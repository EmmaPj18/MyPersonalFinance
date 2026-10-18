#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into the server's database, through the Portainer
# API (no SSH needed). The current data in the server database is REPLACED.
#
# Required env: PORTAINER_URL PORTAINER_API_KEY PORTAINER_ENDPOINT_ID
# Usage: deploy/restore-remote.sh backups/mypersonalfinance-<date>.sql.gz
set -euo pipefail

BACKUP=${1:?Usage: $0 <backup.sql.gz>}
STACK_NAME="${STACK_NAME:-mypersonalfinance}"
: "${PORTAINER_URL:?}" "${PORTAINER_API_KEY:?}" "${PORTAINER_ENDPOINT_ID:?}"
DOCKER="${PORTAINER_URL%/}/api/endpoints/${PORTAINER_ENDPOINT_ID}/docker"
auth=(-H "X-API-Key: ${PORTAINER_API_KEY}")

container() {
  curl -sS --fail-with-body "${auth[@]}" -G "${DOCKER}/containers/json" \
    --data-urlencode "filters={\"label\":[\"com.docker.compose.project=${STACK_NAME}\",\"com.docker.compose.service=$1\"]}" |
    jq -r '.[0].Id // empty'
}

# Runs a command in a container and prints its output.
run() {
  local id=$1 cmd=$2 exec
  exec=$(curl -sS --fail-with-body "${auth[@]}" -H 'Content-Type: application/json' -X POST "${DOCKER}/containers/${id}/exec" \
    --data "$(jq -n --arg cmd "$cmd" '{AttachStdout: true, AttachStderr: true, Cmd: ["sh", "-c", $cmd]}')" | jq -r .Id)
  curl -sS --fail-with-body "${auth[@]}" -H 'Content-Type: application/json' -X POST "${DOCKER}/exec/${exec}/start" \
    --data '{"Detach": false, "Tty": true}'
  echo
}

db=$(container db)
api=$(container api)
[ -n "$db" ] || { echo "No db container for stack ${STACK_NAME}"; exit 1; }

echo "Uploading $(basename "$BACKUP")…"
tmp=$(mktemp -d)
cp "$BACKUP" "$tmp/restore.sql.gz"
tar -C "$tmp" --owner=0 --group=0 --numeric-owner -cf "$tmp/restore.tar" restore.sql.gz
curl -sS --fail-with-body "${auth[@]}" -X PUT -H 'Content-Type: application/x-tar' \
  --data-binary "@$tmp/restore.tar" "${DOCKER}/containers/${db}/archive?path=/tmp"
rm -rf "$tmp"

[ -n "$api" ] && { echo "Stopping api…"; curl -sS "${auth[@]}" -X POST "${DOCKER}/containers/${api}/stop" >/dev/null; }

echo "Restoring (replaces the current data)…"
run "$db" 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;" &&
  gunzip -c /tmp/restore.sql.gz | psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" && rm /tmp/restore.sql.gz && echo RESTORED'

[ -n "$api" ] && { echo "Starting api (applies any newer migrations)…"; curl -sS "${auth[@]}" -X POST "${DOCKER}/containers/${api}/start" >/dev/null; }
echo "Done."
