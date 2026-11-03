# Auditoria da Fase 4 — financeiro somente leitura (somente leitura)

Data: 2026-10-20. Nenhum código, banco ou configuração foi alterado.

## O que existe (VERIFICADO)
- **Tabelas:** `plans` (sem RLS), `subscriptions` (RLS; `tenant_id` XOR `technician_user_id`), `payment_events` (RLS por assinatura; `subscription_id` nulo é permitido para webhook órfão). Plano: `slug`, `name`, `price_cents`, `employee_limit`, `active`.
- **Rotas financeiras hoje:** `GET /plans` (**público**), `PATCH /plans/:id` (admin; só `price_cents`), `GET /subscriptions` e `GET /subscriptions/:id/payment-events` (admin), `PATCH /subscriptions/:id/status` (admin; chama o Mercado Pago), `POST /subscriptions` (empresa/técnico), webhook do Mercado Pago (público, valida assinatura), `GET /admin/dashboard/financeiro` (admin).
- **O painel financeiro do admin** (`admin-dashboard.service.ts` `getFinanceiro`) agrega **todos** os `payment_events`, inclusive os de assinaturas de técnicos (`technician_user_id`), e expõe `mercadopago_payment_id` nos pagamentos recentes.
- **Quem lê `plans`:** `plans.service`, `subscriptions.service`, `tenants.service`, `overview.service`, `admin-dashboard.service` — todos com `JOIN` ou `SELECT` simples.
- **Estado de assinatura por cliente:** `deriveAccessState` (Fase 2) já classifica `ativa | pendente | inativa | trial`.
- **Auditoria de negações:** o `AuditInterceptor` global roda **depois** dos guards; um `403` do `RolesGuard` não passa por ele. Só o `PermissionsGuard` (Fase 1) audita negações. Logo, tentativa do sócio de alterar plano ou assinatura **não é auditada hoje**, mas a spec (§6) exige "tentativas de operação financeira negadas".
- **Proteção atual contra escrita do sócio:** `subscriptions` e `payment_events`: sem policy de escrita para `socio` (RLS nega). `plans`: **sem RLS**; só o `RolesGuard` impede (teste da Fase 1 documenta que um `UPDATE` direto com `app.role=socio` afeta 1 linha).

## Lacunas e riscos
1. **`plans` sem barreira no banco** (confirmado). Habilitar RLS em `plans` é invasivo: `GET /plans` é público e várias tabelas fazem `JOIN`. Alternativa de menor risco (RECOMENDADO): `trigger BEFORE INSERT/UPDATE/DELETE` que levanta exceção quando `app.role` é `socio`, `empresa`, `tecnico` ou `parceiro` (contexto vazio/admin/migrations passam). Não muda leitura nem o seed.
2. **`payment_events` sem policy de leitura para o `socio`**: precisa de `SELECT` limitado a eventos de assinaturas de tenants Montese. Eventos órfãos e de técnicos ficam invisíveis.
3. **Escopo dos "indicadores gerais"**: o painel do admin soma também a receita de **assinaturas de técnicos**. Decisão do proprietário: "todos os clientes e indicadores gerais", mas a spec separa a carteira de técnicos da carteira Montese. Escolha adotada como padrão seguro: sócio vê **somente clientes Montese**; ampliar para a receita total (técnicos) é uma decisão explícita do proprietário.
4. **Dados sensíveis a não expor ao sócio:** `mercadopago_payment_id`, `mercadopago_preapproval_id`, qualquer payload do Mercado Pago, tokens. DTO de saída explícito, sem `SELECT *`.
5. **"Inadimplência / tempo de atraso" não tem definição no código.** Existem regras de alerta do admin (`alert-rules.ts`: `payments_pending_stale` etc.), mas nenhuma definição de cliente inadimplente. Definição proposta (INFERIDO, precisa de aprovação): cliente com assinatura `authorized` cujo **pagamento mais recente** tem status em `rejected|cancelled|pending|in_process|…` (qualquer um fora de `approved`) está **com pendência**; **dias de atraso** = hoje (fuso `America/Sao_Paulo`) menos a data desse pagamento. Cliente `paused`/`cancelled` não é "inadimplente": aparece como situação `inativa`.
6. **MRR:** soma de `plans.price_cents` das assinaturas `authorized` de tenants Montese (preço **atual** do plano, não o histórico cobrado). INFERIDO.
7. **Auditoria de acesso a dados financeiros** (spec §6, "conforme a política"): não há política definida. Proposta: registrar `finance.viewed` com tipo de consulta (resumo/lista/ficha) e ids, sem valores; sem rastrear cada recarga (no máximo uma linha por rota por usuário por minuto — a definir).

## Decisões necessárias do proprietário
1. **Escopo:** o sócio vê só clientes Montese (padrão) ou também a receita de técnicos?
2. **Inadimplência:** aprova a definição do item 5 (pagamento mais recente fora de `approved`; dias desde essa data)?
3. **Auditoria de leitura financeira:** registrar cada consulta (sem valores) ou só as negações?
