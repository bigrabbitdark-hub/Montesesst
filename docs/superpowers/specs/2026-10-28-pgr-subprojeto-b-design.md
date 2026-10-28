# PGR — Sub-projeto B (matriz de risco e plano de ação) — diagnóstico e proposta

**Data:** 2026-10-28 · **Estado:** RASCUNHO para decisão do proprietário. Nada implementado, nada commitado.
**Base:** worktree `/opt/montese-work/painel-release`; próxima migration livre: **0099** (VERIFICADO). Pré-requisitos: Z (0097) e A (0098).
**Regra:** nenhuma escala, faixa, nível, critério de aceitabilidade ou texto normativo é inventado; tudo isso vem da equipe técnica e fica registrado como configuração versionada.

## 1. Achados (VERIFICADO salvo indicação)
- `pgr_risks` (0098) não tem severidade, probabilidade, pontuação, nível nem risco residual.
- `pgr_risk_controls.kind` só aceita `epc/epi/administrativa/treinamento`: faltam **eliminação** e **substituição** da hierarquia pedida.
- `tasks` (0093) e `prevention_corrective_actions` (0039) não servem de plano de ação (sem N:N com risco, sem hierarquia, evidência ou eficácia; vocabulário de status diferente). INFERIDO: misturar poluiria o painel de tarefas.
- O sócio **não consegue anexar evidência** em `documents` hoje (só insere rascunho assinado, 0096).
- Versionamento existente (0096) congela arquivo + SHA-256, não dados estruturados. `document_drafts.category` já inclui `pgr`.
- Alertas: `@nestjs/schedule` + e-mail (padrão `visit-reminder.cron.ts`); sem fila BullMQ. NÃO VERIFICADO: destino dos alertas e execução multi-instância.

## 2. Proposta (RECOMENDADO)
**B1 Matriz** — `pgr_matrix_versions` imutável depois de publicada (config JSONB com escalas, faixas, níveis, critérios e metodologia + SHA-256 do JSON canônico); validação pura (sem lacunas/sobreposições, cobertura total); `pgr_risk_assessments` filha de `pgr_risks` (inerente/residual previsto, `matrix_version_id` fixo, justificativa obrigatória, histórico append-only). Alterar a matriz cria nova versão e nunca recalcula avaliações antigas.
**B2 Plano de ação** — tabelas dedicadas `pgr_actions`, `pgr_action_risks` (N:N), `pgr_action_events` (histórico imutável) e `pgr_action_evidences` (arquivo próprio, sem tocar `documents`); "atrasada" derivada (prazo vencido e aberta), nunca gravada; regras: EPI-only em risco alto/crítico exige justificativa, conclusão exige evidência + verificação de eficácia, ineficaz reabre o risco sem apagar histórico; alertas 30/15/7 idempotentes (UNIQUE ação+limiar).
**Fatias:** B1.1 banco+RLS → B1.2 validação/cálculo (unit) → B1.3 CRUD/publicar → B1.4 editor+mapa de calor → B1.5 avaliações + regra alto/crítico → B1.6 classificar no inventário; B2.1 banco+RLS → B2.2 máquina de estados → B2.3 upload de evidência (risco ALTO) → B2.4 alertas → B2.5 tabela + Kanban. Cada fatia com revisão independente; migrations 0099+ aplicadas primeiro no banco descartável.

## 3. Perguntas só do proprietário / equipe técnica
1. Escalas de severidade e probabilidade (rótulos, pesos, descrições): a matriz 5×5 nasce **vazia** (a equipe preenche) ou com semente que a equipe valida?
2. Faixas, nomes dos níveis, aceitabilidade e decisão por faixa; qual nível bloqueia a emissão ("alto/crítico").
3. Metodologia (só severidade × probabilidade?) e quem valida (nome, registro, data).
4. Quem publica versão da matriz (admin, sócio com permissão nova, dupla aprovação?).
5. Matriz global da Montese, por empresa, ou global com exceção por empresa?
6. Risco residual: apenas previsto pelo técnico ou calculado dos controles?
7. "Treinamento" passa a ser administrativa? Controles do A viram ações ou ficam separados?
8. Evidência: tipos/tamanho, retenção, quem vê (a empresa também?); autoriza tabela própria em vez de relaxar a regra de `documents`?
9. Quem verifica a eficácia (outro profissional) e em quanto tempo reavaliar?
10. Alertas 30/15/7: destinatários e canal (e-mail, painel); avisam a empresa cliente?
11. Plano de ação integrado ao painel de tarefas/agenda ou independente?
12. Autorização para migrations 0099+ (banco descartável primeiro) e para o upload (risco ALTO).

## 4. Riscos
Schema/RLS, permissões novas (CHECK ampliado), upload de arquivos, dados de saúde ocupacional: **risco ALTO**; revisão de segurança independente obrigatória por fatia.
