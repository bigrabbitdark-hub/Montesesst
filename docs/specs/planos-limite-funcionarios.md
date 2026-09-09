# Planos — limite de funcionário por plano (enforcement real)

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-09.
> Primeiro dos 4 sub-projetos da frente de "enforcement" que a proposta
> comercial de `/planos` (já fechada, `docs/specs/planos-proposta-comercial.md`)
> deliberadamente deixou de fora. Os outros 3 (cota de atendimento
> técnico, limite de uso de IA, comissão do técnico por visita) ficam
> pra depois, cada um com seu próprio brainstorming — ver Seção 6.

## 1. Objetivo e escopo

`plans.employee_limit` existe no schema desde a Fase de Planos +
Assinaturas (2026-08-18/19), mas é hoje **só informativo** — nenhum
código no backend lê essa coluna pra decidir se um cadastro de
funcionário deve ser aceito (confirmado por grep: as únicas 2
ocorrências de `employee_limit` em `backend/src` são leitura pura pra
exibição, `plans.service.ts:6,14`). Esta fase faz esse limite valer de
verdade: uma empresa que já está no limite do plano contratado não
consegue cadastrar mais funcionários (criação manual, importação em
lote, ou reativação de um funcionário inativo) até fazer upgrade.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Trial (sem assinatura `authorized`) continua sem limite nenhum** —
  mantém a decisão já registrada em `docs/specs/planos-assinaturas.md`
  ("o trial já dá acesso completo a tudo que existe hoje"). O limite só
  passa a valer depois que a empresa tem uma assinatura de verdade
  aprovada.
- **Só funcionário `status = 'ativo'` conta pro limite** — um
  funcionário desligado (`'inativo'`, mantido por histórico de
  compliance, nunca apagado) não ocupa vaga do limite.
- **Reativar um funcionário inativo conta igual a criar um novo** — se
  a empresa já está no limite, `PATCH /employees/:id` mudando
  `status` pra `'ativo'` é bloqueado do mesmo jeito que um cadastro
  novo, mas só quando isso é uma mudança real de status (editar outro
  campo de um funcionário que já era `'ativo'` não aciona a checagem).
- **`admin` tem bypass total** — mesmo padrão já usado em RLS/outras
  regras de posse deste produto; operação interna da Montese nunca é
  bloqueada pelo limite comercial de um tenant.
