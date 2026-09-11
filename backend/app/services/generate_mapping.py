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

import os
import io
import re
import json
import hashlib
import datetime
import pandas as pd
from pathlib import Path
from dotenv import load_dotenv
from anthropic import Anthropic

from app.services import storage

ENV_PATH = Path(__file__).resolve().parents[2] / ".env.local"
load_dotenv(ENV_PATH)

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")

TARGET_SCHEMA = [
    "retailer", "period_start", "period_end", "period_type", "store_code",
    "store_name", "store_format", "sku", "product_name", "sku_range",
    "size", "brand", "product_category", "uom", "pack_size",
    "quantity_units", "revenue", "source_file", "loaded_at", "data_source",
]


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
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise MappingConfigError("ANTHROPIC_API_KEY is not set")
        _client = Anthropic(api_key=api_key)
    return _client


def to_snake_case(col: str) -> str:
    s = str(col).strip().lower()
    s = s.replace("|", " ")
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"[\s_]+", "_", s)
    return s.strip("_")


# A period column embeds the reporting range in its own name (a week number,
# a DD-MM-YYYY or YYYY-MM-DD date), so two files from the same retailer
# template fingerprint as different layouts the moment the range moves on.
# Collapsing those tokens to a placeholder before hashing keeps the
# fingerprint tied to the template's shape rather than one snapshot of it.
#
# Operates on the underscore-split tokens rather than a regex with \b: after
# to_snake_case every separator is already "_", and \b does not fire between
# two underscore-joined word characters (underscore counts as \w), so a
# boundary-based regex silently never matches here.
def _is_date_triplet(a: str, b: str, c: str) -> bool:
    if not (a.isdigit() and b.isdigit() and c.isdigit()):
        return False
    if len(c) == 4 and len(a) <= 2 and len(b) <= 2:
        return True  # DD_MM_YYYY
    if len(a) == 4 and len(b) <= 2 and len(c) <= 2:
        return True  # YYYY_MM_DD
    return False


def _canonicalize_period_tokens(normalized: str) -> str:
    parts = normalized.split("_")
    canonical: list[str] = []
    i = 0
    while i < len(parts):
        if parts[i] in ("week", "month") and i + 1 < len(parts) and parts[i + 1].isdigit():
            canonical.extend([parts[i], "n"])
            i += 2
            continue
        if i + 2 < len(parts) and _is_date_triplet(parts[i], parts[i + 1], parts[i + 2]):
            canonical.append("date")
            i += 3
            continue
        canonical.append(parts[i])
        i += 1
    return "_".join(canonical)


# ---- Reading headers out of the uploaded bytes ------------------------------

def _read_header_dataframe(filename: str, data: bytes) -> pd.DataFrame:
    """
    Parse just the first few rows of an uploaded file's bytes.

    Takes bytes rather than a path because the router has already consumed the
    UploadFile stream — re-reading it would yield nothing. dtype=str so a
    sample cell reads back as the same text a person would see in the file,
    not a pandas-inferred float (e.g. "100" rather than "100.0").
    """
    ext = Path(filename).suffix.lower()
    bio = io.BytesIO(data)

    try:
        if ext in (".xlsx", ".xlsm"):
            return pd.read_excel(bio, nrows=5, dtype=str)
        elif ext == ".csv":
            return pd.read_csv(bio, nrows=5, dtype=str)
        else:
            # .txt — sniff the delimiter instead of assuming tab. The python
            # engine is required for sep=None.
            return pd.read_csv(bio, sep=None, engine="python", nrows=5, dtype=str)
    except Exception as e:
        raise UnreadableSourceFileError(f"Could not read headers from {filename!r}: {e}")


def read_header_columns(filename: str, data: bytes) -> list[str]:
    """
    Pull the column headers out of an uploaded file's bytes.

    Column names are returned exactly as they appear in the file, because the
    contract's identity_mapping keys and melt_groups column lists have to match
    the real dataframe columns when apply_contract() runs.
    """
    df = _read_header_dataframe(filename, data)
    return [str(c) for c in df.columns]


def read_sample_row(filename: str, data: bytes) -> dict[str, str]:
    """
    First non-blank value per column, kept alongside a proposed contract so
    the review screen can show a real example next to each mapping rule
    instead of just the column name. Best-effort: a column with no non-blank
    value in the first few rows is simply left out.
    """
    df = _read_header_dataframe(filename, data)
    sample: dict[str, str] = {}
    for column in df.columns:
        values = df[column].dropna()
        values = values[values.str.strip() != ""] if not values.empty else values
        if not values.empty:
            sample[str(column)] = str(values.iloc[0])
    return sample


def fingerprint(columns: list[str]) -> str:
    """
    Stable identifier for a set of column headers.

    Normalised, deduplicated after collapsing period tokens (week number,
    embedded date), and sorted — so the same layout fingerprints identically
    whether the columns arrive in a different order, with cosmetic
    punctuation differences, or covering a different date range with a
    different number of period columns. That's safe because contract
    application (see apply_contract) resolves melt-group membership by
    re-matching each group's own period_extract_regex against the file at
    hand rather than trusting the literal column list frozen at confirm time.
    """
    canonical = sorted({_canonicalize_period_tokens(to_snake_case(c)) for c in columns})
    joined = "\x1f".join(canonical)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


# ---- Asking Claude for a contract -------------------------------------------

