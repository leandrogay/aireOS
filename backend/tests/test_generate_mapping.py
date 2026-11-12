"""
Proposing a contract for a new layout, and finding the confirmed one for a
known layout -- with a fake Gemini client and SKU master, so no network.

What must hold: the model can only name this file's headers; a proposal that
fails its checks is sent back with the evidence a limited number of times; a
product code that is not a master SKU fails the proposal; a known layout --
including next month's file of it -- never calls the model.
"""

import json

import pytest
from conftest import fairprice_txt, ledger_csv, prime_sales_xlsx, sheng_siong_xlsx

from app.services import generate_mapping as gm
from app.services import reference_contracts


class FakeCandidate:
    def __init__(self, finish_reason):
        self.finish_reason = finish_reason


class FakeResponse:
    def __init__(self, text, finish_reason="STOP"):
        self.text = text
        self.candidates = [FakeCandidate(finish_reason)]


class FakeModels:
    """Answers each generate_content() call with the next scripted answer; records the calls."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        answer = self.answers.pop(0)
        if isinstance(answer, FakeResponse):
            return answer
        return FakeResponse(json.dumps(answer))


class FakeClient:
    def __init__(self, answers):
        self.models = FakeModels(answers)


def _text(content: dict) -> str:
    return content["parts"][0]["text"]


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
                "format": transform.get("format"), "decimal": transform.get("decimal"),
                "factor": transform.get("factor"), "case": transform.get("case"),
                "replacement": transform.get("replacement"), "tokens": transform.get("tokens") or [],
                "columns": transform.get("columns") or [], "separator": transform.get("separator"),
                "index": transform.get("index"),
            })
        fields.append({
            "target": target, "status": entry["status"], "source": entry.get("source"),
            "melt_group": entry.get("melt_group"), "from_field": entry.get("from_field"),
            "from_layout": entry.get("from_layout"), "from_cell": entry.get("from_cell"),
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
    return _no_nulls({
        "fields": fields, "melt_groups": groups, "filters": contract.get("filters") or [],
        "aggregate_to_month": bool(contract.get("aggregate")), "unsupported": contract.get("unsupported") or [],
    })


def _no_nulls(value, key=None):
    """An answer the way the schema has the model write it: "" or 0 for an unused parameter."""
    if isinstance(value, dict):
        return {k: _no_nulls(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_no_nulls(v) for v in value]
    if value is None:
        return 0 if key in ("group", "factor", "index") else ""
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
    monkeypatch.setattr(gm, "get_gemini_client", lambda: client)
    return client.models


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
    assert "1909280" in _text(messages.calls[1]["contents"][2])
    assert proposal["contract"]["fields"]["sku"]["confidence"] == "low"


def test_the_prompt_lists_the_sku_master_and_the_code_description_pairs(monkeypatch):
    messages = _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])
    frame, layout = _sheng_siong()

    gm.generate_mapping_contract("claim.xlsx", frame, layout)

    prompt = _text(messages.calls[0]["contents"][0])
    assert '"sku": "13271338"' in prompt
    assert '"ItemCode": "1909280"' in prompt and '"Description": "AIRE ULTRA TAPE DIAPERS L"' in prompt


def test_a_failing_proposal_is_sent_back_with_the_evidence(monkeypatch):
    fixed = reference_contracts.reference_contract("sheng_siong_claim")
    messages = _install(monkeypatch, [_answer(_claim_as_revenue()), _answer(fixed)])
    frame, layout = _sheng_siong()

    proposal = gm.generate_mapping_contract("claim.xlsx", frame, layout)

    assert proposal["attempts"] == 2
    repair = messages.calls[1]["contents"]
    assert [m["role"] for m in repair] == ["user", "model", "user"]
    assert "Supplier Claim" in _text(repair[2])
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

    schema = messages.calls[0]["config"].response_json_schema
    source = schema["properties"]["fields"]["items"]["properties"]["source"]
    # The file's headers, plus "" for a field read from no column.
    assert source["enum"] == [*frame.columns, ""]


def test_the_prompt_carries_the_whole_file_profile_and_the_detected_groups(monkeypatch):
    messages = _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])
    frame, layout = _sheng_siong()

    gm.generate_mapping_contract("claim.xlsx", frame, layout)

    prompt = _text(messages.calls[0]["contents"][0])
    assert "Column profile over all 3 data rows" in prompt
    assert '"kind": "dimension"' in prompt
    assert "never revenue" in messages.calls[0]["config"].system_instruction


def test_an_excluded_example_is_not_shown(monkeypatch):
    messages = _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])
    frame, layout = _sheng_siong()

    gm.generate_mapping_contract("claim.xlsx", frame, layout, exclude_examples=("sheng_siong_claim",))

    prompt = _text(messages.calls[0]["contents"][0])
    assert "Sheng Siong claim sales summary" not in prompt
    assert "NHG SAP postings" in prompt


def test_the_request_asks_the_configured_model_for_json(monkeypatch):
    messages = _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])
    frame, layout = _sheng_siong()

    gm.generate_mapping_contract("claim.xlsx", frame, layout)

    assert messages.calls[0]["model"] == gm.config.MAPPING_MODEL
    assert messages.calls[0]["config"].response_mime_type == "application/json"


def test_a_safety_block_is_a_generation_error(monkeypatch):
    _install(monkeypatch, [FakeResponse("", finish_reason="SAFETY")])
    frame, layout = _sheng_siong()

    with pytest.raises(gm.MappingGenerationError, match="declined"):
        gm.generate_mapping_contract("claim.xlsx", frame, layout)


def test_a_blocked_prompt_with_no_candidates_is_a_generation_error(monkeypatch):
    blocked = FakeResponse("")
    blocked.candidates = []
    _install(monkeypatch, [blocked])
    frame, layout = _sheng_siong()

    with pytest.raises(gm.MappingGenerationError, match="declined"):
        gm.generate_mapping_contract("claim.xlsx", frame, layout)


def test_a_truncated_answer_is_a_generation_error(monkeypatch):
    _install(monkeypatch, [FakeResponse('{"fields": [', finish_reason="MAX_TOKENS")])
    frame, layout = _sheng_siong()

    with pytest.raises(gm.MappingGenerationError, match="cut off"):
        gm.generate_mapping_contract("claim.xlsx", frame, layout)


def test_an_answer_that_is_not_json_is_a_generation_error(monkeypatch):
    _install(monkeypatch, [FakeResponse("Sorry, I cannot help with that.")])
    frame, layout = _sheng_siong()

    with pytest.raises(gm.MappingGenerationError, match="valid JSON"):
        gm.generate_mapping_contract("claim.xlsx", frame, layout)


def test_the_proposal_records_gemini_and_the_model_that_made_it(monkeypatch):
    _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])
    frame, layout = _sheng_siong()

    proposal = gm.generate_mapping_contract("claim.xlsx", frame, layout)

    assert (proposal["provider"], proposal["model"]) == ("gemini", gm.config.MAPPING_MODEL)


# ---- The Vertex AI client --------------------------------------------------------------

def test_missing_gcp_project_is_a_config_error(monkeypatch):
    monkeypatch.setattr(gm, "_gemini_client", None)
    monkeypatch.setattr(gm.config, "GCP_PROJECT_ID", None)

    with pytest.raises(gm.MappingConfigError, match="GCP_PROJECT_ID"):
        gm.get_gemini_client()


def test_unusable_google_credentials_are_a_config_error(monkeypatch):
    class NoCredentialsModels:
        def generate_content(self, **kwargs):
            raise gm.GoogleAuthError("no default credentials")

    class NoCredentialsClient:
        models = NoCredentialsModels()

    monkeypatch.setattr(gm, "get_gemini_client", lambda: NoCredentialsClient())
    frame, layout = _sheng_siong()

    with pytest.raises(gm.MappingConfigError, match="Vertex AI"):
        gm.generate_mapping_contract("claim.xlsx", frame, layout)


# ---- Known layouts never call a model ---------------------------------------------------

def _no_model():
    raise AssertionError("this must not call a model")


def _forbid_model_calls(monkeypatch):
    """A known layout must not call the model."""
    monkeypatch.setattr(gm, "get_gemini_client", _no_model)


def _bucket(monkeypatch, blobs):
    written = {}
    monkeypatch.setattr(gm.storage, "download_json", lambda path: blobs.get(path))
    monkeypatch.setattr(gm.storage, "list_mapping_fingerprints", lambda state: [])
    monkeypatch.setattr(gm.storage, "upload_json", lambda path, obj: written.setdefault(path, obj))
    return written


def test_next_months_file_resolves_to_the_confirmed_contract(monkeypatch):
    january = gm.read_header_columns("fp.txt", fairprice_txt())
    _bucket(monkeypatch, {gm.storage.confirmed_mapping_path(gm.fingerprint(january)): {"contract": {"fields": {}}, "name": "FP"}})
    _forbid_model_calls(monkeypatch)

    result = gm.resolve_mapping("fp.txt", fairprice_txt(["01-03-2026", "01-04-2026"]))

    assert result["status"] == "mapped"
    assert result["name"] == "FP"


def test_reordered_headers_are_a_different_layout(monkeypatch):
    columns = gm.read_header_columns("fp.txt", fairprice_txt())
    _bucket(monkeypatch, {
        gm.storage.confirmed_mapping_path(gm.fingerprint(columns)): {
            "contract": {"fields": {}},
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
    assert (envelope["provider"], envelope["model"]) == ("gemini", gm.config.MAPPING_MODEL)
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


# ---- A model that is no longer available ------------------------------------------------

class GoneModels:
    """Every call fails the way Vertex AI answers a retired model."""

    def __init__(self, code=404, status="NOT_FOUND"):
        self.code, self.status = code, status
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        raise gm.genai_errors.ClientError(self.code, {"error": {"code": self.code, "message": "gone", "status": self.status}})


def _install_gone_model(monkeypatch, code=404, status="NOT_FOUND"):
    client = FakeClient([])
    client.models = GoneModels(code, status)
    monkeypatch.setattr(gm, "get_gemini_client", lambda: client)
    recorded = []
    monkeypatch.setattr(gm.ai_models, "record_unavailable", recorded.append)
    return client.models, recorded


def test_a_retired_model_is_a_model_unavailable_error_not_a_generation_error(monkeypatch):
    _install_gone_model(monkeypatch)
    frame, layout = _sheng_siong()

    with pytest.raises(gm.ai_models.ModelUnavailableError) as raised:
        gm.generate_mapping_contract("claim.xlsx", frame, layout)

    assert raised.value.feature == "mapping"


def test_other_gemini_errors_are_still_generation_errors(monkeypatch):
    _install_gone_model(monkeypatch, code=429, status="RESOURCE_EXHAUSTED")
    frame, layout = _sheng_siong()

    with pytest.raises(gm.MappingGenerationError):
        gm.generate_mapping_contract("claim.xlsx", frame, layout)


def test_a_retired_model_parks_a_blank_proposal_to_fill_in_by_hand(monkeypatch):
    written = _bucket(monkeypatch, {})
    models, recorded = _install_gone_model(monkeypatch)

    result = gm.resolve_mapping("claim.xlsx", sheng_siong_xlsx(), "gs://bucket/uploads/claim.xlsx")

    assert len(models.calls) == 1  # no repair attempts against a model that is gone
    assert result["status"] == "pending_confirmation"
    assert result["source"] == "manual"
    assert result["ai_unavailable"].startswith(f"The AI model {gm.config.MAPPING_MODEL} is no longer available. It's used by Nomenclature generation")
    envelope = written[gm.storage.pending_mapping_path(result["fingerprint"])]
    assert envelope["ai_unavailable"] == result["ai_unavailable"]
    assert (envelope["provider"], envelope["model"], envelope["attempts"]) == (None, None, 0)
    assert envelope["contract"]["layout"]["header_row"] == 7
    assert envelope["contract"]["fields"]["sku"]["status"] == "not_available"
    assert [recorded_error.feature for recorded_error in recorded] == ["mapping"]


def test_the_blank_proposal_fails_its_required_checks_until_filled(monkeypatch):
    frame, layout = _sheng_siong()

    proposal = gm.blank_mapping_contract("claim.xlsx", frame, layout)

    failed = {check["id"] for check in proposal["checks"] if not check["passed"]}
    assert {"required_sku", "required_quantity_units"} <= failed


def test_the_blank_proposal_has_nothing_low_confidence_to_confirm(monkeypatch):
    frame, layout = _sheng_siong()

    proposal = gm.blank_mapping_contract("claim.xlsx", frame, layout)

    assert gm.unreviewed_low_confidence(proposal["contract"]) == []


def test_a_model_proposal_records_no_ai_unavailable_message(monkeypatch):
    written = _bucket(monkeypatch, {})
    _install(monkeypatch, [_answer(reference_contracts.reference_contract("sheng_siong_claim"))])

    result = gm.resolve_mapping("claim.xlsx", sheng_siong_xlsx(), "gs://bucket/uploads/claim.xlsx")

    assert (result["source"], result["ai_unavailable"]) == ("generated", None)
    assert written[gm.storage.pending_mapping_path(result["fingerprint"])]["ai_unavailable"] is None


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


def _enum_at(schema: dict, *path: str) -> set:
    for key in path:
        schema = schema["properties"][key] if key != "items" else schema["items"]
    return set(schema["enum"]) - {""}


def test_the_schema_offers_everything_the_contract_accepts():
    schema = gm.mapping_prompt.output_schema(["Product Code", "Qty"])

    assert _enum_at(schema, "fields", "items", "transforms", "items", "type") == set(gm.mapping_prompt.TRANSFORM_TYPES)
    assert _enum_at(schema, "fields", "items", "from_layout") == set(gm.mapping_prompt.LAYOUT_SOURCES)
    assert _enum_at(schema, "melt_groups", "items", "key_target") == set(gm.mapping_prompt.MELT_KEY_TARGETS)
    assert _enum_at(schema, "melt_groups", "items", "labels", "items", "target") == set(gm.mapping_prompt.LABEL_TARGETS)


# Every word of the contract the model writes, each with the schema parameter
# that carries it. A term added to the contract and left out of the prompt
# would never be proposed.
PROMPT_VOCABULARY = (
    "mapped", "derived", "constant", "not_available",
    "from_field", "from_layout", "stated_period", "from_cell",
    "melt_group", "key_target", "key_pattern", "date_format", "period_type",
    "select_kind", "'pattern'", "'between'", "select_before",
    "rows_above", "rows_below", "cells_above_header", "cells_below_header",
    "aggregate_to_month", "case_sensitive", "factor_column", "'group'", "'format'", "'column'",
    "filename_period", "stacked_sheets", "written_as", "date_formats", "total_columns",
    "filters", "'action'", "'drop'", "'keep'", "unsupported", "'issue'",
    "'decimal'", "'factor'", "'case'", "'replacement'", "'tokens'", "'columns'", "'separator'", "'index'",
    "excel_serial",
)


def test_the_prompt_explains_every_word_of_the_contract_vocabulary():
    prompt = gm.mapping_prompt.SYSTEM_PROMPT
    vocabulary = (
        *PROMPT_VOCABULARY,
        *gm.mapping_prompt.TRANSFORM_TYPES,
        *gm.mapping_prompt.RULE_OPS,
        *gm.mapping_prompt.MEASURE_FIELDS,
        *gm.mapping_prompt.MELT_KEY_TARGETS,
        *gm.mapping_prompt.CELL_TARGETS,
        *gm.mapping_prompt.FILTER_OPS,
        *gm.mapping_prompt.TEXT_CASES,
    )

    assert [term for term in vocabulary if term not in prompt] == []


def test_every_field_the_model_decides_is_defined():
    assert set(gm.mapping_prompt.FIELD_DEFINITIONS) == set(gm.mapping_prompt.DECIDABLE_FIELDS)


def test_a_proposed_cell_survives_parsing_and_validation():
    answer = {
        "fields": [
            _answer_field("period_start", "derived", from_cell="A1"),
            _answer_field("retailer", "derived", from_cell="B1", transforms=[
                _answer_transform("value_map", values=[{"from": "ACME", "to": "acme_offline"}]),
            ]),
        ],
        "melt_groups": [],
        "aggregate_to_month": False,
    }

    contract = gm.validate_contract(gm.mapping_prompt.parse_proposal(answer), ["Product", "Qty"], gm.TARGET_SCHEMA)

    assert contract["fields"]["period_start"]["from_cell"] == "A1"
    assert contract["fields"]["retailer"]["from_cell"] == "B1"
    assert contract["fields"]["retailer"]["transforms"][0]["values"] == {"ACME": "acme_offline"}


def test_the_prompt_lists_the_cells_down_to_the_header_by_reference():
    layout = {"header_row": 1, "cells": {"A1": "Jul-26", "B1": "YISHUN", "B2": "HQ"}}

    prompt = gm.mapping_prompt.user_prompt("codes.xlsx", {}, [], layout, 2, [], [])

    assert '"A1": "Jul-26"' in prompt
    assert '"B2"' not in prompt


def _answer_field(target, status, **values):
    return {
        "target": target, "status": status, "source": "", "melt_group": "", "from_field": "",
        "from_layout": "", "value": "", "reason": "", "transforms": [], "confidence": "high",
        "rationale": "", **values,
    }


def _answer_transform(kind, **values):
    return {
        "type": kind, "pattern": "", "group": 0, "values": [], "rules": [], "default": "",
        "case_sensitive": False, "column": "", "factors": [], "format": "", "decimal": "", "factor": 0,
        "case": "", "replacement": "", "tokens": [], "columns": [], "separator": "", "index": 0, **values,
    }


def test_a_stated_period_labels_and_multiply_survive_parsing_and_validation():
    columns = ["Product Code", "Promo cost", "WARD A", "ONLINE"]
    answer = {
        "fields": [
            _answer_field("period_start", "derived", from_layout="stated_period"),
            _answer_field("period_type", "constant", value="month"),
            _answer_field("store_name", "mapped", melt_group="outlets"),
            _answer_field("store_code", "mapped", melt_group="outlets"),
            _answer_field("quantity_units", "mapped", melt_group="outlets"),
            _answer_field(
                "revenue", "derived", from_field="quantity_units",
                transforms=[_answer_transform("multiply", column="Promo cost")],
            ),
        ],
        "melt_groups": [{
            "id": "outlets", "select_kind": "between", "select_pattern": "", "select_after": "Promo cost",
            "select_before": "", "key_target": "store_name", "key_pattern": "", "date_format": "",
            "period_type": "", "value_target": "quantity_units",
            "labels": [{"rows_above": 1, "target": "store_code"}], "confidence": "high", "rationale": "",
        }],
        "aggregate_to_month": True,
    }

    contract = gm.validate_contract(gm.mapping_prompt.parse_proposal(answer), columns, gm.TARGET_SCHEMA)

    assert contract["fields"]["period_start"]["from_layout"] == "stated_period"
    assert contract["fields"]["revenue"]["transforms"] == [{"type": "multiply", "column": "Promo cost"}]
    group = contract["melt_groups"][0]
    assert group["key"]["target"] == "store_name"
    assert group["labels"] == [{"rows_above": 1, "target": "store_code"}]
    assert contract["warnings"] == []


def test_a_uom_factor_default_written_as_text_is_read_as_a_number():
    answer = {
        "fields": [_answer_field(
            "quantity_units", "mapped", source="Qty",
            transforms=[_answer_transform(
                "uom_factor", column="UOM", default="12",
                factors=[{"uom": "EA", "factor": 1, "factor_column": ""}],
            )],
        )],
        "melt_groups": [],
        "aggregate_to_month": False,
    }

    transform = gm.mapping_prompt.parse_proposal(answer)["fields"]["quantity_units"]["transforms"][0]

    assert transform["default"] == 12


def test_the_prompt_shows_the_cells_above_the_header_counted_up_from_it():
    layout = {
        "header_row": 4,
        "rows_above_header": [{"row": 3, "cells": {"WARD A": "W01"}}, {"row": 1, "cells": {"Product Code": "ER130"}}],
    }

    prompt = gm.mapping_prompt.user_prompt("er130.xlsx", {}, [], layout, 2, [], [])

    assert '"rows_above": 1' in prompt and '"W01"' in prompt
    assert '"rows_above": 3' in prompt


def test_the_prompt_shows_the_headings_under_the_header_counted_down_from_it():
    layout = {"header_row": 1, "rows_below_header": [{"row": 2, "cells": {"YISHUN": "HQ"}, "in_table": False}]}

    prompt = gm.mapping_prompt.user_prompt("codes.xlsx", {}, [], layout, 2, [], [])

    assert '"cells_below_header"' in prompt
    assert '"rows_below": 1' in prompt and '"HQ"' in prompt


@pytest.mark.parametrize("answer_label, label", [
    ({"rows_above": 0, "rows_below": 1, "target": "store_code"}, {"rows_below": 1, "target": "store_code"}),
    ({"rows_above": 1, "rows_below": 0, "target": "store_code"}, {"rows_above": 1, "target": "store_code"}),
    ({"rows_above": 0, "rows_below": 0, "target": "store_code"}, {"rows_above": 0, "target": "store_code"}),
])
def test_a_proposed_label_reads_under_the_headings_only_when_rows_below_is_set(answer_label, label):
    answer = {
        "fields": [],
        "melt_groups": [{
            "id": "outlets", "select_kind": "pattern", "select_pattern": "^[A-Z]+$", "select_after": "",
            "select_before": "", "key_target": "store_name", "key_pattern": "", "date_format": "",
            "period_type": "", "value_target": "quantity_units", "labels": [answer_label],
            "confidence": "high", "rationale": "",
        }],
        "aggregate_to_month": False,
    }

    assert gm.mapping_prompt.parse_proposal(answer)["melt_groups"][0]["labels"] == [label]


def test_disable_examples_flag_leaves_every_reference_contract_out_of_the_prompt(monkeypatch):
    monkeypatch.delenv("MAPPING_DISABLE_EXAMPLES", raising=False)
    with_examples = gm.mapping_prompt.user_prompt("new.xlsx", {}, [], {}, 2, [], [])

    monkeypatch.setenv("MAPPING_DISABLE_EXAMPLES", "true")
    without_examples = gm.mapping_prompt.user_prompt("new.xlsx", {}, [], {}, 2, [], [])

    assert len(without_examples) < len(with_examples)
    assert "NHG" not in without_examples and "NHG" in with_examples


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


# ---- The model's vocabulary is the transformation's ---------------------------------------
#
# Generation and transformation are tested apart: here a scripted model answers
# and only the contract it leads to is judged; test_apply_contract.py runs
# contracts with no model anywhere.

def test_every_transform_the_engine_runs_is_explained_and_no_other():
    assert set(gm.mapping_prompt.TRANSFORM_GUIDE) == set(gm.mapping_prompt.TRANSFORM_TYPES)
    for kind, guide in gm.mapping_prompt.TRANSFORM_GUIDE.items():
        assert f"- {kind}: {guide}" in gm.mapping_prompt.SYSTEM_PROMPT


def test_the_schema_lets_the_model_name_only_the_engines_transforms_and_filters():
    schema = gm.mapping_prompt.output_schema(["Qty", "Type"])

    transform = schema["properties"]["fields"]["items"]["properties"]["transforms"]["items"]["properties"]
    row_filter = schema["properties"]["filters"]["items"]["properties"]
    assert transform["type"]["enum"] == list(gm.mapping_prompt.TRANSFORM_TYPES)
    assert transform["columns"]["items"]["enum"] == ["Qty", "Type"]
    assert set(transform["decimal"]["enum"]) == {".", ",", ""}
    assert row_filter["column"]["enum"] == ["Qty", "Type"]
    assert row_filter["op"]["enum"] == list(gm.mapping_prompt.FILTER_OPS)
    assert set(schema["required"]) == {"fields", "melt_groups", "filters", "aggregate_to_month", "unsupported"}


def test_the_prompt_says_what_the_transformation_cannot_do():
    for limit in gm.mapping_prompt.ENGINE_LIMITS:
        assert limit in gm.mapping_prompt.SYSTEM_PROMPT


def _ledger_answer(**changes) -> dict:
    """The model's answer for conftest's ledger_csv, reading each value as it is written."""
    fields = {
        "period_start": _answer_field("period_start", "mapped", source="Txn Date", transforms=[
            _answer_transform("month_start", format="%d/%m/%Y"),
        ]),
        "period_type": _answer_field("period_type", "constant", value="month"),
        "retailer": _answer_field("retailer", "constant", value="acme_offline"),
        "store_code": _answer_field("store_code", "mapped", source="Outlet", transforms=[
            _answer_transform("split_part", separator=" - ", index=1),
        ]),
        "sku": _answer_field("sku", "mapped", source="Item", transforms=[
            _answer_transform("value_map", values=[{"from": "A-1", "to": "13255043"}, {"from": "A-2", "to": "13255044"}]),
        ]),
        "quantity_units": _answer_field("quantity_units", "mapped", source="Qty", transforms=[
            _answer_transform("parse_number", decimal="."),
            _answer_transform("uom_factor", column="Type", factors=[{"uom": "RETURN", "factor": -1, "factor_column": ""}]),
        ]),
        "revenue": _answer_field("revenue", "mapped", source="Net Sales", transforms=[
            _answer_transform("parse_number", decimal="."), _answer_transform("add", column="Discount"),
        ]),
        **changes,
    }
    return {
        "fields": [{**field, "from_cell": ""} for field in fields.values()],
        "melt_groups": [],
        "filters": [
            {"column": "Supplier", "op": "equals", "value": "XEL", "action": "keep", "case_sensitive": False},
            {"column": "Type", "op": "equals", "value": "TRANSFER", "action": "drop", "case_sensitive": False},
        ],
        "aggregate_to_month": True,
        "unsupported": [],
    }


def _ledger():
    return gm.read_layout("ledger.csv", ledger_csv())


def test_a_proposal_using_the_reading_steps_and_filters_passes_in_one_call(monkeypatch):
    messages = _install(monkeypatch, [_ledger_answer()])
    frame, layout = _ledger()

    proposal = gm.generate_mapping_contract("ledger.csv", frame, layout)

    contract = proposal["contract"]
    assert len(messages.calls) == 1
    assert contract["warnings"] == []
    assert gm.mapping_checks.failures(proposal["checks"]) == []
    assert contract["fields"]["revenue"]["transforms"] == [
        {"type": "parse_number", "decimal": "."}, {"type": "add", "column": "Discount"},
    ]
    assert contract["fields"]["quantity_units"]["transforms"][1]["factors"] == {"RETURN": -1}
    assert [item["action"] for item in contract["filters"]] == ["keep", "drop"]


def test_the_prompt_shows_how_each_text_column_is_written(monkeypatch):
    messages = _install(monkeypatch, [_ledger_answer()])
    frame, layout = _ledger()

    gm.generate_mapping_contract("ledger.csv", frame, layout)

    prompt = _text(messages.calls[0]["contents"][0])
    assert '"written_as"' in prompt
    assert '"%d/%m/%Y"' in prompt
    assert '"currency"' in prompt


def test_figures_left_unparsed_are_sent_back_with_the_values_and_the_step_to_add(monkeypatch):
    unparsed = _ledger_answer(revenue=_answer_field("revenue", "mapped", source="Net Sales"))
    messages = _install(monkeypatch, [unparsed, _ledger_answer()])
    frame, layout = _ledger()

    proposal = gm.generate_mapping_contract("ledger.csv", frame, layout)

    repair = _text(messages.calls[1]["contents"][2])
    assert proposal["attempts"] == 2
    assert "$1,250.50" in repair and "parse_number" in repair
    assert gm.mapping_checks.failures(proposal["checks"]) == []


def test_a_step_the_engine_does_not_have_is_dropped_and_sent_back_never_run(monkeypatch):
    invented = _ledger_answer(quantity_units=_answer_field("quantity_units", "mapped", source="Qty", transforms=[
        _answer_transform("round_to_integer"),
    ]))
    messages = _install(monkeypatch, [invented, _ledger_answer()])
    frame, layout = _ledger()

    proposal = gm.generate_mapping_contract("ledger.csv", frame, layout)

    repair = _text(messages.calls[1]["contents"][2])
    assert "unsupported type: 'round_to_integer'" in repair
    assert proposal["attempts"] == 2
    for entry in proposal["contract"]["fields"].values():
        assert {step["type"] for step in entry.get("transforms") or []} <= set(gm.mapping_prompt.TRANSFORM_TYPES)


def test_what_the_model_flags_as_unsupported_reaches_the_reviewer_as_a_check(monkeypatch):
    answer = _ledger_answer(revenue=_answer_field("revenue", "not_available", reason="Sales are in two currencies."))
    answer["unsupported"] = [{"field": "revenue", "issue": "Net Sales mixes SGD and MYR with no rate to convert by."}]
    _install(monkeypatch, [answer])
    frame, layout = _ledger()

    proposal = gm.generate_mapping_contract("ledger.csv", frame, layout)

    flagged = next(check for check in proposal["checks"] if check["id"] == "unsupported_1")
    assert proposal["attempts"] == 1
    assert "SGD and MYR" in flagged["message"]
    assert proposal["contract"]["unsupported"] == [
        {"field": "revenue", "issue": "Net Sales mixes SGD and MYR with no rate to convert by."},
    ]


def test_the_prompt_names_the_stacked_sheets_and_the_period_in_the_files_name(monkeypatch):
    messages = _install(monkeypatch, [_answer(reference_contracts.reference_contract("prime_sales"))])
    filename = "Prime - Jan 2026 - Sales report.xlsx"
    frame, layout = gm.read_layout(filename, prime_sales_xlsx())

    proposal = gm.generate_mapping_contract(filename, frame, layout)

    prompt = _text(messages.calls[0]["contents"][0])
    assert '"stacked_sheets"' in prompt and '"filename_period"' in prompt
    assert proposal["contract"]["fields"]["period_start"]["from_layout"] == "filename_period"
    assert proposal["contract"]["layout"]["stacked_sheets"] is True
    assert gm.mapping_checks.failures(proposal["checks"]) == []


def test_replace_and_concat_keep_an_empty_replacement_and_separator():
    answer = {
        "fields": [
            _answer_field("store_code", "mapped", source="Qty", transforms=[
                _answer_transform("replace", pattern="^0+"),
                _answer_transform("concat", columns=["Type"]),
            ]),
        ],
        "melt_groups": [], "filters": [], "aggregate_to_month": False, "unsupported": [],
    }

    contract = gm.validate_contract(gm.mapping_prompt.parse_proposal(answer), ["Qty", "Type"], gm.TARGET_SCHEMA)

    assert contract["fields"]["store_code"]["transforms"] == [
        {"type": "replace", "pattern": "^0+", "replacement": ""},
        {"type": "concat", "columns": ["Type"], "separator": ""},
    ]
