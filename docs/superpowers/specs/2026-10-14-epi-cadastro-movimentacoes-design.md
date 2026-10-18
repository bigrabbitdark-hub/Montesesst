# Módulo EPI — Subsistema 1: cadastro e movimentações (design)

Data: 2026-10-14. Status: rascunho para revisão do proprietário. Sem commit.
Rótulos: VERIFICADO (lido no código/planilha), RECOMENDADO (proposta).

## Contexto e escopo

Reestruturação do módulo EPI em 4 subsistemas, cada um com spec, plano e implementação próprios:

1. **Cadastro de EPI e movimentações** (este documento).
2. Ficha de controle e PDF.
3. Assinatura eletrônica mobile.
4. Menu EPI e dashboard.

Este subsistema entrega backend, migration e testes. Não inclui tela, ficha, PDF nem link de assinatura (apenas o campo de status que eles usarão).

### Estado atual (VERIFICADO)
- `tenant_epis` (item do catálogo NR-06 + `ca_number` + `ca_valid_until`) e `employee_epi_deliveries` (`signed_by_name` em texto livre), ambas com RLS + FORCE RLS (migrations 0013/0014).
- Rotas `/epis` (POST, GET, DELETE, `:id/deliveries`) e `/epi-catalog-items`; `/caepi` para consulta de CA. Frontend: `empresa/epis` (somente catálogo).
- Não existe: quantidade, estoque, lote, fabricante, mínimo/máximo, custo, devolução, troca, baixa, estorno.
- Reaproveitar: `AuditService`, `withTenantContext`, `@Roles`, rate limit, padrão de RLS (`assigned_tenant_ids_for_current_user()`).
- Testes existentes que devem continuar verdes: `epis-crud`, `epi-deliveries`, `epi-catalog-rls`, `caepi`, `epi-by-function`.

### Decisões do proprietário (2026-10-14)
- Estoque por EPI, com **lote opcional** (flag por EPI).
- Entrega com assinatura pendente **baixa o estoque na hora**; a entrega fica "pendente". Recusa/expiração: o responsável reenvia, registra entrega presencial ou estorna.
- Operar: empresa, técnico e parceiro vinculados. **Ajuste de inventário e estorno**: só o dono da conta da empresa e o admin, com justificativa.
- Saldo inicial por movimentação de **abertura** auditável.
- Aviso de vencimento padrão: **30 dias** (configurável por empresa) — RECOMENDADO, não é prazo normativo.

## Abordagem

Livro de movimentações imutável + saldo materializado, atualizado na mesma transação com `SELECT ... FOR UPDATE` no EPI (serializa concorrência). Rejeitadas: saldo só por SUM (concorrência frágil) e event sourcing completo (excesso).

## Modelo de dados (migration a partir de 0081; numeração a confirmar na hora do merge)

Aditiva: nada é apagado nem reescrito. 0079 está em produção e 0080 está na branch `feat/tabela-oficial-funcionarios`.

**`tenant_epis`** (colunas novas): `manufacturer`, `model`, `unit` (padrão `un`), `min_stock`, `max_stock`, `unit_cost` (numeric), `controls_lot` (bool, padrão false), `replacement_days` (nullable), `status` (`ativo`/`inativo`), `stock_balance` (int, CHECK ≥ 0), `updated_by_user_id`.
- `ca_valid_until` continua sendo a validade do CA. Validade do produto vive só no lote. Prazo de substituição é campo próprio.
- Unicidade por empresa: (catálogo, CA, fabricante, modelo), tratando nulos de forma explícita.
- CHECK: `max_stock` ≥ `min_stock` quando ambos existem.

**`epi_lots`**: `tenant_id`, `tenant_epi_id`, `lot_code`, `valid_until`, `balance` (CHECK ≥ 0). Único por (`tenant_epi_id`, `lot_code`). Só para EPI com `controls_lot`.

**`epi_movements`** (imutável):
`tenant_id`, `tenant_epi_id`, `type` (`abertura`, `entrada`, `entrega`, `devolucao`, `troca`, `baixa`, `ajuste`, `estorno`), `direction` (+1/−1), `quantity` (> 0), `balance_after`, `employee_id` (nullable), `supplier` (nullable), `lot_id` (nullable), `reason`, `occurred_at`, `delivery_id` (nullable), `reverses_movement_id` (nullable, único), `idempotency_key` (único por empresa), `created_by_user_id`, `created_at`.
- Trigger bloqueia UPDATE e DELETE. FK de EPI em RESTRICT.
- CHECKs de coerência: entrega/troca/devolução exigem funcionário; entrada exige origem; baixa e ajuste exigem `reason`; EPI com lote exige `lot_id`.

