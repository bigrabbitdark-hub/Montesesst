# Auditoria de Segurança Pré-Produção — Montese SST

**Data:** 22/09/2026
**Escopo:** Backend NestJS, frontend Next.js, migrations PostgreSQL, configuração nginx/docker-compose, integrações externas (MercadoPago, Resend, MiniMax, OpenRouter, Google Calendar, Cloudflare R2)
**Metodologia:** análise estática (leitura de código, revisão de migrations, configuração de infra) + greps de segurança (TODO/FIXME/HACK, console.log, eval/exec, fallbacks de segredo) + revisão de threat model (multi-tenant via RLS, autenticação JWT, webhooks externos, criptografia em repouso)
**Ambiente auditado:** branch atual de `/opt/Montese` (snapshot 22/09/2026)

> **Veredito final:** **APROVADO COM RESSALVAS** — sistema pronto para deploy em produção após correção dos 3 achados **P0** (F-15, F-20, F-21). Ver `§3 Veredito` e `§4 Achados por severidade` abaixo.

---

## 1. Sumário executivo

A base de segurança do Montese SST é **sólida e madura** na maior parte da pilha. Os pontos fortes são:

- **Multi-tenant rigoroso via RLS**: 48 tabelas com `ENABLE ROW LEVEL SECURITY`, 52 `CREATE POLICY`, todas as funções SECURITY DEFINER para fluxos pré-autenticação (`auth_find_user_by_email`, `auth_register_*`, `auth_confirm_email`).
- **Criptografia em repouso bem feita**: AES-256-GCM com IV aleatório por escrita para tokens do Google (`secret-crypto.util.ts`), chave validada por tamanho (64 hex chars = 32 bytes) e falha-fast na ausência.
- **Assinaturas HMAC constantes em todas as integrações**: `timingSafeEqual` usado tanto no estado OAuth do Google quanto no webhook do MercadoPago, com checagem de comprimento prévia.
- **Auditoria abrangente**: `AuditInterceptor` global registra `actorUserId`, `actorTenantId`, `actorRole`, `action`, `resourceType`, `resourceId`, `ipAddress`, `statusCode`, com `request_id` correlacionando logs.
- **Sem stack trace leak**: `AllExceptionsFilter` devolve sempre `Erro interno` em 5xx e loga stack apenas em stderr estruturado.
- **Arquitetura de rede correta**: docker-compose expõe APENAS nginx nas portas 80/443; postgres/redis/backend/frontend ficam em rede interna sem `ports:`.
- **Higiene de código exemplar**: zero `console.log`, zero `eval/exec/new Function`, zero marcadores `TODO/FIXME/HACK` ativos no backend ou frontend.
- **Rate-limit por rota bem desenhado**: guard global com chave `ip`, `ip-email` ou `user`, com escopo por rota declarado via decorator.

Os **achados críticos** (P0) que bloqueiam o go-live estão concentrados em três lugares pequenos mas importantes: (1) um fallback hardcoded de `JWT_SECRET` que anula toda a segurança de tokens se a env var faltar em produção; (2) ausência total de headers de segurança HTTP em qualquer camada (nem `helmet` no NestJS, nem `add_header` no nginx); (3) ausência de validação no DTO do login combinado com ausência de `ValidationPipe` global.

---

## 2. Escopo auditado

### 2.1 Backend (`/opt/Montese/backend`)

| Item | Status |
| --- | --- |
| Stack | NestJS 10.4.x, class-validator 0.15.x, pg 8.13.x, bcrypt 5.1.x, ioredis 5.11.x |
| Auth | JWT (HS256, 8h) + Passport JWT + bcrypt(10) + RLS |
| Rate limit | Guard global customizado, Redis backend, escopo por rota |
| Audit | AuditInterceptor + AuditService, sem retenção definida no código |
| 51 migrations | 48 com `ENABLE RLS`, 52 `CREATE POLICY`, todas SECURITY DEFINER |
| Endpoints revisados | auth, health, google-calendar (service + controller implícito), payments/webhook, contact, registration |

### 2.2 Frontend (`/opt/Montese/frontend`)

| Item | Status |
| --- | --- |
| Stack | Next.js 14.2.18, React 18.3.1, Tailwind 4.3.3 |
| Dependências de runtime | apenas Next + React + `gray-matter` + `next-mdx-remote` (sem axios, sem SWR, sem @tanstack/react-query — provavelmente usa Server Components / `fetch` nativo) |
| Comunicação com backend | via `NEXT_PUBLIC_API_URL=/api` (proxy pelo nginx) |
| TODO/FIXME/HACK | 0 ocorrências |
| `console.log` | 0 ocorrências |

### 2.3 Infraestrutura

| Item | Status |
| --- | --- |
| `docker-compose.yml` | Apenas nginx expõe 80/443. Postgres, redis, backend, frontend ficam em rede `internal` sem `ports:`. |
| `nginx/conf.d/default.conf` | TLS 1.2/1.3, HTTP/2, HTTPS-only, proxy headers corretos, `client_max_body_size 110m`, `proxy_read_timeout 300s`. **Não adiciona headers de segurança.** |
| Secrets | `JWT_SECRET`, `MERCADOPAGO_*`, `RESEND_API_KEY`, `MINIMAX_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET`, `R2_*` — todos via `.env` no docker-compose |

---

## 3. Veredito

### APROVADO COM RESSALVAS