def generate_mapping_contract(raw_columns: list[str], target_schema: list[str]) -> dict:
    """
    Calls Claude once, asking it to classify every source column and
    return a two-part contract: identity_mapping + melt_groups.
    """
    prompt = f"""You are analyzing a spreadsheet's column headers to prepare a
reshape+rename plan. Some columns are one-off identity fields. Others are
part of a REPEATING GROUP — the same metric measured across many periods
(e.g. one column per week or month), which needs to be melted from wide
format into long format rather than simply renamed.

Target schema (only use these exact field names):
{json.dumps(target_schema, indent=2)}

Raw source columns (in original order):
{json.dumps(raw_columns, indent=2)}

Your task:
1. Group any columns that repeat per time period (same metric, different
   dates/weeks/months in the column name) into "melt_groups". Each group
   needs:
   - "target_field": which target schema field this metric maps to
     (e.g. "revenue", "quantity_units")
   - "columns": the exact list of raw column names in this group
   - "period_extract_regex": a Python regex with ONE capture group that
     extracts the date substring from each column name in this group.
     This contract gets reused later against other files covering different
     date ranges, matched by re-running this regex against whatever columns
     that future file has — so it must include enough of the metric's own
     label (not just the date) that it CANNOT also match a sibling group's
     columns. Two groups differing only by metric name (e.g. "Sales Week 1"
     vs "Qty Week 1") must get regexes anchored to "Sales" and "Qty"
     respectively, not a shared pattern like the date alone.
   - "date_format": the strptime format string matching that date substring
     (e.g. "%d-%m-%Y", "%Y-%m-%d", "%m/%d/%Y")
2. Map any remaining columns that clearly correspond to ONE target schema
   field into "identity_mapping" as {{"raw_column_name": "target_field"}}.
3. Leave out any column that has no clear match — do not force a mapping.
4. Do not invent target fields outside the schema list.

Respond with ONLY raw JSON in this exact shape, no markdown fences, no explanation:
{{
  "identity_mapping": {{"raw_col": "target_field", ...}},
  "melt_groups": [
    {{
      "target_field": "...",
      "columns": ["...", "..."],
      "period_extract_regex": "...",
      "date_format": "..."
    }}
  ]
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

    # 1. Validate identity_mapping: source must exist, target must be in schema
    clean_identity = {}
    for src, tgt in (contract.get("identity_mapping") or {}).items():
        if src not in raw_set:
            warnings.append(f"Dropped identity mapping — source column not found: {src!r}")
            continue
        if tgt not in target_schema:
            warnings.append(f"Dropped identity mapping — target not in schema: {tgt!r}")
            continue
        clean_identity[src] = tgt

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

        clean_groups.append({
            "target_field": tgt,
            "columns": cols,
            "period_extract_regex": pattern,
            "date_format": date_fmt,
        })

    mapped = set(clean_identity) | {c for g in clean_groups for c in g["columns"]}
    unmapped = [c for c in raw_columns if c not in mapped]
    if unmapped:
        warnings.append(f"{len(unmapped)} column(s) left unmapped: {unmapped[:5]}")

    # apply_contract re-matches each group's period_extract_regex against
    # whatever columns a future file actually has, rather than trusting this
    # exact column list forever (see apply_contract.py) -- that only stays
    # correct if each group's regex is scoped to just its own columns. A
    # regex broad enough to also match a sibling group's columns works fine
    # today (this file's literal columns disambiguate it) but would silently
    # misclassify data the next time this same contract is reused.
    for group in clean_groups:
        sibling_columns = {
            c for g in clean_groups if g is not group for c in g["columns"]
        }
        compiled = re.compile(group["period_extract_regex"])
        ambiguous = [c for c in sibling_columns if compiled.search(c)]
        if ambiguous:
            warnings.append(
                f"period_extract_regex for {group['target_field']!r} also matches "
                f"another group's column(s) ({ambiguous[:3]}) — it should be scoped "
                f"tighter or this contract may misclassify columns when reused "
                f"against a future file."
            )

    return {
        "identity_mapping": clean_identity,
        "melt_groups": clean_groups,
        "warnings": warnings,
    }


# ---- The one function the router calls ---------------------------------------

def resolve_mapping(
    filename: str,
    data: bytes,
    uploaded_to: str | None = None,
    force_regenerate: bool = False,
) -> dict:
    """
    Work out the mapping contract for an uploaded file.

    If a confirmed contract already exists for this column layout, it is
    returned as-is and no Claude call is made. Otherwise a fresh contract is
    generated, parked under mappings/pending/, and returned for the user to
    review.

    force_regenerate skips the cache lookup even when a confirmed contract
    exists for this fingerprint. The fingerprint now matches on the file's
    structural shape (see fingerprint()), not its literal column text, so a
    cache hit can point at a contract whose identity columns use different
    raw casing than this file actually has. The caller sets this after such
    a contract fails to apply, to get one regenerated against this file's
    real columns instead of failing the upload over a stale cache entry.

    This is a blocking function (network I/O to both Anthropic and GCS) — the
    router runs it in a thread.
    """
    columns = read_header_columns(filename, data)
    fp = fingerprint(columns)

    if not force_regenerate:
        confirmed = storage.download_json(storage.confirmed_mapping_path(fp))
        if confirmed:
            return {
                "status": "mapped",
                "fingerprint": fp,
                "contract": confirmed.get("contract", {}),
                "source": "cache",
                "confirmed_at": confirmed.get("confirmed_at"),
            }

    contract = generate_mapping_contract(columns, TARGET_SCHEMA)

    envelope = {
        "fingerprint": fp,
        # Kept so the contract can be re-validated against the real headers on
        # confirmation, even if the user edits it in between.
        "raw_columns": columns,
        "target_schema": TARGET_SCHEMA,
        "contract": contract,
        # A real example value per column, so the review screen can show what
        # this rule actually produces instead of just the column name.
        "sample_row": read_sample_row(filename, data),
        "example_file": uploaded_to,
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
