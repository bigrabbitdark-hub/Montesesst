#!/bin/bash
# Cópia dos ARQUIVOS do bucket R2 de produção (documentos dos clientes,
# fichas/assinaturas de EPI, certificados eSocial cifrados, base normativa,
# RAG — tudo exceto backups/) para um BUCKET DEDICADO de backup, com
# credencial SEPARADA (R2_BACKUP_*), via ops/r2-files-backup.js.
#
# O helper roda num container EFÊMERO criado a partir da imagem do backend
# (que já tem o SDK do S3): --rm, --read-only, --cap-drop ALL,
# no-new-privileges, --memory 512m, usuário sem privilégio, helper montado
# somente-leitura, rede `bridge` padrão (saída para a internet, SEM acesso ao
# Postgres/Redis da rede interna do compose). Nada é executado dentro do
# container montese_backend e a credencial do backup nunca entra nele.
#
# Append-only: nunca apaga nada no backup e nunca escreve na produção (exceto
# FILES_BACKUP_ACTION=restore, que só cria o que falta). Idempotente.
# Ver docs/operations/backups.md, seção "Cópia dos arquivos".
#
# Cron sugerido (root), DEPOIS do backup do banco (03:00 UTC) e fora da
# janela 02:55–03:35 UTC, que tem conflitos conhecidos:
#   10 4 * * * /opt/Montese/ops/backup-r2-files.sh >> /var/log/montese-backup.log 2>&1
#
# Controle SÓ pela linha de comando/cron (FILES_BACKUP_* do .env são
# ignoradas de propósito):
#   FILES_BACKUP_ACTION=sync|verify|list-missing|init-destination|list-superseded|restore
#   FILES_BACKUP_DRY_RUN=1, FILES_BACKUP_PREFIX=..., FILES_BACKUP_CONFIRM_BUCKET=...
#   (demais opções: ver o cabeçalho de ops/r2-files-backup.js)
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/Montese}"
ENV_FILE="$PROJECT_DIR/.env"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-montese_backend}"
LOG_FILE="${LOG_FILE:-/var/log/montese-backup.log}"
LOCK_FILE="${LOCK_FILE:-/var/lock/montese-r2-files.lock}"
HELPER_SRC="$PROJECT_DIR/ops/r2-files-backup.js"
NETWORK="${FILES_BACKUP_DOCKER_NETWORK:-bridge}"
RUN_TIMEOUT="${FILES_BACKUP_RUN_TIMEOUT:-2h}"
CNAME="${FILES_BACKUP_CONTAINER_PREFIX:-montese_r2files}_$(date -u +%Y%m%d%H%M%S)_$$"
STAMP() { date -u +%Y-%m-%dT%H:%M:%SZ; }

log() {
  # Vai para a saída (o cron redireciona ao log) e, se rodado à mão, também
  # para o arquivo de log — sem duplicar quando a saída já é o próprio log.
  local line="[$(STAMP)] [r2-files] $*"
  echo "$line"
  if [ ! "$LOG_FILE" -ef /dev/stdout ] && [ -w "$(dirname "$LOG_FILE")" ]; then
    echo "$line" >> "$LOG_FILE"
  fi
}

# Uma execução por vez (cron + execução manual não se atropelam).
exec 9>>"$LOCK_FILE"
if ! flock -n 9; then
  log "[ERRO] já em execução (lock $LOCK_FILE ocupado) — nada foi feito"
  exit 1
fi

ACTION="${FILES_BACKUP_ACTION:-sync}"
log "início (ação=$ACTION, dry-run=${FILES_BACKUP_DRY_RUN:-0})"

