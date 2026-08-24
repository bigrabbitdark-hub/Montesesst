
# Fase 2 — Site institucional

> Spec desta fase do roadmap ([`docs/roadmap.md`](../roadmap.md)), seguindo a
> prática do projeto: cada fase ganha seu próprio plano detalhado quando
> chega a vez. Escopo original do briefing (`docs/vision.md`, anexo):
> Home, Planos, Notícias, Contato, Cadastro (CNPJ + e-mail), Login.
> Decisões abaixo confirmadas com o fundador em 2026-08-18 via brainstorming
> (ver seção 8, "Decisões confirmadas").

## 1. Objetivo e escopo

Construir o site público do Montese — hoje o frontend só tem `/login`
funcional e uma home placeholder sem identidade visual nenhuma
(`frontend/src/app/page.tsx`, estilo inline). Das seis páginas do escopo, o
Login já existe e só recebe o layout novo. As outras cinco se dividem em
duas naturezas diferentes:

- **Conteúdo institucional** (Home, Planos, Notícias, Contato) — visual e
  copy, sem lógica de negócio nova relevante, exceto o formulário de
  Contato (que dispara um e-mail).
- **Cadastro** — o primeiro fluxo de auto-serviço real da plataforma: cria
  tenant + user de verdade, mexe em RLS, precisa de validação de CNPJ,
  confirmação por e-mail, e rate limiting. É a peça de maior risco técnico
  desta fase.

**Fora de escopo desta fase** (não confundir com o que falta):
- Onboarding pós-confirmação (wizard de configuração da empresa) — Fase 3.
- Qualquer tela de admin pra ver/gerenciar cadastros pendentes — Fase 7. Não
  é necessária aqui porque a ativação é por confirmação de e-mail
  automática, não por aprovação manual (ver seção 8).
- Preços/planos reais — ainda não definidos pelo fundador; página de Planos
  usa placeholder "fale conosco" (ver seção 3).

## 2. Stack e sistema de design

Tailwind CSS novo no `frontend` (hoje o projeto não tem nenhum framework de
CSS — só estilo inline em `login/page.tsx` e `page.tsx`). Tokens de tema
(cores da paleta verde, tipografia Poppins via Google Fonts) centralizados
em `tailwind.config.ts`, não espalhados por componente — troca fácil quando
o valor hexadecimal exato da marca for confirmado contra o arquivo-fonte
original (`docs/vision.md` seção 4 já sinaliza essa pendência).

- **Logo:** os arquivos-fonte (vetor/alta resolução) ainda não foram
  enviados. Decisão confirmada: usar um wordmark de texto "Montese" em
  Poppins + verde da paleta como placeholder no header/footer, isolado num
  componente `<Logo />` — trocar pelo arquivo real depois é editar um
  componente, não o site inteiro.
- **Layout compartilhado:** `SiteLayout` novo (header com nav + footer),
  usado por Home/Planos/Notícias/Contato/Cadastro. `/login` mantém o
  layout mínimo atual — é tela de produto, não institucional.

## 3. Páginas de conteúdo

| Página | Rota | Conteúdo |
|---|---|---|
| Home | `/` | Hero com proposta de valor ("Tecnologia que organiza. Gestão que protege."), os três papéis (empresa/técnico responsável/parceiro), CTA pra `/cadastro`. |
| Planos | `/planos` | Sem tabela de preço fechada — placeholder confirmado com o fundador, valores ainda não definidos. CTA principal "Comece grátis" → `/cadastro` (`tenants.plan` já tem default `'trial'`, cadastro já inicia um trial de fato). CTA secundário "Fale com vendas" → `/contato`. |
| Notícias | `/noticias`, `/noticias/[slug]` | Posts como arquivos MDX versionados em `frontend/content/noticias/*.mdx` — decisão confirmada: sem CMS, sem tabela nova. Listagem lê os arquivos do diretório em build time (`generateStaticParams`). |
| Contato | `/contato` | Formulário (nome, e-mail, mensagem) → `POST /contact` → e-mail via Resend. Nada persistido no banco (decisão confirmada). |

## 4. Cadastro — fluxo completo

### 4.1 Formulário (`/cadastro`)

Campos: nome da empresa (`tenants.name`), CNPJ, nome do responsável
(`users.full_name`), e-mail, senha. CNPJ com máscara de exibição no input,
enviado ao backend como os 14 dígitos (formato da coluna
`tenants.cnpj VARCHAR(14)`).

