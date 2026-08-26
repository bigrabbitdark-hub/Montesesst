# Fase 7 (sub-projeto B) — Financeiro — Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra implementar este plano tarefa por tarefa. Passos usam checkbox (`- [ ]`) pra rastreio.

**Objetivo:** dar à Montese uma tela `/admin/financeiro` pra listar assinaturas com histórico de pagamento e editar preço de plano — hoje não existe nenhuma forma de listar assinatura, e o webhook do Mercado Pago descarta todo evento de cobrança individual.

**Arquitetura:** uma tabela nova (`payment_events`, RLS espelhando `subscriptions`), o webhook estendido pra tratar o tópico `subscription_authorized_payment` (não o genérico `payment`, correção feita durante o brainstorming), dois endpoints novos de leitura (`GET /subscriptions`, `GET /subscriptions/:id/payment-events`) e um de escrita (`PATCH /plans/:id`), e uma tela nova seguindo o padrão já usado em toda a Fase 7A.

**Tech Stack:** NestJS + `pg` (backend), Next.js App Router (frontend), Postgres 16 com RLS, Jest + Supertest (e2e, sem mock), API real do Mercado Pago (sandbox, token `TEST-...` já configurado).

**Spec:** [`docs/specs/fase-7-financeiro.md`](../specs/fase-7-financeiro.md)

## Global Constraints

- **Sem cancelar/pausar assinatura pela tela.** Só leitura de assinaturas/histórico + edição de preço de plano.
- **`payment_events.subscription_id` é nullable** — evento sem assinatura correspondente ainda é gravado (auditoria), nunca descartado.
- **`mercadopago_payment_id UNIQUE`** garante idempotência — o Mercado Pago pode reenviar o mesmo webhook.
- **Webhook trata `subscription_authorized_payment`, não `payment`** — tópico dedicado do Mercado Pago pra cobrança recorrente de assinatura, confirmado por pesquisa em 2026-08-26 (ver spec seção 3). Usar o tópico errado silenciosamente nunca captura nenhum evento real.
- **`transaction_amount` do Mercado Pago vem em reais (string), não em centavos** — precisa multiplicar por 100 e arredondar antes de gravar em `amount_cents`.
- **Status de sucesso real é `payment.status` (aninhado), não `status`/`summarized` de nível superior** — os últimos refletem agendamento, não se o dinheiro foi capturado.
- **Verificação da API do Mercado Pago é parcial, por decisão confirmada** — Task 1 confirma que os endpoints existem/autenticam/respondem no formato esperado via chamadas reais (sandbox), mas não simula uma cobrança completa (exigiria aprovação manual via navegador + ~1h de espera). O webhook grava o payload bruto em log pra confirmação posterior quando a primeira cobrança real acontecer.
- **`LEFT JOIN`, nunca `INNER JOIN`**, ao juntar `subscriptions` com `tenants`/`users` — `tenant_id`/`technician_user_id` são mutuamente exclusivos por constraint, um `INNER JOIN` descartaria metade das linhas por design (lição já aplicada na Fase 7A).
- **Próximo número de migration é `0015`** — `0009_update_plan_prices.sql` já ocupa esse número no disco (não commitado, mas já aplicado em produção — os preços atuais dos planos já refletem essa migration).
- **Testes e2e reais, sem mock**, contra o Postgres desta VPS — mesmo padrão rigoroso de todo o projeto.

---

### Task 1: Verificação empírica da API do Mercado Pago

**Files:**
- Nenhum arquivo de produção — este é um spike de pesquisa, não escreve código de aplicação.
- Report: escrever os achados no arquivo de report desta task (path definido pelo controller da SDD).

**Interfaces:**
- Consumes: `MERCADOPAGO_ACCESS_TOKEN` já configurado em `/opt/Montese/.env` (token `TEST-...`, sandbox real, nunca produção).
- Produces: confirmação (ou refutação) do schema documentado na spec seção 3, que a Task 3 depende para implementar `MercadoPagoService.getAuthorizedPayment`.

O SDK oficial `mercadopago` (já instalado em
`backend/node_modules/mercadopago`) tem um client `Invoice` cujo
`InvoiceResponse` tipado já lista `preapproval_id`, `transaction_amount`
(number), `status`, `summarized`, `payment: {id, status, status_detail}`,
`debit_date` — isso é uma confirmação forte (é o pacote real que vai
rodar em produção, não documentação de terceiros). Esta task confirma
esses tipos contra uma chamada real, usando o próprio SDK, não `curl`
cru — pega qualquer divergência entre o `.d.ts` e o comportamento real
da API.

- [ ] **Step 1: Criar uma preapproval de teste real via SDK**

```bash
cd /opt/Montese
set -a; source /opt/Montese/.env; set +a
docker run --rm -v "$(pwd)/backend:/app" -w /app \
  -e MERCADOPAGO_ACCESS_TOKEN="${MERCADOPAGO_ACCESS_TOKEN}" \
  node:20-alpine node -e "
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
new PreApproval(client).create({
  body: {
    reason: 'Verificacao Fase 7B - descartavel',
    external_reference: 'verificacao-fase-7b',
    payer_email: 'test_user_verificacao@testuser.com',
    back_url: 'https://example.com',
    status: 'pending',
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 10.00, currency_id: 'BRL' },
  },
}).then((r) => console.log(JSON.stringify({ id: r.id, status: r.status }))).catch((e) => { console.error(e); process.exit(1); });
"
```

