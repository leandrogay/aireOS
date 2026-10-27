#!/usr/bin/env bash
# Build, push and deploy aireOS to one environment (deploy/<env>/).
# Bash version of deploy.ps1 -- see that file for the full description; keep
# the two in step.
#
#   ./deploy/deploy.sh test                      build at HEAD and deploy
#   ./deploy/deploy.sh test --skip-build 18a1947 redeploy an existing tag
set -euo pipefail

usage() { echo "Usage: $0 <env> [--skip-build <tag>]" >&2; exit 1; }

ENVIRONMENT="${1:-}"
[[ -n "$ENVIRONMENT" ]] || usage
SKIP_BUILD=false
TAG=""
if [[ "${2:-}" == "--skip-build" ]]; then
  SKIP_BUILD=true
  TAG="${3:-}"
  [[ -n "$TAG" ]] || usage
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_DIR="$ROOT/deploy/$ENVIRONMENT"
[[ -d "$ENV_DIR" ]] || { echo "No deploy settings for '$ENVIRONMENT' (expected $ENV_DIR)" >&2; exit 1; }

# ==== Settings ====

# KEY=VALUE files with no spaces in values, so they can be sourced directly.
set -a
. "$ENV_DIR/target.env"
. "$ENV_DIR/web.build.env"
set +a

API_ENV_FILE="$ENV_DIR/api.env.yaml"
[[ -f "$API_ENV_FILE" ]] || { echo "Missing $API_ENV_FILE" >&2; exit 1; }
if grep -q 'REPLACE_WITH' "$API_ENV_FILE"; then
  echo "$API_ENV_FILE still has a REPLACE_WITH placeholder. Fill it in first." >&2
  exit 1
fi

# "ENV_VAR: secret:version" lines -> "ENV_VAR=secret:version,..."
SECRET_REFS=""
while IFS= read -r line || [[ -n "$line" ]]; do
  line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [[ -z "$line" || "$line" == \#* ]] && continue
  key="${line%%:*}"
  value="$(echo "${line#*:}" | sed 's/^[[:space:]]*//')"
  SECRET_REFS="${SECRET_REFS:+$SECRET_REFS,}$key=$value"
done < "$ENV_DIR/api.secrets.yaml"

cd "$ROOT"

if [[ -z "$TAG" ]]; then
  # The tag is the commit, so it must describe exactly what gets built.
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Commit your changes first: the image tag is the commit hash." >&2
    exit 1
  fi
  TAG="$(git rev-parse --short HEAD)"
fi

API_IMAGE="$REGISTRY/api:$TAG"
WEB_IMAGE="$REGISTRY/web:$TAG"
echo "Deploying $ENVIRONMENT at $TAG"

# ==== Build ====

if [[ "$SKIP_BUILD" == false ]]; then
  gcloud builds submit backend --project "$PROJECT" --tag "$API_IMAGE"
  gcloud builds submit frontend/aireos --project "$PROJECT" \
    --config deploy/cloudbuild.web.yaml \
    --substitutions "_IMAGE=$WEB_IMAGE,_NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL,_NEXT_PUBLIC_AUTH_ENABLED=$NEXT_PUBLIC_AUTH_ENABLED,_BACKEND_API_URL=$BACKEND_API_URL"
fi

# ==== Deploy ====

# API first: the web service forwards /api/* to it.
gcloud run deploy "$API_SERVICE" --project "$PROJECT" --region "$REGION" \
  --image "$API_IMAGE" --service-account "$API_SERVICE_ACCOUNT" \
  --env-vars-file "$API_ENV_FILE" --set-secrets "$SECRET_REFS"

# The web image carries its settings, so any runtime env var is a leftover.
gcloud run deploy "$WEB_SERVICE" --project "$PROJECT" --region "$REGION" \
  --image "$WEB_IMAGE" --service-account "$WEB_SERVICE_ACCOUNT" --clear-env-vars

echo "Deployed $ENVIRONMENT at $TAG. Open $NEXT_PUBLIC_API_URL"
