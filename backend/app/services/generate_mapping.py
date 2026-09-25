"""
LLM-generated mapping contract.

Given:
  - the raw source columns
  - the target schema
This asks Claude to classify each column as either:
  (a) an identity column -> simple 1:1 rename, or
  (b) part of a repeating metric group -> needs melting, with a regex
      to extract the period date from the column name

Returns a validated JSON contract ready for apply_contract().

Contracts are keyed by a fingerprint of the file's column headers, so a second
file with the same headers reuses the already-approved contract instead of
paying for another Claude call.
"""

import io
import re
import json
import hashlib
import datetime
import pandas as pd
from pathlib import Path
from anthropic import Anthropic
from app import config
from app.services import storage

MODEL = config.ANTHROPIC_MODEL

TARGET_SCHEMA = [
    "retailer", "period_start", "period_end", "period_type", "store_code",
    "store_name", "store_format", "sku", "product_name", "sku_range",
    "size", "brand", "product_category", "uom", "pack_size",
    "quantity_units", "revenue", "source_file", "loaded_at", "data_source",
]


# How confident the proposal is in one column's mapping. A reviewer is asked to
# confirm every "low" row by hand before a contract can be approved, so an
# unrecognised or absent value is treated as "low" rather than waved through.
CONFIDENCE_LEVELS = ("high", "medium", "low")

# Below this share of shared columns a stored mapping is a different layout,
# not a drifted one, and proposing it would be noise. Above it -- but short of
# an exact fingerprint -- the file is close enough to a mapping we already hold
# that a person should look rather than have it applied silently.
PARTIAL_MATCH_THRESHOLD = 0.6


class MappingConfigError(Exception):
    """The Anthropic API key is missing or unusable."""


class MappingGenerationError(Exception):
    """Claude returned something that couldn't be parsed into a contract."""


class UnreadableSourceFileError(Exception):
    """The uploaded file's headers couldn't be read."""


_client: Anthropic | None = None


def get_client() -> Anthropic:
    """
    Build the Anthropic client lazily.

    Reading the key at module scope turns a missing environment variable into a
    failed app startup; this turns it into a clean error on the one request
    that actually needs the key.
    """
    global _client
    if _client is None:
        try:
            api_key = config.require("ANTHROPIC_API_KEY")
        except config.ConfigError as e:
            raise MappingConfigError(str(e)) from e
        _client = Anthropic(api_key=api_key)
    return _client


def to_snake_case(col: str) -> str:
    s = str(col).strip().lower()
    s = s.replace("|", " ")
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"[\s_]+", "_", s)
    return s.strip("_")


# ---- Reading headers out of the uploaded bytes ------------------------------

def read_header_frame(filename: str, data: bytes, nrows: int = 20) -> pd.DataFrame:
    """
    Read the top of an uploaded file — headers plus a few rows.

    Takes bytes rather than a path because the router has already consumed the
    UploadFile stream — re-reading it would yield nothing. Only the first rows
    are parsed: enough for the header row and a handful of sample values per
    column, not the whole upload.
    """
    ext = Path(filename).suffix.lower()
    bio = io.BytesIO(data)

    try:
        if ext in (".xlsx", ".xlsm"):
            return pd.read_excel(bio, nrows=nrows)
        if ext == ".csv":
            return pd.read_csv(bio, nrows=nrows)
        # .txt — sniff the delimiter instead of assuming tab. The python
        # engine is required for sep=None.
        return pd.read_csv(bio, sep=None, engine="python", nrows=nrows)
    except Exception as e:
        raise UnreadableSourceFileError(f"Could not read headers from {filename!r}: {e}")


def read_header_columns(filename: str, data: bytes) -> list[str]:
    """
    Pull the column headers out of an uploaded file's bytes.

    Column names are returned exactly as they appear in the file, because the
    contract's identity_mapping keys and melt_groups column lists have to match
    the real dataframe columns when apply_contract() runs.
    """
    return [str(c) for c in read_header_frame(filename, data, nrows=5).columns]


