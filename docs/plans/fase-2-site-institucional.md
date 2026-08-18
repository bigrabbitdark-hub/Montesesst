# Fase 2 — Site Institucional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o site público do Montese (Home, Planos, Notícias, Contato, Cadastro) e o primeiro fluxo real de auto-cadastro da plataforma (criação de tenant+user com confirmação por e-mail), substituindo o frontend placeholder atual.

**Architecture:** Backend NestJS ganha dois endpoints públicos novos (`POST /auth/register`, `GET /auth/confirm`) e um módulo `Contact` (`POST /contact`), todos reaproveitando o `RateLimitGuard`/`AuditService`/`DatabaseService` já existentes; duas funções Postgres `SECURITY DEFINER` novas (mesmo padrão de `auth_find_user_by_email`) permitem o INSERT/UPDATE em `users` sem contexto de tenant, contornando a RLS que hoje bloquearia um cadastro anônimo. Frontend ganha Tailwind CSS, um layout institucional compartilhado (`SiteLayout`) aplicado via route group `(site)` do Next.js App Router (não afeta `/login`, que fica fora do grupo), e as páginas novas consomem os endpoints via `fetch` contra `/api/...` (nginx já roteia `/api/` pro backend).

**Tech Stack:** Next.js 14 (App Router) + Tailwind CSS + `next-mdx-remote`/`gray-matter` (frontend); NestJS + `class-validator`/`class-transformer` + `resend` (backend); PostgreSQL 16 com RLS; Docker Compose real desta VPS (mesmo ambiente de produção, sem staging separado).

**Spec:** [`docs/specs/fase-2-site-institucional.md`](../specs/fase-2-site-institucional.md)

## Global Constraints

- **Nunca apresentar mock como funcional** — toda validação final de cada task roda contra os containers Docker reais (Postgres/Redis reais via `docker run --network montese_internal`, ou os containers de produção já rodando). Ver `docs/roadmap.md` regra não-negociável.
- **RLS em toda tabela desde o dia 1** — qualquer INSERT/UPDATE sem contexto de tenant/role autenticado (como o cadastro público) precisa de uma função `SECURITY DEFINER` dedicada, dona `montese_auth_bypass` (já existe, `postgres/init/01-app-role.sh`) — nunca conceder `BYPASSRLS` a `montese_app` diretamente.
- **Documentos nunca no disco da VPS** — não se aplica a esta fase (nenhum upload), mas nenhuma task deve gravar arquivo de usuário em disco.
- **Confirmar antes de codificar upload** — não se aplica (sem upload nesta fase).
- **Nunca commitar segredo** — `RESEND_API_KEY` e demais credenciais só em `.env` (gitignored), nunca em `.env.example` (que fica com placeholder ou vazio).
- **Validação nova só nos DTOs novos** — `class-validator`/`ValidationPipe` aplicado via `@UsePipes` local nos controllers desta fase, nunca como pipe global (não muda comportamento de rotas existentes).
- **Sem teste automatizado de UI** — o ambiente não tem browser real disponível (mesma ressalva já registrada pro login da Fase 1). Tasks de frontend verificam via build + `curl` contra o servidor real (Next dev/prod), e terminam pedindo confirmação visual manual.

---

### Task 1: `EmailService` (wrapper do Resend) + utilitário de escape de HTML

**Files:**
- Create: `backend/src/common/html-escape.util.ts`
- Create: `backend/src/common/email/email.service.ts`
- Create: `backend/src/common/email/email.module.ts`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: nenhuma (task fundação, sem consumidor ainda).
- Produces:
  - `escapeHtml(value: string): string` (`common/html-escape.util.ts`)
  - `EmailService.send(input: { to: string; subject: string; html: string }): Promise<void>` — classe injetável, exportada por `EmailModule` (`@Global()`), consumida pelas Tasks 2, 3 e 4.

- [ ] **Step 1: Instalar as dependências novas**

Rodar (mesmo padrão já usado nas fases anteriores — container Node oficial montando o diretório do backend):

```bash
docker run --rm -v "$(pwd)/backend:/app" -w /app node:20-alpine npm install resend
```

Confirmar que `backend/package.json` e `backend/package-lock.json` foram atualizados com `resend` em `dependencies`.

- [ ] **Step 2: Criar o utilitário de escape de HTML**

`backend/src/common/html-escape.util.ts`:

```typescript
// Escapa entidades HTML em texto de usuário antes de interpolar em corpo de
// e-mail (Tasks 2 e 4 inserem full_name/nome/mensagem digitados pelo
// visitante do site dentro de HTML) — sem isso, um campo malicioso poderia
// injetar markup no e-mail recebido.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

- [ ] **Step 3: Criar o `EmailService`**

`backend/src/common/email/email.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

// Único ponto de envio de e-mail da aplicação (confirmação de cadastro,
// Task 2/3; formulário de Contato, Task 4). Decisão confirmada com o
// fundador (docs/specs/fase-2-site-institucional.md seção 8): API
// transacional externa (Resend), mesma filosofia já usada pro R2 —
// infra gerenciada em vez de SMTP frágil rodando na própria VPS.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);

  async send(input: SendEmailInput): Promise<void> {
    try {
      await this.resend.emails.send({
        from: process.env.EMAIL_FROM as string,
        to: input.to,
        subject: input.subject,
        html: input.html,
      });
    } catch (err) {
      // Nunca deixa passar em silêncio — quem chama decide se um e-mail que
      // falhou deve derrubar a requisição (cadastro, Task 2) ou só logar
      // (não há um terceiro caso nesta fase).
      this.logger.error(`Falha ao enviar e-mail para ${input.to}`, (err as Error).stack);
      throw err;
    }
  }
}
```

- [ ] **Step 4: Criar o módulo**

`backend/src/common/email/email.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
```

- [ ] **Step 5: Adicionar variáveis de ambiente novas**

Em `.env.example`, adicionar após o bloco de rate limiting já existente:

```bash
# E-mail transacional (Resend) — ver docs/specs/fase-2-site-institucional.md
RESEND_API_KEY=
EMAIL_FROM=Montese SST <naoresponda@montesesst.com.br>
CONTACT_EMAIL_TO=
# URL pública onde o nginx atende — usada só pra montar o link absoluto do
# e-mail de confirmação de cadastro (Task 3). Em produção PRECISA apontar
# pro IP/domínio real desta VPS, senão o link do e-mail fica quebrado.
PUBLIC_APP_URL=http://localhost

