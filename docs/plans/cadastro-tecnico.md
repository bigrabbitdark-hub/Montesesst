# Cadastro Próprio de Técnico Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao técnico um cadastro próprio (público, com confirmação por e-mail), reaproveitando ao máximo a infraestrutura de auth já construída na Fase 2 — pré-requisito pra assinatura paga de técnico (sub-projeto B, spec separada, ainda não escrita).

**Architecture:** Um endpoint novo (`POST /auth/register-technician`) cria `users`+`technicians` pendentes via uma função Postgres `SECURITY DEFINER` nova (mesmo motivo de `auth_register_tenant_and_user` da Fase 2 — RLS bloqueia insert anônimo). O endpoint de confirmação (`GET /auth/confirm`) já existente é generalizado para descobrir o `role` do usuário e ativar o recurso certo (`tenants` para `empresa`, `technicians` para `tecnico`) — nenhum código TypeScript de confirmação muda, só a função SQL por trás.

**Tech Stack:** Mesmo da Fase 2 — NestJS + `class-validator` + PostgreSQL (RLS) + Redis (rate limit) + Next.js/Tailwind no frontend. Nenhuma dependência nova.

**Spec:** [`docs/specs/cadastro-tecnico.md`](../specs/cadastro-tecnico.md)

## Global Constraints

- **RLS em toda tabela** — qualquer INSERT/UPDATE sem contexto de tenant/role autenticado precisa de função `SECURITY DEFINER` dedicada, dona `montese_auth_bypass`. `BYPASSRLS` sozinho não basta — a role também precisa do `GRANT` de tabela normal (inclusive `SELECT` quando a função usa `RETURNING`, lição da Fase 2).
- **Nunca editar migration já commitada** — `auth_confirm_email` já existe via `0004_confirm_email_function.sql` (commitado). A generalização é uma migration nova (`DROP FUNCTION` + `CREATE FUNCTION`, não `CREATE OR REPLACE` — Postgres não permite `REPLACE` mudar o tipo de retorno de uma função, e o retorno ganha uma coluna nova, `role`).
- **Sem mock apresentado como funcional** — cada task testada contra Postgres/Redis reais (containers desta VPS), e a task final com deploy real + `curl` real.
- **Reaproveitar, não duplicar** — `RegistrationService.confirm()`/`AuthController.confirm()` não ganham nenhuma lógica nova; só a função SQL fica mais esperta. Página `/cadastro/confirmado` também é reaproveitada, sem versão nova pra técnico.

---

### Task 1: Funções Postgres — `auth_register_technician` + generalização de `auth_confirm_email`

**Files:**
- Create: `backend/db/migrations/0005_technician_registration.sql`

**Interfaces:**
- Consumes: nenhuma (task de banco, sem código TypeScript ainda).
- Produces:
  - Função `auth_register_technician(p_email, p_password_hash, p_full_name, p_phone, p_registration_number, p_specialization) RETURNS TABLE(user_id UUID, technician_id UUID)` — consumida pela Task 2.
  - Função `auth_confirm_email(p_user_id UUID) RETURNS TABLE(user_id UUID, tenant_id UUID, role user_role)` — **assinatura de retorno mudou** (ganhou a coluna `role`) em relação à versão da Fase 2 — a Task 2 precisa atualizar `RegistrationService.confirm()` de acordo.

- [ ] **Step 1: Criar a migration**

`backend/db/migrations/0005_technician_registration.sql`:

```sql
-- auth_register_technician: cria users (role 'tecnico') + technicians
-- pendentes numa única operação atômica, sem exigir contexto de
-- tenant/role — mesmo motivo de auth_register_tenant_and_user
-- (0003_register_function.sql). status 'pendente' é diferente do default
-- atual da tabela technicians ('ativo'), porque esse default assume
-- criação confiada por admin (POST /technicians, @Roles('admin')) —
-- autocadastro não tem essa confiança ainda.
CREATE FUNCTION auth_register_technician(
  p_email TEXT,
  p_password_hash TEXT,
  p_full_name TEXT,
  p_phone TEXT,
  p_registration_number TEXT,
  p_specialization TEXT
) RETURNS TABLE(user_id UUID, technician_id UUID) AS $$
DECLARE
  v_user_id UUID;
  v_technician_id UUID;
BEGIN
  INSERT INTO users (tenant_id, role, email, password_hash, full_name, phone, status)
  VALUES (NULL, 'tecnico', p_email, p_password_hash, p_full_name, p_phone, 'pendente')
  RETURNING id INTO v_user_id;

  INSERT INTO technicians (user_id, registration_number, specialization, status)
  VALUES (v_user_id, p_registration_number, p_specialization, 'pendente')
  RETURNING id INTO v_technician_id;

  RETURN QUERY SELECT v_user_id, v_technician_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION auth_register_technician(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_register_technician(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_register_technician(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO montese_app;

-- montese_auth_bypass já tinha SELECT em technicians (0001_init.sql) —
-- falta INSERT (usado aqui) e UPDATE (usado pela versão generalizada de
-- auth_confirm_email, abaixo).
GRANT INSERT, UPDATE ON technicians TO montese_auth_bypass;

-- auth_confirm_email generalizada: a versão da Fase 2 (0004) só ativava
-- 'empresa' (WHERE role = 'empresa' explícito) e devolvia
-- TABLE(user_id, tenant_id). Aqui ela descobre o role de qualquer usuário
-- e ativa o recurso certo — tenants pra 'empresa', technicians pra
-- 'tecnico'. DROP + CREATE (não CREATE OR REPLACE) porque o tipo de
-- retorno mudou (ganhou a coluna role) — Postgres não permite REPLACE
-- mudar o tipo de retorno de uma função existente.
DROP FUNCTION auth_confirm_email(UUID);

CREATE FUNCTION auth_confirm_email(p_user_id UUID)
RETURNS TABLE(user_id UUID, tenant_id UUID, role user_role) AS $$
DECLARE
  v_tenant_id UUID;
  v_role user_role;
BEGIN
  UPDATE users SET status = 'ativo'
  WHERE id = p_user_id
  RETURNING users.tenant_id, users.role INTO v_tenant_id, v_role;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_role = 'empresa' THEN
    UPDATE tenants SET status = 'ativo' WHERE id = v_tenant_id;
  ELSIF v_role = 'tecnico' THEN
    UPDATE technicians SET status = 'ativo' WHERE technicians.user_id = p_user_id;
  END IF;

  RETURN QUERY SELECT p_user_id, v_tenant_id, v_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION auth_confirm_email(UUID) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_confirm_email(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_confirm_email(UUID) TO montese_app;
```

- [ ] **Step 2: Aplicar a migration no Postgres real**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate
```

Esperado: `[apply] 0005_technician_registration.sql` seguido de `[ok]`.

- [ ] **Step 3: Confirmar as duas funções via `psql` real (chamada direta, sem TypeScript)**

```bash
set -a; source /opt/Montese/.env; set +a

# auth_register_technician — deve devolver user_id + technician_id
docker exec -e PGPASSWORD="${POSTGRES_APP_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_APP_USER}" -d "${POSTGRES_DB}" -c \
  "SELECT * FROM auth_register_technician('teste-migration@teste.montese.local', 'hash-fake', 'Técnico Teste', '48999990000', 'REG-123', 'Segurança do Trabalho');"

# Pegar o user_id que saiu acima e testar a confirmação genérica com ele:
# SELECT * FROM auth_confirm_email('<user_id-do-passo-anterior>');
# Esperado: uma linha com role = 'tecnico', e a tabela technicians com
# status 'ativo' pra esse user_id (conferir com SELECT status FROM
# technicians WHERE user_id = '<user_id>').

# Limpeza do dado de teste:
docker exec -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c \
  "DELETE FROM users WHERE email = 'teste-migration@teste.montese.local';"