def column_samples(dataframe: pd.DataFrame, limit: int = 5) -> dict[str, list[str]]:
    """
    A few real values per source column, for the review screen.

    A reviewer cannot judge whether "Article Description" is a product name or
    a category from the header alone — the values decide it. Blanks are skipped
    rather than padded, so a column that samples empty is visibly empty.
    """
    samples: dict[str, list[str]] = {}

    for column in dataframe.columns:
        values = dataframe[column].dropna().astype(str).str.strip()
        values = values[values != ""].head(limit)
        samples[str(column)] = values.tolist()

    return samples


def fingerprint(columns: list[str]) -> str:
    """
    Stable identifier for a set of column headers.

    Normalised and sorted, so the same layout fingerprints identically even if
    the columns arrive in a different order or with cosmetic punctuation
    differences. That's safe because the contract addresses columns by name,
    never by position.
    """
    normalized = sorted(to_snake_case(c) for c in columns)
    joined = "\x1f".join(normalized)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


# ---- Asking Claude for a contract -------------------------------------------

def generate_mapping_contract(
    raw_columns: list[str],
    target_schema: list[str],
    samples: dict[str, list[str]] | None = None,
) -> dict:
    """
    Calls Claude once, asking it to classify every source column and
    return a two-part contract: identity_mapping + melt_groups, plus a
    confidence level and one-line rationale per decision.

    `samples` — a few real values per column — is passed through when
    available. Headers alone are often ambiguous ("Size" could be a pack size
    or a garment size); the values usually settle it, and a proposal made
    without them is guessing where it need not.
    """
    sample_block = (
        f"""
Sample values from the file (up to 5 per column):
{json.dumps(samples, indent=2, default=str)}
"""
        if samples
        else ""
    )

    prompt = f"""You are analyzing a spreadsheet's column headers to prepare a
reshape+rename plan. Some columns are one-off identity fields. Others are
part of a REPEATING GROUP — the same metric measured across many periods
(e.g. one column per week or month), which needs to be melted from wide
format into long format rather than simply renamed.

Target schema (only use these exact field names):
{json.dumps(target_schema, indent=2)}

Raw source columns (in original order):
{json.dumps(raw_columns, indent=2)}
{sample_block}
Your task:
1. Group any columns that repeat per time period (same metric, different
   dates/weeks/months in the column name) into "melt_groups". Each group
   needs:
   - "target_field": which target schema field this metric maps to
     (e.g. "revenue", "quantity_units")
   - "columns": the exact list of raw column names in this group
   - "period_extract_regex": a Python regex with ONE capture group that
     extracts the date substring from each column name in this group
   - "date_format": the strptime format string matching that date substring
     (e.g. "%d-%m-%Y", "%Y-%m-%d", "%m/%d/%Y")
2. Map any remaining columns into "identity_mapping" as
   {{"raw_column_name": "target_field"}}.
   A column that carries MORE THAN ONE target field's worth of information
   maps to a list instead: {{"raw_column_name": ["field_a", "field_b"]}}.
   An article description reading "VEXA ADULT PANTS XL 10S" holds the
   product name, the size and the pack size all at once, so map it to every
   field it carries rather than picking one and losing the rest. A later
   step pulls each field out of the value; your job is to say which fields
   are in there.
   Two different columns may not map to the same target field.
3. Leave out any column that has no clear match — do not force a mapping.
   A reviewer is shown every field you left unfilled and can assign it by
   hand, so an honest gap costs them one click. A confident wrong answer
   costs them finding it first.
4. Do not invent target fields outside the schema list.
5. These fields matter most, so check the columns against them before you
   decide a column has no home: sku, store_code, store_name, store_format,
   brand, uom, pack_size, product_name, product_category, sku_range, size,
   retailer. Note that period_start, period_end and period_type are NOT
   mapped from columns — they are read out of the melt groups' own column
   headers, so never map a column to them.
6. For EVERY target field you filled, add an entry to "annotations" keyed by
   that TARGET FIELD (not the source column — one column feeding two fields
   can be certain about one and guessing at the other), giving:
   - "confidence": "high" if the header (and its values) leave no real doubt,
     "medium" if the mapping is likely but a reviewer should glance at it,
     "low" if you are guessing between plausible target fields. Be honest —
     a person reviews every "low" row by hand, and a wrong "high" is worse
     than an admitted "low".
   - "rationale": one short sentence saying what the decision rests on.
     Cite the sample values where they are what decided it.
   Give each melt group the same two keys directly on the group object.

Respond with ONLY raw JSON in this exact shape, no markdown fences, no explanation:
{{
  "identity_mapping": {{
    "raw_col": "target_field",
    "another_raw_col": ["target_field_a", "target_field_b"]
  }},
  "melt_groups": [
    {{
      "target_field": "...",
      "columns": ["...", "..."],
      "period_extract_regex": "...",
      "date_format": "...",
      "confidence": "high|medium|low",
      "rationale": "..."
    }}
  ],
  "annotations": {{
    "target_field": {{"confidence": "high|medium|low", "rationale": "..."}}
  }}
}}
"""

    response = get_client().messages.create(
        model=MODEL,
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()
    raw = re.sub(r"^```json|```$", "", raw, flags=re.MULTILINE).strip()

    try:
        contract = json.loads(raw)
    except json.JSONDecodeError as e:
        raise MappingGenerationError(f"Claude did not return valid JSON: {e}")

    return validate_contract(contract, raw_columns, target_schema)


def normalize_targets(value) -> list[str]:
    """
    Read one identity_mapping entry as the list of target fields it fills.

    A source column can feed more than one field -- an article description
    carries both the product name and the size buried in it -- so an entry's
    value is either a single target field or a list of them. One target stays
    a plain string so existing contracts are unchanged and stay readable; the
    list form only appears where it is actually needed.
    """
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value if item]
    return []


