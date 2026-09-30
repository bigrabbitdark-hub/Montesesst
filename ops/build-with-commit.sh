#!/bin/sh
# ITEM 009 (auditoria do Assistente, 2026-09-28): builda backend/frontend
# com o SHA do commit atual embutido (GIT_COMMIT), exposto em GET /health
# como "commit". Sem isto, a imagem builda sem saber de qual commit veio —
# foi assim que a produção ficou 6 commits atrás do HEAD sem ninguém notar
# até uma auditoria manual comparar o .js compilado com o código-fonte.
#
# Só builda as imagens — NÃO recria os containers. `docker compose up -d`
# fica como passo manual separado de propósito (ver AGENTS.md, seção
# Infraestrutura: mudança em produção pede autorização explícita antes de
# aplicar, não só antes de buildar).
set -e
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Aviso: há mudanças não commitadas — o commit embutido na imagem não vai refletir o working tree exato." >&2
fi

export GIT_COMMIT="$(git rev-parse HEAD)"
echo "Buildando com GIT_COMMIT=$GIT_COMMIT"
docker compose build backend frontend

echo
echo "Build concluído. Isto NÃO recriou os containers em produção."
echo "Pra aplicar: docker compose up -d backend frontend"
echo "Pra conferir depois: curl -s http://localhost:4000/health (campo \"commit\")"