Esperado: imprime `{"id":"...","status":"pending"}`. Esse `id` é o
`preapproval_id` real pros próximos passos. Se falhar com erro de
autenticação ou validação inesperado, PARE e reporte — algo na
credencial ou no formato mudou desde que a spec foi escrita.

- [ ] **Step 2: Confirmar `Invoice.search` contra o preapproval criado**

```bash
docker run --rm -v "$(pwd)/backend:/app" -w /app \
  -e MERCADOPAGO_ACCESS_TOKEN="${MERCADOPAGO_ACCESS_TOKEN}" \
  node:20-alpine node -e "
const { MercadoPagoConfig, Invoice } = require('mercadopago');
const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
new Invoice(client).search({ options: { preapproval_id: '<ID_DO_STEP_1>' } })
  .then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e); process.exit(1); });
"
```

Esperado: retorna sem erro, com uma lista vazia de resultados (nenhuma
cobrança aconteceu ainda — a preapproval nunca foi aprovada via
checkout, o que exigiria interação manual no navegador). Confirma que
o client `Invoice.search` do SDK funciona de ponta a ponta com a
credencial real.

- [ ] **Step 3: Confirmar o formato de erro do `Invoice.get`**

```bash
docker run --rm -v "$(pwd)/backend:/app" -w /app \
  -e MERCADOPAGO_ACCESS_TOKEN="${MERCADOPAGO_ACCESS_TOKEN}" \
  node:20-alpine node -e "
const { MercadoPagoConfig, Invoice } = require('mercadopago');
const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
new Invoice(client).get({ id: '00000000-0000-0000-0000-000000000000' })
  .then((r) => console.log('SUCESSO INESPERADO', JSON.stringify(r)))
  .catch((e) => console.log('ERRO (esperado):', e.status ?? e.message));
"
```

Esperado: erro (404 ou equivalente), confirmando que `Invoice.get`
lança de forma previsível pra um id inexistente — é esse o
comportamento que `getAuthorizedPayment` (Task 3) precisa tratar no
`catch`.

- [ ] **Step 4: Escrever o report com o veredito**

O report deve responder explicitamente: o SDK se comportou como o
`.d.ts` e a spec (seção 3) documentam? Se sim, Task 3 prossegue como
planejado. Se algo divergiu (erro de tipo em runtime, campo ausente,
autenticação falhando), o report deve descrever exatamente a
divergência — o controller da SDD decide se isso muda o desenho de
`getAuthorizedPayment` antes de despachar a Task 3.

Não é necessário limpar a preapproval de teste criada no Step 1 — ela
nunca será aprovada/cobrada (fica `pending` indefinidamente no sandbox,
sem custo nem efeito).

- [ ] **Step 5: Nenhum commit** — esta task não produz código, só o
  report de pesquisa.

---

### Task 2: Migration `payment_events`

**Files:**
- Create: `backend/db/migrations/0015_payment_events.sql`
- Test: `backend/test/payment-events-rls.e2e-spec.ts`

**Interfaces:**
- Consumes: `subscriptions` (Fase 1/6), `assigned_tenant_ids_for_current_user()` não é usado aqui — RLS é via `EXISTS` direto contra `subscriptions`, mesmo padrão de `subscriptions_isolation`.
- Produces: tabela `payment_events` e função SQL
  `payments_record_payment_event(p_mercadopago_payment_id TEXT,
  p_preapproval_id TEXT, p_amount_cents INTEGER, p_status TEXT,
  p_occurred_at TIMESTAMPTZ) RETURNS TABLE(id UUID, subscription_id
  UUID)` — consumida pela Task 3.

- [ ] **Step 1: Escrever a migration**

Criar `backend/db/migrations/0015_payment_events.sql`:

```sql
-- payment_events: histórico de cobranças de assinatura, populado pelo
-- webhook do Mercado Pago (tópico subscription_authorized_payment, ver
-- docs/specs/fase-7-financeiro.md secao 3). subscription_id é nullable
-- de propósito: um evento cujo preapproval_id não bate com nenhuma
-- assinatura nossa ainda é gravado (auditoria), nunca descartado —
-- mesmo espírito tolerante do branch subscription_preapproval já
-- existente em WebhookController.
CREATE TABLE payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
  mercadopago_payment_id TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_subscription_idx ON payment_events (subscription_id);

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events FORCE ROW LEVEL SECURITY;

-- Espelha subscriptions_isolation, mas via EXISTS (a tabela não tem
-- tenant_id/technician_user_id própria). Deixa o design pronto pra
-- empresa/técnico um dia verem o próprio histórico, mesmo que esta
-- entrega só construa a tela do admin.
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

-- payments_record_payment_event: usado pelo webhook do Mercado Pago,
-- que chega sem nenhum contexto de tenant/role — RLS bloquearia um
-- INSERT anônimo em payment_events. Mesma técnica de
-- payments_update_subscription_status (0006_plans_subscriptions.sql).
CREATE FUNCTION payments_record_payment_event(
  p_mercadopago_payment_id TEXT,
  p_preapproval_id TEXT,
  p_amount_cents INTEGER,
  p_status TEXT,
  p_occurred_at TIMESTAMPTZ
) RETURNS TABLE(id UUID, subscription_id UUID) AS $$
DECLARE
  v_subscription_id UUID;
  v_id UUID;
BEGIN
  SELECT s.id INTO v_subscription_id FROM subscriptions s
    WHERE s.mercadopago_preapproval_id = p_preapproval_id;

  INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
  VALUES (v_subscription_id, p_mercadopago_payment_id, p_amount_cents, p_status, p_occurred_at)
  ON CONFLICT (mercadopago_payment_id) DO NOTHING
  RETURNING payment_events.id INTO v_id;

  RETURN QUERY SELECT v_id, v_subscription_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION payments_record_payment_event(TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION payments_record_payment_event(TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payments_record_payment_event(TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ) TO montese_app;

-- montese_auth_bypass já tem SELECT em subscriptions desde
-- 0006_plans_subscriptions.sql — só falta o que é genuinamente novo
-- aqui: INSERT em payment_events (tabela nova).
GRANT INSERT ON payment_events TO montese_auth_bypass;
```