# Rate limiting de cadastro e contato — ver docs/specs/fase-2-site-institucional.md
REGISTER_RATE_LIMIT_MAX=5
REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600
CONTACT_RATE_LIMIT_MAX=10
CONTACT_RATE_LIMIT_WINDOW_SECONDS=3600
```

Em `docker-compose.yml`, no bloco `environment:` do serviço `backend`, adicionar:

```yaml
      RESEND_API_KEY: ${RESEND_API_KEY}
      EMAIL_FROM: ${EMAIL_FROM}
      CONTACT_EMAIL_TO: ${CONTACT_EMAIL_TO}
      PUBLIC_APP_URL: ${PUBLIC_APP_URL:-http://localhost}
      REGISTER_RATE_LIMIT_MAX: ${REGISTER_RATE_LIMIT_MAX:-5}
      REGISTER_RATE_LIMIT_WINDOW_SECONDS: ${REGISTER_RATE_LIMIT_WINDOW_SECONDS:-3600}
      CONTACT_RATE_LIMIT_MAX: ${CONTACT_RATE_LIMIT_MAX:-10}
      CONTACT_RATE_LIMIT_WINDOW_SECONDS: ${CONTACT_RATE_LIMIT_WINDOW_SECONDS:-3600}
```

- [ ] **Step 6: Build para confirmar que compila**

Sem consumidor ainda nesta task — a verificação é o build TypeScript passando limpo (a funcionalidade real é exercitada pelas Tasks 2/3/4 via dublê de teste, e por um envio manual real na Task 12).

```bash
docker run --rm -v "$(pwd)/backend:/app" -w /app node:20-alpine npm run build
```

Esperado: build sem erros.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/common/html-escape.util.ts backend/src/common/email .env.example docker-compose.yml
git commit -m "feat: adiciona EmailService (Resend) — fundação da Fase 2"
```

---

### Task 2: `POST /auth/register` — cria tenant + user pendentes

**Files:**
- Create: `backend/db/migrations/0003_register_function.sql`
- Create: `backend/src/common/validators/cnpj.util.ts`
- Create: `backend/src/common/validators/is-valid-cnpj.decorator.ts`
- Create: `backend/src/auth/dto/register.dto.ts`
- Create: `backend/src/auth/registration.service.ts`
- Modify: `backend/src/auth/auth.module.ts`
- Modify: `backend/src/auth/auth.controller.ts`
- Test: `backend/test/register.e2e-spec.ts`

**Interfaces:**
- Consumes: `EmailService.send(...)` (Task 1); `DatabaseService.withoutTenantContext` (existente); `AuditService.log` (existente); `mapPgError` (existente, `common/pg-error.util.ts`); `RateLimit`/`envInt` (existentes, `common/rate-limit/`, `common/env.ts`).
- Produces:
  - `isValidCnpj(value: string): boolean` (`common/validators/cnpj.util.ts`)
  - `RegistrationService.register(input: { companyName: string; cnpj: string; fullName: string; email: string; password: string; ip?: string }): Promise<void>` — consumido pela Task 3 (mesmo arquivo, método `confirm` adicionado lá) e pela Task 12.
  - Função Postgres `auth_register_tenant_and_user(p_company_name, p_cnpj, p_email, p_password_hash, p_full_name) RETURNS TABLE(tenant_id UUID, user_id UUID)`.

**Por que precisa de uma função `SECURITY DEFINER`:** a tabela `users` tem `FORCE ROW LEVEL SECURITY` com a policy `users_isolation` (`backend/db/migrations/0001_init.sql:51`), que exige `app.role = 'admin'` OU `id`/`tenant_id` batendo com o contexto atual — e um cadastro público não tem *nenhum* contexto ainda (é exatamente o que está sendo criado). Uma inserção direta via `montese_app` seria bloqueada pela RLS. `auth_find_user_by_email` (já existente, mesma migration) resolve o mesmo problema pro lado de leitura do login; esta task cria o equivalente pra escrita, com o mesmo dono (`montese_auth_bypass`, role `NOLOGIN BYPASSRLS` que já existe em `postgres/init/01-app-role.sh`).

- [ ] **Step 1: Criar a migration com a função `SECURITY DEFINER`**

`backend/db/migrations/0003_register_function.sql`:

```sql
-- auth_register_tenant_and_user: cria tenant + user 'empresa' pendentes numa
-- única operação atômica (statement único = transação implícita), sem exigir
-- contexto de tenant/role — é o que está sendo criado. Mesma técnica de
-- auth_find_user_by_email (0001_init.sql): SECURITY DEFINER + dono
-- montese_auth_bypass (NOLOGIN BYPASSRLS, criado em postgres/init/01-app-role.sh).
-- CNPJ/e-mail duplicado propaga a violação de UNIQUE normalmente (SQLSTATE
-- 23505) — RegistrationService.register (Task 2) trata isso com mapPgError,
-- igual ao resto do backend.
CREATE FUNCTION auth_register_tenant_and_user(
  p_company_name TEXT,
  p_cnpj TEXT,
  p_email TEXT,
  p_password_hash TEXT,
  p_full_name TEXT
) RETURNS TABLE(tenant_id UUID, user_id UUID) AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
BEGIN
  INSERT INTO tenants (name, cnpj, plan, status)
  VALUES (p_company_name, p_cnpj, 'trial', 'pendente')
  RETURNING id INTO v_tenant_id;

  INSERT INTO users (tenant_id, role, email, password_hash, full_name, status)
  VALUES (v_tenant_id, 'empresa', p_email, p_password_hash, p_full_name, 'pendente')
  RETURNING id INTO v_user_id;

  RETURN QUERY SELECT v_tenant_id, v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION auth_register_tenant_and_user(TEXT, TEXT, TEXT, TEXT, TEXT) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_register_tenant_and_user(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_register_tenant_and_user(TEXT, TEXT, TEXT, TEXT, TEXT) TO montese_app;
```

- [ ] **Step 2: Aplicar a migration no Postgres real e confirmar via `psql` real**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate
```

Esperado no output: `[applied] 0003_register_function.sql` (ou equivalente do script de migração).

Confirmar que a função existe de verdade:

```bash
docker exec -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c "\df auth_register_tenant_and_user"
```

Esperado: uma linha listando a função, owner `montese_auth_bypass`.

- [ ] **Step 3: Criar o validador de CNPJ**

`backend/src/common/validators/cnpj.util.ts`:

```typescript
// Algoritmo padrão de validação de CNPJ (dígito verificador, módulo 11).
// Exemplo real usado nos testes (Task 2, register.e2e-spec.ts): 11222333000181
// é matematicamente válido por este algoritmo (conferido manualmente antes
// de escrever este arquivo, não é um número "de exemplo" arbitrário).
export function isValidCnpj(rawValue: string): boolean {
  const digits = rawValue.replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calcCheckDigit = (base: string): number => {
    const weights =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base
      .split('')
      .reduce((acc, digit, idx) => acc + parseInt(digit, 10) * weights[idx], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const base = digits.slice(0, 12);
  const digit1 = calcCheckDigit(base);
  const digit2 = calcCheckDigit(base + digit1);
  return digits === `${base}${digit1}${digit2}`;
}

// CNPJ limpo (só dígitos) — usado pelo RegisterDto (Task 2) pra normalizar
// antes de validar e antes de gravar no banco (coluna VARCHAR(14)).
export function onlyDigits(rawValue: string): string {
  return rawValue.replace(/\D/g, '');
}
```

- [ ] **Step 4: Criar o decorator de `class-validator`**

`backend/src/common/validators/is-valid-cnpj.decorator.ts`:

```typescript
import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { isValidCnpj } from './cnpj.util';

export function IsValidCnpj(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidCnpj',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isValidCnpj(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} não é um CNPJ válido`;
        },
      },
    });
  };
}
```

- [ ] **Step 5: Criar o `RegisterDto`**

`backend/src/auth/dto/register.dto.ts`:

```typescript
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { IsValidCnpj } from '../../common/validators/is-valid-cnpj.decorator';
import { onlyDigits } from '../../common/validators/cnpj.util';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  company_name: string;

  // Aceita CNPJ com ou sem máscara — normaliza pra só dígitos antes de
  // validar o dígito verificador e antes de gravar (coluna VARCHAR(14)).
  @Transform(({ value }) => (typeof value === 'string' ? onlyDigits(value) : value))
  @IsValidCnpj()
  cnpj: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  full_name: string;

  @IsEmail()
  email: string;

  // bcrypt trunca senha acima de 72 bytes — 72 como teto evita truncamento
  // silencioso que faria a senha "guardada" ser mais curta que a digitada.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
```

- [ ] **Step 6: Criar o `RegistrationService` (só `register` por enquanto — `confirm` entra na Task 3)**

`backend/src/auth/registration.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../common/database/database.service';
import { AuditService } from '../common/audit/audit.service';
import { EmailService } from '../common/email/email.service';
import { escapeHtml } from '../common/html-escape.util';
import { mapPgError } from '../common/pg-error.util';

export interface RegisterInput {
  companyName: string;
  cnpj: string;
  fullName: string;
  email: string;
  password: string;
  ip?: string;
}

// Claim distinto de token de sessão — usado pela Task 3 (confirm) pra
// garantir que um token de confirmação nunca seja confundido com outro tipo
// de JWT assinado com o mesmo JWT_SECRET.
export const CONFIRMATION_TOKEN_PURPOSE = 'email_confirmation';

@Injectable()
export class RegistrationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  async register(input: RegisterInput): Promise<void> {
    const passwordHash = await bcrypt.hash(input.password, 10);