Sistema **não deve ir para produção** antes de corrigir os 3 achados **P0** listados em §4.1. Eles são encontrados em poucas linhas cada, têm fix conhecido e podem ser fechados em um único PR.

Após a correção dos P0 e dos P1 (recomendado mas não bloqueante), o sistema atende aos requisitos de segurança para um SaaS B2B de gestão SST manipulando dados sensíveis (PII de funcionários, documentos legais, integrações financeiras).

**Achados restantes (P2/P3)** podem ser endereçados em sprints pós-lançamento; nenhum deles representa risco imediato de exploração.

> **Atualização pós-PR1+PR2+PR3 (22→24/09/2026):** F-15, F-20, F-21 (PR1) + F-22 (PR2) + F-27 (PR3) foram fechados. Ver §11. F-19 foi tratado no mesmo PR1 (fechado antecipadamente). O P0 original era 3 (F-15, F-20, F-21) — permanece válido retroativamente porque F-19 não era P0, era P1.

---

## 4. Achados por severidade

### 4.1 P0 — Bloqueiam produção (devem ser corrigidos antes do go-live)

#### F-15 — `LoginDto` sem validação + ausência de `ValidationPipe` global

**Arquivos:**
- `backend/src/auth/dto/login.dto.ts` (linhas 1-4: só type annotations, zero decorators)
- `backend/src/main.ts` (linhas 1-19: `enableCors()` chamado, mas nenhum `app.useGlobalPipes(new ValidationPipe(...))`)
- `backend/src/auth/auth.controller.ts` (rota `POST /auth/login` não tem `@UsePipes(ValidationPipe)`)

**Descrição:** O DTO de login declara `email` e `password` apenas como tipos TS. Sem decorators de `class-validator`, o body de `POST /auth/login` é aceito em qualquer formato: arrays, objetos aninhados, valores não-string, strings vazias, payloads enormes. O controller chama diretamente `this.auth.login(email, password, ip)` sem garantia de tipo em runtime. Como também **não há `ValidationPipe` global registrado em `main.ts`**, mesmo que se adicionem decorators ao `LoginDto`, eles não serão aplicados.

**Impacto:**
- Possibilidade de enviar `password` como `null`, `[…]`, `{ $ne: null }` (se um dia o backend trocasse para MongoDB — não é o caso aqui, mas é a forma de pensar) ou string de 1MB (DoS no bcrypt).
- Para um atacante isso não abre brecha de auth bypass direto (o bcrypt ainda recebe a string, e a query parametrizada em `auth_find_user_by_email($1)` não é injetável), mas abre vetor de negação de serviço por memória/CPU via payloads grandes (bcrypt de string de 100KB custa ~100ms; 10 dessas no rate-limit de 10/15min já estoura a janela).
- Mais grave: **inconsistência arquitetural**. Todos os outros DTOs públicos (`RegisterDto`, `ContactDto`, etc.) usam `class-validator`; só o login está descoberto. Indica que a falta de `ValidationPipe` global é esquecimento, não decisão.

**Correção:**
```ts
// backend/src/auth/dto/login.dto.ts
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
```
```ts
// backend/src/main.ts — adicionar antes de app.listen()
import { ValidationPipe } from '@nestjs/common';
app.useGlobalPipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
);
```

> ⚠️ **Atenção ao adicionar ValidationPipe global**: rotas que hoje dependem de `@Body() body: any` (ex.: webhook do MercadoPago em `backend/src/payments/webhook.controller.ts`) precisam ser revistas. O `@Body() body: any` deve virar `@Body() body: MercadoPagoWebhookPayload` (com `forbidNonWhitelisted` ativo). **Testar com `npm run test:e2e` antes de fechar.**

#### F-20 — Zero headers de segurança HTTP em toda a pilha

**Arquivos:**
- `backend/src/main.ts` (linhas 1-19: nenhum `app.use(helmet())`; `helmet` nem está em `package.json`)
- `backend/package.json` (não tem `"helmet"` em `dependencies` nem `devDependencies`)
- `nginx/conf.d/default.conf` (server block sem nenhum `add_header`)

**Descrição:** Nem o backend adiciona `helmet` automaticamente, nem o nginx adiciona headers via `add_header`. Faltam todos:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Frame-Options: DENY` (ou `SAMEORIGIN` se for usado iframe interno)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Permissions-Policy: …`
- `Content-Security-Policy` (no HTML do Next.js, não na API — mas vale configurar também para defesa em profundidade)

**Impacto:** API JSON por si só não renderiza HTML, então o risco direto de XSS/clickjacking é menor do que para um site HTML. Mas o frontend Next.js (porta 3000, também atrás do mesmo nginx) responde HTML em todas as rotas e fica completamente exposto:
- Sem HSTS: usuário pode ser downgraded para HTTP em primeiro acesso (roubo de cookie/token se o app usasse cookies).
- Sem `X-Frame-Options`/`frame-ancestors` no CSP: site pode ser embutido em iframe malicioso (clickjacking).
- Sem `nosniff`: navegador pode fazer MIME-sniff em respostas JSON e potencialmente executar como script se houver bug de Content-Type em alguma rota.

**Correção (dois lugares):**

1. **Backend NestJS:**
```bash
npm install helmet@^7.1.0
```
```ts
// backend/src/main.ts
import helmet from 'helmet';
// ... após NestFactory.create, antes de enableCors:
app.use(helmet());
```

