"""
Mapping contracts for uploaded files: find the confirmed one, or propose one.

A file's layout is located first (layout_detection), its columns profiled over
every row (column_profile), and its layout fingerprinted from header templates,
so next month's file -- new dates in the headers, an extra outlet column --
finds the contract confirmed for this month's without asking the model again.

Only a layout never seen before is sent to the model -- Gemini on Vertex AI,
signed in as the service account, no API key. The proposal comes back as
JSON constrained to a schema built from this file's own headers
(mapping_prompt), is validated (mapping_contract), and is then checked against
the file and the SKU master (mapping_checks) -- statically: nothing here runs
the contract, which is the transformation's job. A proposal that fails a check
is sent back with the evidence, a limited number of times; whatever survives
is parked under mappings/pending/ for a person to review, with the checks
attached and each field's confidence taken from them.

This module only produces contracts. It never transforms or loads data.
"""

import datetime
import json

import pandas as pd
from google import genai
from google.auth.exceptions import GoogleAuthError
from google.genai import errors as genai_errors
from google.genai import types

from app import config
from app.schemas.sellout import BUSINESS_COLUMNS
from app.services import catalog_service, layout_detection, mapping_checks, mapping_prompt, storage
from app.services.column_profile import (
    column_samples,
    detect_column_groups,
    fingerprint,
    header_template,
    layout_templates,
    legacy_fingerprint,
    unordered_fingerprint,
    profile_columns,
    to_snake_case,
)
from app.services.mapping_contract import (
    CONFIDENCE_LEVELS,
    layout_instructions,
    normalize_targets,
    unreviewed_low_confidence,
    validate_contract,
)

__all__ = [
    "CONFIDENCE_LEVELS",
    "column_samples",
    "fingerprint",
    "header_template",
    "legacy_fingerprint",
    "normalize_targets",
    "to_snake_case",
    "unreviewed_low_confidence",
    "validate_contract",
]

# Every pending proposal records which provider and model made it. Gemini is the
# only provider; the field stays so stored proposals keep one shape.
PROVIDER = "gemini"

# Gemini's finish reasons for an answer it withheld; the mapping is declined.
_REFUSAL_FINISH_REASONS = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"}

TARGET_SCHEMA = BUSINESS_COLUMNS

# How many times a proposal that fails its checks is sent back to be fixed
# before it goes to a reviewer as it stands.
MAX_REPAIRS = 2

# Below this share of shared header templates a stored mapping is a different
# layout, not a drifted one, and proposing it would be noise. Above it -- but
# short of an exact fingerprint -- the file is close enough to a mapping we
# already hold that a person should look rather than have it applied silently.
PARTIAL_MATCH_THRESHOLD = 0.6

class MappingConfigError(Exception):
    """The Google Cloud project or credentials for Vertex AI are missing or unusable."""


class MappingGenerationError(Exception):
    """The model returned something that couldn't be parsed into a contract."""


class UnreadableSourceFileError(Exception):
    """The uploaded file's headers couldn't be read."""


# ---- Model client ----------------------------------------------------------------

_gemini_client: genai.Client | None = None


def get_gemini_client() -> genai.Client:
    """
    Build the Gemini-on-Vertex-AI client lazily.

    Reading the project at module scope turns a missing environment variable
    into a failed app startup; this turns it into a clean error on the one
    request that actually needs the model. Auth is Google Application Default
    Credentials, the same service account as BigQuery and GCS.
    """
    global _gemini_client
    if _gemini_client is None:
        try:
            project_id = config.require("GCP_PROJECT_ID")
        except config.ConfigError as e:
            raise MappingConfigError(str(e)) from e
        _gemini_client = genai.Client(
            enterprise=True,
            project=project_id,
            location=config.MAPPING_VERTEX_LOCATION,
        )
    return _gemini_client


# ---- Reading the uploaded bytes -------------------------------------------------