```

Rodar o `SELECT * FROM auth_confirm_email(...)` do comentário acima de
verdade (substituindo o `user_id` real retornado), conferir que `role`
vem `tecnico` e que `technicians.status` virou `ativo` — não só ler o
comentário, executar e ver o resultado real.

- [ ] **Step 4: Commit**

```bash
git add backend/db/migrations/0005_technician_registration.sql
git commit -m "feat: funções SQL do cadastro de técnico (registro + confirmação generalizada)"
```

---

### Task 2: `POST /auth/register-technician` + generalização do `confirm()`

**Files:**
- Create: `backend/src/auth/dto/register-technician.dto.ts`
- Modify: `backend/src/auth/registration.service.ts`
- Modify: `backend/src/auth/auth.controller.ts`
- Test: `backend/test/register-technician.e2e-spec.ts`

**Interfaces:**
- Consumes: `auth_register_technician`, `auth_confirm_email` (Task 1); `EmailService.send`, `AuditService.log`, `mapPgError`, `RateLimit`/`envInt` (existentes, Fase 2).
- Produces: `RegistrationService.registerTechnician(input: { email: string; password: string; fullName: string; phone?: string; registrationNumber?: string; specialization?: string; ip?: string }): Promise<void>` — sem outro consumidor nesta spec além do controller.

- [ ] **Step 1: Criar o `RegisterTechnicianDto`**

`backend/src/auth/dto/register-technician.dto.ts`:

```typescript
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterTechnicianDto {
  @IsEmail()
  email: string;

  // bcrypt trunca senha acima de 72 bytes — mesmo teto já usado no
  // RegisterDto de empresa (auth/dto/register.dto.ts).
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  full_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  registration_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  specialization?: string;
}
```

- [ ] **Step 2: Adicionar `registerTechnician` ao `RegistrationService` e generalizar `confirm`**

Editar `backend/src/auth/registration.service.ts` — arquivo completo (mudanças: novo método `registerTechnician`, e `confirm` atualizado pra usar a coluna `role` nova que a função SQL agora devolve, em vez do `actorRole: 'empresa'` fixo):

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

export interface RegisterTechnicianInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  registrationNumber?: string;
  specialization?: string;
  ip?: string;
}

// Claim distinto de token de sessão — garante que um token de confirmação
// nunca seja confundido com outro tipo de JWT assinado com o mesmo
// JWT_SECRET.
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

    await this.sendConfirmationEmail(userId, input.email, input.fullName);
  }

  async registerTechnician(input: RegisterTechnicianInput): Promise<void> {
    const passwordHash = await bcrypt.hash(input.password, 10);

    const userId = await this.db.withoutTenantContext(async (client) => {
      try {
        const result = await client.query<{ user_id: string; technician_id: string }>(
          'SELECT * FROM auth_register_technician($1, $2, $3, $4, $5, $6)',
          [
            input.email,
            passwordHash,
            input.fullName,
            input.phone ?? null,
            input.registrationNumber ?? null,
            input.specialization ?? null,
          ],
        );
        return result.rows[0].user_id;
      } catch (err) {
        mapPgError(err);
      }
    });

    void this.audit.log({
      actorUserId: userId,
      actorRole: 'tecnico',
      actorTenantId: null,
      action: 'register_technician',
      resourceType: 'auth',
      resourceId: userId,
      method: 'POST',
      path: '/auth/register-technician',
      statusCode: 201,
      ipAddress: input.ip,
    });

    await this.sendConfirmationEmail(userId, input.email, input.fullName);
  }

  private async sendConfirmationEmail(userId: string, email: string, fullName: string): Promise<void> {
    const token = this.jwt.sign(
      { sub: userId, purpose: CONFIRMATION_TOKEN_PURPOSE },
      { expiresIn: '48h' },
    );
    const confirmUrl = `${process.env.PUBLIC_APP_URL}/api/auth/confirm?token=${token}`;

    await this.email.send({
      to: email,
      subject: 'Confirme seu cadastro — Montese SST',
      html: `<p>Olá, ${escapeHtml(fullName)}!</p>
