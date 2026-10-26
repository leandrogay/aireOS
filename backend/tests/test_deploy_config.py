"""
Guards on the committed deploy settings (deploy/<env>/).

Secrets must only ever be named in api.secrets.yaml (values in Secret Manager),
never written into the env or build files, which are committed in plain text.
These read the files only -- no gcloud, no network.
"""
import re
from pathlib import Path

import pytest

from app import config

DEPLOY_DIR = Path(__file__).resolve().parents[2] / "deploy"
ENV_DIRS = sorted(path for path in DEPLOY_DIR.iterdir() if path.is_dir())

# A setting whose name says it is a credential.
SECRET_NAME = re.compile(r"SECRET|PASSWORD|PRIVATE_KEY|API_KEY|TOKEN")
SECRET_REF = re.compile(r"^[a-z][a-z0-9-]*:(latest|\d+)$")


def _read(path: Path, separator: str) -> dict[str, str]:
    # Mirrors Read-Settings in deploy.ps1: flat KEY<sep>VALUE lines, # comments.
    settings = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, value = line.split(separator, 1)
        settings[key.strip()] = value.strip().strip('"')
    return settings


def _api_env(env_dir: Path) -> dict[str, str]:
    return _read(env_dir / "api.env.yaml", ": ")


def _api_secrets(env_dir: Path) -> dict[str, str]:
    return _read(env_dir / "api.secrets.yaml", ": ")


def _web_build(env_dir: Path) -> dict[str, str]:
    return _read(env_dir / "web.build.env", "=")


def test_there_is_at_least_one_environment():
    assert ENV_DIRS, f"no environments under {DEPLOY_DIR}"


# ---- Secrets stay out of committed files ----

@pytest.mark.parametrize("env_dir", ENV_DIRS, ids=lambda path: path.name)
def test_env_and_build_files_hold_no_secret_settings(env_dir):
    committed = {**_api_env(env_dir), **_web_build(env_dir)}

    leaked = [key for key in committed if SECRET_NAME.search(key)]

    assert leaked == [], f"move {leaked} to api.secrets.yaml (Secret Manager)"


@pytest.mark.parametrize("env_dir", ENV_DIRS, ids=lambda path: path.name)
def test_no_setting_is_both_an_env_var_and_a_secret(env_dir):
    # Cloud Run rejects a deploy that sets one name both ways.
    overlap = set(_api_env(env_dir)) & set(_api_secrets(env_dir))

    assert overlap == set()


@pytest.mark.parametrize("env_dir", ENV_DIRS, ids=lambda path: path.name)
def test_every_secret_the_backend_reads_is_in_the_manifest(env_dir):
    # A new secret added to config.py fails here until it is given a
    # Secret Manager entry, instead of failing at sign-in after a deploy.
    backend_secrets = {name for name in vars(config) if name.isupper() and SECRET_NAME.search(name)}

    missing = backend_secrets - set(_api_secrets(env_dir))

    assert missing == set()


@pytest.mark.parametrize("env_dir", ENV_DIRS, ids=lambda path: path.name)
def test_secret_references_name_a_secret_and_version(env_dir):
    for env_var, ref in _api_secrets(env_dir).items():
        assert SECRET_REF.match(ref), f"{env_var}: '{ref}' is not <secret-name>:<version>"
        assert ref.startswith(f"aireos-{env_dir.name}-"), (
            f"{env_var}: each environment uses its own secrets (aireos-{env_dir.name}-*)"
        )


# ---- API and web agree ----

@pytest.mark.parametrize("env_dir", ENV_DIRS, ids=lambda path: path.name)
def test_web_and_api_agree_on_whether_sign_in_is_on(env_dir):
    assert _web_build(env_dir)["NEXT_PUBLIC_AUTH_ENABLED"] == _api_env(env_dir)["AUTH_ENABLED"]


@pytest.mark.parametrize("env_dir", ENV_DIRS, ids=lambda path: path.name)
def test_sign_in_returns_to_the_url_the_browser_uses(env_dir):
    # The session cookie is host-only, so it must be set on the same origin the
    # browser calls, and Google must send the user back there too.
    browser_origin = _web_build(env_dir)["NEXT_PUBLIC_API_URL"].rstrip("/")
    api_env = _api_env(env_dir)

    assert api_env["AUTH_FRONTEND_URL"].rstrip("/") == browser_origin
    assert api_env["GOOGLE_OAUTH_REDIRECT_URI"] == f"{browser_origin}/api/auth/callback"
    assert browser_origin in config.parse_origins(api_env["CORS_ALLOWED_ORIGINS"])
