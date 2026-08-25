"""
LLM-generated mapping contract.

Given:
  - the raw (snake_cased) source columns
  - the target schema
This asks Claude to classify each column as either:
  (a) an identity column -> simple 1:1 rename, or
  (b) part of a repeating metric group -> needs melting, with a regex
      to extract the period date from the column name

Returns a validated JSON contract ready for apply_contract().
"""

import os
import re
import json
import pandas as pd
from pathlib import Path
from dotenv import load_dotenv 
from anthropic import Anthropic

ENV_PATH = Path(__file__).resolve().parents[2] / ".env.local"
load_dotenv(ENV_PATH)

TARGET_SCHEMA = [
    "retailer", "period_start", "period_end", "period_type", "store_code",
    "store_name", "store_format", "sku", "product_name", "sku_range",
    "size", "brand", "product_category", "uom", "pack_size",
    "quantity_units", "revenue", "source_file", "loaded_at", "data_source",
]

client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def to_snake_case(col: str) -> str:
    s = str(col).strip().lower()
    s = s.replace("|", " ")
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"[\s_]+", "_", s)
    return s.strip("_")


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
     extracts the date substring from each column name in this group
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

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()
    raw = re.sub(r"^```json|```$", "", raw, flags=re.MULTILINE).strip()
    contract = json.loads(raw)

    return validate_contract(contract, raw_columns, target_schema)


def validate_contract(contract: dict, raw_columns: list[str], target_schema: list[str]) -> dict:
    """
    Defensive checks before trusting the LLM's output. Anything that
    fails validation gets dropped rather than silently applied.
    """
    raw_set = set(raw_columns)

    # 1. Validate identity_mapping: source must exist, target must be in schema
    clean_identity = {}
    for src, tgt in contract.get("identity_mapping", {}).items():
        if src not in raw_set:
            print(f"  [dropped] identity_mapping source not found: {src!r}")
            continue
        if tgt not in target_schema:
            print(f"  [dropped] identity_mapping target not in schema: {tgt!r}")
            continue
        clean_identity[src] = tgt

    # 2. Validate melt_groups: columns must exist, regex must compile and
    #    actually match every column in its group, target must be in schema
    clean_groups = []
    for group in contract.get("melt_groups", []):
        tgt = group.get("target_field")
        cols = group.get("columns", [])
        pattern = group.get("period_extract_regex")
        date_fmt = group.get("date_format")

        if tgt not in target_schema:
            print(f"  [dropped group] target not in schema: {tgt!r}")
            continue

        missing = [c for c in cols if c not in raw_set]
        if missing:
            print(f"  [dropped group] columns not found for {tgt!r}: {missing[:3]}...")
            continue

        try:
            compiled = re.compile(pattern)
        except re.error as e:
            print(f"  [dropped group] bad regex for {tgt!r}: {e}")
            continue

        bad_matches = [c for c in cols if not compiled.search(c)]
        if bad_matches:
            print(f"  [dropped group] regex didn't match some columns for {tgt!r}: {bad_matches[:3]}...")
            continue

        # Confirm the date format actually parses on a sample
        sample_col = cols[0]
        m = compiled.search(sample_col)
        try:
            pd.to_datetime(m.group(1), format=date_fmt)
        except Exception as e:
            print(f"  [dropped group] date_format {date_fmt!r} failed on {m.group(1)!r}: {e}")
            continue

        clean_groups.append({
            "target_field": tgt,
            "columns": cols,
            "period_extract_regex": pattern,
            "date_format": date_fmt,
        })

    return {"identity_mapping": clean_identity, "melt_groups": clean_groups}


if __name__ == "__main__":
    src = "../XEL_VENDORS_BRANDS_WEEK_01-01-2026_30-07-2026_1.txt"
    output_path = "mapping_contract.json"

    df = pd.read_csv(src, sep="\t", nrows=5)
    raw_columns = df.columns.tolist()

    print("Calling Claude to generate mapping contract...\n")
    contract = generate_mapping_contract(raw_columns, TARGET_SCHEMA)

    # Write the validated contract out to a file so it can be inspected
    # or handed straight to apply_contract.py
    with open(output_path, "w") as f:
        json.dump(contract, f, indent=2)

    print(f"\nMapping contract saved to: {output_path}")
    print(f"  - identity_mapping entries: {len(contract['identity_mapping'])}")
    print(f"  - melt_groups: {len(contract['melt_groups'])}")