def _clean_annotation(source: dict | None) -> dict:
    """
    Normalise one column's confidence + rationale.

    Anything the model omitted, misspelled or invented becomes "low" with no
    rationale. Treating an unreadable confidence as high would let a guess
    through the review gate on a formatting mistake.
    """
    raw = source or {}
    level = str(raw.get("confidence") or "").strip().lower()
    rationale = str(raw.get("rationale") or "").strip()

    return {
        "confidence": level if level in CONFIDENCE_LEVELS else "low",
        "rationale": rationale,
    }


def validate_contract(contract: dict, raw_columns: list[str], target_schema: list[str]) -> dict:
    """
    Defensive checks before trusting the contract. Anything that fails
    validation gets dropped rather than silently applied.

    Every drop is collected into a "warnings" list on the returned contract
    instead of being printed, because a person now reviews this output before
    approving it — they need to see what was discarded, not the server logs.
    """
    raw_set = set(raw_columns)
    warnings: list[str] = []
    annotations_in = contract.get("annotations") or {}

    # Which source is already filling each target field. A column may feed
    # several fields, but a field can only come from one place -- two sources
    # writing the same target would produce two columns of the same name and
    # whichever won would be luck.
    claimed: dict[str, str] = {}

    # 1. Validate identity_mapping: source must exist, targets must be in
    #    schema and not already taken.
    clean_identity = {}
    clean_annotations = {}
    for src, value in (contract.get("identity_mapping") or {}).items():
        if src not in raw_set:
            warnings.append(f"Dropped identity mapping — source column not found: {src!r}")
            continue

        kept = []
        for tgt in normalize_targets(value):
            if tgt not in target_schema:
                warnings.append(f"Dropped identity mapping — target not in schema: {tgt!r}")
                continue
            if tgt in claimed:
                warnings.append(
                    f"Dropped identity mapping — {tgt!r} is already filled by "
                    f"{claimed[tgt]!r}, so {src!r} cannot also fill it"
                )
                continue

            claimed[tgt] = src
            kept.append(tgt)
            # Annotations are keyed by target field, since that is what a
            # confidence is about: one column can feed two fields and be a sure
            # thing for one of them and a guess for the other. Older contracts
            # keyed them by source column, so fall back to that.
            clean_annotations[tgt] = _clean_annotation(
                annotations_in.get(tgt) or annotations_in.get(src)
            )

        if kept:
            clean_identity[src] = kept[0] if len(kept) == 1 else kept

    # 2. Validate melt_groups: columns must exist, regex must compile and
    #    actually match every column in its group, target must be in schema
    clean_groups = []
    for group in (contract.get("melt_groups") or []):
        tgt = group.get("target_field")
        cols = group.get("columns", [])
        pattern = group.get("period_extract_regex")
        date_fmt = group.get("date_format")

        if tgt not in target_schema:
            warnings.append(f"Dropped melt group — target not in schema: {tgt!r}")
            continue

        if tgt in claimed:
            warnings.append(
                f"Dropped melt group — {tgt!r} is already filled by {claimed[tgt]!r}"
            )
            continue

        if not cols:
            warnings.append(f"Dropped melt group for {tgt!r} — no columns listed")
            continue

        missing = [c for c in cols if c not in raw_set]
        if missing:
            warnings.append(
                f"Dropped melt group for {tgt!r} — columns not found in file: {missing[:3]}"
            )
            continue

        if not pattern:
            warnings.append(f"Dropped melt group for {tgt!r} — no period_extract_regex")
            continue

        try:
            compiled = re.compile(pattern)
        except re.error as e:
            warnings.append(f"Dropped melt group for {tgt!r} — bad regex: {e}")
            continue

        if compiled.groups < 1:
            warnings.append(
                f"Dropped melt group for {tgt!r} — regex has no capture group"
            )
            continue

        bad_matches = [c for c in cols if not compiled.search(c)]
        if bad_matches:
            warnings.append(
                f"Dropped melt group for {tgt!r} — regex didn't match: {bad_matches[:3]}"
            )
            continue

        # Confirm the date format actually parses on a sample
        sample_col = cols[0]
        m = compiled.search(sample_col)
        try:
            pd.to_datetime(m.group(1), format=date_fmt)
        except Exception as e:
            warnings.append(
                f"Dropped melt group for {tgt!r} — date_format {date_fmt!r} "
                f"failed on {m.group(1)!r}: {e}"
            )
            continue

        claimed[tgt] = f"melt group over {len(cols)} column(s)"
        annotation = _clean_annotation(group)
        clean_groups.append({
            "target_field": tgt,
            "columns": cols,
            "period_extract_regex": pattern,
            "date_format": date_fmt,
            **annotation,
        })

    mapped = set(clean_identity) | {c for g in clean_groups for c in g["columns"]}
    unmapped = [c for c in raw_columns if c not in mapped]
    if unmapped:
        warnings.append(f"{len(unmapped)} column(s) left unmapped: {unmapped[:5]}")

    return {
        "identity_mapping": clean_identity,
        "melt_groups": clean_groups,
        "annotations": clean_annotations,
        "warnings": warnings,
    }


