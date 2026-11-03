#!/usr/bin/env bash
# Sobe o ambiente de HOMOLOGAÇÃO (backend + frontend + nginx + stub S3) na rede DESCARTÁVEL socio_ensaio.
# Não publica porta, não toca produção, não lê .env. Segredos: aleatórios, em $HOM_DIR (fora do repositório).
set -euo pipefail
: "${HOM_DIR:?defina HOM_DIR (pasta fora do repositório com ensaio.env do Postgres/Redis descartáveis)}"
REPO=/opt/Montese; HOMDIR=$REPO/docs/superpowers/homologacao
NET=socio_ensaio; PG=socio_ensaio_pg; DB=montese_hom
. "$HOM_DIR/ensaio.env"   # SU_PW APP_PW RD_PW — só do Postgres/Redis DESCARTÁVEIS

if [ ! -f "$HOM_DIR/hom.env" ]; then
  ( umask 077; for v in HOM_JWT_SECRET HOM_PW_ADMIN HOM_PW_SOCIOA HOM_PW_SOCIOB HOM_PW_EMPRESA HOM_PW_TECNICO HOM_S3_KEY HOM_S3_SECRET; do echo "$v=$(openssl rand -hex 16)"; done > "$HOM_DIR/hom.env" )
fi
. "$HOM_DIR/hom.env"

psqlsu() { docker exec -i "$PG" psql -U ensaio_su "$@"; }
echo "[1/5] banco $DB (novo) + migrations"
psqlsu -d postgres -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
psqlsu -d "$DB" -q -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;
 GRANT ALL PRIVILEGES ON DATABASE $DB TO montese_app; GRANT ALL ON SCHEMA public TO montese_app;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO montese_app;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO montese_app;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO montese_app;
 GRANT CREATE ON SCHEMA public TO montese_auth_bypass;"
for f in $(ls "$REPO"/backend/db/migrations/*.sql | sort); do
  psqlsu -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -q -f - < "$f" >/dev/null || { echo "migration falhou: $f"; exit 1; }
done

echo "[2/5] arquivo de ambiente de execução (600)"
( umask 077
  cat > "$HOM_DIR/run.env" <<EOT
HOM_PW_ADMIN=$HOM_PW_ADMIN
HOM_PW_SOCIOA=$HOM_PW_SOCIOA
HOM_PW_SOCIOB=$HOM_PW_SOCIOB
HOM_PW_EMPRESA=$HOM_PW_EMPRESA
HOM_PW_TECNICO=$HOM_PW_TECNICO
EOT
  printf 'NODE_PATH=/app/node_modules\nDATABASE_URL=postgresql://ensaio_su:%s@%s:5432/%s\n' "$SU_PW" "$PG" "$DB" >> "$HOM_DIR/run.env" )
docker run --rm --network $NET --env-file "$HOM_DIR/run.env" -v $REPO/backend:/app:ro -v $HOMDIR:/hom:ro node:20-bookworm-slim node /hom/seed.js

echo "[3/5] stub S3 e nginx"
for n in socio_hom_s3 socio_hom_nginx socio_hom_backend socio_hom_frontend; do docker rm -f $n >/dev/null 2>&1 || true; done
docker run -d --name socio_hom_s3 --network $NET --memory 256m -v $HOMDIR/s3-stub.js:/s3.js:ro node:20-bookworm-slim node /s3.js >/dev/null
docker run -d --name socio_hom_nginx --network $NET --memory 128m -v $HOMDIR/nginx.conf:/etc/nginx/nginx.conf:ro nginx:1.27-alpine >/dev/null
ip() { docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1"; }
S3IP=$(ip socio_hom_s3); NGX=$(ip socio_hom_nginx)

echo "[4/5] backend e frontend"
( umask 077
  cat > "$HOM_DIR/backend.env" <<EOT
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://montese_app:$APP_PW@$PG:5432/$DB
REDIS_URL=redis://:$RD_PW@socio_ensaio_redis:6379
JWT_SECRET=$HOM_JWT_SECRET
JWT_EXPIRES_IN=2h
PUBLIC_APP_URL=http://$NGX
R2_ENDPOINT=http://$S3IP:9000
R2_ACCESS_KEY_ID=$HOM_S3_KEY
R2_SECRET_ACCESS_KEY=$HOM_S3_SECRET
R2_BUCKET=hom-bucket
GOOGLE_CLIENT_ID=fake
GOOGLE_CLIENT_SECRET=fake
GOOGLE_TOKEN_ENCRYPTION_KEY=$(printf 'b%.0s' $(seq 1 64))
MERCADOPAGO_ACCESS_TOKEN=fake-homologacao-nao-usar-000000
MERCADOPAGO_WEBHOOK_SECRET=fake-homologacao-0000
ASSISTANT_QUERY_LOG_DISABLED=true
AUTH_RATE_LIMIT_MAX=1000
RATE_LIMIT_MAX=5000
EOT
)
docker run -d --name socio_hom_backend --network $NET --memory 1g --env-file "$HOM_DIR/backend.env" -v $REPO/backend:/app:ro -w /app node:20-bookworm-slim node dist/src/main.js >/dev/null
docker run -d --name socio_hom_frontend --network $NET --memory 1g -e NODE_ENV=production -e PORT=3000 -e HOSTNAME=0.0.0.0 --tmpfs /app/.next/cache -v $REPO/frontend:/app:ro -w /app node:20-bookworm-slim node node_modules/next/dist/bin/next start -p 3000 >/dev/null

echo "[5/5] aguardando saúde"
for i in $(seq 1 60); do
  code=$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://$NGX/api/health" || true)
  [ "$code" = "200" ] && break; sleep 2
done
echo "api/health -> $code"
echo "http://$NGX" > "$HOM_DIR/hom.addr"
echo "pronto: $(cat "$HOM_DIR/hom.addr") (alcançável do shell do agente; nenhuma porta publicada)"