- [ ] **Step 2: Aplicar a migration no Postgres real**

```bash
cd /opt/Montese
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate
```

Esperado: `0015_payment_events.sql` aplicada.

- [ ] **Step 3: Escrever o teste de RLS**

Criar `backend/test/payment-events-rls.e2e-spec.ts`:

```typescript
import { TestDb } from './db-test-helper';

describe('payment_events RLS (via SQL direto)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let planId: string;
  let subscriptionAId: string;
  let subscriptionBId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();

    const tenantA = await db.createTenantWithUser('Empresa Payment Events A');
    const tenantB = await db.createTenantWithUser('Empresa Payment Events B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const planResult = await (db as any).client.query(
      `SELECT id FROM plans WHERE audience = 'empresa' LIMIT 1`,
    );
    planId = planResult.rows[0].id;

    const subAResult = await (db as any).client.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [planId, tenantAId, `preapproval-test-a-${Date.now()}`],
    );
    subscriptionAId = subAResult.rows[0].id;

    const subBResult = await (db as any).client.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [planId, tenantBId, `preapproval-test-b-${Date.now()}`],
    );
    subscriptionBId = subBResult.rows[0].id;

    await (db as any).client.query(
      `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
       VALUES ($1, $2, 10000, 'approved', now())`,
      [subscriptionAId, `payment-test-a-${Date.now()}`],
    );
    await (db as any).client.query(
      `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
       VALUES ($1, $2, 20000, 'approved', now())`,
      [subscriptionBId, `payment-test-b-${Date.now()}`],
    );
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM payment_events WHERE subscription_id = ANY($1)', [
      [subscriptionAId, subscriptionBId],
    ]);
    await (db as any).client.query('DELETE FROM subscriptions WHERE id = ANY($1)', [
      [subscriptionAId, subscriptionBId],
    ]);
    await db.cleanup();
    await db.disconnect();
  });

  it('empresa A só vê o próprio payment_event, não o de empresa B', async () => {
    await (db as any).client.query('BEGIN');
    await (db as any).client.query(`SET LOCAL app.role = 'empresa'`);
    await (db as any).client.query(`SET LOCAL app.tenant_id = '${tenantAId}'`);
    const result = await (db as any).client.query('SELECT subscription_id FROM payment_events');
    await (db as any).client.query('ROLLBACK');

    const ids = result.rows.map((r: any) => r.subscription_id);
    expect(ids).toContain(subscriptionAId);
    expect(ids).not.toContain(subscriptionBId);
  });

  it('admin vê os dois payment_events', async () => {
    await (db as any).client.query('BEGIN');
    await (db as any).client.query(`SET LOCAL app.role = 'admin'`);
    const result = await (db as any).client.query(
      'SELECT subscription_id FROM payment_events WHERE subscription_id = ANY($1)',
      [[subscriptionAId, subscriptionBId]],
    );
    await (db as any).client.query('ROLLBACK');

    const ids = result.rows.map((r: any) => r.subscription_id);
    expect(ids).toContain(subscriptionAId);
    expect(ids).toContain(subscriptionBId);
  });

  it('payments_record_payment_event grava e ignora reenvio duplicado (idempotência)', async () => {
    const paymentId = `payment-idempotencia-${Date.now()}`;
    const first = await (db as any).client.query(
      `SELECT * FROM payments_record_payment_event($1, $2, $3, $4, now())`,
      [paymentId, `preapproval-test-a-${subscriptionAId}`, 5000, 'approved'],
    );
    // preapproval_id inventado não bate com nenhuma assinatura real —
    // prova que o evento ainda é gravado, sem vínculo.
    expect(first.rows[0].subscription_id).toBeNull();

    const second = await (db as any).client.query(
      `SELECT * FROM payments_record_payment_event($1, $2, $3, $4, now())`,
      [paymentId, `preapproval-test-a-${subscriptionAId}`, 5000, 'approved'],
    );
    // ON CONFLICT DO NOTHING: reenvio não gera segunda linha, id vem NULL
    // (RETURNING não encontra a linha que não foi inserida de novo).
    expect(second.rows[0].id).toBeNull();

    await (db as any).client.query('DELETE FROM payment_events WHERE mercadopago_payment_id = $1', [
      paymentId,
    ]);
  });
});
```

- [ ] **Step 4: Rodar o teste**

```bash
cd /opt/Montese
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e PUBLIC_APP_URL="https://example.com" \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
  -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
  -e CONTACT_EMAIL_TO="comercial@teste.montese.local" \
  -e CONTACT_RATE_LIMIT_MAX=10 -e CONTACT_RATE_LIMIT_WINDOW_SECONDS=3600 \
  -e MERCADOPAGO_ACCESS_TOKEN="${MERCADOPAGO_ACCESS_TOKEN}" \
  -e R2_ACCOUNT_ID="${R2_ACCOUNT_ID}" -e R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
  -e R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" -e R2_BUCKET="${R2_BUCKET}" \
  -e R2_ENDPOINT="${R2_ENDPOINT}" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand payment-events-rls"
```

