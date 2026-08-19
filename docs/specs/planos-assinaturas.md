# Planos + Assinaturas (Mercado Pago)

> Sub-projeto B da iniciativa de pagamento — depende do sub-projeto A
> (cadastro próprio de técnico, concluído). Decomposição e decisões de
> escopo confirmadas em brainstorming de 2026-08-18/19: modelo de
> assinatura recorrente, sem gate de funcionalidade ainda, planos como
> dados configuráveis, comissão de visita presencial fora de escopo (fica
> pra quando a Fase 6 existir).

## 1. Objetivo e escopo

Dar à plataforma um mecanismo real de cobrança recorrente — empresa e
técnico conseguem assinar um plano pago, o cartão é cobrado de verdade via
Mercado Pago, e o status da assinatura fica rastreado no banco. **Não é
objetivo desta fase** gatear nenhuma funcionalidade por plano (o trial já
dá acesso completo a tudo que existe hoje; a diferenciação por plano faz
sentido quando os Dashboards de Empresa/Técnico — Fases 4/5 — existirem) e
não inclui comissão de visita presencial (terceiro fluxo de receita, com
split de pagamento, tratado quando a Fase 6 existir).

## 2. Modelo de dados

### 2.1 `plans` — catálogo de planos, dado configurável

```sql
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience TEXT NOT NULL CHECK (audience IN ('empresa', 'tecnico')),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  employee_limit INTEGER,  -- só informativo nesta fase, nada fiscaliza
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Sem RLS — não é dado de tenant, é catálogo público da plataforma (a
página `/planos` precisa listar preços sem autenticação). Populada com
valores de exemplo nesta fase (decisão confirmada): 4 tiers `audience =
'empresa'` (Start/Premium/Super Premium/Enterprise, faixas de preço
baseadas no esboço já compartilhado pelo fundador) e 1 tier `audience =
'tecnico'` (Start Técnico). Marcados como placeholder no comentário da
migration — o fundador ajusta os valores depois (via mim, ou futuramente
uma tela de admin na Fase 7), sem precisar mexer em código.

### 2.2 `subscriptions` — uma linha por tentativa/assinatura

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  technician_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'authorized', 'paused', 'cancelled')),
  mercadopago_preapproval_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_subscription_subject CHECK (
    (tenant_id IS NOT NULL AND technician_user_id IS NULL) OR
    (tenant_id IS NULL AND technician_user_id IS NOT NULL)
  )
);
```

RLS habilitada e forçada — dado sensível por tenant/usuário, mesma
policy-shape já usada em `users`: `admin` vê tudo, senão só a própria
linha (`tenant_id = app.tenant_id` ou `technician_user_id = app.user_id`).

**Simplificação explícita desta fase:** nada impede múltiplas assinaturas
simultâneas pro mesmo tenant/técnico — sem Dashboard ainda pra gerenciar
troca/upgrade de plano, não há um lugar natural pra impor essa regra
direito. Fica registrado como pendência, não como bug.

## 3. Fluxo de assinatura

1. Usuário autenticado (empresa ou técnico) clica "Assinar" num plano —
   em `/planos` (empresa) ou `/tecnico/planos` (técnico, página nova, sem
   link na navegação principal — mesmo padrão do `/tecnico/cadastro`).
2. `POST /subscriptions` (autenticado, `@Roles('empresa','tecnico')`):
   valida que `plan.audience` bate com o role de quem está pedindo (uma
   empresa não assina plano de técnico e vice-versa) → chama a API de
   Assinaturas do Mercado Pago (`POST /preapproval`) com
   `auto_recurring.transaction_amount` vindo de `plans.price_cents`
   (nunca um valor calculado no Mercado Pago — a nossa tabela é a única
   fonte de verdade de preço) → insere a linha em `subscriptions` com
   `status = 'pending'` e o `mercadopago_preapproval_id` já retornado →
   devolve o `init_point` (URL de checkout hospedada) pro frontend.
3. Frontend redireciona o navegador pro `init_point`. Pessoa completa o
   pagamento na página do Mercado Pago — nunca vemos dado de cartão.
4. Mercado Pago redireciona de volta pro nosso `back_url`
   (`/planos/assinatura-concluida` ou `/tecnico/planos/assinatura-concluida`)
   — só uma tela de "estamos confirmando", **não** a fonte de verdade do
   que aconteceu (ver seção 4).

## 4. Webhook — fonte de verdade real

`POST /payments/mercadopago/webhook` (público): Mercado Pago notifica
mudança de status de forma assíncrona. Ao receber:

