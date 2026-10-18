"""
Proposing a contract for a new layout, and finding the confirmed one for a
known layout -- with a fake Anthropic client and SKU master, so no network.

What must hold: the model can only name this file's headers; a proposal that
fails its checks is sent back with the evidence a limited number of times; a
product code that is not a master SKU fails the proposal; a known layout --
including next month's file of it -- never calls Claude.
"""

import json

import pytest
from conftest import fairprice_txt, sheng_siong_xlsx

from app.services import generate_mapping as gm
from app.services import reference_contracts


class FakeBlock:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class FakeResponse:
    def __init__(self, text, stop_reason="end_turn"):
        self.content = [FakeBlock(text)]
        self.stop_reason = stop_reason


class FakeMessages:
    """Answers each create() call with the next scripted answer; records the calls."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        answer = self.answers.pop(0)
        if isinstance(answer, FakeResponse):
            return answer
        return FakeResponse(json.dumps(answer))


class FakeClient:
    def __init__(self, answers):
        self.messages = FakeMessages(answers)


def _answer(contract: dict) -> dict:
    """A reference contract written the way the model's schema asks for it."""
    fields = []
    for target, entry in contract["fields"].items():
        transforms = []
        for transform in entry.get("transforms") or []:
            factors = [
                {"uom": uom, "factor": None if isinstance(f, dict) else f, "factor_column": f.get("column") if isinstance(f, dict) else None}
                for uom, f in (transform.get("factors") or {}).items()
            ]
            transforms.append({
                "type": transform["type"], "pattern": transform.get("pattern"), "group": transform.get("group"),
                "values": [{"from": k, "to": v} for k, v in (transform.get("values") or {}).items()],
                "rules": transform.get("rules") or [], "default": transform.get("default"),
                "case_sensitive": False, "column": transform.get("column"), "factors": factors,
                "format": transform.get("format"),
            })
        fields.append({
            "target": target, "status": entry["status"], "source": entry.get("source"),
            "melt_group": entry.get("melt_group"), "from_field": entry.get("from_field"),
            "value": entry.get("value"), "reason": entry.get("reason"), "transforms": transforms,
            "confidence": "high", "rationale": "",
        })
    groups = [{
        "id": group["id"], "select_kind": group["select"]["kind"],
        "select_pattern": group["select"].get("pattern"), "select_after": group["select"].get("after"),
        "select_before": group["select"].get("before"), "key_target": group["key"]["target"],
        "key_pattern": group["key"].get("pattern"), "date_format": group["key"].get("date_format"),
        "period_type": group.get("period_type"), "value_target": group["value_target"],
        "confidence": "high", "rationale": "",
    } for group in contract["melt_groups"]]
    return _no_nulls({"fields": fields, "melt_groups": groups, "aggregate_to_month": bool(contract.get("aggregate"))})


def _no_nulls(value, key=None):
    """An answer the way the schema has the model write it: "" or 0 for an unused parameter."""
    if isinstance(value, dict):
        return {k: _no_nulls(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_no_nulls(v) for v in value]
    if value is None:
        return 0 if key in ("group", "factor") else ""
    return value


MASTER = [
    {"sku": sku, "product_name": name, "sku_range": None, "size": name.rsplit(" ", 1)[-1]}
    for sku, name in {
        "13255043": "Aire Adult Pants XL", "13255044": "Aire Adult Pants S/M", "13255045": "Aire Adult Pants L",
        "13271338": "Aire Ultra Tape L", "13271339": "Aire Ultra Pants S/M", "13271340": "Aire Ultra Pants L",
    }.items()
]


@pytest.fixture(autouse=True)
def sku_master(monkeypatch):
    """The SKU master, served from memory instead of Cloud SQL."""
    monkeypatch.setattr(gm.catalog_service, "get_skus", lambda: MASTER)


def _install(monkeypatch, answers):
    client = FakeClient(answers)
    monkeypatch.setattr(gm, "get_client", lambda: client)
    return client.messages


def _sheng_siong():
    return gm.read_layout("claim.xlsx", sheng_siong_xlsx())


def _claim_as_revenue():
    contract = reference_contracts.reference_contract("sheng_siong_claim")
    contract["fields"]["revenue"] = {"status": "mapped", "source": "Supplier Claim"}
    return contract


# ---- The proposal --------------------------------------------------------------------

def test_a_proposal_that_passes_its_checks_is_returned_after_one_call(monkeypatch):
    messages = _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])
    frame, layout = _sheng_siong()

    proposal = gm.generate_mapping_contract("claim.xlsx", frame, layout)

    assert proposal["attempts"] == 1
    assert len(messages.calls) == 1
    assert proposal["contract"]["fields"]["revenue"]["status"] == "not_available"
    assert not [c for c in proposal["checks"] if c["level"] == "error" and not c["passed"]]


def test_the_contract_records_the_layout_and_the_roll_up(monkeypatch):
    _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])
    frame, layout = _sheng_siong()

    contract = gm.generate_mapping_contract("claim.xlsx", frame, layout)["contract"]

    assert contract["layout"]["header_row"] == 7
    assert contract["layout"]["fill_down"] == ["BusinessDate"]
    assert contract["aggregate"]["period"] == "month"