def read_layout(filename: str, data: bytes) -> tuple[pd.DataFrame, dict]:
    """
    The file's data table and its layout (see layout_detection).

    Takes bytes rather than a path because the router has already consumed the
    UploadFile stream -- re-reading it would yield nothing.
    """
    try:
        return layout_detection.read_table(filename, data)
    except layout_detection.LayoutError as e:
        raise UnreadableSourceFileError(f"Could not read headers from {filename!r}: {e}") from e


def read_header_columns(filename: str, data: bytes) -> list[str]:
    """
    The data table's column headers, whitespace-normalised, as the contract's
    field sources and melt selectors will see them.
    """
    frame, _ = read_layout(filename, data)
    return [str(column) for column in frame.columns]


def layout_summary(layout: dict) -> dict:
    """The parts of a layout worth storing with a mapping proposal."""
    return {key: value for key, value in layout.items() if key != "frame"}


# ---- Asking the model for a contract --------------------------------------------


def _gemini_contents(messages: list[dict]) -> list[dict]:
    """
    The conversation in Gemini's shape: the assistant's role is "model".

    The repair loop keeps it as role user/assistant with text content, the
    plainest shape to build and read, and translates it only here.
    """
    return [
        {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
        for m in messages
    ]


def _ask_gemini(messages: list[dict], schema: dict) -> str:
    """One Gemini request (Vertex AI, Google credentials); the JSON text of the answer."""
    request_config = types.GenerateContentConfig(
        system_instruction=mapping_prompt.SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_json_schema=schema,
    )
    try:
        response = get_gemini_client().models.generate_content(
            model=config.MAPPING_MODEL, contents=_gemini_contents(messages), config=request_config
        )
    except GoogleAuthError as e:
        raise MappingConfigError(f"Google credentials for Vertex AI are unusable: {e}") from e
    except genai_errors.APIError as e:
        raise MappingGenerationError(f"The Gemini API call failed: {e}") from e

    # A prompt blocked outright comes back with no candidates at all.
    candidate = response.candidates[0] if response.candidates else None
    if candidate is None or candidate.finish_reason in _REFUSAL_FINISH_REASONS:
        raise MappingGenerationError("Gemini declined to propose a mapping for this file.")
    if candidate.finish_reason == "MAX_TOKENS":
        raise MappingGenerationError("Gemini's proposal was cut off before it was complete.")
    text = response.text
    if not text:
        raise MappingGenerationError("Gemini returned no proposal.")
    return text


def _check_values(profile: dict) -> dict[str, list[str]]:
    """Every column's profiled values: what transforms are validated against."""
    return {column: entry.get("values", []) for column, entry in profile.items()}


def fetch_master_skus() -> list[dict] | None:
    """
    The SKU master's products (read-only), or None when Cloud SQL cannot be
    read -- which fails the product-code check rather than the whole upload.
    """
    try:
        return catalog_service.get_skus()
    except Exception:
        return None


def master_codes(master_skus: list[dict] | None) -> set[str] | None:
    """The master SKU codes, as the product-code check compares them."""
    if master_skus is None:
        return None
    return {str(product["sku"]) for product in master_skus}


def check_contract(
    frame: pd.DataFrame, layout: dict, contract: dict, filename: str, master_skus: list[dict] | None
) -> list[dict]:
    """The static checks of a validated contract against its file (mapping_checks)."""
    return mapping_checks.run_checks(frame, layout, contract, filename, master_codes(master_skus))


def generate_mapping_contract(
    filename: str,
    frame: pd.DataFrame,
    layout: dict,
    exclude_examples: tuple[str, ...] = (),
    master_skus: list[dict] | None = None,
) -> dict:
    """
    Propose a contract for a new layout, check it against the file and the SKU
    master, and send failures back for repair up to MAX_REPAIRS times.

    The contract records where the data sits (its layout, from layout
    detection) beside the model's field decisions. Returns the validated
    contract (each field's confidence taken from the checks), the checks from
    its last round, how many attempts it took, and which provider and model
    made it. A contract that still fails is returned as it stands: the
    reviewer is shown the failing checks and their evidence, and it cannot be
    approved until they pass.
    """
    if master_skus is None:
        master_skus = fetch_master_skus()
    columns = [str(column) for column in frame.columns]
    profile = profile_columns(frame, layout)
    groups = detect_column_groups(columns)
    schema = mapping_prompt.output_schema(columns)
    messages: list[dict] = [{
        "role": "user",
        "content": mapping_prompt.user_prompt(
            filename,
            profile,
            groups,
            layout,
            len(frame),
            master_skus or [],
            mapping_prompt.value_pairs(frame, profile, groups),
            exclude_examples,
        ),
    }]

    contract: dict = {}
    checks: list[dict] = []
    attempts = 0
    for attempts in range(1, MAX_REPAIRS + 2):
        answer_text = _ask_gemini(messages, schema)
        try:
            answer = json.loads(answer_text)
        except json.JSONDecodeError as e:
            raise MappingGenerationError(f"The model did not return valid JSON: {e}") from e

        proposed = mapping_prompt.parse_proposal(answer)
        proposed["layout"] = layout_instructions(layout)
        contract = validate_contract(proposed, columns, TARGET_SCHEMA, samples=_check_values(profile))
        checks = check_contract(frame, layout, contract, filename, master_skus)
        failed = mapping_checks.failures(checks)
        if not failed or attempts > MAX_REPAIRS:
            break
        messages += [
            {"role": "assistant", "content": answer_text},
            {"role": "user", "content": mapping_prompt.repair_prompt(failed, contract["warnings"])},
        ]

    contract = mapping_checks.field_confidence(contract, checks)
    return {
        "contract": contract,
        "checks": checks,
        "attempts": attempts,
        "provider": PROVIDER,
        "model": config.MAPPING_MODEL,
    }


# ---- Stored mappings -------------------------------------------------------------

def find_confirmed(columns: list[str]) -> tuple[str, dict] | tuple[None, None]:
    """
    The confirmed mapping for this layout and the fingerprint it is stored
    under: the ordered template fingerprint first, then compatible historical
    template/exact-header keys whose stored raw columns have the same order.
    """
    # Ordered signatures are authoritative. The other two keys keep contracts
    # confirmed before this rule changed addressable without asking users to
    # recreate them.
    ordered_key = fingerprint(columns)
    for key in dict.fromkeys([
        ordered_key,
        unordered_fingerprint(columns),
        legacy_fingerprint(columns),
    ]):
        envelope = storage.download_json(storage.confirmed_mapping_path(key))
        if not envelope:
            continue
        if key != ordered_key:
            stored_columns = envelope.get("raw_columns") or []
            if not stored_columns or fingerprint(stored_columns) != ordered_key:
                continue
        return key, envelope
    return None, None


def find_partial_match(columns: list[str]) -> dict | None:
    """
    Find the confirmed mapping whose layout most nearly matches this file's.

    A fingerprint is all-or-nothing: a renamed header and a file that is
    plainly last month's layout looks brand new. This catches that case -- the
    retailer added a column, dropped one, or renamed a header -- and reports how
    far apart the two layouts are so a person can decide. Nothing is applied on
    a partial match; the point is that applying it silently would be wrong.

    Compared on the same header templates the fingerprint uses, so new dates or
    an extra outlet never count as a difference. Returns None when nothing
    clears PARTIAL_MATCH_THRESHOLD.
    """
    current = layout_templates(columns)
    if not current:
        return None

    best = None
    for candidate_fp in storage.list_mapping_fingerprints("confirmed"):
        envelope = storage.download_json(storage.confirmed_mapping_path(candidate_fp))
        if not envelope:
            continue
        stored_columns = envelope.get("raw_columns") or []
        stored = layout_templates(stored_columns)
        if not stored:
            continue

        # Jaccard, so a mapping that happens to list many more columns does not
        # win just by covering more of a small file.
        ratio = len(current.keys() & stored.keys()) / len(current.keys() | stored.keys())
        if ratio < PARTIAL_MATCH_THRESHOLD or (best and ratio <= best["match_ratio"]):
            continue

        best = {
            "fingerprint": candidate_fp,
            "name": envelope.get("name"),
            "vendor": envelope.get("vendor"),
            "match_ratio": round(ratio, 3),
            "missing_columns": sorted(
                column for template in stored.keys() - current.keys() for column in stored[template]
            ),
            "extra_columns": sorted(
                column for template in current.keys() - stored.keys() for column in current[template]
            ),
        }

    return best


# ---- The one function the router calls ---------------------------------------

def resolve_mapping(filename: str, data: bytes, uploaded_to: str | None = None) -> dict:
    """
    Work out the mapping contract for an uploaded file.

    Two outcomes, cheapest first:

      - a confirmed contract exists for this layout: returned as-is, no model
        call
      - the layout is unrecognised: a contract is proposed and checked, parked under
        mappings/pending/, and returned for the user to review

    This is a blocking function (network I/O to Vertex AI and GCS) -- the
    router runs it in a thread.
    """
    frame, layout = read_layout(filename, data)
    columns = [str(column) for column in frame.columns]

    confirmed_fp, confirmed = find_confirmed(columns)
    if confirmed:
        return {
            "status": "mapped",
            "fingerprint": confirmed_fp,
            "contract": confirmed.get("contract", {}),
            "name": confirmed.get("name"),
            "vendor": confirmed.get("vendor"),
            "version": confirmed.get("version"),
            "source": "cache",
            "confirmed_at": confirmed.get("confirmed_at"),
        }

    fp = fingerprint(columns)
    proposal = generate_mapping_contract(filename, frame, layout)

    envelope = {
        "fingerprint": fp,
        # Kept so the contract can be re-validated against the real headers on
        # confirmation, even if the user edits it in between.
        "raw_columns": columns,
        "column_samples": column_samples(frame),
        "column_profile": profile_columns(frame, layout),
        "layout": layout_summary(layout),
        "target_schema": TARGET_SCHEMA,
        "contract": proposal["contract"],
        # The proposal as the model made it, so the reviewer's changes can be
        # recorded as a diff against it on approval.
        "proposal": proposal["contract"],
        "checks": proposal["checks"],
        "attempts": proposal["attempts"],
        # Every product code in the file and what the code table makes of it,
        # for the review screen's code table.
        "sku_codes": mapping_checks.sku_codes(frame, proposal["contract"]),
        "example_file": uploaded_to,
        "source_filename": filename,
        "provider": proposal["provider"],
        "model": proposal["model"],
        "proposed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    storage.upload_json(storage.pending_mapping_path(fp), envelope)

    return {
        "status": "pending_confirmation",
        "fingerprint": fp,
        "contract": proposal["contract"],
        "checks": proposal["checks"],
        "source": "generated",
    }


def preview_mapping(filename: str, data: bytes) -> dict:
    """
    Say which of resolve_mapping's outcomes a file would get, without causing it.

    The same lookups in the same order -- confirmed contract, then partial
    match -- but where resolve_mapping would ask the model and park a proposal,
    this only reports "new_layout". No model call and no writes, so the upload
    screen can run it the moment a file is dropped. Raises
    UnreadableSourceFileError when the headers cannot be read, as
    resolve_mapping would.
    """
    columns = read_header_columns(filename, data)

    confirmed_fp, confirmed = find_confirmed(columns)
    if confirmed:
        return {
            "status": "mapped",
            "fingerprint": confirmed_fp,
            "name": confirmed.get("name"),
            "vendor": confirmed.get("vendor"),
        }

    fp = fingerprint(columns)
    partial = find_partial_match(columns)
    if partial:
        return {"status": "partial_match", "fingerprint": fp, "matched": partial}

    return {"status": "new_layout", "fingerprint": fp}