### 4.2 `POST /auth/register` (público)

- Rate limiting por IP, reaproveitando o `RateLimitGuard` já existente
  (`backend/src/common/rate-limit/`) — mesmo mecanismo do `/auth/login`,
  limite configurável por env própria (`REGISTER_RATE_LIMIT_MAX`/
  `REGISTER_RATE_LIMIT_WINDOW_SECONDS`, sugestão de default 5/hora por IP —
  cadastro é uma ação rara por usuário legítimo, ao contrário de login).
- `RegisterDto` com `class-validator`: e-mail válido, senha com mínimo de 8
  caracteres, CNPJ validado por formato **e** dígito verificador (algoritmo
  padrão da Receita Federal) — primeira introdução de validação de input
  real no backend (hoje nenhum DTO tem `class-validator`; ver seção 6).
- Dentro de uma transação (`DatabaseService.withoutTenantContext`, já que
  ainda não existe tenant/user autenticado neste ponto — mesmo padrão do
  bootstrap de login):
  1. `INSERT INTO tenants (name, cnpj, plan, status) VALUES (..., 'trial', 'pendente')`.
  2. `INSERT INTO users (tenant_id, role, email, password_hash, full_name, status) VALUES (..., 'empresa', ..., 'pendente')`.
  3. CNPJ e e-mail duplicados já são barrados pelas constraints `UNIQUE`
     que já existem no schema (`tenants.cnpj`, `users_email_unique`) — o
     service captura a violação (código `23505` do Postgres) e devolve
     `409 Conflict` com mensagem amigável, sem vazar qual dos dois campos
     colidiu em detalhe (evita enumeração de CNPJs/e-mails cadastrados).
- Gera um token de confirmação: JWT assinado com o mesmo `JWT_SECRET`,
  claim `purpose: 'email_confirmation'` (distingue de token de sessão),
  `sub` = user id, expira em 48h. Sem tabela nova só pra isso — mesma
  filosofia de "não introduzir infra pra algo que um token assinado já
  resolve" já aplicada no projeto.
- Envia e-mail de confirmação via `EmailService` (seção 5) com link pro
  **endpoint do backend** (não uma página do frontend — é o backend que
  processa o token e decide o redirect, seção 4.3):
  `<PUBLIC_APP_URL>/api/auth/confirm?token=<jwt>`. `PUBLIC_APP_URL` é uma
  env var nova (URL pública de onde o nginx atende, ex.
  `http://<ip-da-vps>` até existir domínio próprio) — necessária porque um
  link de e-mail precisa ser absoluto, diferente do redirect da seção 4.3
  (que pode ser relativo porque acontece dentro do navegador, já na origem
  certa).
- Resposta: `201` com mensagem genérica ("verifique seu e-mail"), sem
  devolver token de sessão — usuário só loga depois de confirmar.

### 4.3 `GET /auth/confirm?token=...` (público)

- Valida o JWT (assinatura + expiração + `purpose`). Token inválido/expirado
  → `400` com mensagem clara ("link expirado ou inválido").
- Idempotente: se o user já está `ativo`, apenas confirma sucesso sem
  erro — clicar duas vezes no link não quebra nada.
- Ativa: `UPDATE users SET status = 'ativo' WHERE id = ...` e
  `UPDATE tenants SET status = 'ativo' WHERE id = ...`.
- Resposta: link clicado a partir de um cliente de e-mail abre no
  navegador, então a resposta é sempre um redirect (302), nunca JSON cru —
  sucesso (ou já confirmado antes) redireciona pra
  `/cadastro/confirmado?status=ok`, token inválido/expirado redireciona pra
  `/cadastro/confirmado?status=erro`. A página do frontend lê o `status` da
  query string e mostra a mensagem certa, com link pra `/login` quando
  `ok`.

### 4.4 Auditoria

`register` e `email_confirmed` viram ações novas no `audit_log` — mesmo
padrão do `login_failure`/`login_success` já existente em
`AuthService`, não o `AuditInterceptor` genérico (que ignora rotas
`/auth/*` de propósito, como já documentado no código).

## 5. `EmailService` e Contato

Módulo comum novo (`backend/src/common/email/`) encapsulando o SDK do
Resend — usado pelo fluxo de confirmação (seção 4) e por `POST /contact`.

- `POST /contact` (público, rate-limited por IP, mesmo padrão) recebe
  `ContactDto` (nome, e-mail, mensagem — validado com `class-validator`) e
  chama `EmailService.send(...)` pro endereço comercial da Montese
  (`CONTACT_EMAIL_TO` no `.env`). Decisão confirmada: sem persistir no
  banco.
