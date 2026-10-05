#!/bin/sh
# Restores a backup created by backup.sh: ./scripts/restore.sh backups/<file>.sql.gz
set -eu
[ $# -eq 1 ] || { echo "Uso: $0 <backup.sql.gz>"; exit 1; }
gunzip -c "$1" | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
