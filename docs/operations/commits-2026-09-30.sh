#!/usr/bin/env bash
# PREPARADO, NÃO EXECUTADO. Revise `git diff` de cada frente antes de rodar.
# Um commit por frente, em ordem. Nenhum push. Para no primeiro erro.
# Uso: bash docs/operations/commits-2026-09-30.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")/../.."
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
TRAILER='Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>'

commit_group() {
  local msg="$1"; shift
  git add -A -- "$@"
  if git diff --cached --quiet; then echo "[vazio] $msg"; return; fi
  echo "=== $msg"; git diff --cached --stat | tail -1
  if [ "$DRY" = "1" ]; then git reset -q; return; fi
  git commit -q -m "$msg" -m "$TRAILER"
}

commit_group "feat(dashboard): GET /dashboard/overview e contagens do cruzamento PGR×PCMSO no summary" \
  backend/src/dashboard backend/test/dashboard-overview.e2e-spec.ts backend/test/dashboard-summary.e2e-spec.ts

commit_group "feat(pagamentos): troca de plano cancela preapproval anterior e cron de reconciliação de assinaturas" \
  backend/src/payments backend/test/subscription-downgrade-check.e2e-spec.ts backend/test/subscription-reconciliation.e2e-spec.ts

commit_group "fix(assistente): claim-support, avisos de pergunta e EPI por função" \
  backend/src/normative backend/test/claim-support.unit-spec.ts backend/test/epi-by-function.unit-spec.ts \
  backend/test/question-notices.unit-spec.ts backend/test/normative-assistant.e2e-spec.ts \
  backend/test/normative-assistant-tecnico-tenant.e2e-spec.ts backend/test/tenant-context-callsites.unit-spec.ts

commit_group "fix(company-units): ajustes de controller/serviço e e2e" \
  backend/src/company-units backend/test/company-units.e2e-spec.ts

commit_group "fix(pente-fino): comparação de funções e spec do LIP com source_excerpt" \
  backend/src/pente-fino backend/test/pente-fino-comparison.unit-spec.ts backend/test/pente-fino-run.e2e-spec.ts \
  backend/test/pente-fino-lip-insalubridade.e2e-spec.ts

commit_group "feat(custo-ia): monitor de crédito OpenRouter e estimativa de custo MiniMax (ITEM 013/014)" \
  backend/db/migrations/0061_openrouter_credit_status.sql backend/db/migrations/0062_minimax_usage_estimated_cost.sql \
  backend/src/common/ai-usage backend/src/admin-dashboard backend/test/admin-alert-rules.unit-spec.ts \
  backend/test/minimax-cost.unit-spec.ts .env.example

commit_group "chore(infra): commit do git embutido na imagem e exposto em /health (ITEM 009)" \
  backend/Dockerfile docker-compose.yml ops/build-with-commit.sh backend/src/health

commit_group "feat(normative): seed das fontes normativas oficiais (NR) e script de reseed" \
  backend/db/reseed-normative-sources.ts backend/db/seed-data backend/package.json

commit_group "feat(frontend): dashboard v2 (design system, componentes, dados reais, vitest/eslint/playwright)" \
  frontend/e2e frontend/eslint.config.mjs frontend/playwright.config.ts frontend/vitest.config.ts frontend/vitest.setup.ts \
  frontend/package.json frontend/package-lock.json frontend/public/dashboard-v2 frontend/src/app/dashboard-v2 \
  frontend/src/app/empresa/em-construcao frontend/src/app/globals.css frontend/src/app/layout.tsx \
  frontend/src/components/dashboard frontend/src/components/ui frontend/src/lib/dashboard

commit_group "fix(frontend): assistente e página de planos" \
  "frontend/src/app/(site)/planos/page.tsx" frontend/src/components/AssistantChat.tsx frontend/src/components/AssistantSummaryPanel.tsx

commit_group "docs: dashboard v2, design system, plano de release e specs (eSocial, documentos de referência, auditoria)" \
  docs

left="$(git status --short | wc -l)"
echo "Sobraram $left entradas fora dos grupos:"; git status --short