**`employee_epi_deliveries`** (colunas novas): `quantity` (nullable para legado), `movement_id`, `signature_status` (`pendente`, `assinada`, `recusada`, `expirada`, `presencial`; legado = `legado`). Registros antigos ficam intactos e sem quantidade inventada.

**Configuração por empresa**: `epi_alert_days` (padrão 30) em tabela de settings existente ou coluna em `tenants` — a escolher no plano, após ler `tenants`.

Todas as tabelas novas: RLS + FORCE RLS com a policy padrão do módulo e índice em `tenant_id`.

## Regras de negócio

- **Idempotência**: mesma `idempotency_key` devolve a movimentação já criada, sem duplicar saldo.
- **Saldo**: nunca negativo (CHECK no banco + validação no serviço com erro claro). Sem exceção autorizada nesta fase. Lote respeita o mesmo limite.
- **Correção**: sem DELETE/UPDATE de movimentação. Estorno cria linha oposta com `reverses_movement_id`; cada movimentação é estornada uma única vez. Estornar entrega devolve ao estoque e marca a entrega vinculada como estornada.
- **Abertura**: uma por EPI (e por lote), só pelo dono da conta/admin, antes de outras movimentações do EPI.
- **Entrega**: valida funcionário do mesmo tenant, EPI ativo, CA vencido gera bloqueio ou aviso (a decidir no plano; RECOMENDADO bloquear e permitir justificativa só com permissão específica), cria movimentação + entrega `pendente` na mesma transação.
- **Alertas** (cálculo): sem estoque (0), abaixo do mínimo, ótimo, acima do máximo; CA e lote vencidos/a vencer em `epi_alert_days`. Sem prazos normativos inventados.
- **Exclusão de EPI**: só sem movimentações (o comportamento atual é mantido); caso contrário, inativar.

## API (sob `/epis`, sem duplicar rotas existentes)

- `GET /epis` com busca, filtros (status, faixa de estoque, vencimento) e paginação; `PATCH /epis/:id` auditado; `GET /epis/:id/lots`.
- `POST /epis/:id/movements` (entrada, entrega, devolução, troca, baixa), `POST /epis/:id/adjustments` e `POST /epis/movements/:id/reversal` (permissão restrita); `GET /epis/movements` com filtros e paginação.
- DTOs com `whitelist` + `forbidNonWhitelisted`. `tenant_id` nunca vem do corpo para o perfil `empresa`.
- Toda mutação grava no `AuditService` (sem CPF em logs).
- Contrato de `POST /epis/:id/deliveries` existente preservado como compatibilidade, delegando ao novo fluxo.

## Testes (em ensaio descartável; nunca contra produção)

Cadastro e edição; entrada e saída; saldo insuficiente; requisição duplicada; concorrência de entregas (N paralelas, saldo exato); isolamento entre empresas (RLS, incluindo técnico/parceiro não vinculado); estorno único; imutabilidade (UPDATE/DELETE falham); conferência saldo = soma das movimentações; permissões por papel; lote; regressão dos 5 testes existentes.

## Riscos

- Colisão de numeração de migration com outras branches (confirmar antes do merge).
- Pasta principal tem 131 alterações não commitadas de outras sessões: implementar em worktree isolado.
- Backfill de saldo: EPIs existentes começam com saldo 0 e sem abertura; entregas legadas não geram movimentação.
- Nada disso foi implementado nem testado ainda.

## Critérios de aceitação

1. Migration aditiva aplica e reverte (rollback documentado) em ensaio descartável.
2. Saldo sempre igual à soma das movimentações; nunca negativo, mesmo sob concorrência.
3. Movimentação confirmada não é alterável nem apagável; correção só por estorno rastreável.
4. Isolamento entre empresas e permissões comprovados por testes.
5. Testes existentes de EPI continuam passando; build e typecheck limpos.

## Fora de escopo

Frontend, ficha, PDF, assinatura e dashboard (subsistemas 2–4); importação da planilha (contém dados pessoais reais; depende de decisão LGPD); qualquer mudança de infraestrutura.