<p>Confirme seu cadastro no Montese SST clicando no link abaixo (válido por 48 horas):</p>
<p><a href="${confirmUrl}">Confirmar cadastro</a></p>`,
    });
  }

  async confirm(token: string): Promise<'ok' | 'erro'> {
    let payload: { sub: string; purpose: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      return 'erro';
    }
    if (payload.purpose !== CONFIRMATION_TOKEN_PURPOSE) return 'erro';

    const result = await this.db.withoutTenantContext((client) =>
      client.query<{ user_id: string; tenant_id: string | null; role: string }>(
        'SELECT * FROM auth_confirm_email($1)',
        [payload.sub],
      ),
    );
    const activated = result.rows[0];
    if (!activated) return 'erro';

    void this.audit.log({
      actorUserId: activated.user_id,
      actorRole: activated.role,
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
}
```

(Extraí o envio de e-mail de confirmação pra `sendConfirmationEmail`, reaproveitado pelos dois fluxos — único jeito de adicionar o segundo fluxo sem duplicar a montagem do token/HTML do e-mail.)

- [ ] **Step 3: Adicionar a rota no `AuthController`**

Editar `backend/src/auth/auth.controller.ts` — adicionar o import de `RegisterTechnicianDto` e o método novo, logo depois de `register`:

```typescript
import { RegisterTechnicianDto } from './dto/register-technician.dto';
```

```typescript
  @Public()
  @RateLimit({
    limit: envInt('REGISTER_RATE_LIMIT_MAX', 5),
    windowSeconds: envInt('REGISTER_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('register-technician')
  async registerTechnician(@Body() dto: RegisterTechnicianDto, @Req() req: any) {
    await this.registrationService.registerTechnician({
      email: dto.email,
      password: dto.password,
      fullName: dto.full_name,
      phone: dto.phone,
      registrationNumber: dto.registration_number,
      specialization: dto.specialization,
      ip: req.ip,
    });
    return { message: 'Cadastro recebido — verifique seu e-mail para confirmar.' };
  }
```

- [ ] **Step 4: Escrever os testes e2e**

