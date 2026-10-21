#!/usr/bin/env bash
# Executa um script Node de jornada (Playwright do frontend) contra a HOMOLOGAÇÃO descartável.
# Uso: HOM_DIR=<pasta fora do repo> ./hom-run.sh <script.mjs|.js> [args]
# Exporta HOM_BASE e as senhas de TESTE (aleatórias, de hom.env) para o processo; nunca as imprime.
set -euo pipefail
: "${HOM_DIR:?}"
set -a; . "$HOM_DIR/hom.env"; set +a
export HOM_BASE="$(cat "$HOM_DIR/hom.addr")"
export HOM_SHOTS="${HOM_SHOTS:-$HOM_DIR/hom-shots}"; mkdir -p "$HOM_SHOTS"
export NODE_PATH=/opt/Montese/frontend/node_modules
exec node "$@"
