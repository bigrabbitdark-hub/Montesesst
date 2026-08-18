# Cadastro próprio de técnico

> Sub-projeto A da iniciativa de pagamento (Mercado Pago) — pré-requisito
> pra B (Planos + Assinaturas), decomposta em brainstorming de 2026-08-18.
> Sem isso, não existe como um técnico chegar num plano pago sozinho: hoje
> `POST /technicians` exige `@Roles('admin')`, só um admin cria conta de
> técnico. Segue de perto o padrão já validado na Fase 2 (site
> institucional) para o cadastro de empresa.

## 1. Objetivo e escopo

Dar ao técnico um jeito de se cadastrar sozinho na plataforma, com
confirmação por e-mail — mesma régua de confiança já aplicada ao cadastro
de empresa. **Fora de escopo:** qualquer coisa de plano/pagamento (isso é
o sub-projeto B, spec separada) e qualquer tela de "carteira de clientes"
do técnico (isso é Fase 5, Dashboard Técnico — ainda não construída).

## 2. Fluxo

### 2.1 Formulário (`/tecnico/cadastro`, novo)

Campos: e-mail, senha, nome completo, telefone (opcional), número de
registro profissional (opcional), especialização (opcional) — mesmos
campos que `CreateTechnicianDto` já usa na criação via admin
(`backend/src/technicians/dto/create-technician.dto.ts`).

Fica dentro do route group `(site)` (`SiteLayout`, header/footer
institucional) — mesma consistência visual do `/cadastro` de empresa.
**Sem link novo no `SiteHeader`** — o header continua focado na aquisição
de empresa (funil principal); a página do técnico fica acessível por URL
direta por enquanto. Adicionar um CTA "Sou técnico" na navegação é uma
decisão de produto separada, não parte desta spec.

### 2.2 `POST /auth/register-technician` (público, novo)

Vive em `AuthController`/`RegistrationService` (não em
`TechniciansController`) pra reaproveitar a infra já existente de
JWT/e-mail/auditoria sem criar dependência cruzada entre os módulos
`AuthModule` e `TechniciansModule`.

- Rate limiting por IP, reaproveitando `RATE_LIMIT_MAX`/mesma infra do
  `RateLimitGuard` — mesmos valores de `REGISTER_RATE_LIMIT_MAX`/
  `REGISTER_RATE_LIMIT_WINDOW_SECONDS` já usados no cadastro de empresa
  (a chave Redis já é isolada por rota desde a correção da Fase 2, então
  não há conflito de contador entre os dois cadastros).
- `RegisterTechnicianDto` com `class-validator`: e-mail válido, senha
  mínimo 8 caracteres (máx 72, mesmo motivo do bcrypt já documentado),
  nome completo mínimo 2 caracteres. Telefone/registro/especialização
  opcionais, sem validação de formato nesta primeira versão.
- Dentro de uma função Postgres `SECURITY DEFINER` nova
  (`auth_register_technician`, mesmo motivo de `auth_register_tenant_and_user`
  da Fase 2 — RLS de `users`/`technicians` bloqueia insert anônimo):
  insere `users` (role `tecnico`, `tenant_id` NULL, status `pendente`) e
  `technicians` (status **`pendente`** — diferente do default atual da
  tabela, que é `'ativo'`, porque isso assume criação confiada por admin;
  autocadastro não tem essa confiança ainda).
- E-mail duplicado já é barrado pela constraint `users_email_unique`
  existente — mesmo tratamento via `mapPgError` (409).
- Gera o mesmo tipo de token de confirmação (JWT, `purpose:
  'email_confirmation'`, 48h) e envia e-mail via `EmailService` com link
  pro mesmo endpoint `GET /auth/confirm` já existente.
- Audita como `register_technician` (ação distinta de `register`, pra
  diferenciar cadastro de empresa e de técnico na trilha de auditoria).

### 2.3 `GET /auth/confirm` — generalizado, não duplicado

Em vez de um segundo endpoint de confirmação, a função Postgres
`auth_confirm_email` (Fase 2) é generalizada: descobre o `role` do usuário
pelo `user_id` do token e ativa `tenants`+`users` (se `empresa`) ou
`technicians`+`users` (se `tecnico`). O código TypeScript
(`RegistrationService.confirm()`, `AuthController.confirm()`) **não muda
nada** — só a função SQL por trás fica role-aware. Migration nova
(`CREATE OR REPLACE FUNCTION`, já que `0004_confirm_email_function.sql`
já está commitada e não deve ser editada retroativamente).

Redirect de sucesso/erro continua pra `/cadastro/confirmado?status=...`
— a página já existente serve pros dois públicos, mensagem já é genérica
("Sua conta já está ativa" + link pra `/login`), não precisa de versão
separada pra técnico.

## 3. Testes

e2e reais (mesmo padrão da Fase 2, contra Postgres/Redis reais): cadastro
cria `users`+`technicians` pendentes e dispara e-mail; e-mail duplicado
rejeitado com 409; confirmação ativa ambos e login funciona depois;
confirmação duplicada não quebra (idempotente); rate limit dispara 429.
Também: confirmar que o cadastro de **empresa** continua funcionando
depois da generalização de `auth_confirm_email` (não é regressão
silenciosa) — reexecutar a suíte e2e completa da Fase 2 além dos testes
novos.

## 4. Decisões desta spec

| Decisão | Escolha |
|---|---|
| Onde vive o endpoint | `POST /auth/register-technician` em `AuthController` (não em `TechniciansController`) — evita acoplar `AuthModule` e `TechniciansModule` |
| Confirmação | Reaproveita `GET /auth/confirm` existente, generalizado por role — não duplica a lógica de token/idempotência já testada |
| Página de resultado | Reaproveita `/cadastro/confirmado` existente — mensagem já é genérica |
| Status inicial do técnico autocadastrado | `pendente` (diferente do default `'ativo'` da tabela, que assume criação por admin) |

## 5. Pendências

- [ ] Nenhuma pendência bloqueante identificada — diferente da Fase 2, não
      depende de credencial externa nova (reaproveita a Resend já
      configurada).