2. **Nginx** (em `/opt/Montese/nginx/conf.d/default.conf`, dentro de cada bloco `server { listen 443 ssl; … }`):
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```
> Se algum endpoint precisar ser embutido em iframe de terceiros (ex.: embed do dashboard), ajustar para `SAMEORIGIN` ou lista de origens permitidas via CSP `frame-ancestors`.

#### F-21 — Fallback hardcoded de `JWT_SECRET` em três arquivos críticos

**Arquivos:**
- `backend/src/auth/auth.module.ts:13` — `secret: process.env.JWT_SECRET || 'dev-secret-change-me'`
- `backend/src/auth/strategies/jwt.strategy.ts:18` — `secretOrKey: process.env.JWT_SECRET || 'dev-secret-change-me'`
- `backend/src/google-calendar/google-calendar.service.ts:40,51` — HMAC do estado OAuth usa o mesmo fallback

**Descrição:** Se a env var `JWT_SECRET` estiver ausente em produção (cenário plausível: deploy feito sem copiar `.env`, container reiniciado após limpeza de volume, secret manager offline), o sistema **silenciosamente** passa a usar o string público `'dev-secret-change-me'`. Esse string está visível em qualquer clone do repositório GitHub, em todos os planos de implementação em `docs/plans/*.md` e em qualquer issue/PR do projeto.

**Impacto em caso de incidente:**
- Atacante forja JWT para qualquer `user_id`, qualquer `tenantId`, qualquer `role` → **bypass completo de autenticação e autorização**.
- Atacante forja `state` OAuth do Google para qualquer `technician_user_id` → consegue vincular a própria conta Google a um técnico arbitrário, capturando refresh tokens de terceiros.
- Como o atacante pode emitir tokens com `role: 'admin'` e `tenantId: null` (regra admin nas policies RLS), tem acesso irrestrito a todos os tenants.

**Probabilidade:** Média. O `docker-compose.yml` exige `JWT_SECRET: ${JWT_SECRET}` (linha 42), então em deploy normal via compose o valor estará presente. Mas o `||` torna o sistema frágil a:
- Deploy manual (sem compose) onde o operador esquece a env var.
- CI/CD com `.env` mal sincronizado.
- Migração para outra plataforma (K8s, ECS, Fly) onde o secret não foi portado.

**Correção (módulo centralizado de validação de env):**

```ts
// backend/src/common/env/env.validation.ts
import { Logger } from '@nestjs/common';

const log = new Logger('EnvValidation');

const REQUIRED_IN_PRODUCTION: Array<[string, (v: string) => boolean, string]> = [
  ['JWT_SECRET', (v) => v.length >= 32, 'mínimo 32 caracteres (256 bits)'],
  ['GOOGLE_TOKEN_ENCRYPTION_KEY', (v) => /^[0-9a-f]{64}$/i.test(v), '64 caracteres hex (32 bytes)'],
  ['MERCADOPAGO_WEBHOOK_SECRET', (v) => v.length >= 16, 'mínimo 16 caracteres'],
  ['RESEND_API_KEY', (v) => v.startsWith('re_'), 'deve começar com re_'],
  ['MINIMAX_API_KEY', (v) => v.length >= 20, 'mínimo 20 caracteres'],
  ['OPENROUTER_API_KEY', (v) => v.startsWith('sk-or-'), 'deve começar com sk-or-'],
  ['DATABASE_URL', (v) => v.startsWith('postgres'), 'deve ser uma URL postgres://'],
  ['REDIS_URL', (v) => v.startsWith('redis'), 'deve ser uma URL redis://'],
];

const FORBIDDEN_VALUES = ['dev-secret-change-me', 'changeme', 'secret', 'missing-api-key', ''];

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const missing: string[] = [];
  const weak: string[] = [];
  const forbidden: string[] = [];

  for (const [name, check, hint] of REQUIRED_IN_PRODUCTION) {
    const v = process.env[name];
    if (!v) { missing.push(`${name}: ausente (${hint})`); continue; }
    if (FORBIDDEN_VALUES.includes(v)) { forbidden.push(name); continue; }
    if (!check(v)) { weak.push(`${name}: inválido (${hint})`); }
  }

  const problems = [...missing.map((m) => `  - ausente: ${m}`),
                    ...forbidden.map((n) => `  - valor proibido: ${n}`),
                    ...weak.map((w) => `  - fraco: ${w}`)];

  if (problems.length > 0) {
    log.error(`Validação de env em produção falhou:\n${problems.join('\n')}`);
    process.exit(1);
  }
  log.log('Env de produção validado.');
}
```
```ts
// backend/src/main.ts — primeira linha do bootstrap():
import { validateProductionEnv } from './common/env/env.validation';
validateProductionEnv();
```

**E remover os fallbacks:**
```ts
// backend/src/auth/auth.module.ts
secret: process.env.JWT_SECRET!,  // já validado acima; ! porque TS não sabe
```
```ts
// backend/src/google-calendar/google-calendar.service.ts:40,51
const signature = createHmac('sha256', process.env.JWT_SECRET!)
  .update(payload)
  .digest('hex');
```

> **Bônus:** o mesmo padrão `||` aparece em `backend/src/common/email/email.service.ts:26` com `RESEND_API_KEY || 'missing-api-key'`. Embora a API do Resend rejeite a chave inválida em runtime (não é silenciosamente aceita), o ideal é trocar para fail-fast no startup — ver F-23.

---

### 4.2 P1 — Devem ser corrigidos no mesmo PR dos P0 (recomendação forte)

#### F-19 — `enableCors()` sem allowlist (origem `*`)

**Arquivo:** `backend/src/main.ts:17` — `app.enableCors();`

**Descrição:** A chamada sem argumentos faz com que `Access-Control-Allow-Origin: *` seja devolvido em **toda** resposta da API. Para uma API autenticada por Bearer JWT isso é menos crítico do que para uma API com cookies — o JWT não é enviado automaticamente pelo browser em cross-origin sem o atacante ter acesso a ele — mas mesmo assim:

- Permite que qualquer site malicioso faça preflight OPTIONS e descubra quais rotas existem.
- Se algum endpoint algum dia passar a aceitar credenciais via cookie (alguma integração futura, SSO etc.), a falha fica pré-configurada.
- Viola o princípio de menor privilégio: por que aceitar origens que nunca vão consumir a API?

**Correção:**
```ts
// backend/src/main.ts
const ALLOWED_ORIGINS = [
  process.env.PUBLIC_APP_URL,        // ex.: 'https://app.montesesst.com.br'
  'https://montesesst.com.br',
  'https://www.montesesst.com.br',
].filter(Boolean) as string[];

app.enableCors({
  origin: (origin, cb) => {
    // Permitir requests sem Origin (curl, server-to-server, mobile nativo)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} não permitida`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  maxAge: 86400,
});
```

> **Teste manual pós-fix:** `curl -i -H 'Origin: https://evil.com' http://localhost:4000/auth/login` deve responder sem o header `Access-Control-Allow-Origin`.

#### F-22 — Rate-limit fail-open em outage do Redis

**Arquivos:** `backend/src/common/rate-limit/rate-limit.guard.ts` (toda a lógica de catch), `backend/src/main.ts` (RedisModule registrado)

**Descrição:** Confirmado em revisão anterior: quando o Redis está indisponível, o `RateLimitGuard` **permite a requisição** (fail-open). Isso é uma decisão consciente e documentada no código (preferir disponibilidade a segurança em uma interrupção do cache). Em produção, porém, é preciso:

1. **Alertar** no momento do fail-open (log estruturado em stderr + webhook de observabilidade).
2. **Degradar de forma controlada**: quando o Redis falha, aplicar um cap mínimo global por IP (ex.: 60 req/min) direto em memória local para impedir abuso oportunista.

**Correção sugerida:**
```ts
// dentro de RateLimitGuard.canActivate, no bloco catch do redis:
this.logger.error(
  `Rate-limit Redis offline — aplicando fallback local. IP=${req.ip} path=${req.path}`,
);
return this.localFallback(req);
```

```ts
// localFallback: LRU em memória com TTL
private localFallback(req: Request): boolean {
  const key = `local:${req.ip}`;
  const now = Date.now();
  const bucket = this.localBuckets.get(key) ?? { count: 0, resetAt: now + 60_000 };
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + 60_000; }
  bucket.count += 1;
  this.localBuckets.set(key, bucket);
  return bucket.count <= 60;  // 60 req/min por IP em modo degradado
}
```

> Map com TTL exige limpeza periódica para não vazar memória em processos longos. Em Node.js com `restart: unless-stopped`, OK; se migrar para serverless, refatorar.

#### F-27 — Fallback hardcoded de `GOOGLE_CLIENT_ID`/`SECRET` em `google-oauth-calendar-client.service.ts`

**Arquivo:** `backend/src/google-calendar/google-oauth-calendar-client.service.ts:19-22` (constructor) — também linhas 62-63 (segunda instanciação em `refreshAccessToken`)

> **Detecção:** achado durante revisão pré-push do PR 1 (F-21 mencionava `google-calendar.service.ts` mas não este `google-oauth-calendar-client.service.ts`, que é o `useClass` real do provider `GOOGLE_CALENDAR_CLIENT`). A revisão do PR 1 pegou 3 dos 4 fallbacks; este ficou de fora por falha de cobertura do grep.

**Descrição:** O service que encapsula `OAuth2Client` (cliente real que fala com o Google — diferente do `google-calendar.service.ts` de domínio) lia as credenciais com fallback string:

```ts
process.env.GOOGLE_CLIENT_ID || 'missing-google-client-id',
process.env.GOOGLE_CLIENT_SECRET || 'missing-google-client-secret',
```

Diferente de `R2Service`/`EmailService` (que também usam o mesmo padrão e estão documentados em §F-21/F-23), o **erro do Google OAuth é opaco**: o Google devolve `"invalid_client"` sem distinguir "chave errada" de "chave ausente". Resultado em prod sem `GOOGLE_CLIENT_ID`/`SECRET` no `.env`:

1. Backend **sobe** normalmente (boot não falha — o validator centralizado F-21 só cobre segredos sensíveis, não credenciais OAuth).
2. Primeira tentativa real de "Conectar Google" (técnico clica o botão) ou criar evento via `refreshAccessToken` → usuário vê `"invalid_client"` opaco, sem indicação de que a env var está faltando.
3. Operador confunde com problema de credencial no Cloud Console, perde horas debugando o lado errado.

**Probabilidade:** Alta — `docker-compose.yml:90-91` exige as duas vars **sem valor default** (falha `docker compose config` se ausentes), mas o `docker-compose up --build` em dev sem `.env` configurado, ou um `.env` antigoesquecido em prod (cenário plausível: deploy feito copiando `.env.example` e esquecendo de preencher), fazem o container subir com `NODE_ENV=production` mas sem as credenciais OAuth. Esse cenário é o mesmo do F-21 e a auditoria documenta explicitamente como "Migração para outra plataforma onde o secret não foi portado".

**Correção (fail-fast no constructor):**

```ts
// backend/src/google-calendar/google-oauth-calendar-client.service.ts
constructor() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'GoogleOAuthCalendarClientService: faltam GOOGLE_CLIENT_ID e/ou ' +
        'GOOGLE_CLIENT_SECRET no ambiente. Sem elas, o OAuth2Client seria ' +
        'instanciado com placeholder e a primeira tentativa real de ' +
        '"Conectar Google" retornaria "invalid_client" sem contexto.',
    );
  }

  this.client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
}
```

**Decisão de não adicionar a `validateProductionEnv`:** Por design, o validator central F-21 cobre só **segredos sensíveis** (chaves de API, tokens de criptografia, JWT_SECRET) — as credenciais OAuth do Google são credenciais de cliente e ficariam melhor tratadas na camada do client. Esta é uma escolha de projeto, não esquecimento. Ver §10 para comando de verificação.

**Decisão de quebrar o padrão `R2Service`/`EmailService`:** Consciente. Nestes dois, o erro real da chamada API identifica o problema ("credenciais inválidas" no Resend, "NoSuchBucket" no R2). No OAuth do Google, `"invalid_client"` é opaco. A quebra fica registrada aqui para o próximo dev saber por que este service é diferente dos outros.

**Impacto nos testes e2e:** Os 2 testes e2e do google-calendar (`google-calendar.e2e-spec.ts:24-32` e `visits-google-integration.e2e-spec.ts:32-39`) agora setam `process.env.GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` no `beforeAll`, mesmo padrão já em uso para `GOOGLE_TOKEN_ENCRYPTION_KEY`. Os valores são placeholders (`fake-client-id-for-e2e`) — o provider inteiro é mockado via `.overrideProvider(GOOGLE_CALENDAR_CLIENT).useValue(fakeGoogleClient)` então nunca chega a ser usado.

> **Cobre com:** `backend/test/google-oauth-calendar-client-constructor.unit-spec.ts` (novo, 4 cenários: ID faltando, SECRET faltando, ambos faltando, ambos presentes).

---

### 4.3 P2 — Corrigir no primeiro sprint pós-lançamento

#### F-17 — `/auth/confirm` sem rate-limit

**Arquivo:** `backend/src/auth/auth.controller.ts` (rota GET `/auth/confirm`)

**Descrição:** O token de confirmação tem 48h de validade, é um JWT assinado e tem `purpose: 'email_confirmation'` distinto de tokens de sessão. Brute-force é inviável. Mesmo assim, defesa em profundidade pede um rate-limit de `ip` (ex.: 30/hora) — caso um atacante descubra uma forma de emitir tokens de confirmação próprios (não é o caso hoje, mas é a postura correta).

**Correção:**
```ts
// backend/src/auth/auth.controller.ts
@Public()
@RateLimit({ limit: 30, windowSeconds: 3600, keyBy: 'ip' })
@Get('confirm')
async confirm(@Query('token') token: string, @Req() req: Request) { … }
```

#### F-26 — `MERCADOPAGO_WEBHOOK_SECRET` silenciosamente vazio

**Arquivo:** `backend/src/payments/webhook.controller.ts:32`

**Descrição:** `process.env.MERCADOPAGO_WEBHOOK_SECRET || ''` faz com que, se a env var estiver ausente, `verifyMercadoPagoSignature` retorne `false` e o webhook responda 401 — bloqueando **todas** as renovações de assinatura silenciosamente, sem alerta. Combinado com a natureza de "sempre responde 200 para evitar retry infinito", a assinatura ficaria permanentemente `pending` sem ninguém ser notificado.

**Correção:** Incluir na função `validateProductionEnv` proposta em F-21. Não precisa de mais código; só adicionar à lista de REQUIRED.

---

### 4.4 P3 — Backlog (informativo, sem bloqueio)

#### F-11 (REVISADO) — Cross-tenant upload de documentos — **VERIFICADO SEGURO**

**Status:** ✅ **SEGURO por revisão de código**. **Downgrade de P1 para P3 (informativo).**

**Análise:** Confirmado em três lugares:

1. `backend/src/documents/documents.controller.ts:107` constrói o `fileKey` a partir de `data.tenantId` (campo validado pelo DTO).
2. `req.withTenantContext` em `backend/src/common/database/database.service.ts` faz `SET LOCAL app.tenant_id = $1` usando `req.user.tenantId`.
3. A policy `documents_isolation` em `backend/db/migrations/0011_partner_access.sql` tem **quatro branches**:
   - admin global (`app.is_admin = true`)
   - próprio tenant (`tenant_id = app.tenant_id`)
   - técnico parceiro (`EXISTS (SELECT 1 FROM tenant_technicians …)`)
   - parceiro de negócio (`EXISTS (SELECT 1 FROM tenant_partners …)`)

Um INSERT cross-tenant (ex.: técnico tenta gravar documento de tenant A em tenant B) falha a policy → `mapPgError` em `backend/src/common/pg-error.util.ts` traduz `new row violates row-level security policy` para `ForbiddenException` (403). Confirmado.

**Recomendação:** smoke test manual (`curl` com token de tenant A tentando upload em tenant B → esperar 403) antes do go-live para fechar 100%. Caso positivo, marcar como resolvido e remover da auditoria.

#### F-16 — `/health` público sem rate-limit

**Arquivo:** `backend/src/health/health.controller.ts:12-16`

**Descrição:** Endpoint retorna `{ status: 'ok', db_time: … }` com `@Public() @SkipRateLimit()`. Como só faz `SELECT now()`, o custo é mínimo e o impacto direto é desprezível. Único ponto: expõe uptime do DB (proxy para uptime do servidor).

**Recomendação:** aceitar como está, ou — se quiser esconder — restringir por IP via nginx (`allow 127.0.0.1; allow 10.0.0.0/8; deny all;` no location `/api/health`).

#### F-18 — Refresh token do Google lido e decriptado a cada evento

**Arquivos:** `backend/src/google-calendar/google-calendar.service.ts:108-114` (`createEvent`)

**Descrição:** Para cada `createEvent` (reunião confirmada, visita confirmada), o serviço faz um `SELECT refresh_token_encrypted …` + `decryptSecret` (AES-256-GCM). Em volume baixo (alguns eventos/dia por técnico) isso é desprezível. Em volume alto (100+ eventos/dia) vira round-trip extra ao DB por chamada.

**Recomendação:** cache em memória com TTL de ~5min, invalidar em `disconnect`. Não é P0; é otimização. Backlog.

#### F-23 — `RESEND_API_KEY || 'missing-api-key'`

**Arquivo:** `backend/src/common/email/email.service.ts:26`

**Descrição:** Mesmo padrão `||` problemático de F-21, mas com impacto menor: a API do Resend rejeita a chave inválida em runtime (não aceita silenciosamente). Resultado: emails falham, mas o sistema continua no ar.

**Recomendação:** incluir na função `validateProductionEnv` de F-21.

#### F-24 — bcrypt rounds = 10

**Arquivos:** `backend/src/auth/auth.service.ts:52`, `backend/src/auth/registration.service.ts:44,75`

**Descrição:** OWASP 2024 recomenda bcrypt com cost factor 12+ para novas implantações. Hashes existentes continuam válidos se o cost for aumentado (bcrypt codifica o cost no próprio hash).

**Recomendação:** mudar para `bcrypt.hash(password, 12)`. Em hardware modesto (CPU 2024) isso adiciona ~50ms por login — aceitável.

#### F-25 — `/auth/confirm` retorna string literal `'ok'`/`'erro'`

**Arquivos:** `backend/src/auth/auth.controller.ts`, `backend/src/auth/registration.service.ts:128-160`

**Descrição:** O endpoint confirma email e retorna `'ok'` ou `'erro'` como string com status 200 em ambos os casos. Sem leak relevante (não revela se o token era válido — `'erro'` cobre todos os casos de falha), mas é uma escolha de design inconsistente (demais endpoints usam `HttpException` apropriado).

**Recomendação:** manter como está. Não vale o esforço de mudar.

#### F-14 (REVISADO) — Upload de logo — **VERIFICADO SEGURO**

**Status:** ✅ Resolvido por revisão. Removido da lista de abertos.

- `client_max_body_size 110m` em nginx é suficiente para os 2MB de logo + margem.
- MIME allowlist (JPG/PNG) já implementada.
- Auth requerida em todos os endpoints de upload.
- Download via presigned URL com expiração de 5 minutos.
- Verificado em `backend/src/documents/` no commit atual.

---

## 5. Pontos fortes (manter e cultivar)

### 5.1 Multi-tenant rigoroso
- 48 tabelas com RLS habilitado, 52 policies. Padrão consistente em todas as migrations.
- Funções SECURITY DEFINER isoladas em schema dedicado para fluxos pré-autenticação (`auth_*`).
- `withTenantContext` / `withoutTenantContext` padronizado em todo o `DatabaseService`.

### 5.2 Criptografia
- AES-256-GCM com IV aleatório de 12 bytes por escrita (`secret-crypto.util.ts:30-32`).
- Auth tag armazenado separado do ciphertext.
- Validação estrita da chave (`hex.length === 64`) — fail-fast sem fallback.

### 5.3 Assinaturas e HMAC
- `timingSafeEqual` em todas as comparações de HMAC (Google state OAuth, webhook MercadoPago).
- Checagem de comprimento antes de `timingSafeEqual` (evita exception).
- Manifest string documentada inline.

### 5.4 Auditoria
- `AuditInterceptor` global captura toda requisição.
- `request_id` via `RequestIdMiddleware` correlaciona logs entre filter, interceptors, services.
- `AuditService.log()` é fire-and-forget (`void this.audit.log(…)`) — não bloqueia request.

### 5.5 Tratamento de erros
- `AllExceptionsFilter` nunca devolve stack trace em 5xx.
- Log estruturado em JSON-line para stderr.
- 4xx como `warn` (sem stack), 5xx como `error` (com stack).

### 5.6 Infraestrutura
- docker-compose com tudo atrás de nginx; sem `ports:` expostos para postgres/redis/backend/frontend.
- TLS 1.2/1.3 + HTTP/2 + HTTPS-only redirect.
- `client_max_body_size 110m` (documentado para documentos).
- `proxy_read_timeout 300s` (documentado para embeddings de normas longas).

### 5.7 Higiene de código
- Zero `console.log` em backend/frontend.
- Zero `eval/exec/new Function` em backend.
- Zero marcadores `TODO/FIXME/HACK` ativos (a única ocorrência no backend é `TODOS` em pt-BR, falso positivo).

### 5.8 Validação de input (padrão-ouro: `contact.controller.ts`)
```ts
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
```
Esse padrão deve ser replicado globalmente (ver correção de F-15).

---

## 6. Matriz de rotas (resumo)

| Método | Rota | Auth | Rate-limit | Roles | RLS | Observações |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/auth/login` | @Public | 10/15min `ip-email` | — | bypass via SECURITY DEFINER | **F-15**: sem ValidationPipe no DTO |
| POST | `/auth/register` | @Public | 5/h `ip` | — | bypass | ✅ ValidationPipe no controller |
| POST | `/auth/register-technician` | @Public | 5/h `ip` | — | bypass | ✅ ValidationPipe no controller |
| GET | `/auth/confirm` | @Public | **NENHUM** | — | bypass | **F-17**: adicionar rate-limit |
| GET | `/auth/me` | JWT | nenhum | — | — | Coberto pela mesma recomendação de F-17 (rate-limit em endpoints auth-adj) |
| POST | `/payments/mercadopago/webhook` | @Public | global padrão | — | bypass | ✅ HMAC verificado |
| POST | `/contact` | @Public | 10/h `ip` | — | — | ✅ ValidationPipe + DTO |
| GET | `/health` | @Public | SkipRateLimit | — | bypass | **F-16**: aceita como está |
| (rotas autenticadas genéricas) | … | JWT | global padrão | RolesGuard | sim | RLS enforça tenant |

> Cada rota autenticada herda o `RateLimitGuard` global (padrão `RATE_LIMIT_MAX=300 / RATE_LIMIT_WINDOW_SECONDS=300` = 300 req/5min). Rotas sensíveis (auth, contact, ai-draft, etc.) sobrescrevem com `@RateLimit` decorator mais restritivo.

---

## 7. Recomendações de implementação (ordem sugerida)

### PR 1 — Bloqueios P0 (pré go-live)

1. **F-15**: criar `validateProductionEnv` e adicionar `app.useGlobalPipes(new ValidationPipe(...))`. Adicionar decorators ao `LoginDto`.
2. **F-20**: instalar `helmet`, chamar `app.use(helmet())`, adicionar `add_header` ao nginx.
3. **F-21**: centralizar validação de env, remover todos os fallbacks `||`, fail-fast em produção.

**Esforço:** 1 dev-dia total. **Risco de regressão:** baixo — todos os P0 são aditivos (não removem funcionalidade existente), mas testar E2E:
```bash
npm run test:e2e
# e manualmente: smoke test das rotas auth/register, auth/login, payments/webhook
```

### PR 2 — P1 (mesmo deploy, ou imediatamente após)

4. **F-19**: allowlist CORS.
5. **F-22**: fallback local no RateLimitGuard + alerta.

### PR 3 — P2/P3 (primeiro sprint pós-lançamento)

6. **F-17**, **F-26**, **F-16**, **F-23**, **F-24**, **F-18**, **F-25**.

---

## 8. Anexo A — Dependências auditadas

### Backend (`/opt/Montese/backend/package.json`)

| Pacote | Versão | Notas |
| --- | --- | --- |
| @nestjs/core | ^10.4.15 | Atual |
| @nestjs/jwt | ^10.2.0 | Atual |
| @nestjs/passport | ^10.0.3 | Atual |
| @nestjs/platform-express | ^10.4.15 | Atual |
| bcrypt | ^5.1.1 | Atual; **F-24**: considerar rounds=12 |
| class-validator | ^0.15.1 | Atual |
| class-transformer | ^0.5.1 | Atual |
| pg | ^8.13.1 | Atual |
| ioredis | ^5.11.1 | Atual |
| mercadopago | ^3.4.0 | Atual |
| resend | ^6.20.0 | Atual |
| google-auth-library | ^10.9.1 | Atual |
| exceljs | ^4.4.0 | OK (apenas leitura/escrita controlada) |
| mammoth | ^1.12.2 | OK (extração de texto de DOCX) |
| pdf-parse | ^2.4.5 | OK (extração de texto de PDF) |
| basic-ftp | ^6.2.1 | OK (sync CAEPI) |
| **helmet** | **AUSENTE** | **F-20** — instalar |

### Frontend (`/opt/Montese/frontend/package.json`)

| Pacote | Versão | Notas |
| --- | --- | --- |
| next | ^14.2.18 | Atual |
| react | ^18.3.1 | Atual |
| gray-matter | ^4.0.3 | OK (parser frontmatter) |
| next-mdx-remote | ^6.0.0 | OK (conteúdo institucional) |
| tailwindcss | ^4.3.3 | Atual |

> **Observação:** frontend tem superfície de ataque mínima (sem axios, sem cliente HTTP dedicado). Recomenda-se confirmar que toda chamada ao backend passa pelo proxy nginx (`NEXT_PUBLIC_API_URL=/api`) e nunca usa URL absoluta — já está configurado em docker-compose.yml.

---

## 9. Anexo B — Referências normativas

- **OWASP API Security Top 10 (2023)**: API1 (BOLA), API2 (Broken Auth), API3 (BOPLA), API4 (Resource Consumption), API5 (Function-level Auth), API8 (Misconfiguration).
- **OWASP ASVS 4.0**: V2 (Authentication), V3 (Session Management), V5 (Validation), V6 (Cryptography), V9 (Communications), V14 (Configuration).
- **LGPD (Lei 13.709/2018)**: dados de funcionários em SST são dados pessoais sensíveis (art. 5º, II); exige base legal específica, retenção limitada, criptografia em repouso e em trânsito.
- **NIST SP 800-63B**: digital identity guidelines — recomenda bcrypt cost factor ≥ 10 (atendido), Argon2id preferível para sistemas novos.
- **PCI-DSS v4.0** (se aplicável): integração MercadoPago + webhook handling segue boas práticas (HMAC, idempotência, não confiar no body).

---

## 10. Anexo C — Comandos de verificação pós-fix

```bash
# F-15 — DTO + global pipe
curl -i -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email": 1, "password": null}'
# esperado: 400 com mensagem de validação (não 500)

# F-19 — CORS
curl -i -H 'Origin: https://evil.com' http://localhost:4000/api/auth/me
# esperado: resposta SEM 'Access-Control-Allow-Origin: *'

# F-20 — headers
curl -I https://montesesst.com.br/api/health
# esperado: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy presentes

# F-21 — fail-fast
docker run --rm -e NODE_ENV=production montese/backend
# sem JWT_SECRET: container deve exit(1) com mensagem clara, NÃO subir

# F-27 — Google OAuth fail-fast (sem docker, só localmente, pois o
# provider é instanciado no boot do NestJS):
NODE_ENV=development npm run start:dev
# sem GOOGLE_CLIENT_ID/SECRET no .env: erro imediato no NestJS
# apontando exatamente a(s) var(s) faltando(s) — NÃO subir
#
# Repetir o teste confirmando o caminho feliz:
# GOOGLE_CLIENT_ID=<id-real> GOOGLE_CLIENT_SECRET=<secret-real> npm run start:dev
# esperado: backend sobe, rota /api/health retorna 200

# F-11 — cross-tenant (smoke)
TOKEN_A=…; TOKEN_B=…
curl -i -X POST http://localhost:4000/api/documents/upload \
  -H "Authorization: Bearer $TOKEN_A" \
  -F "tenant_id=<uuid do tenant B>" -F "file=@/tmp/logo.png"
# esperado: 403 Forbidden

# F-17 — confirm rate-limit
for i in $(seq 1 100); do
  curl -s -o /dev/null -w '%{http_code}\n' \
    "http://localhost:4000/api/auth/confirm?token=invalid"
done
# esperado: primeiros 30 = 200/erro; depois = 429
```

---

## 11. Histórico

- **2026-09-22**: primeira versão da auditoria pré-produção. Cobre 14 achados numerados (F-11..F-26), sendo 3 P0 (F-15, F-20, F-21), 2 P1 (F-19, F-22), 2 P2 (F-17, F-26), 5 P3 (F-16, F-18, F-23, F-24, F-25), e 2 verificados seguros por revisão de código (F-11, F-14).
- **2026-09-22 (PR 1)**: fechamento de F-15 (`ValidationPipe` + decorators `LoginDto`), F-19 (allowlist CORS), F-20 (`helmet` + `add_header` nginx), F-21 (`validateProductionEnv` centralizado + remoção dos fallbacks `JWT_SECRET ||`). 10 arquivos / +759/-6.
- **2026-09-22 (PR 2)**: fechamento de F-22 (fallback local no `RateLimitGuard` quando Redis cai — `localBuckets` LRU com cap 60 req/min/IP). 2 arquivos / +209/-9. Inclui teste unit novo (`rate-limit-fallback.unit-spec.ts`, 4 cenários).
- **2026-09-23 (PR 3)**: achado novo F-27 adicionado em §4.2 P1 (fallback hardcoded em `google-oauth-calendar-client.service.ts`, falha de cobertura do grep do PR 1). Fechamento: constructor fail-fast com mensagem explícita apontando a(s) var(s) faltando(s), documento `.env.example` adicionado bloco Google Calendar com 4 vars (`GOOGLE_CLIENT_ID`/`SECRET`/`TOKEN_ENCRYPTION_KEY`/`APP_BASE_URL`), 2 testes e2e existentes atualizados para setar as vars no `beforeAll` (mesmo padrão já usado para `GOOGLE_TOKEN_ENCRYPTION_KEY`), 1 teste unit novo (`google-oauth-calendar-client-constructor.unit-spec.ts`, 4 cenários — todos passam). Decisão consciente de quebrar o padrão `R2Service`/`EmailService` registrada em §F-27 (erro do Google OAuth é opaco, `'invalid_client'` não distingue "chave errada" de "chave ausente"). 6 arquivos / +210/-12 (5 modificados + 1 novo). Suite unit: 387 pass / 18 falhas (todas pre-existing: 8 suites — pdf-text, pdf-text-full, r2-get-object, pente-fino-{extractor,comparison}, lip-agent-extractor, document-checklist-extractor, company-document-indexer — todas relacionadas a infra externa em ambiente sandbox).
- **Próxima revisão**: 30 dias após go-live (ou após correção dos P0, o que vier primeiro).

---

**Auditor:** revisão técnica estática manual (sem ferramenta SAST comercial integrada).
**Próxima ação:** abertura de ticket P0 e execução do PR 1 antes do deploy em produção.