def test_an_unknown_product_code_fails_the_proposal_and_is_sent_back(monkeypatch):
    incomplete = reference_contracts.reference_contract("sheng_siong_claim")
    del incomplete["fields"]["sku"]["transforms"][0]["values"]["1909280"]
    messages = _install(monkeypatch, [_answer(incomplete)] * (gm.MAX_REPAIRS + 1))
    frame, layout = _sheng_siong()

    proposal = gm.generate_mapping_contract("claim.xlsx", frame, layout)

    failed = {c["id"]: c for c in proposal["checks"] if c["level"] == "error" and not c["passed"]}
    assert set(failed) == {"sku_codes"}
    assert "1909280" in failed["sku_codes"]["message"]
    assert "1909280" in messages.calls[1]["messages"][2]["content"]
    assert proposal["contract"]["fields"]["sku"]["confidence"] == "low"


def test_the_prompt_lists_the_sku_master_and_the_code_description_pairs(monkeypatch):
    messages = _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])
    frame, layout = _sheng_siong()

    gm.generate_mapping_contract("claim.xlsx", frame, layout)

    prompt = messages.calls[0]["messages"][0]["content"]
    assert '"sku": "13271338"' in prompt
    assert '"ItemCode": "1909280"' in prompt and '"Description": "AIRE ULTRA TAPE DIAPERS L"' in prompt


def test_a_failing_proposal_is_sent_back_with_the_evidence(monkeypatch):
    fixed = reference_contracts.reference_contract("sheng_siong_claim")
    messages = _install(monkeypatch, [_answer(_claim_as_revenue()), _answer(fixed)])
    frame, layout = _sheng_siong()

    proposal = gm.generate_mapping_contract("claim.xlsx", frame, layout)

    assert proposal["attempts"] == 2
    repair = messages.calls[1]["messages"]
    assert [m["role"] for m in repair] == ["user", "assistant", "user"]
    assert "Supplier Claim" in repair[2]["content"]
    assert proposal["contract"]["fields"]["revenue"]["status"] == "not_available"


def test_repairs_are_limited_and_the_reviewer_gets_the_failures(monkeypatch):
    messages = _install(monkeypatch, [_answer(_claim_as_revenue())] * (gm.MAX_REPAIRS + 1))
    frame, layout = _sheng_siong()

    proposal = gm.generate_mapping_contract("claim.xlsx", frame, layout)

    assert len(messages.calls) == gm.MAX_REPAIRS + 1
    failed = {c["id"] for c in proposal["checks"] if c["level"] == "error" and not c["passed"]}
    assert failed == {"revenue_source"}
    # Confidence comes from the checks, not the model's "high".
    assert proposal["contract"]["fields"]["revenue"]["confidence"] == "low"


def test_the_model_can_only_name_this_files_headers(monkeypatch):
    messages = _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])
    frame, layout = _sheng_siong()

    gm.generate_mapping_contract("claim.xlsx", frame, layout)

    schema = messages.calls[0]["output_config"]["format"]["schema"]
    source = schema["properties"]["fields"]["items"]["properties"]["source"]
    # The file's headers, plus "" for a field read from no column.
    assert source["enum"] == [*frame.columns, ""]


def test_the_prompt_carries_the_whole_file_profile_and_the_detected_groups(monkeypatch):
    messages = _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])
    frame, layout = _sheng_siong()

    gm.generate_mapping_contract("claim.xlsx", frame, layout)

    prompt = messages.calls[0]["messages"][0]["content"]
    assert "Column profile over all 3 data rows" in prompt
    assert '"kind": "dimension"' in prompt
    assert "never revenue" in messages.calls[0]["system"]


def test_an_excluded_example_is_not_shown(monkeypatch):
    messages = _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])
    frame, layout = _sheng_siong()

    gm.generate_mapping_contract("claim.xlsx", frame, layout, exclude_examples=("sheng_siong_claim",))

    prompt = messages.calls[0]["messages"][0]["content"]
    assert "Sheng Siong claim sales summary" not in prompt
    assert "NHG SAP postings" in prompt


def test_structured_output_request_omits_unsupported_temperature(monkeypatch):
    messages = _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])
    frame, layout = _sheng_siong()

    gm.generate_mapping_contract("claim.xlsx", frame, layout)

    assert "temperature" not in messages.calls[0]


def test_a_refusal_is_a_generation_error(monkeypatch):
    _install(monkeypatch, [FakeResponse("", stop_reason="refusal")])
    frame, layout = _sheng_siong()

    with pytest.raises(gm.MappingGenerationError, match="declined"):
        gm.generate_mapping_contract("claim.xlsx", frame, layout)


# ---- Known layouts never call Claude ---------------------------------------------------

def _no_claude():
    raise AssertionError("a known layout must not call Claude")


def _bucket(monkeypatch, blobs):
    written = {}
    monkeypatch.setattr(gm.storage, "download_json", lambda path: blobs.get(path))
    monkeypatch.setattr(gm.storage, "list_mapping_fingerprints", lambda state: [])
    monkeypatch.setattr(gm.storage, "upload_json", lambda path, obj: written.setdefault(path, obj))
    return written


