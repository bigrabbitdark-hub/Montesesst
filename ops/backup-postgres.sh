#!/bin/bash
# Backup lógico do Postgres via pg_dump, formato custom (comprimido, permite
# restore seletivo). Pensado para rodar via cron no host — ver
# docs/operations/backups.md para o setup do cron e o procedimento de
# restauração testado.
#
# Limitação conhecida: o backup fica no mesmo disco da VPS. Protege contra
# erro de aplicação/migração/comando (o cenário mais comum), NÃO protege
# contra perda total do servidor. Cópia externa (Cloudflare R2) é pendência
# registrada em docs/operations/backups.md.
set -euo pipefail

PROJECT_DIR="/opt/Montese"
BACKUP_DIR="/opt/montese-backups/postgres"
RETENTION_DAYS=14
CONTAINER="montese_postgres"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)

set -a
source "$PROJECT_DIR/.env"
set +a

mkdir -p "$BACKUP_DIR"

TMP_NAME="backup-${TIMESTAMP}.dump"
OUTFILE="$BACKUP_DIR/montese-${TIMESTAMP}.dump"

docker exec -e PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" "$CONTAINER" \
  pg_dump -U "$POSTGRES_SUPERUSER" -d "$POSTGRES_DB" -Fc -f "/tmp/$TMP_NAME"

docker cp "$CONTAINER:/tmp/$TMP_NAME" "$OUTFILE"
docker exec "$CONTAINER" rm "/tmp/$TMP_NAME"

echo "[ok] backup salvo em $OUTFILE ($(du -h "$OUTFILE" | cut -f1))"

# Retenção: apaga backups com mais de RETENTION_DAYS dias.
find "$BACKUP_DIR" -maxdepth 1 -name 'montese-*.dump' -mtime "+${RETENTION_DAYS}" -print -delete