Esperado: PASS, 3 testes.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/0015_payment_events.sql backend/test/payment-events-rls.e2e-spec.ts
git commit -m "feat: adiciona tabela payment_events com RLS e funcao payments_record_payment_event"
```

---

### Task 3: Webhook estendido + `MercadoPagoService.getAuthorizedPayment`

**Files:**
- Modify: `backend/src/payments/mercadopago.service.ts`
- Modify: `backend/src/payments/webhook.controller.ts`
- Test: `backend/test/webhook-authorized-payment.e2e-spec.ts`

**Interfaces:**
- Consumes: achados da Task 1 (schema confirmado ou divergências
  reportadas — se divergiu, ajustar os nomes de campo abaixo antes de
  implementar); `payments_record_payment_event` da Task 2.
- Produces: nada consumido por outra task deste plano.

- [ ] **Step 1: Adicionar `getAuthorizedPayment` em `MercadoPagoService`**

O SDK oficial `mercadopago` (já instalado, já usado neste arquivo pra
`PreApproval`) tem um client `Invoice` tipado especificamente pra esse
recurso — `InvoiceResponse` inclui `preapproval_id`, `transaction_amount`
(number), `status`, `summarized`, `payment: { id, status, status_detail }`,
`debit_date`, `date_created`. Usar o client tipado, não `fetch` cru.

Adicionar ao topo do arquivo:

```typescript
import { MercadoPagoConfig, PreApproval, Invoice } from 'mercadopago';
```

Adicionar junto das interfaces existentes:

```typescript
export interface AuthorizedPaymentResult {
  id: string;
  preapprovalId: string | null;
  amountCents: number;
  status: string;
  occurredAt: string;
}
```

Adicionar ao `MercadoPagoService`, como novo método (depois de
`getPreapproval`):

```typescript
  async getAuthorizedPayment(id: string): Promise<AuthorizedPaymentResult> {
    try {
      const invoice = new Invoice(this.client);
      const result = await invoice.get({ id });
      // transaction_amount vem em reais — converte pra centavos. status de
      // sucesso real é payment.status (aninhado), não o status/summarized
      // de nível superior, que reflete agendamento do débito, não se o
      // dinheiro foi capturado — ver docs/specs/fase-7-financeiro.md secao 3.
      const amountCents = Math.round((result.transaction_amount ?? 0) * 100);
      return {
        id: result.id ?? id,
        preapprovalId: result.preapproval_id ?? null,
        amountCents,
        status: result.payment?.status ?? result.status ?? 'desconhecido',
        occurredAt: result.debit_date ?? result.date_created ?? new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error(`Falha ao buscar authorized_payment ${id} no Mercado Pago`, (err as Error).stack);
      throw err;
    }
  }
```

Se o report da Task 1 confirmou alguma divergência em runtime (ex.:
`transaction_amount` vem em formato diferente do esperado), ajustar
antes de seguir.

- [ ] **Step 2: Estender `WebhookController.handleWebhook`**

Modificar o branch que hoje só trata `subscription_preapproval`:

```typescript
    // Cobrança recorrente de assinatura tem tópico próprio — distinto de
    // subscription_preapproval (mudança de status da assinatura em si) e
    // de um "payment" genérico (que o Mercado Pago também pode notificar
    // na mesma URL pra outros fluxos, sem relação com assinatura).
    if (type === 'subscription_authorized_payment') {
      let authorizedPayment;
      try {
        authorizedPayment = await this.mercadoPago.getAuthorizedPayment(dataId);
      } catch (err) {
        // Payload bruto do erro fica no log — confirmação final do schema
        // populado acontece organicamente na primeira cobrança real
        // (ver docs/specs/fase-7-financeiro.md secao 3), não trava o
        // webhook: melhor logar e seguir do que derrubar a notificação
        // com um 500 que o Mercado Pago reinterpretaria como falha de
        // entrega e tentaria de novo indefinidamente.
        this.logger.error(
          `Erro ao processar subscription_authorized_payment ${dataId}: ${(err as Error).message}`,
        );
        return { message: 'erro ao processar, ver log' };
      }

      if (!authorizedPayment.preapprovalId) {
        this.logger.warn(
          `authorized_payment ${dataId} sem preapproval_id no payload — gravando sem vínculo`,
        );
      }

      await this.db.withoutTenantContext((client) =>
        client.query('SELECT * FROM payments_record_payment_event($1, $2, $3, $4, $5)', [
          authorizedPayment.id,
          authorizedPayment.preapprovalId,
          authorizedPayment.amountCents,
          authorizedPayment.status,
          authorizedPayment.occurredAt,
        ]),
      );

      return { message: 'ok' };
    }

    // Só tratamos eventos de assinatura — outros tipos (pagamento avulso,
    // etc.) o Mercado Pago também pode notificar na mesma URL se
    // configurado; devolver 200 evita retry infinito pra evento que não
    // vamos processar.
    if (type !== 'subscription_preapproval') {
      return { message: 'ignorado' };
    }
```

Este bloco novo entra **antes** do `if (type !== 'subscription_preapproval')`
já existente, no mesmo método, depois da verificação de assinatura
(`verifyMercadoPagoSignature`).

- [ ] **Step 3: Escrever o teste e2e**

Criar `backend/test/webhook-authorized-payment.e2e-spec.ts`. Este teste
não pode disparar uma chamada real ao Mercado Pago (webhook precisa de
assinatura válida calculada com `MERCADOPAGO_WEBHOOK_SECRET`, e
`getAuthorizedPayment` chamaria a API real com um id inventado, que
falharia com 404) — em vez disso, testa a função SQL diretamente (já
coberta na Task 2) e testa que o endpoint do webhook rejeita assinatura
inválida do mesmo jeito pro tópico novo que já rejeita pro tópico
antigo:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('POST /payments/mercadopago/webhook - subscription_authorized_payment (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejeita notificacao subscription_authorized_payment sem assinatura valida', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'payment-fake-123', type: 'subscription_authorized_payment' })
      .send({});

    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 4: Rodar o teste**

Mesmo comando de execução da Task 2 Step 4, trocando o filtro do jest
pro nome deste arquivo: `webhook-authorized-payment`.
Esperado: PASS, 1 teste.

- [ ] **Step 5: Rodar a suíte completa pra confirmar zero regressão**

Mesmo comando, sem filtro (`npm run test:e2e`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/payments/mercadopago.service.ts backend/src/payments/webhook.controller.ts backend/test/webhook-authorized-payment.e2e-spec.ts
git commit -m "feat: webhook trata subscription_authorized_payment e grava payment_events"
```

---

### Task 4: `PATCH /plans/:id`

**Files:**
- Create: `backend/src/payments/plans.service.ts`
- Create: `backend/src/payments/dto/update-plan.dto.ts`
- Modify: `backend/src/payments/plans.controller.ts`
- Modify: `backend/src/payments/payments.module.ts`
- Test: `backend/test/plans-update.e2e-spec.ts`

**Interfaces:**
- Consumes: nada de outra task.
- Produces: `PlansService.findAll(client, audience?)`,
  `PlansService.update(client, id, data)` — Task 6 (frontend) consome
  `GET /plans` (já existente, público, inalterado) e `PATCH /plans/:id`.

- [ ] **Step 1: Escrever o teste e2e (vai falhar — endpoint não existe)**

Criar `backend/test/plans-update.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('PATCH /plans/:id (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let planId: string;
  let originalPriceCents: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Plans Teste');
    const admin = await db.createUserWithRole('admin', 'Admin Plans Teste');

    const planResult = await (db as any).client.query(
      `SELECT id, price_cents FROM plans WHERE audience = 'empresa' LIMIT 1`,
    );
    planId = planResult.rows[0].id;
    originalPriceCents = planResult.rows[0].price_cents;

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    // Restaura o preço original — este teste roda contra o banco real
    // compartilhado, não pode deixar um plano de produção com preço de teste.
    await (db as any).client.query('UPDATE plans SET price_cents = $1 WHERE id = $2', [
      originalPriceCents,
      planId,
    ]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('admin edita price_cents', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/plans/${planId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ price_cents: 55500 });

    expect(res.status).toBe(200);
    expect(res.body.price_cents).toBe(55500);

    const check = await (db as any).client.query('SELECT price_cents FROM plans WHERE id = $1', [
      planId,
    ]);
    expect(check.rows[0].price_cents).toBe(55500);
  });

  it('rejeita campo fora da allowlist (ex: slug)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/plans/${planId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ slug: 'novo-slug' });

    // forbidNonWhitelisted: true rejeita a requisição inteira (400).
    expect(res.status).toBe(400);
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/plans/${planId}`)
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ price_cents: 1000 });

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Mesmo comando de execução da Task 2 Step 4, filtro `plans-update`.
Esperado: FAIL — `PATCH /plans/:id` retorna 404 (rota não existe).

