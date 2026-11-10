"""
A Gemini model that is no longer available: how it is recognised, the message
staff see, the notification it leaves, and the status the pages read back.
No database: notification_service is replaced with fakes that record calls.
"""

import pytest
from google.genai import errors as genai_errors

from app.services import ai_models


def _same_model(monkeypatch, model="gemini-old"):
    monkeypatch.setattr(ai_models.config, "MAPPING_MODEL", model)
    monkeypatch.setattr(ai_models.config, "GEMINI_ASSISTANT_MODEL", model)


def _different_models(monkeypatch):
    monkeypatch.setattr(ai_models.config, "MAPPING_MODEL", "gemini-old")
    monkeypatch.setattr(ai_models.config, "GEMINI_ASSISTANT_MODEL", "gemini-new")


def _gemini_error(code, status):
    return genai_errors.ClientError(code, {"error": {"code": code, "message": "model", "status": status}})


# ---- Recognising a missing model ---------------------------------------------

def test_a_404_from_gemini_means_the_model_is_gone():
    assert ai_models.is_model_not_found(_gemini_error(404, "NOT_FOUND")) is True


@pytest.mark.parametrize("code, status", [(400, "INVALID_ARGUMENT"), (403, "PERMISSION_DENIED"), (429, "RESOURCE_EXHAUSTED")])
def test_other_client_errors_are_not_a_missing_model(code, status):
    assert ai_models.is_model_not_found(_gemini_error(code, status)) is False


def test_a_server_error_is_not_a_missing_model():
    error = genai_errors.ServerError(503, {"error": {"code": 503, "message": "busy", "status": "UNAVAILABLE"}})
    assert ai_models.is_model_not_found(error) is False


# ---- The message ---------------------------------------------------------------

def test_a_model_both_features_use_names_both_features_and_both_settings(monkeypatch):
    _same_model(monkeypatch)

    assert str(ai_models.ModelUnavailableError("mapping")) == (
        "The AI model gemini-old is no longer available. It's used by Nomenclature generation and Assistant. "
        "To fix this, update MAPPING_MODEL and GEMINI_ASSISTANT_MODEL to a current Gemini model and redeploy."
    )


def test_a_model_only_one_feature_uses_names_only_that_feature(monkeypatch):
    _different_models(monkeypatch)

    assert str(ai_models.ModelUnavailableError("assistant")) == (
        "The AI model gemini-new is no longer available. It's used by Assistant. "
        "To fix this, update GEMINI_ASSISTANT_MODEL to a current Gemini model and redeploy."
    )


def test_the_error_lists_every_feature_on_the_model(monkeypatch):
    _same_model(monkeypatch)

    error = ai_models.ModelUnavailableError("assistant")

    assert (error.feature, error.model, error.features) == ("assistant", "gemini-old", ["mapping", "assistant"])


# ---- The notification ----------------------------------------------------------

def test_recording_a_missing_model_writes_the_notification_payload(monkeypatch):
    _same_model(monkeypatch)
    written = []
    monkeypatch.setattr(ai_models.notification_service, "insert_model_outdated", written.append)

    ai_models.record_unavailable(ai_models.ModelUnavailableError("mapping"))

    assert written == [{
        "features": ["mapping", "assistant"],
        "settings": ["MAPPING_MODEL", "GEMINI_ASSISTANT_MODEL"],
        "current_model": "gemini-old",
        "status": "retired",
        "retires_on": None,
        "suggested_model": None,
    }]


# ---- Status read back for the pages ---------------------------------------------

def test_a_reported_model_is_unavailable_with_its_message(monkeypatch):
    _different_models(monkeypatch)
    asked = []

    def reported(models):
        asked.append(models)
        return {"gemini-old"}

    monkeypatch.setattr(ai_models.notification_service, "models_reported_unavailable", reported)

    status = ai_models.model_status()

    assert asked == [["gemini-new", "gemini-old"]]
    assert status["mapping"] == {
        "model": "gemini-old",
        "available": False,
        "message": ai_models.unavailable_message("gemini-old"),
    }
    assert status["assistant"] == {"model": "gemini-new", "available": True, "message": None}


def test_status_reports_every_model_available_when_notifications_cannot_be_read(monkeypatch):
    _same_model(monkeypatch)

    def unreachable(models):
        raise ConnectionError("Cloud SQL is down")

    monkeypatch.setattr(ai_models.notification_service, "models_reported_unavailable", unreachable)

    status = ai_models.model_status()

    assert [status[feature]["available"] for feature in ("mapping", "assistant")] == [True, True]