def find_partial_match(columns: list[str]) -> dict | None:
    """
    Find the confirmed mapping whose columns most nearly match this file's.

    A fingerprint is all-or-nothing: one added column and a file that is
    plainly last month's layout looks brand new. This catches that case — the
    retailer added a column, dropped one, or renamed a header — and reports how
    far apart the two layouts are so a person can decide. Nothing is applied on
    a partial match; the point is that applying it silently would be wrong.

    Comparison is on the same normalised, unordered column names the
    fingerprint uses, so it agrees with the exact-match path about what "the
    same column" means. Returns None when nothing clears
    PARTIAL_MATCH_THRESHOLD.
    """
    normalized = {to_snake_case(column) for column in columns}
    if not normalized:
        return None

    best = None

    for candidate_fp in storage.list_mapping_fingerprints("confirmed"):
        envelope = storage.download_json(storage.confirmed_mapping_path(candidate_fp))
        if not envelope:
            continue

        stored_columns = envelope.get("raw_columns") or []
        stored = {to_snake_case(column) for column in stored_columns}
        if not stored:
            continue

        # Jaccard, so a mapping that happens to list many more columns does not
        # win just by covering more of a small file.
        ratio = len(normalized & stored) / len(normalized | stored)
        if ratio < PARTIAL_MATCH_THRESHOLD or (best and ratio <= best["match_ratio"]):
            continue

        by_normal = {to_snake_case(column): column for column in stored_columns}
        best = {
            "fingerprint": candidate_fp,
            "name": envelope.get("name"),
            "vendor": envelope.get("vendor"),
            "match_ratio": round(ratio, 3),
            "missing_columns": sorted(
                by_normal[key] for key in stored - normalized
            ),
            "extra_columns": sorted(
                column for column in columns if to_snake_case(column) not in stored
            ),
        }

    return best