- [ ] **Step 3: Criar `dto/update-plan.dto.ts`**

```typescript
import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdatePlanDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  price_cents?: number;
}
```

- [ ] **Step 4: Criar `plans.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';

const UPDATABLE_FIELDS = ['price_cents'] as const;
const PLAN_COLUMNS = 'id, audience, slug, name, price_cents, employee_limit';

export interface Plan {
  id: string;
  audience: string;
  slug: string;
  name: string;
  price_cents: number;
  employee_limit: number | null;
}

interface UpdatePlanData {
  price_cents?: number;
}

@Injectable()
export class PlansService {
  async findAll(client: PoolClient, audience?: string): Promise<Plan[]> {
    const result = audience
      ? await client.query<Plan>(
          `SELECT ${PLAN_COLUMNS} FROM plans WHERE active = true AND audience = $1 ORDER BY price_cents`,
          [audience],
        )
      : await client.query<Plan>(
          `SELECT ${PLAN_COLUMNS} FROM plans WHERE active = true ORDER BY audience, price_cents`,
        );
    return result.rows;
  }

  async update(client: PoolClient, id: string, data: UpdatePlanData): Promise<Plan> {
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) {
      const result = await client.query<Plan>(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1`, [id]);
      const plan = result.rows[0];
      if (!plan) throw new NotFoundException('Plano não encontrado');
      return plan;
    }

    const result = await client.query<Plan>(
      `UPDATE plans SET ${setClauses.join(', ')} WHERE id = $1 RETURNING ${PLAN_COLUMNS}`,
      [id, ...values],
    );
    const plan = result.rows[0];
    if (!plan) throw new NotFoundException('Plano não encontrado');
    return plan;
  }
}
```

Nota: `findAll` reproduz exatamente a query que hoje vive inline em
`PlansController.findAll` — mesmo filtro (`active = true`), mesmas
colunas, mesma ordenação. Comportamento do endpoint público não muda.

- [ ] **Step 5: Reescrever `plans.controller.ts`**

```typescript
import { Body, Controller, Get, Param, Patch, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PlansService } from './plans.service';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Public()
  @Get()
  async findAll(@Query('audience') audience: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.plans.findAll(client, audience));
  }

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.plans.update(client, id, dto));
  }
}
```

Nota: `findAll` passa a usar `req.withTenantContext` (disponível em
toda rota, `@Public()` ou não) em vez de `this.db.withoutTenantContext`
diretamente — `DatabaseService` deixa de ser injetado neste controller.
Comportamento idêntico, só migrou de acesso direto ao banco pra
passar pelo service novo.

- [ ] **Step 6: Registrar `PlansService` em `payments.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { MercadoPagoService } from './mercadopago.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { WebhookController } from './webhook.controller';