- **Múltiplas assinaturas `authorized` simultâneas usam o maior
  limite** — gap já documentado (não corrigido) no spec de
  Planos+Assinaturas ("nada impede múltiplas assinaturas simultâneas
  pro mesmo tenant"); nunca bloqueia por engano uma empresa que já paga
  por um plano maior. Se qualquer assinatura ativa for Enterprise
  (`employee_limit IS NULL`), o resultado é "sem limite" (o maior valor
  possível sempre vence).
- **Importação em lote nunca aborta o lote inteiro por causa do
  limite** — linhas que excederiam o limite viram erro por linha
  (mesmo padrão já usado pra CPF inválido/filial não encontrada), o
  resto do lote continua sendo processado normalmente.
- **HTTP 403** pra rejeição de criação/reativação única (não 400/409)
  — a requisição está bem formada, é proibida por regra de negócio do
  plano contratado.

## 3. Onde vem o limite

Novo método `SubscriptionsService.getActiveEmployeeLimit(client,
tenantId): Promise<number | null>` (`backend/src/payments/subscriptions.service.ts`,
módulo já existente). `null` significa "sem limite" (trial, Enterprise,
ou qualquer assinatura ativa sem teto).

```sql
SELECT p.employee_limit
FROM subscriptions s
JOIN plans p ON p.id = s.plan_id
WHERE s.tenant_id = $1 AND s.status = 'authorized'
```

Lógica em código: se nenhuma linha voltar, `null`. Se alguma linha
tiver `employee_limit IS NULL`, resultado final `null`. Caso contrário,
`Math.max(...employee_limit das linhas)`.

Mesmo padrão de JOIN já usado em `tenants.service.ts:203-209` (`findDetail`),
só filtrando por `status = 'authorized'` e trazendo `employee_limit`
em vez de `name`/`price_cents`.

## 4. Onde e como o limite é fiscalizado

Contagem de referência, reutilizada nos 3 pontos abaixo: `SELECT
COUNT(*) FROM employees WHERE tenant_id = $1 AND status = 'ativo'`.

### 4.1 `EmployeesService.create()` (`POST /employees`, criação única)

Antes do INSERT, se `role !== 'admin'`: busca `limit =
getActiveEmployeeLimit(...)`. Se `limit !== null` e a contagem atual
`>= limit`, rejeita com `ForbiddenException` (403) e mensagem `Limite
de ${limit} funcionários do plano atingido. Faça upgrade para
adicionar mais.`.

### 4.2 `EmployeesService.update()` (`PATCH /employees/:id`, reativação)

Só quando `data.status === 'ativo'` E o `status` atual do funcionário
**não** já era `'ativo'`. `update()` hoje só busca a linha existente
quando `company_unit_id`/`position_id` vêm no payload (pra validar
posse) — pra um update de `status`, é preciso um `SELECT tenant_id,
status FROM employees WHERE id = $1` novo, específico pra esta
checagem (reaproveita a mesma linha pra também resolver o `tenantId`
usado na busca do limite, sem duas queries separadas). Mesma
checagem/mensagem da Seção 4.1.

### 4.3 `processImportRows()` (compartilhado por `import`/`import-mapped`)

Busca `limit` e a contagem atual **uma vez**, antes do loop principal
(mesmo padrão já usado pra `unitsByName`, `employees.service.ts:238-242`).
Mantém um contador local (`aceitosNestaImportacao`) incrementado a cada
linha aceita. Pra cada linha, se `limit !== null` e `(contagemAtual +
aceitosNestaImportacao) >= limit`, empurra `{ linha: row.line, motivo:
'Limite de funcionários do plano atingido' }` e `continue` — mesmo
formato de erro por linha já usado pras validações existentes
(`employees.service.ts:247-260`), sem abortar o resto do lote.

`role === 'admin'` pula a checagem inteira nos 3 pontos (nenhuma
consulta de limite é feita).

## 5. Testes

e2e reais (Postgres real, `TestDb`). Fixture de "tenant com assinatura
ativa" é uma linha inserida direto em `subscriptions` via o cliente de
superuser do `TestDb` (`status: 'authorized'`), sem precisar chamar a
API real do Mercado Pago — o fluxo de pagamento em si já é coberto pela
suíte de `planos-assinaturas`, esta fase testa só o enforcement.

Cenários: tenant com plano de limite baixo, funcionários até o limite
exato, criação do próximo é rejeitada (403, mensagem certa); import em
lote perto do limite — parte aceita, parte rejeitada com o motivo
certo, resto do lote continua; reativar funcionário inativo no limite
é rejeitado; editar outro campo de funcionário já ativo não aciona a
checagem; admin criando pra tenant no limite é aceito; tenant em trial
(sem assinatura `authorized`) nunca é bloqueado; 2 assinaturas
`authorized` simultâneas usam o maior limite; assinatura Enterprise
ativa (`employee_limit IS NULL`) junto de outra assinatura resulta em
sem limite.

## 6. Fora de escopo

- Os outros 3 sub-projetos da frente de enforcement: cota de
  atendimento técnico rastreada, limite de uso de IA/documentos por
  plano, comissão do técnico por visita presencial — cada um com seu
  próprio brainstorming e spec, ainda não iniciados.
- Qualquer mudança na página `/planos` (proposta comercial, já
  fechada) ou no fluxo de assinatura em si (`POST /subscriptions`,
  webhook do Mercado Pago).
- Qualquer UI nova pro erro de limite — o frontend hoje já mostra a
  mensagem de erro devolvida pelo backend nos formulários de
  funcionário/importação (padrão já existente, reaproveitado sem
  mudança).
- Correção da múltiplas-assinaturas-simultâneas em si (só o
  contorno "usa o maior limite" faz parte desta fase, não uma correção
  estrutural do gap).
