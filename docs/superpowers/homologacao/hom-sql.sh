#!/usr/bin/env bash
# Consulta SOMENTE LEITURA ao banco montese_hom (descartável). Uso: ./hom-sql.sh "SELECT ..."
set -euo pipefail
exec docker exec -i socio_ensaio_pg psql -U ensaio_su -d montese_hom -X -q -v ON_ERROR_STOP=1 \
  -c "SET default_transaction_read_only = on" -c "$1"