1. Valida a assinatura HMAC do corpo (headers `x-signature`/`x-request-id`
   contra `MERCADOPAGO_WEBHOOK_SECRET`, configurado no painel do Mercado
   Pago) — rejeita com 401 se não bater. **Pendência de implementação
   explícita:** o formato exato do "manifest string" usado no HMAC precisa
   ser conferido contra a documentação atual do Mercado Pago no momento de
   implementar, não assumido de memória — errar isso silenciosamente abre
   ou fecha demais o webhook.
2. Nunca confia no corpo da notificação pro status em si — busca o estado
   real via `GET /preapproval/{id}` (prática recomendada pelo próprio
   Mercado Pago, evita agir sobre um payload que, mesmo com assinatura
   válida, poderia estar desatualizado por uma corrida de eventos).
3. Atualiza `subscriptions.status` pelo `mercadopago_preapproval_id`, via
   uma função Postgres `SECURITY DEFINER` nova (`payments_update_subscription_status`,
   mesmo motivo/técnica de `auth_confirm_email` — o webhook chega sem
   nenhum contexto de tenant/role, RLS bloquearia um UPDATE anônimo).
4. Se a assinatura vira `authorized` e é de uma empresa, atualiza também
   `tenants.plan` (campo texto já existente) com o nome do plano — mantém
   o que já é exibido hoje coerente, sem precisar reescrever nada que já
   lê esse campo. Sem equivalente pro técnico (não existe campo de plano
   em `users`/`technicians` hoje, e não é necessário criar um só pra
   isso — a tabela `subscriptions` já é a fonte de verdade).

## 5. Ambiente e credenciais

Construído e testado inteiramente com credenciais de **teste** do
Mercado Pago (`MERCADOPAGO_ACCESS_TOKEN` no formato `TEST-...`, mais o
segredo do webhook) — decisão confirmada com o fundador. Só a chave de
acesso é necessária no backend (não usamos Checkout Bricks, então a
public key do Mercado Pago não é necessária nesta fase). Troca pras
credenciais de produção fica pra quando o fundador decidir vender de
verdade — mesmo padrão já usado com a Resend.

**Pendência bloqueante:** `MERCADOPAGO_ACCESS_TOKEN` de teste e o segredo
do webhook ainda não existem — implementação pode seguir com a estrutura
completa, mas o teste real de ponta a ponta (assinar com um cartão de
teste do Mercado Pago, confirmar que o webhook chega e ativa a assinatura)
só acontece depois que o fundador fornecer isso.

## 6. Testes

e2e reais (mesmo padrão já estabelecido no projeto): `POST /subscriptions`
cria a linha `pending` e chama de verdade a API de sandbox do Mercado
Pago (não mock — mesma régua já aplicada ao Resend); plano de audiência
errada (empresa tentando assinar plano de técnico) rejeitado; webhook com
HMAC válido ativa a assinatura certa; webhook com HMAC inválido rejeitado
com 401; RLS confirmada (uma empresa não vê assinatura de outra). Teste
manual de ponta a ponta com cartão de teste do Mercado Pago antes de
fechar a fase — não pode ser considerado pronto sem isso, mesmo critério
já usado no cadastro (Fase 2 e sub-projeto A).

## 7. Decisões confirmadas (brainstorming de 2026-08-18/19)

| Decisão | Escolha |
|---|---|
| Mecanismo de cobrança | Assinatura recorrente via API de Assinaturas do Mercado Pago (Preapproval) |
| Onde o cartão é preenchido | Checkout Pro (página hospedada pelo Mercado Pago) — não Checkout Bricks |
| Preço | Sempre vem de `plans.price_cents`, nunca de um "Plan" registrado do lado do Mercado Pago |
| Gate de funcionalidade | Nenhum nesta fase |
| Comissão de visita presencial | Fora de escopo — fica pra quando a Fase 6 existir |
| Credenciais | Teste (`TEST-...`) — produção só quando o fundador decidir vender de verdade |
| Preços dos planos | Valores de exemplo/placeholder — fundador ajusta depois |
| Assinatura do técnico | Página `/tecnico/planos` nova, mesmo padrão do `/tecnico/cadastro` |

## 8. Pendências

- [ ] **`MERCADOPAGO_ACCESS_TOKEN`** (teste) e segredo do webhook —
      bloqueiam o teste real de ponta a ponta.
- [ ] **Formato exato do HMAC do webhook** — confirmar contra a
      documentação atual do Mercado Pago no momento de implementar.
- [ ] **Valores reais dos planos** — placeholder até o fundador fechar.
- [ ] **Múltiplas assinaturas simultâneas não são impedidas** — aceitável
      nesta fase (sem Dashboard pra gerenciar troca de plano ainda),
      revisitar quando a Fase 4/5 existir.
