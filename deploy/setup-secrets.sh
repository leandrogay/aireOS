#!/usr/bin/env bash
# Create (or rotate) the Secret Manager secrets one environment needs.
# Bash version of setup-secrets.ps1 -- see that file for the full description;
# keep the two in step.
#
#   ./deploy/setup-secrets.sh test                             first-time setup
#   ./deploy/setup-secrets.sh test GOOGLE_OAUTH_CLIENT_SECRET  rotate one secret
set -euo pipefail

ENVIRONMENT="${1:-}"
NAME="${2:-}"
[[ -n "$ENVIRONMENT" ]] || { echo "Usage: $0 <env> [ENV_VAR_NAME]" >&2; exit 1; }

ENV_DIR="$(cd "$(dirname "$0")" && pwd)/$ENVIRONMENT"
[[ -d "$ENV_DIR" ]] || { echo "No deploy settings for '$ENVIRONMENT' (expected $ENV_DIR)" >&2; exit 1; }

set -a
. "$ENV_DIR/target.env"
set +a

if [[ -n "$NAME" ]] && ! grep -q "^$NAME:" "$ENV_DIR/api.secrets.yaml"; then
  echo "$NAME is not in $ENV_DIR/api.secrets.yaml" >&2
  exit 1
fi

# The manifest is read on fd 3 so the prompt below still reads the terminal.
while IFS= read -r line <&3 || [[ -n "$line" ]]; do
  line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [[ -z "$line" || "$line" == \#* ]] && continue
  env_var="${line%%:*}"
  secret_id="$(echo "${line#*:}" | sed 's/^[[:space:]]*//' | cut -d: -f1)"
  [[ -n "$NAME" && "$env_var" != "$NAME" ]] && continue

  exists=false
  has_value=false
  if gcloud secrets describe "$secret_id" --project "$PROJECT" --format 'value(name)' >/dev/null 2>&1; then
    exists=true
    if [[ -n "$(gcloud secrets versions list "$secret_id" --project "$PROJECT" \
        --filter 'state=enabled' --limit 1 --format 'value(name)')" ]]; then
      has_value=true
    fi
  fi

  if [[ "$has_value" == true && -z "$NAME" ]]; then
    echo "$env_var ($secret_id) already has a value; skipping. Rotate with: $0 $ENVIRONMENT $env_var"
    continue
  fi

  if [[ "$exists" == false ]]; then
    gcloud secrets create "$secret_id" --project "$PROJECT" --replication-policy automatic
  fi

  if [[ "$env_var" == "AUTH_SESSION_SECRET" ]]; then
    value="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
    echo "Generated a new $env_var."
  else
    read -r -s -p "Value for $env_var: " value
    echo
    [[ -n "$value" ]] || { echo "No value entered for $env_var" >&2; exit 1; }
  fi

  # printf '%s' stores exactly the value: no trailing newline.
  printf '%s' "$value" | gcloud secrets versions add "$secret_id" --project "$PROJECT" --data-file=-

  gcloud secrets add-iam-policy-binding "$secret_id" --project "$PROJECT" \
    --member "serviceAccount:$API_SERVICE_ACCOUNT" \
    --role roles/secretmanager.secretAccessor >/dev/null
  echo "$env_var ($secret_id) set; $API_SERVICE_ACCOUNT can read it."
done 3< "$ENV_DIR/api.secrets.yaml"

echo "Done. Redeploy (deploy.sh) for running services to pick up new values."