def test_next_months_file_resolves_to_the_confirmed_contract(monkeypatch):
    january = gm.read_header_columns("fp.txt", fairprice_txt())
    _bucket(monkeypatch, {gm.storage.confirmed_mapping_path(gm.fingerprint(january)): {"contract": {"version": 2}, "name": "FP"}})
    monkeypatch.setattr(gm, "get_client", _no_claude)

    result = gm.resolve_mapping("fp.txt", fairprice_txt(["01-03-2026", "01-04-2026"]))

    assert result["status"] == "mapped"
    assert result["name"] == "FP"


def test_a_contract_stored_under_the_old_fingerprint_is_still_found(monkeypatch):
    columns = gm.read_header_columns("fp.txt", fairprice_txt())
    legacy = gm.legacy_fingerprint(columns)
    _bucket(monkeypatch, {
        gm.storage.confirmed_mapping_path(legacy): {
            "contract": {},
            "name": "Old",
            "raw_columns": columns,
        }
    })
    monkeypatch.setattr(gm, "get_client", _no_claude)

    result = gm.resolve_mapping("fp.txt", fairprice_txt())

    assert (result["status"], result["fingerprint"]) == ("mapped", legacy)


def test_reordered_headers_do_not_reuse_an_order_free_legacy_contract(monkeypatch):
    columns = gm.read_header_columns("fp.txt", fairprice_txt())
    old_key = gm.unordered_fingerprint(columns)
    _bucket(monkeypatch, {
        gm.storage.confirmed_mapping_path(old_key): {
            "contract": {"version": 2},
            "raw_columns": columns,
        }
    })

    key, envelope = gm.find_confirmed(list(reversed(columns)))

    assert (key, envelope) == (None, None)


def test_a_new_layout_is_proposed_checked_and_parked_for_review(monkeypatch):
    written = _bucket(monkeypatch, {})
    _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])

    result = gm.resolve_mapping("claim.xlsx", sheng_siong_xlsx(), "gs://bucket/uploads/claim.xlsx")

    assert result["status"] == "pending_confirmation"
    envelope = written[gm.storage.pending_mapping_path(result["fingerprint"])]
    assert envelope["proposal"] == envelope["contract"]
    assert envelope["layout"]["header_row"] == 7
    assert envelope["column_profile"]["2A"]["type"] == "number"
    assert envelope["checks"] and envelope["attempts"] == 1
    assert envelope["model"] == gm.MODEL
    assert [item["code"] for item in envelope["sku_codes"]] == ["1909284", "1909280"]
    assert envelope["contract"]["layout"]["header_row"] == 7


def test_a_near_match_still_gets_a_new_proposal_for_review(monkeypatch):
    written = _bucket(monkeypatch, {})
    monkeypatch.setattr(
        gm,
        "find_partial_match",
        lambda columns: pytest.fail("actual uploads do not stop at a near match"),
    )
    messages = _install(
        monkeypatch,
        [_answer(reference_contracts.reference_contract("fairprice_monthly"))],
    )

    result = gm.resolve_mapping(
        "fairprice.txt",
        fairprice_txt(),
        "gs://bucket/uploads/fairprice.txt",
    )

    assert result["status"] == "pending_confirmation"
    assert len(messages.calls) == 1
    envelope = written[gm.storage.pending_mapping_path(result["fingerprint"])]
    assert "near_match" not in envelope


# ---- The schema ------------------------------------------------------------------------

def _unions(schema) -> int:
    """How many parameters in a schema are a union (anyOf, or a list of types)."""
    if isinstance(schema, dict):
        own = int("anyOf" in schema or isinstance(schema.get("type"), list))
        return own + sum(_unions(v) for v in schema.values())
    if isinstance(schema, list):
        return sum(_unions(v) for v in schema)
    return 0


def test_the_schema_stays_within_the_structured_output_union_limit():
    # The API refuses more than 16 union-typed parameters (a 400, seen live).
    schema = gm.mapping_prompt.output_schema(["SKU No.", "Store Code", "Qty"])

    assert _unions(schema) == 0


def test_unused_parameters_written_as_empty_or_zero_are_left_out():
    answer = {
        "fields": [{
            "target": "store_code", "status": "mapped", "source": "Store Code", "melt_group": "",
            "from_field": "", "value": "", "reason": "", "confidence": "high", "rationale": "",
            "transforms": [{
                "type": "regex_extract", "pattern": "(\d+)", "group": 0, "values": [], "rules": [],
                "default": "", "case_sensitive": False, "column": "", "factors": [], "format": "",
            }],
        }],
        "melt_groups": [],
        "aggregate_to_month": False,
    }

    contract = gm.mapping_prompt.parse_proposal(answer)

    entry = contract["fields"]["store_code"]
    assert set(entry) == {"status", "source", "confidence", "transforms"}
    assert "melt_group" not in entry and "from_field" not in entry and "value" not in entry
    assert entry["transforms"] == [{"type": "regex_extract", "pattern": "(\d+)"}]
    assert "aggregate" not in contract