- Falha de envio (Resend fora do ar, chave inválida) não pode devolver 500
  genérico pro usuário nem se perder silenciosamente — logada como `error`
  estruturado (`docs/operations/reliability.md`) com o conteúdo da
  tentativa, e o usuário recebe uma mensagem de erro clara pra tentar de
  novo ou usar outro canal.

**Pendência bloqueante:** preciso da API key da Resend (`RESEND_API_KEY`)
antes de codificar o envio de verdade — mesmo processo já usado pro R2.
Até lá, a implementação do `EmailService` pode ser escrita e testada com um
dublê de teste, mas o envio real fica pendente dessa credencial.

## 6. Validação de input (`class-validator`)

Hoje nenhum DTO do backend valida formato (nem o `LoginDto` atual, que é só
um shape TypeScript sem decorators, sem `ValidationPipe` global). Esta fase
introduz `class-validator` + `class-transformer` como dependência nova,
com `ValidationPipe` aplicado **só nos controllers novos**
(`RegisterDto`, `ContactDto`) via `@UsePipes` local, não como pipe global —
evita mudar o comportamento de rotas existentes que não fazem parte desta
fase (escopo focado, sem refatoração não relacionada).

## 7. Testes

- e2e reais contra Postgres/Redis (padrão já estabelecido no projeto):
  cadastro cria tenant/user `pendente` → confirmação ativa ambos →
  login funciona só depois da confirmação; CNPJ duplicado rejeitado com
  409; e-mail duplicado rejeitado com 409; token de confirmação expirado/
  inválido rejeitado com 400; confirmação duplicada (clicar duas vezes) não
  quebra; rate limit de `/auth/register` dispara 429 após o limite.
- `EmailService` testado com um dublê nos testes automatizados — chamar a
  API real da Resend a cada rodada de teste custaria dinheiro e mandaria
  e-mail de verdade. **Antes de fechar esta fase**, confirmo manualmente
  pelo menos um cadastro de ponta a ponta recebendo o e-mail real de
  confirmação (mesmo princípio de "nunca mock como funcional" já seguido
  no backup e no rate limiting — evidência real antes de dar como pronto).
- Páginas de conteúdo (Home/Planos/Notícias/Contato): sem teste automatizado
  de UI (o ambiente não tem browser real disponível, mesma ressalva já
  registrada pro login na Fase 1) — validação visual fica por sua conta
  depois, eu aviso explicitamente quando chegar nessa parte.

## 8. Decisões confirmadas (brainstorming de 2026-08-18)

| Decisão | Escolha |
|---|---|
| Ativação do cadastro | Confirmação por e-mail (não aprovação manual, não ativação imediata) |
| Envio de e-mail | API transacional externa — **Resend** |
| Fonte de conteúdo de Notícias | Arquivos MDX no repositório, sem CMS |
| Planos/preços | Placeholder "fale conosco" — valores reais ainda não definidos |
| Formulário de Contato | Só e-mail, sem persistir no banco |
| Estilização | Tailwind CSS |
| Logo | Wordmark de texto temporário, arquivo real ainda não enviado |

## 9. Pendências

- [ ] **`RESEND_API_KEY`** — bloqueia o envio real de e-mail (confirmação
      de cadastro e Contato). Implementação pode seguir com dublê de teste
      até a credencial existir, mas a fase não fecha sem o teste manual
      real.
- [ ] **Domínio verificado na Resend** — pra e-mail não cair em spam,
      normalmente exige verificar um domínio próprio (registro DNS). Se o
      domínio do Montese ainda não está configurado pra isso, é uma
      decisão/ação externa ao código, a confirmar quando chegarmos nessa
      parte.
- [ ] **Paleta de cores exata** — `docs/vision.md` seção 4 já registra que
      os valores hexadecimais exatos dependem do arquivo-fonte de
      identidade visual. Uso uma aproximação razoável da paleta verde
      descrita até o arquivo real chegar.
- [ ] **Valores da página de Planos** — placeholder até o fundador definir.
- [ ] **`PUBLIC_APP_URL`** — precisa apontar pro endereço público real desta
      VPS (IP ou domínio, quando existir) em produção, senão o link de
      confirmação no e-mail fica quebrado. Fica com um default de
      desenvolvimento (`http://localhost`) até lá.