    const { tenantId, userId } = await this.db.withoutTenantContext(async (client) => {
      try {
        const result = await client.query<{ tenant_id: string; user_id: string }>(
          'SELECT * FROM auth_register_tenant_and_user($1, $2, $3, $4, $5)',
          [input.companyName, input.cnpj, input.email, passwordHash, input.fullName],
        );
        return { tenantId: result.rows[0].tenant_id, userId: result.rows[0].user_id };
      } catch (err) {
        mapPgError(err);
      }
    });

    void this.audit.log({
      actorUserId: userId,
      actorRole: 'empresa',
      actorTenantId: tenantId,
      action: 'register',
      resourceType: 'auth',
      resourceId: userId,
      method: 'POST',
      path: '/auth/register',
      statusCode: 201,
      ipAddress: input.ip,
    });

    const token = this.jwt.sign(
      { sub: userId, purpose: CONFIRMATION_TOKEN_PURPOSE },
      { expiresIn: '48h' },
    );
    const confirmUrl = `${process.env.PUBLIC_APP_URL}/api/auth/confirm?token=${token}`;

    await this.email.send({
      to: input.email,
      subject: 'Confirme seu cadastro — Montese SST',
      html: `<p>Olá, ${escapeHtml(input.fullName)}!</p>
<p>Confirme seu cadastro no Montese SST clicando no link abaixo (válido por 48 horas):</p>
<p><a href="${confirmUrl}">Confirmar cadastro</a></p>`,
    });
  }
}
```

- [ ] **Step 7: Registrar o serviço no `AuthModule`**

Editar `backend/src/auth/auth.module.ts` — adicionar `RegistrationService` aos `providers`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret-change-me',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RegistrationService, JwtStrategy],
})
export class AuthModule {}
```

- [ ] **Step 8: Adicionar `POST /auth/register` ao controller**

Editar `backend/src/auth/auth.controller.ts`:

```typescript
import { Body, Controller, Get, Post, Query, Req, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Public } from '../common/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly registrationService: RegistrationService,
  ) {}

  @Public()
  @RateLimit({
    limit: envInt('AUTH_RATE_LIMIT_MAX', 10),
    windowSeconds: envInt('AUTH_RATE_LIMIT_WINDOW_SECONDS', 900),
    keyBy: 'ip-email',
  })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.authService.login(dto.email, dto.password, req.ip);
  }

  @Public()
  @RateLimit({
    limit: envInt('REGISTER_RATE_LIMIT_MAX', 5),
    windowSeconds: envInt('REGISTER_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: any) {
    await this.registrationService.register({
      companyName: dto.company_name,
      cnpj: dto.cnpj,
      fullName: dto.full_name,
      email: dto.email,
      password: dto.password,
      ip: req.ip,
    });
    return { message: 'Cadastro recebido — verifique seu e-mail para confirmar.' };
  }

  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }
}
```

(`GET /auth/confirm` entra na Task 3 — deixando o import de `Query`/`Res`/`Response` já preparado aqui evita reabrir este bloco de imports de novo.)

- [ ] **Step 9: Escrever os testes e2e (vão falhar — `EmailService` real não pode ser chamado em teste)**

`backend/test/register.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/common/email/email.service';

const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;

function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 10);
  return out;
}

// CNPJ matematicamente válido (dígito verificador conferido manualmente —
// ver comentário em common/validators/cnpj.util.ts).
const VALID_CNPJ = '11222333000181';

describe('Cadastro — POST /auth/register (e2e)', () => {
  let app: INestApplication;
  let db: Client;
  const fakeEmail = { send: jest.fn().mockResolvedValue(undefined) };
  const createdCnpjs: string[] = [];
  const createdEmails: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(fakeEmail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new Client({ connectionString: SUPERUSER_URL });
    await db.connect();
  });

  afterEach(() => {
    fakeEmail.send.mockClear();
  });

  afterAll(async () => {
    if (createdCnpjs.length) {
      await db.query('DELETE FROM tenants WHERE cnpj = ANY($1)', [createdCnpjs]);
    }
    await db.end();
    await app.close();
  });

  it('cria tenant e user pendentes, e dispara o e-mail de confirmação', async () => {
    const email = `cadastro-${randomUUID()}@teste.montese.local`;
    createdCnpjs.push(VALID_CNPJ);
    createdEmails.push(email);

    const res = await request(app.getHttpServer()).post('/auth/register').send({
      company_name: 'Empresa Teste Cadastro',
      cnpj: VALID_CNPJ,
      full_name: 'Responsável Teste',
      email,
      password: 'senha-segura-123',
    });

    expect(res.status).toBe(201);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
    expect(fakeEmail.send.mock.calls[0][0].to).toBe(email);

    const row = await db.query(
      `SELECT t.status AS tenant_status, u.status AS user_status
       FROM tenants t JOIN users u ON u.tenant_id = t.id
       WHERE t.cnpj = $1`,
      [VALID_CNPJ],
    );
    expect(row.rows[0]).toMatchObject({ tenant_status: 'pendente', user_status: 'pendente' });
  });

  it('rejeita CNPJ com dígito verificador inválido com 400', async () => {
    const res = await request(app.getHttpServer()).post('/auth/register').send({
      company_name: 'Empresa Inválida',
      cnpj: '11222333000180',
      full_name: 'X',
      email: `invalido-${randomUUID()}@teste.montese.local`,
      password: 'senha-segura-123',
    });
    expect(res.status).toBe(400);
    expect(fakeEmail.send).not.toHaveBeenCalled();
  });

  it('rejeita CNPJ duplicado com 409', async () => {
    const cnpj = randomDigits(14);
    createdCnpjs.push(cnpj);
    const first = { company_name: 'Original', cnpj, full_name: 'A', email: `a-${randomUUID()}@teste.montese.local`, password: 'senha-segura-123' };
    await request(app.getHttpServer()).post('/auth/register').send(first).expect(201);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...first, email: `b-${randomUUID()}@teste.montese.local` });
    expect(res.status).toBe(409);
  });

  it('rejeita e-mail duplicado com 409', async () => {
    const email = `dup-${randomUUID()}@teste.montese.local`;
    const cnpjA = randomDigits(14);
    const cnpjB = randomDigits(14);
    createdCnpjs.push(cnpjA, cnpjB);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ company_name: 'A', cnpj: cnpjA, full_name: 'A', email, password: 'senha-segura-123' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ company_name: 'B', cnpj: cnpjB, full_name: 'B', email, password: 'senha-segura-123' });
    expect(res.status).toBe(409);
  });

  it('bloqueia com 429 depois do limite de cadastros por IP', async () => {
    const limit = parseInt(process.env.REGISTER_RATE_LIMIT_MAX ?? '5', 10);
    for (let i = 0; i < limit; i++) {
      const cnpj = randomDigits(14);
      createdCnpjs.push(cnpj);
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          company_name: `Rate ${i}`,
          cnpj,
          full_name: 'X',
          email: `rate-${randomUUID()}@teste.montese.local`,
          password: 'senha-segura-123',
        });
    }
    const res = await request(app.getHttpServer()).post('/auth/register').send({
      company_name: 'Estourou',
      cnpj: randomDigits(14),
      full_name: 'X',
      email: `estourou-${randomUUID()}@teste.montese.local`,
      password: 'senha-segura-123',
    });
    expect(res.status).toBe(429);
  });
});
```

> **Nota sobre TDD nesta task:** diferente do padrão "teste primeiro" das
> tasks mais simples deste plano, aqui a implementação (Steps 1–8: migration,
> validador, DTO, service, controller) precisa existir antes de um teste
> e2e conseguir exercitar algo além de erro de conexão/rota inexistente —
> é uma característica de testar no nível de HTTP/e2e contra infra real
> (não unitário), não um desvio de disciplina. O Step 10 é o "verde" real:
> primeira execução dos testes escritos no Step 9 contra a implementação
> completa.

