#!/bin/bash
# Executado automaticamente pelo entrypoint oficial do Postgres na primeira
# inicialização do volume (docker-entrypoint-initdb.d). POSTGRES_USER vira
# superuser por padrão na imagem oficial, e superuser sempre ignora RLS —
# por isso a aplicação NUNCA deve conectar com ele. Esta role é quem o
# backend realmente usa (POSTGRES_APP_USER / POSTGRES_APP_PASSWORD).
#
# Nota: dentro de blocos DO $$ ... $$ o psql NÃO substitui variáveis
# :'nome' (são tratadas como parte da string dollar-quoted). Por isso aqui
# usamos o padrão SELECT ... \gexec em vez de DO blocks.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$POSTGRES_APP_USER" \
  -v app_password="$POSTGRES_APP_PASSWORD" \
  -v db_name="$POSTGRES_DB" <<-'EOSQL'
    SELECT format(
      'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE',
      :'app_user', :'app_password'
    )
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user')
    \gexec

    GRANT ALL PRIVILEGES ON DATABASE :"db_name" TO :"app_user";
    GRANT ALL ON SCHEMA public TO :"app_user";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO :"app_user";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO :"app_user";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO :"app_user";

    -- Role sem LOGIN, com BYPASSRLS, usada apenas para ser dona da função
    -- SECURITY DEFINER de bootstrap de login (auth_find_user_by_email, criada
    -- na migration 0001). Precisa existir e ser criada por um superuser porque
    -- BYPASSRLS só pode ser concedido por superuser. montese_app precisa ser
    -- membro dela para poder transferir a posse da função (ALTER ... OWNER TO)
    -- quando a migration rodar.
    SELECT 'CREATE ROLE montese_auth_bypass NOLOGIN BYPASSRLS'
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'montese_auth_bypass')
    \gexec

    GRANT montese_auth_bypass TO :"app_user";

    -- Postgres exige que, para transferir a posse de um objeto (ALTER
    -- FUNCTION ... OWNER TO), o novo dono tenha CREATE no schema onde o
    -- objeto vive — mesmo só herdando a role via GRANT acima.
    GRANT CREATE ON SCHEMA public TO montese_auth_bypass;
EOSQL
