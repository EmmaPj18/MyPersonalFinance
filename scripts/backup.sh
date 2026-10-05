#!/bin/sh
# Dumps the production database to ./backups/mypersonalfinance-<timestamp>.sql.gz
set -eu
mkdir -p backups
file="backups/mypersonalfinance-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$file"
echo "Backup: $file"