- [ ] **Step 10: Rodar os testes e confirmar que passam contra Postgres/Redis reais**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e PUBLIC_APP_URL="http://localhost" \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
  -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/register.e2e-spec.ts"
```

Esperado: 5/5 testes passando.

- [ ] **Step 11: Commit**

```bash
git add backend/db/migrations/0003_register_function.sql backend/src/common/validators backend/src/auth backend/test/register.e2e-spec.ts
git commit -m "feat: adiciona POST /auth/register (cadastro cria tenant+user pendentes)"
```

---

### Task 3: `GET /auth/confirm` — ativa tenant + user

**Files:**
- Create: `backend/db/migrations/0004_confirm_email_function.sql`
- Modify: `backend/src/auth/registration.service.ts`
- Modify: `backend/src/auth/auth.controller.ts`
- Test: `backend/test/register.e2e-spec.ts`

**Interfaces:**
- Consumes: `RegistrationService` (Task 2, mesmo arquivo); `CONFIRMATION_TOKEN_PURPOSE` (Task 2); `JwtService` (já injetado).
- Produces: `RegistrationService.confirm(token: string): Promise<'ok' | 'erro'>` — consumido pelo controller nesta task e pela Task 12 (smoke test manual).

- [ ] **Step 1: Criar a migration com a função de ativação**

`backend/db/migrations/0004_confirm_email_function.sql`:

```sql
-- auth_confirm_email: ativa tenant+user depois da confirmação por e-mail.
-- Mesmo motivo de SECURITY DEFINER que auth_register_tenant_and_user
-- (0003_register_function.sql) — UPDATE em users também é bloqueado pela
-- RLS sem contexto de tenant/role. Idempotente por natureza: rodar duas
-- vezes com o mesmo p_user_id não quebra nada (RETURNING sempre traz a
-- linha, esteja ela indo de 'pendente' pra 'ativo' ou já 'ativo').
CREATE FUNCTION auth_confirm_email(p_user_id UUID)
RETURNS TABLE(user_id UUID, tenant_id UUID) AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  UPDATE users SET status = 'ativo'
  WHERE id = p_user_id AND role = 'empresa'
  RETURNING users.tenant_id INTO v_tenant_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE tenants SET status = 'ativo' WHERE id = v_tenant_id;

  RETURN QUERY SELECT p_user_id, v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION auth_confirm_email(UUID) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_confirm_email(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_confirm_email(UUID) TO montese_app;
```

- [ ] **Step 2: Aplicar a migration e confirmar via `psql` real**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate

docker exec -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c "\df auth_confirm_email"
```

Esperado: `[applied] 0004_confirm_email_function.sql` e a função listada com owner `montese_auth_bypass`.

- [ ] **Step 3: Adicionar `confirm` ao `RegistrationService`**

Editar `backend/src/auth/registration.service.ts` — adicionar o método dentro da classe `RegistrationService` (depois de `register`):

```typescript
  async confirm(token: string): Promise<'ok' | 'erro'> {
    let payload: { sub: string; purpose: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      return 'erro';
    }
    if (payload.purpose !== CONFIRMATION_TOKEN_PURPOSE) return 'erro';

    const result = await this.db.withoutTenantContext((client) =>
      client.query<{ user_id: string; tenant_id: string | null }>(
        'SELECT * FROM auth_confirm_email($1)',
        [payload.sub],
      ),
    );
    const activated = result.rows[0];
    if (!activated) return 'erro';

    void this.audit.log({
      actorUserId: activated.user_id,
      actorRole: 'empresa',
      actorTenantId: activated.tenant_id,
      action: 'email_confirmed',
      resourceType: 'auth',
      resourceId: activated.user_id,
      method: 'GET',
      path: '/auth/confirm',
      statusCode: 200,
    });

    return 'ok';
  }
```

- [ ] **Step 4: Adicionar `GET /auth/confirm` ao controller**

Editar `backend/src/auth/auth.controller.ts` — adicionar dentro da classe `AuthController`, depois de `register`:

```typescript
  @Public()
  @Get('confirm')
  async confirm(@Query('token') token: string, @Res() res: Response) {
    const status = await this.registrationService.confirm(token);
    res.redirect(302, `/cadastro/confirmado?status=${status}`);
  }
```

(`Query`, `Res` e `Response` já foram importados na Task 2, Step 8.)

- [ ] **Step 5: Adicionar os testes e2e ao mesmo arquivo da Task 2**

Adicionar ao final de `backend/test/register.e2e-spec.ts`, dentro do mesmo `describe` (antes do `});` final) — precisa de acesso ao `JwtService` real da aplicação pra gerar tokens de teste, obtido via `moduleRef.get(JwtService)`:

```typescript
  it('confirma o e-mail e ativa tenant+user; clicar duas vezes não quebra', async () => {
    const email = `confirmar-${randomUUID()}@teste.montese.local`;
    const cnpj = randomDigits(14);
    createdCnpjs.push(cnpj);

    await request(app.getHttpServer()).post('/auth/register').send({
      company_name: 'Empresa Confirmar',
      cnpj,
      full_name: 'Responsável',
      email,
      password: 'senha-segura-123',
    });

    const confirmUrl: string = fakeEmail.send.mock.calls[0][0].html.match(/href="([^"]+)"/)[1];
    const token = new URL(confirmUrl).searchParams.get('token') as string;

    const first = await request(app.getHttpServer()).get('/auth/confirm').query({ token });
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe('/cadastro/confirmado?status=ok');

    const row = await db.query(
      `SELECT t.status AS tenant_status, u.status AS user_status
       FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE t.cnpj = $1`,
      [cnpj],
    );
    expect(row.rows[0]).toMatchObject({ tenant_status: 'ativo', user_status: 'ativo' });

    const second = await request(app.getHttpServer()).get('/auth/confirm').query({ token });
    expect(second.status).toBe(302);
    expect(second.headers.location).toBe('/cadastro/confirmado?status=ok');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'senha-segura-123' });
    expect(loginRes.status).toBe(201);
  });

  it('token inválido ou expirado redireciona com status=erro', async () => {
    const jwt = app.get(JwtService);
    const expired = jwt.sign(
      { sub: randomUUID(), purpose: 'email_confirmation' },
      { expiresIn: '-10s' },
    );

    const resExpired = await request(app.getHttpServer()).get('/auth/confirm').query({ token: expired });
    expect(resExpired.status).toBe(302);
    expect(resExpired.headers.location).toBe('/cadastro/confirmado?status=erro');

    const resGarbage = await request(app.getHttpServer())
      .get('/auth/confirm')
      .query({ token: 'nao-e-um-jwt' });
    expect(resGarbage.status).toBe(302);
    expect(resGarbage.headers.location).toBe('/cadastro/confirmado?status=erro');
  });
```

Adicionar o import de `JwtService` no topo do arquivo:

```typescript
import { JwtService } from '@nestjs/jwt';
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e PUBLIC_APP_URL="http://localhost" \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
  -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/register.e2e-spec.ts"
```

Esperado: 7/7 testes passando (5 da Task 2 + 2 novos).

- [ ] **Step 7: Commit**

```bash
git add backend/db/migrations/0004_confirm_email_function.sql backend/src/auth backend/test/register.e2e-spec.ts
git commit -m "feat: adiciona GET /auth/confirm (ativação do cadastro por e-mail)"
```

---

### Task 4: `POST /contact`

**Files:**
- Create: `backend/src/contact/dto/contact.dto.ts`
- Create: `backend/src/contact/contact.service.ts`
- Create: `backend/src/contact/contact.controller.ts`
- Create: `backend/src/contact/contact.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/contact.e2e-spec.ts`

**Interfaces:**
- Consumes: `EmailService.send(...)` (Task 1); `escapeHtml` (Task 1); `RateLimit`/`envInt` (existentes).
- Produces: `ContactService.send(input: { name: string; email: string; message: string }): Promise<void>` — sem outro consumidor nesta fase além do próprio controller.

- [ ] **Step 1: Criar o `ContactDto`**

`backend/src/contact/dto/contact.dto.ts`:

```typescript
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class ContactDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message: string;
}
```

- [ ] **Step 2: Criar o `ContactService`**

`backend/src/contact/contact.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { EmailService } from '../common/email/email.service';
import { escapeHtml } from '../common/html-escape.util';

export interface ContactInput {
  name: string;
  email: string;
  message: string;
}

@Injectable()
export class ContactService {
  constructor(private readonly email: EmailService) {}

  async send(input: ContactInput): Promise<void> {
    const to = process.env.CONTACT_EMAIL_TO as string;
    await this.email.send({
      to,
      subject: `Novo contato pelo site — ${input.name}`,
      html: `<p><strong>Nome:</strong> ${escapeHtml(input.name)}</p>
<p><strong>E-mail:</strong> ${escapeHtml(input.email)}</p>
<p><strong>Mensagem:</strong></p>
<p>${escapeHtml(input.message).replace(/\n/g, '<br/>')}</p>`,
    });
  }
}
```

- [ ] **Step 3: Criar o `ContactController`**

`backend/src/contact/contact.controller.ts`:

```typescript
import { Body, Controller, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactDto } from './dto/contact.dto';
import { Public } from '../common/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Public()
  @RateLimit({
    limit: envInt('CONTACT_RATE_LIMIT_MAX', 10),
    windowSeconds: envInt('CONTACT_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  async create(@Body() dto: ContactDto) {
    await this.contact.send(dto);
    return { message: 'Mensagem enviada — retornaremos em breve.' };
  }
}
```

- [ ] **Step 4: Criar o `ContactModule` e importar no `AppModule`**

`backend/src/contact/contact.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
```

Editar `backend/src/app.module.ts` — adicionar o import e incluir `ContactModule` no array `imports`:

```typescript
import { ContactModule } from './contact/contact.module';
```

```typescript
  imports: [
    DatabaseModule,
    RedisModule,
    AuditModule,
    HealthModule,
    AuthModule,
    ContactModule,
    EmployeesModule,
    TechniciansModule,
    PartnersModule,
  ],
```

- [ ] **Step 5: Escrever o teste e2e**

`backend/test/contact.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/common/email/email.service';

describe('Contato — POST /contact (e2e)', () => {
  let app: INestApplication;
  const fakeEmail = { send: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(fakeEmail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => {
    fakeEmail.send.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('envia a mensagem por e-mail e devolve 201', async () => {
    const res = await request(app.getHttpServer()).post('/contact').send({
      name: 'Visitante Teste',
      email: 'visitante@teste.montese.local',
      message: 'Mensagem de teste com mais de dez caracteres.',
    });

    expect(res.status).toBe(201);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
    expect(fakeEmail.send.mock.calls[0][0].to).toBe(process.env.CONTACT_EMAIL_TO);
    expect(fakeEmail.send.mock.calls[0][0].html).toContain('Visitante Teste');
  });

  it('escapa HTML no nome e na mensagem (proteção contra injeção)', async () => {
    await request(app.getHttpServer()).post('/contact').send({
      name: '<script>alert(1)</script>',
      email: 'visitante@teste.montese.local',
      message: 'Mensagem com <b>html</b> de propósito, mais de dez caracteres.',
    });

    const html = fakeEmail.send.mock.calls[0][0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejeita mensagem muito curta com 400', async () => {
    const res = await request(app.getHttpServer()).post('/contact').send({
      name: 'X',
      email: 'visitante@teste.montese.local',
      message: 'curta',
    });
    expect(res.status).toBe(400);
    expect(fakeEmail.send).not.toHaveBeenCalled();
  });

  it('bloqueia com 429 depois do limite por IP', async () => {
    const limit = parseInt(process.env.CONTACT_RATE_LIMIT_MAX ?? '10', 10);
    for (let i = 0; i < limit; i++) {
      await request(app.getHttpServer()).post('/contact').send({
        name: `Teste ${i}`,
        email: 'visitante@teste.montese.local',
        message: 'Mensagem de teste com mais de dez caracteres.',
      });
    }
    const res = await request(app.getHttpServer()).post('/contact').send({
      name: 'Estourou',
      email: 'visitante@teste.montese.local',
      message: 'Mensagem de teste com mais de dez caracteres.',
    });
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e CONTACT_EMAIL_TO="comercial@teste.montese.local" \
  -e CONTACT_RATE_LIMIT_MAX=10 -e CONTACT_RATE_LIMIT_WINDOW_SECONDS=3600 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/contact.e2e-spec.ts"
```

Esperado: 4/4 testes passando.

- [ ] **Step 7: Rodar a suíte e2e completa (garantir que nada quebrou)**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e PUBLIC_APP_URL="http://localhost" \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
  -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
  -e CONTACT_EMAIL_TO="comercial@teste.montese.local" \
  -e CONTACT_RATE_LIMIT_MAX=10 -e CONTACT_RATE_LIMIT_WINDOW_SECONDS=3600 \
  node:20-alpine sh -c "npm run test:e2e"
```

Esperado: todos os testes (Fase 1 + rate limiting + register + contact) passando juntos.

- [ ] **Step 8: Commit**

```bash
git add backend/src/contact backend/src/app.module.ts backend/test/contact.e2e-spec.ts
git commit -m "feat: adiciona POST /contact (formulário de contato via e-mail)"
```

---

### Task 5: Fundação do frontend — Tailwind, tema, `Logo`, `SiteLayout`

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.js`
- Create: `frontend/src/app/globals.css`
- Modify: `frontend/src/app/layout.tsx`
- Create: `frontend/src/components/Logo.tsx`
- Create: `frontend/src/components/SiteHeader.tsx`
- Create: `frontend/src/components/SiteFooter.tsx`
- Create: `frontend/src/components/SiteLayout.tsx`
- Create: `frontend/src/app/(site)/layout.tsx`
- Move: `frontend/src/app/page.tsx` → `frontend/src/app/(site)/page.tsx`

**Interfaces:**
- Consumes: nenhuma.
- Produces: `<Logo />`, `<SiteHeader />`, `<SiteFooter />`, `<SiteLayout>{children}</SiteLayout>` (`@/components/*`) — consumidos pelas Tasks 6, 7, 8, 9, 10 via `app/(site)/layout.tsx`. Tokens Tailwind `brand-*` (cores) e `font-sans` (Poppins) — consumidos por todas as tasks de frontend, inclusive a Task 11 (login).

- [ ] **Step 1: Instalar Tailwind e as dependências de conteúdo (MDX vem na Task 8, mas instalar tudo de uma vez evita rebuild duplo)**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine \
  npm install -D tailwindcss postcss autoprefixer
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine \
  npm install next-mdx-remote gray-matter
```

- [ ] **Step 2: Configurar o Tailwind com os tokens de marca**

`frontend/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss';

// Aproximação da paleta verde descrita em docs/vision.md seção 4 — os
// valores hexadecimais exatos dependem do arquivo-fonte de identidade
// visual, ainda não enviado (pendência registrada em
// docs/specs/fase-2-site-institucional.md seção 9). Trocar aqui quando o
// arquivo chegar — é o único lugar que precisa mudar.
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f9f4',
          100: '#dbf0e3',
          300: '#7fcf9d',
          500: '#2f9e5c',
          700: '#1f6e40',
          900: '#123822',
        },
      },
      fontFamily: {
        sans: ['var(--font-poppins)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 3: Configurar o PostCSS**

`frontend/postcss.config.js`:

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Criar o CSS global**

`frontend/src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Carregar a fonte Poppins e importar o CSS global no layout raiz**

Editar `frontend/src/app/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Poppins } from 'next/font/google';
import './globals.css';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
});