@Module({
  controllers: [PlansController, SubscriptionsController, WebhookController],
  providers: [MercadoPagoService, PlansService, SubscriptionsService],
  exports: [MercadoPagoService],
})
export class PaymentsModule {}
```

- [ ] **Step 7: Rodar o teste pra confirmar que passa**

Mesmo comando do Step 2. Esperado: PASS, 3 testes.

- [ ] **Step 8: Rodar a suíte completa pra confirmar zero regressão**

`npm run test:e2e` sem filtro — `GET /plans` é usado por
`frontend/src/app/(site)/planos/page.tsx` e por
`backend/test/plans.e2e-spec.ts` já existente; confirmar que nenhum
teste existente quebrou com a migração pro service novo.

- [ ] **Step 9: Commit**

```bash
git add backend/src/payments/plans.service.ts backend/src/payments/dto/update-plan.dto.ts backend/src/payments/plans.controller.ts backend/src/payments/payments.module.ts backend/test/plans-update.e2e-spec.ts
git commit -m "feat: adiciona PATCH /plans/:id admin-only, extrai PlansService"
```

---

### Task 5: `GET /subscriptions` e `GET /subscriptions/:id/payment-events`

**Files:**
- Modify: `backend/src/payments/subscriptions.service.ts`
- Modify: `backend/src/payments/subscriptions.controller.ts`
- Test: `backend/test/subscriptions-admin-list.e2e-spec.ts`

**Interfaces:**
- Consumes: `payment_events` (Task 2).
- Produces: `SubscriptionsService.findAllForAdmin(client)`,
  `SubscriptionsService.findPaymentEvents(client, subscriptionId)` —
  Task 6 consome `GET /subscriptions` e
  `GET /subscriptions/:id/payment-events`.

- [ ] **Step 1: Escrever o teste e2e (vai falhar — endpoints não existem)**

Criar `backend/test/subscriptions-admin-list.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /subscriptions e GET /subscriptions/:id/payment-events (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let planId: string;
  let subscriptionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Subscriptions List');
    const admin = await db.createUserWithRole('admin', 'Admin Subscriptions List');

    const planResult = await (db as any).client.query(
      `SELECT id FROM plans WHERE audience = 'empresa' LIMIT 1`,
    );
    planId = planResult.rows[0].id;

    const subResult = await (db as any).client.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [planId, tenant.tenantId, `preapproval-list-test-${Date.now()}`],
    );
    subscriptionId = subResult.rows[0].id;

    await (db as any).client.query(
      `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
       VALUES ($1, $2, 39700, 'approved', now())`,
      [subscriptionId, `payment-list-test-${Date.now()}`],
    );

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM payment_events WHERE subscription_id = $1', [
      subscriptionId,
    ]);
    await (db as any).client.query('DELETE FROM subscriptions WHERE id = $1', [subscriptionId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('admin lista assinaturas com plano e empresa/tecnico agregados', async () => {
    const res = await request(app.getHttpServer())
      .get('/subscriptions')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const found = res.body.find((s: any) => s.id === subscriptionId);
    expect(found).toBeDefined();
    expect(found.tenant_name).toBeDefined();
    expect(found.plan_name).toBeDefined();
    expect(found.status).toBe('authorized');
  });

  it('bloqueia empresa com 403 em GET /subscriptions', async () => {
    const res = await request(app.getHttpServer())
      .get('/subscriptions')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(res.status).toBe(403);
  });

  it('admin ve o historico de pagamento da assinatura', async () => {
    const res = await request(app.getHttpServer())
      .get(`/subscriptions/${subscriptionId}/payment-events`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].amount_cents).toBe(39700);
    expect(res.body[0].status).toBe('approved');
  });

  it('bloqueia empresa com 403 em GET /subscriptions/:id/payment-events', async () => {
    const res = await request(app.getHttpServer())
      .get(`/subscriptions/${subscriptionId}/payment-events`)
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Filtro `subscriptions-admin-list`. Esperado: FAIL — ambos endpoints
retornam 404.

- [ ] **Step 3: Adicionar métodos em `subscriptions.service.ts`**

Adicionar ao arquivo, depois de `create`:

```typescript
export interface SubscriptionAdminRow {
  id: string;
  status: string;
  created_at: string;
  plan_id: string;
  plan_name: string;
  price_cents: number;
  tenant_id: string | null;
  tenant_name: string | null;
  technician_user_id: string | null;
  technician_name: string | null;
}

export interface PaymentEventRow {
  id: string;
  mercadopago_payment_id: string;
  amount_cents: number;
  status: string;
  occurred_at: string;
}
```

```typescript
  async findAllForAdmin(client: PoolClient): Promise<SubscriptionAdminRow[]> {
    const result = await client.query<SubscriptionAdminRow>(
      `SELECT s.id, s.status, s.created_at,
         p.id AS plan_id, p.name AS plan_name, p.price_cents,
         s.tenant_id, t.name AS tenant_name,
         s.technician_user_id, u.full_name AS technician_name
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN users u ON u.id = s.technician_user_id
       ORDER BY s.created_at DESC`,
    );
    return result.rows;
  }

  async findPaymentEvents(client: PoolClient, subscriptionId: string): Promise<PaymentEventRow[]> {
    const result = await client.query<PaymentEventRow>(
      `SELECT id, mercadopago_payment_id, amount_cents, status, occurred_at
       FROM payment_events
       WHERE subscription_id = $1
       ORDER BY occurred_at DESC`,
      [subscriptionId],
    );
    return result.rows;
  }
```

`LEFT JOIN` com `tenants`/`users` é deliberado (Global Constraints) —
`tenant_id`/`technician_user_id` são mutuamente exclusivos por
constraint (`chk_subscription_subject` em `0006_plans_subscriptions.sql`),
um `INNER JOIN` descartaria metade das linhas por design.

- [ ] **Step 4: Adicionar endpoints em `subscriptions.controller.ts`**

```typescript
import { Controller, Get, Param, Post, Body, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Roles('empresa', 'tecnico')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateSubscriptionDto, @Req() req: any) {
    const user = req.user;
    return this.subscriptions.create(req.withTenantContext.bind(req), dto.plan_id, {
      tenantId: user.role === 'empresa' ? user.tenantId : undefined,
      technicianUserId: user.role === 'tecnico' ? user.id : undefined,
      userId: user.id,
      audience: user.role,
    });
  }

  @Roles('admin')
  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.subscriptions.findAllForAdmin(client));
  }

  @Roles('admin')
  @Get(':id/payment-events')
  findPaymentEvents(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.subscriptions.findPaymentEvents(client, id));
  }
}
```

- [ ] **Step 5: Rodar o teste pra confirmar que passa**

Mesmo comando do Step 2. Esperado: PASS, 4 testes.

- [ ] **Step 6: Rodar a suíte completa pra confirmar zero regressão**

`npm run test:e2e` sem filtro.

- [ ] **Step 7: Commit**

```bash
git add backend/src/payments/subscriptions.service.ts backend/src/payments/subscriptions.controller.ts backend/test/subscriptions-admin-list.e2e-spec.ts
git commit -m "feat: adiciona GET /subscriptions e GET /subscriptions/:id/payment-events admin-only"
```

---

### Task 6: Frontend — `/admin/financeiro`

**Files:**
- Create: `frontend/src/app/admin/financeiro/page.tsx`
- Modify: `frontend/src/components/AdminNav.tsx`

**Interfaces:**
- Consumes: `AdminNav` (sem props); `GET /plans` (existente, público —
  `{id, audience, slug, name, price_cents, employee_limit}[]`);
  `PATCH /plans/:id` (Task 4, `{price_cents}`); `GET /subscriptions`
  (Task 5, `SubscriptionAdminRow[]`); `GET
  /subscriptions/:id/payment-events` (Task 5, `PaymentEventRow[]`).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Adicionar o 5º link em `AdminNav.tsx`**

Modificar o array `LINKS`:

```typescript
const LINKS = [
  { href: '/admin/empresas', label: 'Empresas' },
  { href: '/admin/tecnicos', label: 'Técnicos' },
  { href: '/admin/parceiros', label: 'Parceiros' },
  { href: '/admin/auditoria', label: 'Auditoria' },
  { href: '/admin/financeiro', label: 'Financeiro' },
];
```

- [ ] **Step 2: Criar `/admin/financeiro/page.tsx`**

```typescript
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNav } from '@/components/AdminNav';

interface Plan {
  id: string;
  audience: string;
  slug: string;
  name: string;
  price_cents: number;
  employee_limit: number | null;
}

interface SubscriptionRow {
  id: string;
  status: string;
  created_at: string;
  plan_name: string;
  price_cents: number;
  tenant_name: string | null;
  technician_name: string | null;
}

interface PaymentEventRow {
  id: string;
  amount_cents: number;
  status: string;
  occurred_at: string;
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

export default function AdminFinanceiroPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [listError, setListError] = useState('');

  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editPriceReais, setEditPriceReais] = useState('');
  const [editStatus, setEditStatus] = useState<'idle' | 'loading' | 'erro'>('idle');

  const [expandedSubscriptionId, setExpandedSubscriptionId] = useState<string | null>(null);
  const [paymentEventsBySubscription, setPaymentEventsBySubscription] = useState<
    Record<string, PaymentEventRow[]>
  >({});

  async function loadPlans() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/plans', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setPlans(await res.json());
    } catch {
      // lista de planos fica vazia; erro de conexão já reportado por loadSubscriptions
    }
  }

  async function loadSubscriptions() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/subscriptions', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setSubscriptions(await res.json());
        setListError('');
      } else {
        setListError('Não foi possível carregar as assinaturas.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    Promise.all([loadPlans(), loadSubscriptions()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleEditPrice(event: FormEvent, planId: string) {
    event.preventDefault();
    setEditStatus('loading');
    const reaisValue = Number.parseFloat(editPriceReais.replace(',', '.'));
    if (Number.isNaN(reaisValue) || reaisValue < 0) {
      setEditStatus('erro');
      return;
    }
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ price_cents: Math.round(reaisValue * 100) }),
      });
      if (res.ok) {
        setEditingPlanId(null);
        setEditPriceReais('');
        setEditStatus('idle');
        loadPlans();
        return;
      }
      setEditStatus('erro');
    } catch {
      setEditStatus('erro');
    }
  }

  async function toggleHistory(subscriptionId: string) {
    if (expandedSubscriptionId === subscriptionId) {
      setExpandedSubscriptionId(null);
      return;
    }
    setExpandedSubscriptionId(subscriptionId);
    if (paymentEventsBySubscription[subscriptionId]) return;
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}/payment-events`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const events: PaymentEventRow[] = await res.json();
        setPaymentEventsBySubscription((prev) => ({ ...prev, [subscriptionId]: events }));
      }
    } catch {
      // histórico fica vazio pra essa assinatura; sem estado de erro dedicado
    }
  }

  if (!ready) {
    return <div className="mx-auto max-w-5xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Painel administrativo</h1>
      <div className="mt-6">
        <AdminNav />
      </div>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Planos</h2>
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-brand-100 text-brand-700">
              <th className="py-2">Plano</th>
              <th className="py-2">Público</th>
              <th className="py-2">Preço</th>
              <th className="py-2">Limite de funcionários</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id} className="border-b border-brand-100">
                <td className="py-2 font-medium text-brand-900">{plan.name}</td>
                <td className="py-2 text-brand-700">{plan.audience}</td>
                <td className="py-2 text-brand-700">
                  {editingPlanId === plan.id ? (
                    <form onSubmit={(e) => handleEditPrice(e, plan.id)} className="flex items-center gap-2">
                      <input
                        required
                        value={editPriceReais}
                        onChange={(e) => setEditPriceReais(e.target.value)}
                        placeholder="0,00"
                        className="w-24 rounded-md border border-brand-100 px-2 py-1"
                      />
                      <button type="submit" className="text-brand-500 hover:underline">
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPlanId(null)}
                        className="text-brand-700 hover:underline"
                      >
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    formatCents(plan.price_cents)
                  )}
                </td>
                <td className="py-2 text-brand-700">{plan.employee_limit ?? '—'}</td>
                <td className="py-2">
                  {editingPlanId !== plan.id && (
                    <button
                      onClick={() => {
                        setEditingPlanId(plan.id);
                        setEditPriceReais((plan.price_cents / 100).toFixed(2).replace('.', ','));
                        setEditStatus('idle');
                      }}
                      className="text-brand-500 hover:underline"
                    >
                      Editar preço
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editStatus === 'erro' && <p className="mt-2 text-sm text-red-600">Não foi possível salvar o preço.</p>}
      </section>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Assinaturas</h2>
        {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        {subscriptions.length === 0 && !listError ? (
          <p className="mt-4 text-sm text-brand-700">Nenhuma assinatura ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {subscriptions.map((sub) => (
              <li key={sub.id} className="rounded-md border border-brand-100 px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="text-brand-900">{sub.tenant_name ?? sub.technician_name ?? '—'}</strong>
                    <span className="ml-2 text-brand-700">{sub.plan_name}</span>
                    <span className="ml-2 text-brand-700">({sub.status})</span>
                  </div>
                  <button onClick={() => toggleHistory(sub.id)} className="text-brand-500 hover:underline">
                    {expandedSubscriptionId === sub.id ? 'Ocultar histórico' : 'Ver histórico'}
                  </button>
                </div>

                {expandedSubscriptionId === sub.id && (
                  <div className="mt-3 border-t border-brand-100 pt-3">
                    {(paymentEventsBySubscription[sub.id]?.length ?? 0) === 0 ? (
                      <p className="text-xs text-brand-700">Nenhuma cobrança registrada ainda.</p>
                    ) : (
                      <ul className="flex flex-col gap-1 text-xs text-brand-700">
                        {paymentEventsBySubscription[sub.id].map((event) => (
                          <li key={event.id}>
                            {formatDateTime(event.occurred_at)} — {formatCents(event.amount_cents)} —{' '}
                            {event.status}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Build isolado do frontend**

```bash
cd /opt/Montese
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
```

Esperado: build passa sem erro, `/admin/financeiro` presente na
listagem de rotas geradas.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/financeiro/page.tsx frontend/src/components/AdminNav.tsx
git commit -m "feat: adiciona painel admin financeiro (planos + assinaturas + historico de pagamento)"
```

---

## Self-Review (feito ao escrever este plano)

**Cobertura da spec:** seção 2 (`payment_events` → Task 2) ✅; seção 3
(correção da API do MP → Task 1 verifica, Task 3 implementa) ✅; seção
4 (`GET /subscriptions`, `PATCH /plans/:id`, webhook, `GET
/subscriptions/:id/payment-events` → Tasks 3/4/5) ✅; seção 5
(frontend → Task 6) ✅; seção 6 (testes, incluindo a ressalva sobre o
webhook → cada task) ✅; seção 7 (decisões) refletidas nas Global
Constraints ✅; seção 8 (pendências) deliberadamente sem task — fora de
escopo, como a própria spec documenta.

**Placeholders:** nenhum `TBD`/`TODO`. A Task 1 é propositalmente um
spike sem código de produção — isso é o formato correto pra essa
tarefa, não uma lacuna.

**Consistência de tipos:** `SubscriptionAdminRow`/`PaymentEventRow`
(Task 5) são consumidos pela Task 6 com os mesmos nomes de campo.
`AuthorizedPaymentResult` (Task 3) usa `preapprovalId`/`amountCents`
(camelCase, JS) que o controller mapeia pros parâmetros da função SQL
(snake_case, Postgres) — mesma convenção já usada em
`SubscribeContext`/`CreatePreapprovalInput` no arquivo existente.
`Plan` (Task 4) e o `Plan` usado no frontend (Task 6) têm os mesmos
campos.