# ---- The one function the router calls ---------------------------------------

def resolve_mapping(filename: str, data: bytes, uploaded_to: str | None = None) -> dict:
    """
    Work out the mapping contract for an uploaded file.

    Three outcomes, cheapest first:

      - a confirmed contract exists for this exact column layout: returned
        as-is, no Claude call
      - the layout nearly matches a confirmed mapping: returned as a partial
        match for review, no Claude call and nothing applied
      - the layout is new: a fresh contract is generated, parked under
        mappings/pending/, and returned for the user to review

    This is a blocking function (network I/O to both Anthropic and GCS) — the
    router runs it in a thread.
    """
    frame = read_header_frame(filename, data)
    columns = [str(column) for column in frame.columns]
    samples = column_samples(frame)
    fp = fingerprint(columns)

    confirmed = storage.download_json(storage.confirmed_mapping_path(fp))
    if confirmed:
        return {
            "status": "mapped",
            "fingerprint": fp,
            "contract": confirmed.get("contract", {}),
            "name": confirmed.get("name"),
            "vendor": confirmed.get("vendor"),
            "source": "cache",
            "confirmed_at": confirmed.get("confirmed_at"),
        }

    partial = find_partial_match(columns)
    if partial:
        return {
            "status": "partial_match",
            "fingerprint": fp,
            "source": "partial",
            "matched": partial,
        }

    contract = generate_mapping_contract(columns, TARGET_SCHEMA, samples)

    envelope = {
        "fingerprint": fp,
        # Kept so the contract can be re-validated against the real headers on
        # confirmation, even if the user edits it in between.
        "raw_columns": columns,
        "column_samples": samples,
        "target_schema": TARGET_SCHEMA,
        "contract": contract,
        "example_file": uploaded_to,
        "source_filename": filename,
        "model": MODEL,
        "proposed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    storage.upload_json(storage.pending_mapping_path(fp), envelope)

    return {
        "status": "pending_confirmation",
        "fingerprint": fp,
        "contract": contract,
        "source": "generated",
    }


if __name__ == "__main__":
    src = Path("../XEL_VENDORS_BRANDS_WEEK_01-01-2026_30-07-2026_1.txt")

    cols = read_header_columns(src.name, src.read_bytes())
    print(f"Fingerprint: {fingerprint(cols)}")
    print("Calling Claude to generate mapping contract...\n")

    result = generate_mapping_contract(cols, TARGET_SCHEMA)

    with open("mapping_contract.json", "w") as f:
        json.dump(result, f, indent=2)

    print("\nMapping contract saved to: mapping_contract.json")
    print(f"  - identity_mapping entries: {len(result['identity_mapping'])}")
    print(f"  - melt_groups: {len(result['melt_groups'])}")
    for w in result["warnings"]:
        print(f"  - warning: {w}")