export const metadata = {
  title: 'Montese SST',
  description: 'Plataforma de gestão de Segurança e Saúde do Trabalho',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={poppins.variable}>
      <body className="font-sans text-brand-900">{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Criar o componente `Logo`**

`frontend/src/components/Logo.tsx`:

```tsx
import Link from 'next/link';

// Wordmark de texto temporário — arquivo-fonte do logo (vetor/alta
// resolução) ainda não foi enviado (docs/vision.md seção 4). Trocar só
// este componente quando o arquivo real chegar, sem mexer no resto do site.
export function Logo() {
  return (
    <Link href="/" className="text-xl font-bold text-brand-700">
      Montese
    </Link>
  );
}
```

- [ ] **Step 7: Criar `SiteHeader` e `SiteFooter`**

`frontend/src/components/SiteHeader.tsx`:

```tsx
import Link from 'next/link';
import { Logo } from './Logo';

const NAV_LINKS = [
  { href: '/planos', label: 'Planos' },
  { href: '/noticias', label: 'Notícias' },
  { href: '/contato', label: 'Contato' },
];

export function SiteHeader() {
  return (
    <header className="border-b border-brand-100">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Logo />
        <nav className="flex items-center gap-6">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm text-brand-900 hover:text-brand-700">
              {link.label}
            </Link>
          ))}
          <Link href="/login" className="text-sm text-brand-900 hover:text-brand-700">
            Entrar
          </Link>
          <Link
            href="/cadastro"
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Comece grátis
          </Link>
        </nav>
      </div>
    </header>
  );
}
```

`frontend/src/components/SiteFooter.tsx`:

```tsx
import { Logo } from './Logo';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-brand-100 py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 text-sm text-brand-700">
        <Logo />
        <p>Tecnologia que organiza. Gestão que protege.</p>
        <p>&copy; {new Date().getFullYear()} Montese SST</p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 8: Criar `SiteLayout`**

`frontend/src/components/SiteLayout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';

export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
```

- [ ] **Step 9: Criar o route group `(site)` e mover a home pra dentro dele**

Criar `frontend/src/app/(site)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { SiteLayout } from '@/components/SiteLayout';

export default function SiteGroupLayout({ children }: { children: ReactNode }) {
  return <SiteLayout>{children}</SiteLayout>;
}
```

Mover o conteúdo de `frontend/src/app/page.tsx` para `frontend/src/app/(site)/page.tsx` (mesmo conteúdo por enquanto — a Task 6 reescreve o conteúdo da Home) e apagar o arquivo antigo:

```bash
mkdir -p frontend/src/app/\(site\)
git mv frontend/src/app/page.tsx "frontend/src/app/(site)/page.tsx"
```

`/login` (`frontend/src/app/login/page.tsx`) fica fora do grupo `(site)`, então continua sem `SiteLayout` — decisão confirmada na spec (seção 2).

- [ ] **Step 10: Build de produção pra confirmar que compila e o Tailwind está sendo aplicado**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
```

Esperado: build sem erros. Conferir no output que `(site)` aparece como rota e que não há erro de "unknown at rule @tailwind".

- [ ] **Step 11: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tailwind.config.ts frontend/postcss.config.js frontend/src/app/globals.css frontend/src/app/layout.tsx frontend/src/components "frontend/src/app/(site)"
git commit -m "feat: adiciona Tailwind, tema de marca e layout institucional (SiteLayout)"
```

---

### Task 6: Página Home

**Files:**
- Modify: `frontend/src/app/(site)/page.tsx`

**Interfaces:**
- Consumes: `SiteLayout` (Task 5, aplicado automaticamente via `app/(site)/layout.tsx` — esta página não precisa importar nada dele).
- Produces: nenhuma (página folha).

- [ ] **Step 1: Reescrever a Home com conteúdo real**

`frontend/src/app/(site)/page.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface StoredUser {
  id: string;
  tenantId: string | null;
  role: string;
}

const ROLES = [
  {
    title: 'Empresa cliente',
    description: 'Acompanhe score de SST, pendências, documentos e agenda num único painel.',
  },
  {
    title: 'Técnico responsável',
    description: 'Carteira de clientes, agenda e relatórios de inspeção — tudo à distância.',
  },
  {
    title: 'Técnico parceiro',
    description: 'Visitas técnicas e checklists de inspeção em campo, sincronizados na hora.',
  },
];

export default function HomePage() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('montese_user');
    setUser(raw ? JSON.parse(raw) : null);
    setChecked(true);
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <section className="text-center">
        <h1 className="text-4xl font-bold text-brand-900 sm:text-5xl">
          Tecnologia que organiza. Gestão que protege.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-brand-700">
          A plataforma que conecta empresa, técnico responsável e técnico parceiro num só lugar
          — com histórico e rastreabilidade completos de SST.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          {checked && user ? (
            <p className="text-brand-900">
              Logado como <strong>{user.role}</strong>.
            </p>
          ) : (
            <>
              <Link
                href="/cadastro"
                className="rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700"
              >
                Comece grátis
              </Link>
              <Link
                href="/contato"
                className="rounded-md border border-brand-500 px-6 py-3 font-medium text-brand-700 hover:bg-brand-50"
              >
                Fale com a gente
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="mt-20 grid gap-8 sm:grid-cols-3">
        {ROLES.map((role) => (
          <div key={role.title} className="rounded-lg border border-brand-100 p-6">
            <h2 className="text-lg font-semibold text-brand-900">{role.title}</h2>
            <p className="mt-2 text-sm text-brand-700">{role.description}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
```

(Removi o botão "Sair"/logout que existia na home placeholder — sem tela de dashboard ainda pra redirecionar depois do logout, e essa tela é institucional, não de produto; login/logout continuam funcionando normalmente pela própria `/login`.)

- [ ] **Step 2: Subir o frontend real e conferir via `curl`**

```bash
docker compose up -d --build frontend
sleep 3
curl -s http://localhost/ | grep -o "Tecnologia que organiza[^<]*"
```

Esperado: a frase aparece no HTML retornado (confirma SSR funcionando com o conteúdo novo).

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/(site)/page.tsx"
git commit -m "feat: reescreve a Home institucional"
```

---

### Task 7: Página Planos

**Files:**
- Create: `frontend/src/app/(site)/planos/page.tsx`

**Interfaces:**
- Consumes: `SiteLayout` (Task 5, automático).
- Produces: nenhuma.

- [ ] **Step 1: Criar a página**

`frontend/src/app/(site)/planos/page.tsx`:

```tsx
import Link from 'next/link';

export const metadata = { title: 'Planos — Montese SST' };

export default function PlanosPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-3xl font-bold text-brand-900">Planos</h1>
      <p className="mt-4 text-brand-700">
        Estamos validando o modelo de atendimento na região Sul de Santa Catarina antes de
        fechar uma tabela de preços — cada empresa começa com um período de teste (trial) sem
        custo. Fale com a gente pra saber o que faz sentido pro seu time.
      </p>
      <div className="mt-8 flex justify-center gap-4">
        <Link
          href="/cadastro"
          className="rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700"
        >
          Comece grátis
        </Link>
        <Link
          href="/contato"
          className="rounded-md border border-brand-500 px-6 py-3 font-medium text-brand-700 hover:bg-brand-50"
        >
          Fale com vendas
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Subir o frontend e conferir via `curl`**

```bash
docker compose up -d --build frontend
sleep 3
curl -s http://localhost/planos | grep -o "Planos</h1>"
```

Esperado: encontra o trecho no HTML.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/(site)/planos"
git commit -m "feat: adiciona página Planos (placeholder até valores serem definidos)"
```

---

### Task 8: Notícias (MDX)

**Files:**
- Create: `frontend/src/lib/noticias.ts`
- Create: `frontend/content/noticias/bem-vindo-ao-montese.mdx`
- Create: `frontend/content/noticias/sst-para-qualquer-cnpj.mdx`
- Create: `frontend/src/app/(site)/noticias/page.tsx`
- Create: `frontend/src/app/(site)/noticias/[slug]/page.tsx`

**Interfaces:**
- Consumes: `SiteLayout` (Task 5, automático).
- Produces:
  - `getAllPosts(): PostMeta[]` — `{ slug: string; title: string; date: string; excerpt: string }[]`, ordenado por data decrescente.
  - `getPostBySlug(slug: string): Post | null` — `PostMeta & { content: string }`.
  - Ambos em `frontend/src/lib/noticias.ts`, consumidos só pelas duas páginas desta task.

- [ ] **Step 1: Criar os posts de exemplo**

> Conteúdo real, não lorem ipsum — mas claramente placeholder editorial pro fundador substituir/expandir quando quiser (sem CMS, é editar o arquivo `.mdx` direto, ver spec seção 3).

`frontend/content/noticias/bem-vindo-ao-montese.mdx`:

```mdx
---
title: "Bem-vindo ao blog do Montese"
date: "2026-08-18"
excerpt: "Por que estamos construindo uma plataforma de SST pensada pra quem atua na região Sul de Santa Catarina."
---

Toda empresa com CNPJ e funcionários CLT precisa manter processos de Saúde
e Segurança do Trabalho em dia — PGR, PCMSO, laudos, fichas de EPI,
treinamentos, inspeções periódicas. Na prática, a maioria depende de
terceirização operada de forma manual: e-mails, planilhas, papel.

O Montese existe pra organizar isso — conectando empresa, técnico
responsável e técnico parceiro num único lugar, com histórico e
rastreabilidade completos.

Esse espaço vai reunir novidades da plataforma e conteúdo sobre SST pra
quem opera na região Sul de SC. Fique de olho.
```

`frontend/content/noticias/sst-para-qualquer-cnpj.mdx`:

```mdx
---
title: "SST não é só pra indústria: qualquer CNPJ com CLT precisa"
date: "2026-08-19"
excerpt: "A obrigação legal de Segurança e Saúde do Trabalho vale pra qualquer empregador com carteira assinada — não só setores de risco."
---

Um erro comum é achar que Segurança e Saúde do Trabalho é assunto só de
indústria ou construção civil. Não é — a obrigação legal vale pra
**qualquer empresa com CNPJ e funcionários CLT**, independente do setor.

Isso inclui escritórios, comércio, serviços — qualquer relação de emprego
formal exige acompanhamento de conformidade. O Montese nasceu justamente
pra atender esse universo amplo, sem foco setorial específico, começando
pela região Sul de Santa Catarina.
```

- [ ] **Step 2: Criar o helper de leitura de conteúdo**

`frontend/src/lib/noticias.ts`:

```typescript
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';

const CONTENT_DIR = join(process.cwd(), 'content', 'noticias');

export interface PostMeta {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
}

export interface Post extends PostMeta {
  content: string;
}

function readAllFiles(): { slug: string; raw: string }[] {
  return readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => ({
      slug: file.replace(/\.mdx$/, ''),
      raw: readFileSync(join(CONTENT_DIR, file), 'utf-8'),
    }));
}

export function getAllPosts(): PostMeta[] {
  return readAllFiles()
    .map(({ slug, raw }) => {
      const { data } = matter(raw);
      return { slug, title: data.title, date: data.date, excerpt: data.excerpt };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPostBySlug(slug: string): Post | null {
  const file = readAllFiles().find((entry) => entry.slug === slug);
  if (!file) return null;
  const { data, content } = matter(file.raw);
  return { slug, title: data.title, date: data.date, excerpt: data.excerpt, content };
}
```

- [ ] **Step 3: Criar a página de listagem**

`frontend/src/app/(site)/noticias/page.tsx`:

```tsx
import Link from 'next/link';
import { getAllPosts } from '@/lib/noticias';

export const metadata = { title: 'Notícias — Montese SST' };

export default function NoticiasPage() {
  const posts = getAllPosts();

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold text-brand-900">Notícias</h1>
      <div className="mt-8 flex flex-col gap-8">
        {posts.map((post) => (
          <article key={post.slug} className="border-b border-brand-100 pb-8">
            <Link href={`/noticias/${post.slug}`}>
              <h2 className="text-xl font-semibold text-brand-900 hover:text-brand-700">
                {post.title}
              </h2>
            </Link>
            <p className="mt-1 text-sm text-brand-700">{post.date}</p>
            <p className="mt-2 text-brand-700">{post.excerpt}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Criar a página de detalhe**

`frontend/src/app/(site)/noticias/[slug]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { getAllPosts, getPostBySlug } from '@/lib/noticias';

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const post = getPostBySlug(params.slug);
  return { title: post ? `${post.title} — Montese SST` : 'Notícia — Montese SST' };
}

export default function NoticiaPage({ params }: { params: { slug: string } }) {
  const post = getPostBySlug(params.slug);
  if (!post) notFound();

  return (
    <article className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-bold text-brand-900">{post.title}</h1>
      <p className="mt-1 text-sm text-brand-700">{post.date}</p>
      <div className="prose prose-brand mt-8 max-w-none">
        <MDXRemote source={post.content} />
      </div>
    </article>
  );
}
```

- [ ] **Step 5: Subir o frontend e conferir via `curl` (listagem e detalhe)**

```bash
docker compose up -d --build frontend
sleep 3
curl -s http://localhost/noticias | grep -o "Bem-vindo ao blog do Montese"
curl -s http://localhost/noticias/bem-vindo-ao-montese | grep -o "Toda empresa com CNPJ"
```

Esperado: os dois `grep` encontram o trecho correspondente.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/noticias.ts frontend/content "frontend/src/app/(site)/noticias" frontend/package.json frontend/package-lock.json
git commit -m "feat: adiciona Notícias (posts MDX versionados, sem CMS)"
```

---

### Task 9: Página Contato

**Files:**
- Create: `frontend/src/app/(site)/contato/page.tsx`

**Interfaces:**
- Consumes: `POST /api/contact` (Task 4) via `fetch`.
- Produces: nenhuma.

- [ ] **Step 1: Criar a página com o formulário**

`frontend/src/app/(site)/contato/page.tsx`:

```tsx
'use client';

import { FormEvent, useState } from 'react';

export default function ContatoPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message }),
      });
      setStatus(res.ok ? 'ok' : 'erro');
    } catch {
      setStatus('erro');
    }
  }

  if (status === 'ok') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-900">Mensagem enviada</h1>
        <p className="mt-4 text-brand-700">Obrigado pelo contato — retornaremos em breve.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Fale com a gente</h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          E-mail
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Mensagem
          <textarea
            required
            minLength={10}
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        {status === 'erro' && (
          <p className="text-sm text-red-600">Não foi possível enviar. Tente de novo em instantes.</p>
        )}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Enviando...' : 'Enviar'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Subir os containers reais e confirmar o fluxo de ponta a ponta via `curl`**

```bash
docker compose up -d --build frontend backend
sleep 3
curl -s http://localhost/contato | grep -o "Fale com a gente"
curl -s -i -X POST http://localhost/api/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Test","email":"smoke@teste.montese.local","message":"Mensagem de smoke test com mais de dez caracteres."}'
```

Esperado: o primeiro `curl` encontra o texto da página; o segundo devolve `201` — como `RESEND_API_KEY` ainda não existe (pendência da spec), o envio real vai falhar dentro do `EmailService`, mas isso só é confirmado no log estruturado (`docker logs montese_backend`), não deve derrubar a resposta HTTP de forma diferente do esperado até a Task 12 revisitar isso com a chave real. Se a resposta não for `201`, conferir os logs antes de prosseguir.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/(site)/contato"
git commit -m "feat: adiciona página Contato (formulário → POST /api/contact)"
```

---

### Task 10: Páginas Cadastro e Cadastro Confirmado

**Files:**
- Create: `frontend/src/app/(site)/cadastro/page.tsx`
- Create: `frontend/src/app/(site)/cadastro/confirmado/page.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/register` (Task 2), `GET /api/auth/confirm?token=...` (Task 3, acessado só pelo link do e-mail, não pelo frontend diretamente).
- Produces: nenhuma.

- [ ] **Step 1: Criar a página de cadastro**

`frontend/src/app/(site)/cadastro/page.tsx`:

```tsx
'use client';

import { FormEvent, useState } from 'react';

export default function CadastroPage() {
  const [companyName, setCompanyName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          cnpj,
          full_name: fullName,
          email,
          password,
        }),
      });
      if (res.ok) {
        setStatus('ok');
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(
        res.status === 409
          ? 'CNPJ ou e-mail já cadastrado.'
          : body?.message ?? 'Não foi possível concluir o cadastro.',
      );
      setStatus('erro');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  if (status === 'ok') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-900">Verifique seu e-mail</h1>
        <p className="mt-4 text-brand-700">
          Enviamos um link de confirmação para <strong>{email}</strong>. Confirme pra ativar o
          cadastro e poder entrar.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Comece grátis</h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome da empresa
          <input
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          CNPJ
          <input
            required
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            placeholder="00.000.000/0000-00"
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome do responsável
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          E-mail
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Senha
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Enviando...' : 'Criar conta'}
        </button>
      </form>
    </div>
  );
}
```

(Sem máscara de CNPJ no input por enquanto — o backend já normaliza e valida o dígito verificador, seção 4.1 da spec; máscara visual é um polish que pode entrar depois sem tocar em nada de backend.)

- [ ] **Step 2: Criar a página de resultado da confirmação**

`frontend/src/app/(site)/cadastro/confirmado/page.tsx`:

```tsx
import Link from 'next/link';

export default function CadastroConfirmadoPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const ok = searchParams.status === 'ok';

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      {ok ? (
        <>
          <h1 className="text-2xl font-bold text-brand-900">Cadastro confirmado</h1>
          <p className="mt-4 text-brand-700">Sua conta já está ativa.</p>
          <Link
            href="/login"
            className="mt-8 inline-block rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700"
          >
            Entrar
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold text-brand-900">Link inválido ou expirado</h1>
          <p className="mt-4 text-brand-700">
            O link de confirmação não é mais válido. Cadastre-se novamente pra receber um novo.
          </p>
          <Link
            href="/cadastro"
            className="mt-8 inline-block rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700"
          >
            Voltar ao cadastro
          </Link>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Subir os containers reais e testar o fluxo completo de ponta a ponta via `curl`**

```bash
docker compose up -d --build frontend backend
sleep 3

curl -s http://localhost/cadastro | grep -o "Comece grátis</h1>"

# Cadastro real via curl (CNPJ matematicamente válido, ver Task 2)
curl -s -i -X POST http://localhost/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"company_name":"Smoke Cadastro","cnpj":"11222333000181","full_name":"Responsável Smoke","email":"smoke-cadastro@teste.montese.local","password":"senha-segura-123"}'
```

Esperado: página `/cadastro` retorna o HTML certo; `POST /api/auth/register` retorna `201`. O e-mail de confirmação real só funciona depois da Task 12 (com `RESEND_API_KEY` configurada) — por enquanto confirmar via `docker logs montese_backend` que o `EmailService` tentou enviar (mesmo que falhe por falta de credencial).

Limpar o dado de smoke test:

```bash
set -a; source /opt/Montese/.env; set +a
docker exec -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c \
  "DELETE FROM tenants WHERE cnpj = '11222333000181';"
```

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(site)/cadastro"
git commit -m "feat: adiciona páginas de Cadastro e confirmação"
```

---

### Task 11: Restyle da página de Login (visual, sem mudar comportamento)

**Files:**
- Modify: `frontend/src/app/login/page.tsx`

**Interfaces:**
- Consumes: Tokens Tailwind `brand-*`/`font-sans` (Task 5) — só classes utilitárias, **sem** importar `SiteLayout` (decisão da spec seção 2: login não é página institucional).
- Produces: nenhuma.

- [ ] **Step 1: Substituir os estilos inline por classes Tailwind, mantendo a lógica exatamente igual**

`frontend/src/app/login/page.tsx`:

```tsx
'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setError('Credenciais inválidas.');
        return;
      }

      const data = await res.json();
      localStorage.setItem('montese_token', data.access_token);
      localStorage.setItem('montese_user', JSON.stringify(data.user));
      router.push('/');
    } catch {
      setError('Não foi possível conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="mb-6">
        <Logo />
      </div>
      <h1 className="text-2xl font-bold text-brand-900">Entrar</h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          E-mail
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Senha
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Subir o frontend real e confirmar login de ponta a ponta continua funcionando (mesmo teste de fumaça já usado na Fase 1)**

```bash
docker compose up -d --build frontend
sleep 3
curl -s http://localhost/login | grep -o "Entrar</h1>"
```

Rodar a suíte e2e do backend (garante que nada no fluxo de login quebrou — o restyle é só frontend, mas confirmar por completo):

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e PUBLIC_APP_URL="http://localhost" \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
  -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
  -e CONTACT_EMAIL_TO="comercial@teste.montese.local" \
  -e CONTACT_RATE_LIMIT_MAX=10 -e CONTACT_RATE_LIMIT_WINDOW_SECONDS=3600 \
  node:20-alpine sh -c "npm run test:e2e"
```

Esperado: `/login` retorna o HTML certo; suíte e2e completa passando.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/login/page.tsx
git commit -m "style: aplica Tailwind/tema de marca ao login (sem mudar comportamento)"
```

---

### Task 12: Integração final, deploy real e documentação

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/vision.md`

**Interfaces:**
- Consumes: tudo das Tasks 1–11.
- Produces: nenhuma — task de fechamento.

- [ ] **Step 1: Rebuild e deploy dos dois containers reais desta VPS**

```bash
docker compose build backend frontend
docker compose up -d backend frontend
sleep 3
docker compose ps
```

Esperado: `montese_backend` e `montese_frontend` com status `Up`.

- [ ] **Step 2: Rodar a migração no Postgres de produção**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate
```

Esperado: `0003_register_function.sql` e `0004_confirm_email_function.sql` aplicadas (ou `[skip]` se a Task 2/3 já rodou isso antes contra este mesmo Postgres).

- [ ] **Step 3: Smoke test real de todas as páginas via `curl`**

```bash
for path in / /planos /noticias /contato /cadastro /login; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost${path}")
  echo "${path} -> ${code}"
done
```

Esperado: `200` em todas.

- [ ] **Step 4: Confirmar se `RESEND_API_KEY` já foi configurada; se sim, fazer um cadastro real de ponta a ponta**

Se o fundador já forneceu `RESEND_API_KEY`, `EMAIL_FROM` (domínio verificado) e `PUBLIC_APP_URL` (endereço público real desta VPS) no `.env`: reiniciar o backend (`docker compose up -d backend`) e rodar um cadastro real com um e-mail que você consiga checar de verdade, confirmando que o e-mail chega e que clicar no link ativa a conta e permite login. **Esta etapa não pode ser marcada como concluída sem essa evidência real** — é a mesma régua já aplicada ao backup (Fase Escala/Confiabilidade) e ao rate limiting.

Se as credenciais ainda não existirem: documentar isso como pendência aberta (Step 5) em vez de simular/inventar o resultado.

- [ ] **Step 5: Atualizar `docs/roadmap.md`**

Adicionar uma seção descrevendo o estado da Fase 2 ao final do arquivo (ou substituir a linha "Fase 2 — Site institucional (não iniciada)" existente), no mesmo formato de tabela já usado pra Fase 1 — item por item (Home ✅, Planos ✅, Notícias ✅, Contato ✅, Cadastro ✅ com a ressalva do Step 4 se `RESEND_API_KEY` ainda não existir, Login ✅ restyled). Marcar explicitamente se o teste real de e-mail (Step 4) foi ou não feito.

- [ ] **Step 6: Atualizar `docs/vision.md`**

Na tabela da seção 10 ("Mapa de documentação"), nenhuma linha nova é necessária (a spec já está listada indiretamente via `docs/roadmap.md`) — mas revisar a seção 11 ("Estado atual e próximos passos"), que hoje ainda descreve a Fase 1 como "parcialmente concluída" (desatualizado desde antes desta fase) — corrigir pra refletir Fases 1 e 2 concluídas, Fase 3 como próximo passo natural.

- [ ] **Step 7: Commit final**

```bash
git add docs/roadmap.md docs/vision.md
git commit -m "docs: fecha Fase 2 (site institucional) no roadmap"
```
