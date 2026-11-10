"""
Which Gemini model each AI feature uses, and what happens when one is gone.

Nomenclature generation (upload mapping) reads MAPPING_MODEL and the Assistant reads
GEMINI_ASSISTANT_MODEL (config.py). When Google retires a model -- or a
setting names one that never existed -- every call to it comes back as a
404 NOT_FOUND from Vertex AI. That is found where the call is made (there is no
background check): the feature raises ModelUnavailableError, whose message
names every feature on that model and every setting that holds it, so one
redeploy fixes them all.

Each such failure is recorded as a model_outdated notification (one unread
at a time per model). model_status reads those rows back, so the "AI
unavailable" notices on the pages stay up for everyone until the setting
names a different model -- the same rows the notification bell shows.
"""

import logging

from google.genai import errors as genai_errors

from app import config
from app.services import notification_service

logger = logging.getLogger("uvicorn.error")

# Every AI feature: the name staff know it by and the setting that names its
# model. The labels match MODEL_FEATURES in frontend utils/notificationText.js.
FEATURES = {
    "mapping": {"label": "Nomenclature generation", "setting": "MAPPING_MODEL"},
    "assistant": {"label": "Assistant", "setting": "GEMINI_ASSISTANT_MODEL"},
}


class ModelUnavailableError(Exception):
    """The Gemini model a feature is set to use does not exist on Vertex AI (retired, or a mistyped name)."""

    def __init__(self, feature: str):
        self.feature = feature
        self.model = configured_models()[feature]
        self.features = features_using(self.model)
        super().__init__(unavailable_message(self.model))


def configured_models() -> dict[str, str]:
    """Each feature's configured model, read at call time so a test can change config."""
    return {"mapping": config.MAPPING_MODEL, "assistant": config.GEMINI_ASSISTANT_MODEL}


def features_using(model: str) -> list[str]:
    """Every feature whose setting names this model, in FEATURES order."""
    models = configured_models()
    return [feature for feature in FEATURES if models[feature] == model]


def is_model_not_found(error: Exception) -> bool:
    """
    Whether a Gemini error means the model itself is gone. Vertex AI answers a
    retired or unknown model with 404 NOT_FOUND; nothing else in a
    generate_content call is addressed by name, so a 404 is the model.
    """
    return isinstance(error, genai_errors.ClientError) and error.code == 404


def _join(words: list[str]) -> str:
    """'A', 'A and B', 'A, B and C'."""
    if len(words) <= 1:
        return "".join(words)
    return f"{', '.join(words[:-1])} and {words[-1]}"


def unavailable_message(model: str) -> str:
    """
    The sentence staff see wherever the model is missing: which features it
    breaks and which settings to change. The bell's wording for the same
    notification is built from its payload in frontend utils/notificationText.js.
    """
    features = features_using(model)
    labels = _join([FEATURES[feature]["label"] for feature in features]) or "an AI feature"
    settings = _join([FEATURES[feature]["setting"] for feature in features]) or "its model setting"
    return (
        f"The AI model {model} is no longer available. "
        f"It's used by {labels}. "
        f"To fix this, update {settings} to a current Gemini model and redeploy."
    )


def record_unavailable(error: ModelUnavailableError) -> None:
    """
    Note the failure as a model_outdated notification (best effort: an upload
    or a question never fails over its notification). The payload is the
    contract listed with modelHeading in frontend utils/notificationText.js.
    """
    logger.warning(str(error))
    notification_service.insert_model_outdated({
        "features": error.features,
        "settings": [FEATURES[feature]["setting"] for feature in error.features],
        "current_model": error.model,
        "status": "retired",
        "retires_on": None,
        "suggested_model": None,
    })


def model_status() -> dict:
    """
    Per feature: its configured model and whether a call to it has come back
    "not found". A model is unavailable from its first failed call until the
    setting names a different one (notifications older than 60 days are
    deleted, after which the next failed call reports it again). Best effort:
    when the notifications cannot be read, every model is reported available,
    because these notices only add to the error the feature itself shows.
    """
    models = configured_models()
    try:
        failed = notification_service.models_reported_unavailable(sorted(set(models.values())))
    except Exception as exc:
        logger.warning("Could not read AI model status: %s", exc)
        failed = set()
    return {
        feature: {
            "model": models[feature],
            "available": models[feature] not in failed,
            "message": unavailable_message(models[feature]) if models[feature] in failed else None,
        }
        for feature in FEATURES
    }