`backend/test/register-technician.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/common/email/email.service';

const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;

// Mesmo motivo do REGISTER_RATE_LIMIT_KEY em register.e2e-spec.ts — o
// contador de /auth/register-technician é isolado por rota (RateLimitGuard),
// mas ainda cumulativo entre os testes deste arquivo (mesmo IP de loopback).
const RATE_LIMIT_KEY = 'ratelimit:AuthController.registerTechnician:::ffff:127.0.0.1';

describe('Cadastro de técnico — POST /auth/register-technician (e2e)', () => {
  let app: INestApplication;
  let db: Client;
  let redis: Redis;
  const fakeEmail = { send: jest.fn().mockResolvedValue(undefined) };
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

    redis = new Redis(process.env.REDIS_URL as string);
  });

  beforeEach(async () => {
    fakeEmail.send.mockClear();
    await redis.del(RATE_LIMIT_KEY);
  });

  afterAll(async () => {
    if (createdEmails.length) {
      await db.query('DELETE FROM users WHERE email = ANY($1)', [createdEmails]);
    }
    await redis.del(RATE_LIMIT_KEY);
    redis.disconnect();
    await db.end();
    await app.close();
  });

  it('cria user+technician pendentes, e dispara o e-mail de confirmação', async () => {
    const email = `tecnico-${randomUUID()}@teste.montese.local`;
    createdEmails.push(email);

    const res = await request(app.getHttpServer()).post('/auth/register-technician').send({
      email,
      password: 'senha-segura-123',
      full_name: 'Técnico Teste',
      phone: '48999990000',
      registration_number: 'REG-123',
      specialization: 'Segurança do Trabalho',
    });

    expect(res.status).toBe(201);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
    expect(fakeEmail.send.mock.calls[0][0].to).toBe(email);

    const row = await db.query(
      `SELECT u.status AS user_status, t.status AS technician_status
       FROM users u JOIN technicians t ON t.user_id = u.id
       WHERE u.email = $1`,
      [email],
    );
    expect(row.rows[0]).toMatchObject({ user_status: 'pendente', technician_status: 'pendente' });
  });

  it('rejeita e-mail duplicado com 409', async () => {
    const email = `dup-tec-${randomUUID()}@teste.montese.local`;
    createdEmails.push(email);
    const payload = {
      email,
      password: 'senha-segura-123',
      full_name: 'Técnico Duplicado',
    };
    await request(app.getHttpServer()).post('/auth/register-technician').send(payload).expect(201);

    const res = await request(app.getHttpServer())
      .post('/auth/register-technician')
      .send(payload);
    expect(res.status).toBe(409);
  });

  it('confirma o e-mail e ativa technician+user; clicar duas vezes não quebra', async () => {
    const email = `confirmar-tec-${randomUUID()}@teste.montese.local`;
    createdEmails.push(email);

    await request(app.getHttpServer()).post('/auth/register-technician').send({
      email,
      password: 'senha-segura-123',
      full_name: 'Técnico Confirmar',
    });

    const confirmUrl: string = fakeEmail.send.mock.calls[0][0].html.match(/href="([^"]+)"/)[1];
    const token = new URL(confirmUrl).searchParams.get('token') as string;

    const first = await request(app.getHttpServer()).get('/auth/confirm').query({ token });
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe('/cadastro/confirmado?status=ok');

    const row = await db.query(
      `SELECT u.status AS user_status, t.status AS technician_status
       FROM users u JOIN technicians t ON t.user_id = u.id WHERE u.email = $1`,
      [email],
    );
    expect(row.rows[0]).toMatchObject({ user_status: 'ativo', technician_status: 'ativo' });

    const second = await request(app.getHttpServer()).get('/auth/confirm').query({ token });
    expect(second.status).toBe(302);
    expect(second.headers.location).toBe('/cadastro/confirmado?status=ok');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'senha-segura-123' });
    expect(loginRes.status).toBe(201);
  });

  it('bloqueia com 429 depois do limite de cadastros por IP', async () => {
    const limit = parseInt(process.env.REGISTER_RATE_LIMIT_MAX ?? '5', 10);
    for (let i = 0; i < limit; i++) {
      const email = `rate-tec-${randomUUID()}@teste.montese.local`;
      createdEmails.push(email);
      await request(app.getHttpServer()).post('/auth/register-technician').send({
        email,
        password: 'senha-segura-123',
        full_name: 'Técnico Rate',
      });
    }
    const res = await request(app.getHttpServer()).post('/auth/register-technician').send({
      email: `estourou-tec-${randomUUID()}@teste.montese.local`,
      password: 'senha-segura-123',
      full_name: 'Técnico Estourou',
    });
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 5: Rodar os testes novos e confirmar que passam contra Postgres/Redis reais**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e PUBLIC_APP_URL="http://localhost" \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/register-technician.e2e-spec.ts"
```

Esperado: 4/4 testes passando.

- [ ] **Step 6: Rodar a suíte e2e completa — confirmar que o cadastro de empresa (Fase 2) não quebrou com a generalização de `auth_confirm_email`**

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

Esperado: todos os testes (Fase 1 + rate limiting + register empresa + contact + register técnico) passando juntos — número exato de testes maior que os 21 da Fase 2 (mais os 4 novos desta task).

- [ ] **Step 7: Commit**

```bash
git add backend/src/auth backend/test/register-technician.e2e-spec.ts
git commit -m "feat: adiciona POST /auth/register-technician (cadastro próprio de técnico)"
```

---

### Task 3: Página `/tecnico/cadastro`

**Files:**
- Create: `frontend/src/app/(site)/tecnico/cadastro/page.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/register-technician` (Task 2) via `fetch`.
- Produces: nenhuma.

- [ ] **Step 1: Criar a página**

