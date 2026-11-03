#!/usr/bin/env bash
# Derruba a homologação: remove os 4 containers socio_hom_* e apaga o banco montese_hom (descartável).
set -euo pipefail
for n in socio_hom_s3 socio_hom_nginx socio_hom_backend socio_hom_frontend; do docker rm -f $n >/dev/null 2>&1 || true; done
docker exec -i socio_ensaio_pg psql -U ensaio_su -d postgres -q -c "DROP DATABASE IF EXISTS montese_hom" || true
echo "homologação removida (socio_ensaio_pg/redis permanecem)"
