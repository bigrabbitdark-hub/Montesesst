#!/bin/bash
# Backup lógico do Postgres via pg_dump, formato custom (comprimido, permite
# restore seletivo). Pensado para rodar via cron no host — ver
# docs/operations/backups.md para o setup do cron e o procedimento de
# restauração testado.
#
# Depois do backup local, envia uma cópia para o Cloudflare R2 (ITEM 007 da
# auditoria 2026-09-27) via ops/r2-backup.js, executado dentro do container
# do backend (que já tem o SDK do S3 e as variáveis R2_*). Uma falha no envio
# externo NUNCA impede o backup local nem a rotação local: ela roda por
# último e só faz o script terminar com erro (visível em
# /var/log/montese-backup.log). Limitações da cópia externa e o que continua
# pendente: ver docs/operations/backups.md.
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

# --- Cópia externa (R2) ---------------------------------------------------
BACKEND_CONTAINER="${BACKEND_CONTAINER:-montese_backend}"
REMOTE_KEEP=30
REMOTE_KEY="backups/postgres/montese-${TIMESTAMP}.dump"
HELPER_SRC="$PROJECT_DIR/ops/r2-backup.js"
HELPER_DST="/tmp/r2-backup.js"

r2_helper() {
  # $1 = ação; demais argumentos = variáveis extras (-e NOME=valor).
  local action="$1"; shift
  docker exec -i -e NODE_PATH=/app/node_modules -e NODE_NO_WARNINGS=1 \
    -e BACKUP_ACTION="$action" "$@" "$BACKEND_CONTAINER" node "$HELPER_DST"
}

# Sem `set -e` aqui dentro (a função roda num `if`): cada passo é checado
# explicitamente.
upload_external() {
  docker cp "$HELPER_SRC" "$BACKEND_CONTAINER:$HELPER_DST" || return 1
  r2_helper put -e BACKUP_KEY="$REMOTE_KEY" < "$OUTFILE" || return 1
  # Rotação remota só depois do envio confirmado (tamanho + MD5). Falha aqui
  # não invalida o backup que acabou de subir, só é registrada.
  r2_helper prune -e BACKUP_KEEP="$REMOTE_KEEP" \
    || echo "[aviso] rotação remota falhou — o backup de hoje já está no R2"
  docker exec "$BACKEND_CONTAINER" rm -f "$HELPER_DST" || true
}

if upload_external; then
  echo "[ok] cópia externa enviada ao R2: $REMOTE_KEY"
else
  echo "[ERRO] cópia externa para o R2 FALHOU — o backup local está íntegro em $OUTFILE"
  exit 1
fi
