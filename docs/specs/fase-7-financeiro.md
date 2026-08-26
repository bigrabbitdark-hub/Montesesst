# Fase 7 (sub-projeto B) — Financeiro (planos, assinaturas, histórico de pagamento)

> Segundo sub-projeto da Fase 7 (Dashboard Admin). Decisão confirmada em
> brainstorming de 2026-08-26: entre as frentes possíveis (gestão de
> tenants/vínculos, planos/assinaturas, visão geral/métricas), "gestão
> de tenants e vínculos" (sub-projeto A) veio primeiro; "financeiro"
> vem em seguida.

## 1. Objetivo e escopo

Hoje não existe **nenhuma** forma de listar assinaturas — `POST
/subscriptions` é o único endpoint do módulo `payments`, sem
equivalente `GET`. Editar preço de plano só é possível via SQL direto
(comentário na própria migration `0006_plans_subscriptions.sql`:
"ajustar depois via SQL direto ou futuramente uma tela de admin (Fase
7)"). E o webhook do Mercado Pago hoje **descarta** qualquer evento
que não seja `subscription_preapproval` — cobrança individual de uma
assinatura (evento `subscription_authorized_payment`, ver seção 6)
nunca é processada, então não existe histórico de pagamento nenhum.

Esta entrega dá à Montese uma tela `/admin/financeiro` pra:
- listar todas as assinaturas (empresa/técnico, plano, status atual);
- ver o histórico de cobranças de uma assinatura específica;
- editar o preço de um plano pela tela.

**Não é objetivo desta entrega:**
- Cancelar ou pausar assinatura pela tela — decisão confirmada em
  brainstorming: só leitura + editar preço. Cancelamento continua
  tratado diretamente com o time (`Contato`), como já documentado nos
  Termos de Uso publicados em 2026-08-26.
- Mudar o fluxo de criação de assinatura (`POST /subscriptions`
  permanece como está).
- "Gargalo da VPS" (infraestrutura, domínio separado), "visão
  geral/métricas" e "clientes" (visão mais rica de empresa) — outras
  frentes identificadas na mesma rodada de brainstorming, não
  escolhidas para esta entrega.

## 2. Modelo de dados (`payment_events`)

```sql
CREATE TABLE payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
  mercadopago_payment_id TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events FORCE ROW LEVEL SECURITY;

CREATE POLICY payment_events_isolation ON payment_events USING (
  current_setting('app.role', true) = 'admin'
  OR EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.id = payment_events.subscription_id
      AND (
        s.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        OR s.technician_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      )
  )
);
```

- `mercadopago_payment_id UNIQUE` garante idempotência — o Mercado Pago
  pode reenviar o mesmo webhook.
- `subscription_id` é **nullable**: se o webhook não conseguir casar o
  evento a uma assinatura nossa, ainda grava o evento (auditoria), sem
  vínculo — mesmo espírito tolerante que `handleWebhook` já tem hoje
  pro caso de `subscription_preapproval` sem assinatura correspondente.
- RLS espelha `subscriptions_isolation`, mas via `EXISTS` (a tabela não
  tem `tenant_id`/`technician_user_id` própria) — isso já deixa o
  design pronto pra empresa/técnico um dia verem o próprio histórico,
  mesmo que esta entrega só construa a tela do admin.

## 3. Correção de entendimento sobre a API do Mercado Pago

O design original deste sub-projeto assumia um evento de webhook
genérico `type=payment`. **Isso está errado.** Pesquisa feita em
2026-08-26 confirma: o Mercado Pago tem um tópico de webhook **dedicado**
para cobrança recorrente de assinatura — `subscription_authorized_payment`
— distinto de `subscription_preapproval` (que `handleWebhook` já trata) e
distinto de um `payment` genérico.

O `data.id` recebido nesse webhook é o id de um recurso "authorized
payment" (também chamado de invoice), buscável via
`GET /authorized_payments/{id}`. A documentação oficial de referência
desse endpoint (consultada em 2026-08-26) lista o seguinte schema de
resposta:

| Campo | Conteúdo |
|---|---|
| `id` | id da cobrança/invoice (o mesmo `data.id` do webhook) |
| `preapproval_id` | **id da assinatura** — bate com `subscriptions.mercadopago_preapproval_id` |
| `transaction_amount` | valor cobrado, como string em reais (ex.: `"24.50"`) — **não em centavos**, precisa multiplicar por 100 e arredondar pra gravar em `amount_cents` |
| `currency_id` | moeda (ex.: `"BRL"`) |
| `debit_date` | data em que a cobrança ocorreu |
| `status` / `summarized` | status do agendamento da cobrança (ex.: `"scheduled"`/`"pending"`) — **não confundir com sucesso do pagamento em si** |
| `payment.id`, `payment.status`, `payment.status_detail` | objeto aninhado com o pagamento de fato — `payment.status` (ex.: `"approved"`) é o sinal confiável de que o dinheiro foi capturado, não o `status` de nível superior |

Existe também `GET /authorized_payments/search?preapproval_id=...`
pra buscar todas as cobranças de uma assinatura de uma vez (útil pra
reconciliação futura, não necessário pro fluxo do webhook em si, que já
recebe o id direto).

Fonte:
[Get authorized payment — Mercado Pago API Reference](https://www.mercadopago.com.br/developers/en/reference/online-payments/subscriptions/get-authorized-payment/get),
[Subscriptions with authorized payment](https://www.mercadopago.com.co/developers/en/docs/subscriptions/integration-configuration/subscription-no-associated-plan/authorized-payments),
[Webhooks - Notifications](https://www.mercadopago.com.mx/developers/en/docs/your-integrations/notifications/webhooks).

**O que ainda não foi verificado ao vivo:** este schema vem da
documentação oficial, não de uma chamada real feita durante este
brainstorming. A Task 1 do plano de implementação faz uma chamada real
contra o sandbox do Mercado Pago (token `TEST-...` já configurado no
`.env`) pra confirmar que a resposta real bate com o documentado antes
do código de produção depender disso — mesmo princípio de validar
contra o sistema real antes de finalizar, só que mais leve agora
(confirmar o schema documentado, não simular uma cobrança completa via
checkout no navegador, que exigiria interação manual e ~1h de espera
segundo a própria documentação do Mercado Pago).

## 4. Backend

**`GET /subscriptions`** (`@Roles('admin')`, novo):

```sql
SELECT s.id, s.status, s.created_at,
  p.id AS plan_id, p.name AS plan_name, p.price_cents,
  s.tenant_id, t.name AS tenant_name,
  s.technician_user_id, u.full_name AS technician_name
FROM subscriptions s
JOIN plans p ON p.id = s.plan_id
LEFT JOIN tenants t ON t.id = s.tenant_id
LEFT JOIN users u ON u.id = s.technician_user_id
ORDER BY s.created_at DESC
```

`LEFT JOIN` deliberado com `tenants`/`users` — mesma lição já aplicada
na Fase 7A (`JOIN` vira `INNER` e derruba linha silenciosamente quando
o lado direito é invisível por RLS a um caller não-admin; aqui o
caller é sempre admin, mas o padrão correto é usado por consistência e
porque `tenant_id`/`technician_user_id` são mutuamente exclusivos por
constraint — sempre um dos dois é `NULL`, então um `INNER JOIN`
descartaria metade das linhas por design).

**`PATCH /plans/:id`** (`@Roles('admin')`, novo) — só `price_cents`
editável, mesmo padrão `buildSafeSetClause` de `TenantsService`. Extrai
a lógica hoje inline em `PlansController` pra um `PlansService` novo,
seguindo o padrão do resto do projeto (controller fino, lógica no
service) — `PlansController.findAll` (`GET /plans`, `@Public()`)
permanece como está.

**Webhook estendido** — `WebhookController.handleWebhook` ganha um
branch pra `type === 'subscription_authorized_payment'` (não `payment`,
ver seção 3): busca a cobrança via um método novo em
`MercadoPagoService`, `getAuthorizedPayment(id)` (`GET
/authorized_payments/{id}`, espelhando `getPreapproval` já existente),
retornando `{ id, preapprovalId, amountCents, status, occurredAt }` —
`amountCents` já convertido de `transaction_amount` (string em reais)
multiplicando por 100 e arredondando; `status` lido de `payment.status`
(não do `status`/`summarized` de nível superior, que reflete
agendamento, não sucesso de cobrança — ver seção 3). O controller grava
o evento chamando uma função SQL nova
`payments_record_payment_event(...)` (`SECURITY DEFINER`, mesmo padrão
de `payments_update_subscription_status` que já existe exatamente pra
esse problema — webhook chega sem contexto de tenant/role, RLS
bloquearia um INSERT anônimo). A função tenta casar o evento a uma
assinatura via `preapproval_id` = `subscriptions.mercadopago_preapproval_id`;
se não achar, grava com `subscription_id NULL` mesmo assim (auditoria).

**`GET /subscriptions/:id/payment-events`** (`@Roles('admin')`, novo) —
lista os eventos de uma assinatura, mais recente primeiro.

## 5. Frontend

**`/admin/financeiro`**, mesmo padrão "lista + ação inline" das outras
telas admin, duas seções na mesma página:

- **Planos**: tabela com nome, público (empresa/técnico), preço atual
  (formatado em R$) e limite de funcionários. Cada linha tem "Editar
  preço" — campo inline, confirma com `PATCH /plans/:id`.
- **Assinaturas**: tabela com empresa/técnico, plano, status atual.
  Cada linha tem "Ver histórico" — expande (mesmo padrão de "Registrar
  entrega" do `EpisPanel`) e carrega `GET
  /subscriptions/:id/payment-events`. Sem paginação nesta primeira
  versão — volume de assinaturas é baixo hoje (zero clientes pagantes
  reais), diferente do `audit_log` da Fase 7A (que já tinha 5.651
  linhas antes de qualquer cliente pagante).

`AdminNav` ganha um 5º link ("Financeiro").

## 6. Testes

Mesmo padrão rigoroso do projeto — e2e reais contra Postgres real, sem
mock:

- `GET /subscriptions`: admin vê todas as assinaturas com dados
  agregados corretos; `empresa`/`tecnico`/`parceiro` recebem 403.
- `PATCH /plans/:id`: admin edita `price_cents`; outros campos
  (`slug`, `audience`, etc.) permanecem fora da allowlist; roles
  não-admin recebem 403.
- `GET /subscriptions/:id/payment-events`: lista eventos corretos pra
  uma assinatura, vazio pra assinatura sem cobrança ainda.
- **Webhook `subscription_authorized_payment`**: cobertura mínima
  esperada, usando o schema confirmado na Task 1 (seção 3): evento
  válido grava `payment_events` vinculado à assinatura certa, com
  `amount_cents` convertido corretamente de reais pra centavos; evento
  com `preapproval_id` desconhecido grava sem vínculo (`subscription_id
  NULL`) em vez de falhar; reenvio do mesmo evento não duplica
  (`ON CONFLICT DO NOTHING` via `mercadopago_payment_id UNIQUE`);
  `payment.status !== 'approved'` não é tratado como sucesso.
- Build isolado do frontend.

## 7. Decisões confirmadas (brainstorming de 2026-08-26)

- Frente escolhida como sub-projeto B da Fase 7: financeiro (planos +
  assinaturas + histórico de pagamento).
- Histórico de pagamento faz parte do escopo (não adiado) — decisão
  que introduziu a necessidade de `payment_events` e da correção sobre
  a API do Mercado Pago (seção 3).
- Captura de eventos: armazenamento local (`payment_events`), não
  consulta ao vivo na API do Mercado Pago a cada carregamento de tela
  — recomendação aceita por não depender da disponibilidade externa a
  cada acesso à tela.
- Sem cancelar/pausar assinatura pela tela nesta entrega — só leitura +
  editar preço.

## 8. Pendências

- **Verificação empírica do schema documentado da API do Mercado
  Pago** (seção 3) — vira Task 1 do plano de implementação, antes de
  qualquer código de webhook ser escrito. Schema já levantado por
  pesquisa; falta só confirmar contra uma chamada real do sandbox.
- Cancelar/pausar assinatura pela tela — fica para um sub-projeto
  seguinte.
- Consulta ao vivo de status via `MercadoPagoService.getPreapproval`
  como fallback de reconciliação (hoje só o webhook atualiza status) —
  não avaliado nesta rodada.
- Placeholders dos Termos de Uso (`[RAZÃO SOCIAL/CNPJ]`,
  `[CIDADE/ESTADO]`, já registrados na frente de conformidade) não têm
  relação com este sub-projeto, mas seguem pendentes do fundador.