# Lê SÓ as 8 variáveis R2 do .env, sem executar o arquivo como shell
# (sem source/eval). Aceita `NOME=valor`, `export NOME=valor`, aspas
# simples/duplas envolvendo o valor e comentário no fim da linha como o
# docker compose (`NOME=valor # nota` e `NOME="valor" # nota`; num valor SEM
# aspas, ` #` inicia comentário). Nada é impresso.
env_get() {
  local name="$1" line
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?${name}=" "$ENV_FILE" 2>/dev/null | tail -n 1 || true)
  line="${line#*=}"
  line="${line%$'\r'}"
  if [[ "$line" =~ ^\"([^\"]*)\"[[:space:]]*(#.*)?$ ]] || [[ "$line" =~ ^\'([^\']*)\'[[:space:]]*(#.*)?$ ]]; then
    line="${BASH_REMATCH[1]}"
  else
    line="${line%%[[:space:]]#*}"
    line="${line%"${line##*[![:space:]]}"}"
  fi
  printf '%s' "$line"
}

if [ ! -r "$ENV_FILE" ]; then
  log "[ERRO] .env não legível em $PROJECT_DIR — nada foi feito"
  exit 1
fi
VARS=(R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
  R2_BACKUP_ENDPOINT R2_BACKUP_ACCESS_KEY_ID R2_BACKUP_SECRET_ACCESS_KEY R2_BACKUP_BUCKET)
missing=()
for name in "${VARS[@]}"; do
  value="$(env_get "$name")"
  if [ -z "$value" ]; then missing+=("$name"); continue; fi
  # `export` é builtin: o valor não vira argumento de processo algum.
  export "$name=$value"
done
unset value
if [ "${#missing[@]}" -gt 0 ]; then
  log "[ERRO] variáveis não definidas no .env: ${missing[*]} — nada foi feito (ver docs/operations/backups.md)"
  exit 1
fi

if [ ! -f "$HELPER_SRC" ]; then
  log "[ERRO] helper não encontrado: $HELPER_SRC"
  exit 1
fi

IMAGE="${FILES_BACKUP_IMAGE:-}"
if [ -z "$IMAGE" ]; then
  # Só a imagem do backend em execução (nada de env/config).
  # ID exato da imagem em execução (não a tag, que pode ter sido movida).
  IMAGE=$(docker inspect --format '{{.Image}}' "$BACKEND_CONTAINER" 2>/dev/null || true)
fi
if [ -z "$IMAGE" ]; then
  log "[ERRO] não foi possível descobrir a imagem do backend (defina FILES_BACKUP_IMAGE) — nada foi feito"
  exit 1
fi

# Credenciais e opções vão por NOME (`-e NOME`): o docker lê o valor do
# ambiente deste processo, então ele não aparece em `ps`/argv.
passthrough=()
for name in "${VARS[@]}"; do passthrough+=(-e "$name"); done
passthrough+=(-e "FILES_BACKUP_ACTION=$ACTION")
for name in FILES_BACKUP_DRY_RUN FILES_BACKUP_CONCURRENCY FILES_BACKUP_RETRIES FILES_BACKUP_BACKOFF_MS \
  FILES_BACKUP_TIMEOUT_MS FILES_BACKUP_VERIFY_DEEP FILES_BACKUP_PREFIX FILES_BACKUP_ONLY_MISSING \
  FILES_BACKUP_PART_SIZE_MB FILES_BACKUP_MULTIPART_MB FILES_BACKUP_FORCE_PATH_STYLE \
  FILES_BACKUP_CONFIRM_BUCKET FILES_BACKUP_SUPERSEDED_MAX_AGE_DAYS FILES_BACKUP_ALLOW_BROAD_RESTORE; do
  if [ -n "${!name:-}" ]; then export "$name"; passthrough+=(-e "$name"); fi
done

# Se o `timeout` matar o cliente docker, o container efêmero não pode sobrar.
cleanup() { docker rm -f "$CNAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

set +e
# stdout = só a linha JSON do helper; stderr segue para a saída do script
# (o cron grava no mesmo log).
# --init: o node não roda como PID 1, então o SIGTERM do `timeout` (repassado
# pelo cliente docker) encerra o helper de fato.
RESULT=$(timeout --kill-after=60s "$RUN_TIMEOUT" docker run --rm --init --name "$CNAME" \
  --network "$NETWORK" --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 512m --memory-swap 512m --pids-limit 256 --user 1000:1000 \
  -v "$HELPER_SRC:/opt/montese-ops/r2-files-backup.js:ro" \
  -e NODE_PATH=/app/node_modules -e NODE_NO_WARNINGS=1 "${passthrough[@]}" \
  --entrypoint node "$IMAGE" /opt/montese-ops/r2-files-backup.js)
STATUS=$?
set -e

JSON_LINE=$(printf '%s\n' "$RESULT" | tail -n 1)
if [ -n "$JSON_LINE" ]; then log "resultado: $JSON_LINE"; fi
case "$STATUS" in
  0) log "[ok] fim (ação=$ACTION)"; exit 0 ;;
  124) log "[ERRO] tempo esgotado ($RUN_TIMEOUT) — container efêmero encerrado" ;;
  137) log "[ERRO] processo morto (SIGKILL: timeout após o prazo extra ou falta de memória — limite 512m)" ;;
  125) log "[ERRO] docker run falhou (imagem/rede '$NETWORK'?) — NÃO há fallback para docker exec no backend" ;;
  *) log "[ERRO] cópia dos arquivos FALHOU (código $STATUS) — ver 'error'/'failures' acima" ;;
esac
exit 1
