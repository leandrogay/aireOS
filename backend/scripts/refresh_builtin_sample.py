"""
Refresh the example row shown for the built-in FairPrice mapping.

The built-in mapping (fairprice_wide_v1) is hardcoded Python, not a stored
contract, so unlike a confirmed/pending mapping it has no envelope with an
example_file to draw a sample from. This scans uploads/ for a real file the
built-in recognizer actually matches, runs it through the real pipeline
(find_matching_mapping -> process_and_validate), and stores the first output
row -- keyed by target field, since several of these fields (size, retailer,
period_start...) are transform outputs with no single input cell to show --
at storage.builtin_sample_path() for the mappings API to serve.

Run from backend/ with the venv active:
    python scripts/refresh_builtin_sample.py
"""

import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import storage
from app.services.apply_contract import read_source_dataframe
from app.services.mapping_service import extract_header_signature, find_matching_mapping
from app.services.validation_service import process_and_validate
from app.routers.uploads import _preview


def find_builtin_example() -> tuple[str, bytes] | None:
    """The most recently uploaded file the built-in recognizer matches."""
    client = storage.get_storage_client()
    bucket = client.bucket(storage.BUCKET_NAME)
    blobs = sorted(
        (b for b in bucket.list_blobs(prefix="uploads/") if not b.name.endswith("/")),
        key=lambda b: b.updated,
        reverse=True,
    )

    for blob in blobs:
        filename = Path(blob.name).name
        try:
            data = blob.download_as_bytes()
            dataframe = read_source_dataframe(filename, data)
            headers = extract_header_signature(dataframe)
        except Exception:
            continue
        if find_matching_mapping(headers):
            return blob.name, data

    return None


def main() -> None:
    found = find_builtin_example()
    if not found:
        print("No file under uploads/ matches the built-in FairPrice recognizer.")
        return

    blob_path, data = found
    filename = Path(blob_path).name
    dataframe = read_source_dataframe(filename, data)
    headers = extract_header_signature(dataframe)
    builtin = find_matching_mapping(headers)
    validated = process_and_validate(dataframe, builtin, filename)

    if validated["valid_df"].empty:
        print(f"{blob_path} matched but produced no valid rows -- skipping.")
        return

    sample_row = _preview(validated["valid_df"], limit=1)[0]
    envelope = {
        "example_file": f"gs://{storage.BUCKET_NAME}/{blob_path}",
        "sample_row": sample_row,
        "refreshed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    storage.upload_json(storage.builtin_sample_path(), envelope)
    print(f"Refreshed builtin sample from {blob_path}")
    for field, value in sample_row.items():
        print(f"  {field}: {value!r}")


if __name__ == "__main__":
    main()
