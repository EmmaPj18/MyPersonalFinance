#!/usr/bin/env bash
# Creates or updates the "mypersonalfinance" stack in Portainer (CE 2.19+) through its API.
#
# Required env:
#   PORTAINER_URL           e.g. https://docker.emmapj18.dev
#   PORTAINER_API_KEY       Portainer access token (My account → Access tokens)
#   PORTAINER_ENDPOINT_ID   environment id (the number in the Portainer URL)
#   APP_IMAGE_TAG           image tag to deploy (e.g. sha-abc1234)
# Stack variables (only sent when set; existing ones are kept):
#   POSTGRES_PASSWORD SESSION_SECRET WEB_ORIGIN WEB_PORT COOKIE_SECURE TZ
#
# Usage: deploy/portainer-deploy.sh [--dry-run]
set -euo pipefail

STACK_NAME="${STACK_NAME:-mypersonalfinance}"
COMPOSE_FILE="${COMPOSE_FILE:-$(dirname "$0")/docker-compose.server.yml}"
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

: "${PORTAINER_URL:?PORTAINER_URL is required}"
: "${PORTAINER_API_KEY:?PORTAINER_API_KEY is required}"
: "${PORTAINER_ENDPOINT_ID:?PORTAINER_ENDPOINT_ID is required}"
: "${APP_IMAGE_TAG:?APP_IMAGE_TAG is required}"

api() {
  local method=$1 path=$2 body=${3:-}
  local args=(-sS --fail-with-body -X "$method" -H "X-API-Key: ${PORTAINER_API_KEY}" -H "Content-Type: application/json")
  [ -n "$body" ] && args+=(--data-binary "$body")
  curl "${args[@]}" "${PORTAINER_URL%/}/api${path}"
}

# Variables from the environment that should end up in the stack.
new_env=$(jq -n '[$ARGS.named | to_entries[] | select(.value != "") | {name: .key, value: .value}]' \
  --arg APP_IMAGE_TAG "${APP_IMAGE_TAG}" \
  --arg POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-}" \
  --arg SESSION_SECRET "${SESSION_SECRET:-}" \
  --arg WEB_ORIGIN "${WEB_ORIGIN:-}" \
  --arg WEB_PORT "${WEB_PORT:-}" \
  --arg COOKIE_SECURE "${COOKIE_SECURE:-}" \
  --arg TZ "${TZ:-}")

stack=$(api GET /stacks | jq --arg name "$STACK_NAME" --argjson ep "$PORTAINER_ENDPOINT_ID" \
  '[.[] | select(.Name == $name and .EndpointId == $ep)][0] // empty')

if $DRY_RUN; then
  echo "Portainer: $(api GET /system/status | jq -r .Version)"
  echo "Environment ${PORTAINER_ENDPOINT_ID}: $(api GET "/endpoints/${PORTAINER_ENDPOINT_ID}" | jq -r .Name)"
  if [ -n "$stack" ]; then
    echo "Stack ${STACK_NAME} exists (id $(jq -r .Id <<<"$stack")); would update to ${APP_IMAGE_TAG}"
  else
    echo "Stack ${STACK_NAME} not found; would create it with ${APP_IMAGE_TAG}"
  fi
  exit 0
fi

compose=$(cat "$COMPOSE_FILE")

if [ -z "$stack" ]; then
  for required in POSTGRES_PASSWORD SESSION_SECRET; do
    [ -n "${!required:-}" ] || { echo "::error::${required} is required to create the stack"; exit 1; }
  done
  echo "Creating stack ${STACK_NAME} (${APP_IMAGE_TAG})…"
  body=$(jq -n --arg name "$STACK_NAME" --arg compose "$compose" --argjson env "$new_env" \
    '{name: $name, stackFileContent: $compose, env: $env}')
  api POST "/stacks/create/standalone/string?endpointId=${PORTAINER_ENDPOINT_ID}" "$body" | jq '{Id, Name}'
else
  id=$(jq -r .Id <<<"$stack")
  # Keep variables set in Portainer, override the ones we send.
  env=$(jq -n --argjson old "$(jq '.Env // []' <<<"$stack")" --argjson new "$new_env" \
    '($old | map({(.name): .value}) | add // {}) + ($new | map({(.name): .value}) | add // {})
     | to_entries | map({name: .key, value: .value})')
  echo "Updating stack ${STACK_NAME} (id ${id}) to ${APP_IMAGE_TAG}…"
  body=$(jq -n --arg compose "$compose" --argjson env "$env" \
    '{stackFileContent: $compose, env: $env, prune: false, pullImage: true}')
  api PUT "/stacks/${id}?endpointId=${PORTAINER_ENDPOINT_ID}" "$body" | jq '{Id, Name}'
fi