`frontend/src/app/(site)/tecnico/cadastro/page.tsx`:

```tsx
'use client';

import { FormEvent, useState } from 'react';

export default function CadastroTecnicoPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/auth/register-technician', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          email,
          password,
          phone: phone || undefined,
          registration_number: registrationNumber || undefined,
          specialization: specialization || undefined,
        }),
      });
      if (res.ok) {
        setStatus('ok');
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(
        res.status === 409
          ? 'E-mail já cadastrado.'
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
      <h1 className="text-2xl font-bold text-brand-900">Cadastro de técnico</h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome completo
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
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Telefone (opcional)
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Número de registro profissional (opcional)
          <input
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Especialização (opcional)
          <input
            value={specialization}
            onChange={(e) => setSpecialization(e.target.value)}
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

- [ ] **Step 2: Build de produção pra confirmar que compila**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
```

Esperado: build sem erros, `/tecnico/cadastro` aparece na lista de rotas.

- [ ] **Step 3: Subir o frontend real e conferir via `curl`**

```bash
docker compose up -d --build frontend
sleep 3
curl -s http://localhost/tecnico/cadastro | grep -o "Cadastro de técnico</h1>"
```

Esperado: encontra o trecho no HTML.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(site)/tecnico/cadastro"
git commit -m "feat: adiciona página de cadastro de técnico"
```

---

### Task 4: Integração final, deploy real e documentação

**Files:**
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: tudo das Tasks 1–3.
- Produces: nenhuma — task de fechamento.

- [ ] **Step 1: Rebuild e deploy dos dois containers reais desta VPS**

```bash
docker compose build backend frontend
docker compose up -d backend frontend
sleep 3
docker compose ps
```

Esperado: `montese_backend` e `montese_frontend` com status `Up`.

- [ ] **Step 2: Smoke test real de ponta a ponta via `curl`**

```bash
# Cadastro real de técnico (usar um e-mail que você consiga checar de
# verdade, já que RESEND_API_KEY está em modo sandbox — só entrega pro
# e-mail da conta Resend configurada)
curl -s -i -X POST http://localhost/api/auth/register-technician \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Smoke Técnico","email":"<SEU_EMAIL_AQUI>","password":"senha-segura-123"}'
```

Esperado: `201`. Conferir `docker logs montese_backend --tail 5` pra ver se o e-mail foi enviado sem erro. **Este smoke test não pode ser marcado como concluído sem confirmar visualmente que o e-mail chegou e que o link de confirmação funciona** — mesma régua já aplicada ao cadastro de empresa na Fase 2.

Depois de confirmar (clicar no link, ver a página de sucesso), validar no banco:

```bash
set -a; source /opt/Montese/.env; set +a
docker exec -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c \
  "SELECT u.email, u.status AS user_status, t.status AS technician_status FROM users u JOIN technicians t ON t.user_id = u.id WHERE u.email = '<SEU_EMAIL_AQUI>';"
```

Esperado: `user_status` e `technician_status` ambos `ativo`. Depois, limpar o dado de teste:

```bash
docker exec -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c \
  "DELETE FROM users WHERE email = '<SEU_EMAIL_AQUI>';"
```

- [ ] **Step 3: Confirmar que o cadastro de empresa (Fase 2) continua funcionando no ambiente real (regressão)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/cadastro
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/tecnico/cadastro
```

Esperado: `200` nos dois.

- [ ] **Step 4: Atualizar `docs/roadmap.md`**

Adicionar uma seção "Cadastro próprio de técnico: status" (mesmo formato de tabela já usado nas fases anteriores), marcando o item como fechado com a data e a evidência do smoke test real (e-mail recebido, conta ativada, login funcionando). Referenciar
[`docs/specs/cadastro-tecnico.md`](../specs/cadastro-tecnico.md) e este plano.

- [ ] **Step 5: Commit final**

```bash
git add docs/roadmap.md
git commit -m "docs: fecha cadastro próprio de técnico (sub-projeto A do pagamento)"
```
