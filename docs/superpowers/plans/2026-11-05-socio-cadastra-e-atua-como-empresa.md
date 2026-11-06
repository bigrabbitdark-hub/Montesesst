# Sócia cadastra empresa e atua como empresa — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** a Eng. Évelyn (papel `socio`) cadastra empresa da Montese com e-mail + senha temporária e opera as telas `/empresa/*` dessa empresa pelo modo "atuar como empresa".

**Arquitetura:** (1) função SQL `socio_create_company` cria tenant+usuário já ativos, com `must_change_password`; (2) endpoint emite JWT curto do sócio com claim `act`; (3) um guard global reescreve `request.user` para `{role:'empresa', tenantId:X}` só em controllers marcados `@ActingAllowed()` e após revalidar no banco (`socio_can_act_on_tenant`), de modo que **as policies de RLS existentes continuam valendo sem alteração**; (4) frontend troca o slot `montese_token` pelo token de atuação (guardando o da Évelyn) e mostra a faixa "Atuando em X".

**Stack:** NestJS + pg + JWT (backend), Next.js/React/Tailwind (frontend), Jest (`*.unit-spec.ts`, `*.e2e-spec.ts`), PostgreSQL com RLS/FORCE RLS.

**Spec:** `docs/superpowers/specs/2026-11-05-socio-cadastra-e-atua-como-empresa-design.md`

## Restrições globais (valem para todas as tarefas)

- **Base de código:** branch `release/painel-evelyn-20261103` (a árvore `/opt/Montese`, em `feat/home-diagnostico-carrossel`, NÃO tem o painel da Évelyn). Trabalhar no worktree `/opt/montese-work/socio-atua-empresa`, branch `feat/socio-atua-empresa`.
- **Sem `git commit`, `push`, `reset`, `revert`.** Onde a skill pediria "Commit", fazer o *Checkpoint*: `git status --short` + `git diff --stat` e seguir. Quem commita é o proprietário.
- **Nada em produção.** Migration `0108` só é aplicada no ensaio descartável. Nunca ler/imprimir `.env`, chaves ou certificados; ensaio com senhas aleatórias e chaves falsas; nunca `docker compose down -v`.
- Numeração: a maior migration em todas as branches é `0105`; `0106` está pendente na árvore principal. A nova é **`0108`** (reconferir com `git ls-tree` antes de criar).
- Senha temporária: **nunca** em log, auditoria, resposta de listagem ou e-mail; devolvida/exibida uma única vez (no cadastro, o backend nem a devolve — o front já a tem).
- Token de atuação: JWT assinado com o mesmo `JWT_SECRET`, claim `act` (uuid do tenant), `role:'socio'`, **TTL 1800 s**. `purpose` continua proibido em token de sessão.
- `@ActingAllowed()` é **lista fechada**; excluídos sempre: `subscriptions`, `tenant-technicians`, `partners`, `auth`, `assistant`/`ai-copilot` (IA), `google-calendar`, `technicians`, `admin-dashboard`, `visits`, `atuacao`; de `tenants` só `GET me`.
- `PERMISSIONS` (TS) e o `CHECK` de `socio_permissions` (SQL) devem ter **os mesmos 25 valores** (os 23 atuais + `empresas.criar` + `empresas.atuar`).
- Mensagens ao usuário em português; DTOs com `whitelist` + `forbidNonWhitelisted`.
- Testes: unit rodam no host (`cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão> --forceExit`); e2e **somente** contra o ensaio descartável (Task 0), nunca contra o Postgres de produção, com `R2Service`/`MercadoPagoService` mockados. Saída de jest sempre redirecionada a arquivo (nunca `| tail`).
- Revisão final por `montese-seguranca` e `montese-qa` (Task 14). Quem implementa não aprova.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/db/migrations/0108_socio_cadastra_atua_empresa.sql` | criar | coluna, CHECK, 5 funções SQL |
| `backend/test/socio-empresa-funcoes.e2e-spec.ts` | criar | testa as funções SQL (RLS real) |
| `backend/src/common/types.ts` | modificar | campos opcionais em `AuthenticatedUser` |
| `backend/src/common/permissions.ts` | modificar | +2 permissões |
| `backend/src/auth/strategies/jwt.strategy.ts` | modificar | lê `act` e `mcp` |
| `backend/src/common/decorators/acting-allowed.decorator.ts` | criar | `@ActingAllowed()` |
| `backend/src/common/decorators/allow-password-pending.decorator.ts` | criar | `@AllowWhilePasswordPending()` |
| `backend/src/common/guards/acting-tenant.guard.ts` | criar | revalida e reescreve `request.user` |
| `backend/src/common/guards/password-change-required.guard.ts` | criar | bloqueia tudo enquanto a senha é temporária |
| `backend/src/app.module.ts` | modificar | registra os 2 guards na ordem certa |
| `backend/src/auth/auth.service.ts`, `auth.controller.ts`, `dto/change-password.dto.ts`, `auth.module.ts` | modificar/criar | `mcp` no login, `change-password`, exporta `JwtModule` |
| `backend/src/atuacao/dto/criar-empresa.dto.ts` | criar | DTO do cadastro |
| `backend/src/atuacao/atuacao.service.ts`, `atuacao.controller.ts`, `atuacao.module.ts` | modificar | `POST clientes`, `POST clientes/:id/atuar` |
| `backend/src/common/interceptors/audit.interceptor.ts` | modificar | ator = sócia quando atuando |
| `backend/src/**/**.controller.ts` (lista da Task 8) | modificar | `@ActingAllowed()` |
| `backend/test/acting-allowed-lista.unit-spec.ts` | criar | trava a lista fechada |
| `backend/test/socio-atua-empresa.e2e-spec.ts` | criar | isolamento HTTP ponta a ponta |
| `frontend/src/lib/acting.ts` | criar | entrar/sair do modo atuação |
| `frontend/src/components/ActingBanner.tsx` | criar | faixa "Atuando em X" |
| `frontend/src/lib/auth.ts`, `components/RoleGuard.tsx` | modificar | restaura sessão da sócia; troca de senha obrigatória |
| `frontend/src/app/(site)/trocar-senha/page.tsx`, `(site)/login/page.tsx` | criar/modificar | troca obrigatória |
| `frontend/src/app/atuacao/api.ts`, `clientes/page.tsx`, `clientes/NovaEmpresaForm.tsx`, `clientes/[tenantId]/page.tsx` | modificar/criar | cadastrar empresa; "Abrir como empresa" |
| `frontend/src/app/empresa/layout.tsx`, `dashboard-v2/layout.tsx`, `components/dashboard/EmpresaShell.tsx`, `lib/dashboard/menu.ts` | modificar | faixa, menu filtrado, sem aviso de assinatura |
| `docs/operations/release-socio-atua-empresa-2026-11.md` | criar | passo a passo de release e retorno |

---

### Task 0: Workspace e ensaio descartável

**Files:** nenhum arquivo do repositório.

- [ ] **Step 1: criar o worktree a partir da linhagem do painel**

```bash
git -C /opt/Montese worktree add /opt/montese-work/socio-atua-empresa -b feat/socio-atua-empresa release/painel-evelyn-20261103
git -C /opt/montese-work/socio-atua-empresa log --oneline -1
ls /opt/montese-work/socio-atua-empresa/backend/db/migrations | tail -3
```
Esperado: último arquivo `0105_documento_base_pgr.sql`. Se `0106*`/`0108*` aparecerem, ajustar o número da migration da Task 1.

- [ ] **Step 2: instalar dependências no worktree**

```bash
cd /opt/montese-work/socio-atua-empresa/backend && npm ci > /tmp/claude-0/-opt-Montese/21bc59c2-db11-4f0e-8459-f81e31a3346f/scratchpad/npm-be.log 2>&1; echo $?
cd ../frontend && npm ci > /tmp/claude-0/-opt-Montese/21bc59c2-db11-4f0e-8459-f81e31a3346f/scratchpad/npm-fe.log 2>&1; echo $?
```
Esperado: `0` nos dois. Sem rede: não improvisar; reportar ao proprietário.

- [ ] **Step 3: baseline dos testes unitários (anotar números)**

```bash
cd /opt/montese-work/socio-atua-empresa/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json --forceExit > /tmp/claude-0/-opt-Montese/21bc59c2-db11-4f0e-8459-f81e31a3346f/scratchpad/baseline-unit.log 2>&1; grep -E "^(Tests|Test Suites):" /tmp/claude-0/-opt-Montese/21bc59c2-db11-4f0e-8459-f81e31a3346f/scratchpad/baseline-unit.log
```
Registrar suítes que já falham (conhecidas: `r2-get-object`, `golden-dataset`, `tenant-context-callsites`). Qualquer falha nova depois deste ponto é regressão nossa.

- [ ] **Step 4: subir Postgres+Redis descartáveis** (método de `reference_ensaio_descartavel_isolado`; scripts do ensaio antigo podem ter sumido, recriar). Senhas **aleatórias**, nada de produção:

```bash
S=/tmp/claude-0/-opt-Montese/21bc59c2-db11-4f0e-8459-f81e31a3346f/scratchpad
PGPW=$(openssl rand -hex 16); APPPW=$(openssl rand -hex 16); RDPW=$(openssl rand -hex 16)
docker network create montese_ensaio_socio
docker run -d --name ensaio_socio_pg --network montese_ensaio_socio --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=$PGPW -e POSTGRES_DB=montese \
  -e POSTGRES_APP_USER=montese_app -e POSTGRES_APP_PASSWORD=$APPPW \
  -v /opt/montese-work/socio-atua-empresa/postgres/init:/docker-entrypoint-initdb.d:ro pgvector/pgvector:pg16
docker run -d --name ensaio_socio_redis --network montese_ensaio_socio redis:7-alpine redis-server --requirepass $RDPW
printf 'PGPW=%s\nAPPPW=%s\nRDPW=%s\n' $PGPW $APPPW $RDPW > $S/ensaio-socio.secrets && chmod 600 $S/ensaio-socio.secrets
sleep 8; docker exec ensaio_socio_pg psql -U postgres -d montese -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

- [ ] **Step 5: aplicar as migrations 0001–0105 em ordem** (cada uma com `ON_ERROR_STOP` e registro em `_migrations` só depois de aplicar sem erro)

```bash
cd /opt/montese-work/socio-atua-empresa/backend/db/migrations
docker exec ensaio_socio_pg psql -U postgres -d montese -c "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())"
for f in $(ls *.sql | sort); do
  docker exec -i ensaio_socio_pg psql -U montese_app -d montese -v ON_ERROR_STOP=1 --single-transaction -f - < $f > /dev/null 2>$S/mig-err.log \
   && docker exec ensaio_socio_pg psql -U postgres -d montese -c "INSERT INTO _migrations(name) VALUES ('$f')" > /dev/null \
   || { echo "FALHOU $f"; cat $S/mig-err.log; break; }
done
docker exec ensaio_socio_pg psql -U postgres -d montese -tc "SELECT count(*), max(name) FROM _migrations"
```
Esperado: nenhuma linha `FALHOU`; `max(name)` = `0105_documento_base_pgr.sql`. Se alguma migration exigir superusuário/extensão, aplicar como `postgres` apenas essa e anotar.

- [ ] **Step 6: arquivo de ambiente do ensaio para jest** (fica só no scratchpad; chaves falsas)

```bash
cat > $S/ensaio-socio.env <<EOF
DATABASE_URL=postgresql://montese_app:$APPPW@ensaio_socio_pg:5432/montese
TEST_SUPERUSER_DATABASE_URL=postgresql://postgres:$PGPW@ensaio_socio_pg:5432/montese
REDIS_URL=redis://:$RDPW@ensaio_socio_redis:6379
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRES_IN=8h
NODE_ENV=test
PUBLIC_APP_URL=http://localhost:3000
GOOGLE_CLIENT_ID=fake
GOOGLE_CLIENT_SECRET=fake
GOOGLE_TOKEN_ENCRYPTION_KEY=$(printf 'b%.0s' $(seq 1 64))
EOF
chmod 600 $S/ensaio-socio.env
```
Comando-padrão para e2e nas tarefas seguintes (`SPEC` = nome do arquivo):

```bash
docker run --rm --network montese_ensaio_socio --env-file $S/ensaio-socio.env \
  -v /opt/montese-work/socio-atua-empresa/backend:/app:ro -w /app node:20-bookworm-slim \
  sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit --cacheDirectory /tmp/jc $SPEC" > $S/e2e-$SPEC.log 2>&1
```
- [ ] **Step 7: Checkpoint** — `git -C /opt/montese-work/socio-atua-empresa status --short` deve estar vazio.

---

### Task 1: Migration 0108 (coluna, permissões e funções SQL)

**Files:**
- Create: `backend/db/migrations/0108_socio_cadastra_atua_empresa.sql`
- Test: `backend/test/socio-empresa-funcoes.e2e-spec.ts`

**Interfaces — Produz (as próximas tarefas usam exatamente estes nomes):**
- `users.must_change_password BOOLEAN NOT NULL DEFAULT false`
- `auth_user_must_change_password(p_user_id UUID) RETURNS BOOLEAN` (sem contexto, usada no login)
- `auth_own_password_hash(p_user_id UUID) RETURNS TEXT` (exige `app.user_id = p_user_id`)
- `auth_change_password(p_user_id UUID, p_old_password_hash TEXT, p_new_password_hash TEXT) RETURNS TABLE(user_id UUID)` (compare-and-swap, limpa a flag; exige `app.user_id`)
- `socio_create_company(p_socio_id UUID, p_company_name TEXT, p_cnpj TEXT, p_email TEXT, p_password_hash TEXT, p_full_name TEXT) RETURNS TABLE(tenant_id UUID, user_id UUID)` (exige `app.role='socio'`, `app.user_id=p_socio_id`, permissão `empresas.criar`; erro `42501` caso contrário)
- `socio_can_act_on_tenant(p_socio_id UUID, p_tenant_id UUID) RETURNS BOOLEAN` (sócio ativo + `empresas.atuar` + `is_montese_tenant` + tenant `ativo`; exige `app.role='socio'` e `app.user_id=p_socio_id`, senão `false`)

- [ ] **Step 1: escrever o teste que falha** — `backend/test/socio-empresa-funcoes.e2e-spec.ts`

```ts
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb, TestUserFixture } from './db-test-helper';

// 0108: funções SQL do cadastro por sócio e do modo "atuar como empresa".
// Conexão na role da aplicação (sujeita a RLS). commit=true só onde o resultado precisa ser lido depois.
async function como<T>(
  ctx: { userId: string; role: string },
  fn: (c: Client) => Promise<T>,
  commit = false,
): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', '', true), set_config('app.role', $2, true)",
      [ctx.userId, ctx.role],
    );
    const out = await fn(client);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

const cnpj = () => String(Math.floor(Math.random() * 1e14)).padStart(14, '0');
const email = () => `socio-${randomUUID().slice(0, 8)}@teste.montese.local`;

describe('0108 — funções SQL do sócio (e2e DB)', () => {
  let db: TestDb;
  let socio: TestUserFixture;
  let semPermissao: TestUserFixture;
  let montese: { tenantId: string; userId: string };
  let comTecnico: { tenantId: string; userId: string };
  const criados: string[] = [];

  const conceder = (userId: string, ...perms: string[]) =>
    Promise.all(perms.map((p) => db.client.query('INSERT INTO socio_permissions (user_id, permission) VALUES ($1,$2)', [userId, p])));

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', 'Socio 0108');
    semPermissao = await db.createUserWithRole('socio', 'Socio sem permissao 0108');
    await conceder(socio.userId, 'empresas.criar', 'empresas.atuar');
    montese = await db.createTenantWithUser('Montese 0108');
    comTecnico = await db.createTenantWithUser('Com Tecnico 0108');
    const tecnico = await db.createUserWithRole('tecnico', 'Tec 0108');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1,$2)', [comTecnico.tenantId, tec.rows[0].id]);
    await db.client.query("UPDATE tenants SET status='ativo' WHERE id = ANY($1)", [[montese.tenantId, comTecnico.tenantId]]);
  }, 60000);

  afterAll(async () => {
    if (criados.length) await db.client.query('DELETE FROM tenants WHERE id = ANY($1)', [criados]);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1)', [[socio.userId, semPermissao.userId]]);
    await db.cleanup();
  });

  it('socio_create_company cria tenant ativo, usuário ativo com troca obrigatória e carteira', async () => {
    const em = email();
    const r = await como({ userId: socio.userId, role: 'socio' }, async (c) =>
      (await c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'Empresa Nova 0108', cnpj(), em, 'hash-fake', 'RH Teste'])).rows[0],
      true);
    criados.push(r.tenant_id);
    const t = (await db.client.query('SELECT status, plan FROM tenants WHERE id=$1', [r.tenant_id])).rows[0];
    const u = (await db.client.query('SELECT role, status, must_change_password, tenant_id FROM users WHERE id=$1', [r.user_id])).rows[0];
    const o = (await db.client.query('SELECT 1 FROM tenant_owners WHERE tenant_id=$1 AND user_id=$2', [r.tenant_id, socio.userId])).rowCount;
    expect(t).toEqual({ status: 'ativo', plan: 'trial' });
    expect(u).toEqual({ role: 'empresa', status: 'ativo', must_change_password: true, tenant_id: r.tenant_id });
    expect(o).toBe(1);
    const montese2 = (await db.client.query('SELECT is_montese_tenant($1) AS ok', [r.tenant_id])).rows[0].ok;
    expect(montese2).toBe(true);
  });

  it('socio_create_company recusa sócio sem empresas.criar', async () => {
    await expect(
      como({ userId: semPermissao.userId, role: 'socio' }, (c) =>
        c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [semPermissao.userId, 'X Empresa', cnpj(), email(), 'h', 'RH'])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('socio_create_company recusa papel diferente de socio e p_socio_id diferente do app.user_id', async () => {
    await expect(
      como({ userId: montese.userId, role: 'empresa' }, (c) =>
        c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [montese.userId, 'X Empresa', cnpj(), email(), 'h', 'RH'])),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      como({ userId: semPermissao.userId, role: 'socio' }, (c) =>
        c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'X Empresa', cnpj(), email(), 'h', 'RH'])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('socio_create_company propaga e-mail duplicado (23505)', async () => {
    const em = email();
    const r = await como({ userId: socio.userId, role: 'socio' }, async (c) =>
      (await c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'Dup A 0108', cnpj(), em, 'h', 'RH'])).rows[0], true);
    criados.push(r.tenant_id);
    await expect(
      como({ userId: socio.userId, role: 'socio' }, (c) =>
        c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'Dup B 0108', cnpj(), em, 'h', 'RH'])),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('socio_can_act_on_tenant: true só para empresa da Montese, com permissão, ativa', async () => {
    const pode = (uid: string, tid: string, role = 'socio', asUid = uid) =>
      como({ userId: asUid, role }, async (c) => (await c.query('SELECT socio_can_act_on_tenant($1,$2) AS ok', [uid, tid])).rows[0].ok);
    expect(await pode(socio.userId, montese.tenantId)).toBe(true);
    expect(await pode(socio.userId, comTecnico.tenantId)).toBe(false);       // vínculo com técnico
    expect(await pode(semPermissao.userId, montese.tenantId)).toBe(false);   // sem empresas.atuar
    expect(await pode(socio.userId, randomUUID())).toBe(false);              // tenant inexistente
    expect(await pode(socio.userId, montese.tenantId, 'empresa')).toBe(false); // papel errado
    expect(await pode(socio.userId, montese.tenantId, 'socio', semPermissao.userId)).toBe(false); // id ≠ app.user_id
    await db.client.query("UPDATE tenants SET status='inativo' WHERE id=$1", [montese.tenantId]);
    expect(await pode(socio.userId, montese.tenantId)).toBe(false);          // tenant inativo
    await db.client.query("UPDATE tenants SET status='ativo' WHERE id=$1", [montese.tenantId]);
  });

  it('vínculo criado depois derruba a permissão de atuar', async () => {
    const outro = await db.createTenantWithUser('Vira Tecnico 0108');
    await db.client.query("UPDATE tenants SET status='ativo' WHERE id=$1", [outro.tenantId]);
    const pode = () => como({ userId: socio.userId, role: 'socio' }, async (c) => (await c.query('SELECT socio_can_act_on_tenant($1,$2) AS ok', [socio.userId, outro.tenantId])).rows[0].ok);
    expect(await pode()).toBe(true);
    const tec = await db.createUserWithRole('tecnico', 'Tec Vinculo 0108');
    const t = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tec.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1,$2)', [outro.tenantId, t.rows[0].id]);
    expect(await pode()).toBe(false);
  });

  it('auth_user_must_change_password, auth_own_password_hash e auth_change_password', async () => {
    const em = email();
    const r = await como({ userId: socio.userId, role: 'socio' }, async (c) =>
      (await c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'Troca Senha 0108', cnpj(), em, 'hash-velho', 'RH'])).rows[0], true);
    criados.push(r.tenant_id);
    const ctx = { userId: r.user_id, role: 'empresa' };
    const flag = () => como(ctx, async (c) => (await c.query('SELECT auth_user_must_change_password($1) AS v', [r.user_id])).rows[0].v);
    expect(await flag()).toBe(true);
    expect(await como(ctx, async (c) => (await c.query('SELECT auth_own_password_hash($1) AS h', [r.user_id])).rows[0].h)).toBe('hash-velho');
    // outro usuário não lê o hash alheio
    await expect(como({ userId: socio.userId, role: 'socio' }, (c) => c.query('SELECT auth_own_password_hash($1)', [r.user_id]))).resolves.toMatchObject({ rows: [{ auth_own_password_hash: null }] });
    // hash antigo errado: nenhuma linha
    expect((await como(ctx, (c) => c.query('SELECT * FROM auth_change_password($1,$2,$3)', [r.user_id, 'errado', 'hash-novo'], ))).rowCount).toBe(0);
    expect((await como(ctx, (c) => c.query('SELECT * FROM auth_change_password($1,$2,$3)', [r.user_id, 'hash-velho', 'hash-novo']), true)).rowCount).toBe(1);
    expect(await flag()).toBe(false);
  });
});
```

- [ ] **Step 2: rodar e ver falhar**

```bash
SPEC=socio-empresa-funcoes.e2e-spec.ts   # + comando-padrão da Task 0
```
Esperado: FAIL — `function socio_create_company(...) does not exist` / coluna `must_change_password` inexistente.

- [ ] **Step 3: escrever a migration** — `backend/db/migrations/0108_socio_cadastra_atua_empresa.sql`

```sql
-- Sócia cadastra empresa (senha temporária) e atua como empresa.
-- Rollback (aditivo; seguro):
--   DROP FUNCTION socio_can_act_on_tenant(uuid,uuid), socio_create_company(uuid,text,text,text,text,text),
--     auth_change_password(uuid,text,text), auth_own_password_hash(uuid), auth_user_must_change_password(uuid);
--   ALTER TABLE users DROP COLUMN must_change_password;
--   DELETE FROM socio_permissions WHERE permission IN ('empresas.criar','empresas.atuar');
--   (restaurar o CHECK da 0104, sem as duas permissões novas)
--   DELETE FROM _migrations WHERE name = '0108_socio_cadastra_atua_empresa.sql';

ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE socio_permissions DROP CONSTRAINT IF EXISTS socio_permissions_permission_check;
ALTER TABLE socio_permissions ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (
  'clients.read','clients.update_operational','tasks.read','tasks.write','appointments.manage',
  'documents.create_draft','documents.review','documents.sign','documents.read','documents.approve',
  'documents.publish','documents.cancel','documents.view_registration','finance.read',
  'empresas.read','empresas.documentos','pgr.read','pgr.write',
  'checklists.read','checklists.write','checklists.approve',
  'alertas.read','alertas.manage',
  'empresas.criar','empresas.atuar'));

-- Privilégios mínimos para o dono (montese_auth_bypass) das funções abaixo (padrão 0003/0004/0058).
GRANT SELECT ON socio_permissions TO montese_auth_bypass;
GRANT INSERT ON tenant_owners TO montese_auth_bypass;

-- Usada no login (sem contexto de tenant): só devolve a flag do usuário já autenticado por senha.
CREATE FUNCTION auth_user_must_change_password(p_user_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT must_change_password FROM users WHERE id = p_user_id), false);
$$;
ALTER FUNCTION auth_user_must_change_password(uuid) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_user_must_change_password(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_user_must_change_password(uuid) TO montese_app;

-- O usuário só lê o PRÓPRIO hash (para conferir a senha atual na troca). Outro id => NULL.
CREATE FUNCTION auth_own_password_hash(p_user_id UUID) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.password_hash FROM users u
   WHERE u.id = p_user_id
     AND p_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;
ALTER FUNCTION auth_own_password_hash(uuid) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_own_password_hash(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_own_password_hash(uuid) TO montese_app;

-- Troca de senha autenticada: compare-and-swap no hash antigo (mesma técnica da 0058) e limpa a flag.
CREATE FUNCTION auth_change_password(p_user_id UUID, p_old_password_hash TEXT, p_new_password_hash TEXT)
RETURNS TABLE(user_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid THEN
    RETURN;
  END IF;
  RETURN QUERY
  UPDATE users u
     SET password_hash = p_new_password_hash, must_change_password = false
   WHERE u.id = p_user_id AND u.password_hash = p_old_password_hash AND u.status = 'ativo'
  RETURNING u.id;
END;
$$;
ALTER FUNCTION auth_change_password(uuid, text, text) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_change_password(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_change_password(uuid, text, text) TO montese_app;

-- Cadastro por sócio: tenant ATIVO (plano trial, como o autocadastro) + usuário 'empresa' ATIVO com troca de
-- senha obrigatória + carteira da sócia. Todas as checagens ficam no banco (defesa em profundidade).
CREATE FUNCTION socio_create_company(
  p_socio_id UUID, p_company_name TEXT, p_cnpj TEXT, p_email TEXT, p_password_hash TEXT, p_full_name TEXT
) RETURNS TABLE(tenant_id UUID, user_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
BEGIN
  IF current_setting('app.role', true) IS DISTINCT FROM 'socio'
     OR p_socio_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid
     OR NOT EXISTS (SELECT 1 FROM users s WHERE s.id = p_socio_id AND s.role = 'socio' AND s.status = 'ativo')
     OR NOT EXISTS (SELECT 1 FROM socio_permissions sp WHERE sp.user_id = p_socio_id AND sp.permission = 'empresas.criar')
  THEN
    RAISE EXCEPTION 'sem permissão para cadastrar empresa' USING ERRCODE = '42501';
  END IF;

  INSERT INTO tenants (name, cnpj, plan, status) VALUES (p_company_name, p_cnpj, 'trial', 'ativo')
  RETURNING id INTO v_tenant_id;

  INSERT INTO users (tenant_id, role, email, password_hash, full_name, status, must_change_password)
  VALUES (v_tenant_id, 'empresa', p_email, p_password_hash, p_full_name, 'ativo', true)
  RETURNING id INTO v_user_id;

  INSERT INTO tenant_owners (tenant_id, user_id, assigned_by) VALUES (v_tenant_id, p_socio_id, p_socio_id);

  RETURN QUERY SELECT v_tenant_id, v_user_id;
END;
$$;
ALTER FUNCTION socio_create_company(uuid, text, text, text, text, text) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION socio_create_company(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION socio_create_company(uuid, text, text, text, text, text) TO montese_app;

-- Única fonte da regra "a sócia pode atuar nesta empresa?". Reavaliada a CADA requisição pelo guard.
CREATE FUNCTION socio_can_act_on_tenant(p_socio_id UUID, p_tenant_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT current_setting('app.role', true) = 'socio'
     AND p_socio_id = NULLIF(current_setting('app.user_id', true), '')::uuid
     AND EXISTS (SELECT 1 FROM users s WHERE s.id = p_socio_id AND s.role = 'socio' AND s.status = 'ativo')
     AND EXISTS (SELECT 1 FROM socio_permissions sp WHERE sp.user_id = p_socio_id AND sp.permission = 'empresas.atuar')
     AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant_id AND t.status = 'ativo')
     AND is_montese_tenant(p_tenant_id);
$$;
ALTER FUNCTION socio_can_act_on_tenant(uuid, uuid) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION socio_can_act_on_tenant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION socio_can_act_on_tenant(uuid, uuid) TO montese_app;
```
Obs.: `current_setting(...) = 'socio'` devolve NULL se a variável não existir; `AND` com NULL dá NULL, e `COALESCE` não é necessário porque o chamador compara com `=== true`. Para devolver `false` e não `NULL` no teste, envolver o corpo em `COALESCE((...), false)` se o Step 4 mostrar `null`.

- [ ] **Step 4: aplicar no ensaio e rodar o teste**

```bash
docker exec -i ensaio_socio_pg psql -U montese_app -d montese -v ON_ERROR_STOP=1 --single-transaction -f - < /opt/montese-work/socio-atua-empresa/backend/db/migrations/0108_socio_cadastra_atua_empresa.sql
docker exec ensaio_socio_pg psql -U postgres -d montese -c "INSERT INTO _migrations(name) VALUES ('0108_socio_cadastra_atua_empresa.sql')"
SPEC=socio-empresa-funcoes.e2e-spec.ts   # + comando-padrão da Task 0
grep -E "✓|✕|Tests:" $S/e2e-$SPEC.log
```
Esperado: 6 testes verdes. Se `socio_can_act_on_tenant` devolver `null` onde se esperava `false`, aplicar o `COALESCE` descrito acima e reaplicar (`CREATE OR REPLACE`).

- [ ] **Step 5: prova de que o teste protege (sabotagem)** — remover a checagem de permissão e ver o teste ficar vermelho:

```bash
docker exec ensaio_socio_pg psql -U postgres -d montese -c "CREATE OR REPLACE FUNCTION socio_can_act_on_tenant(a uuid, b uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS 'SELECT true'"
# rodar o spec de novo: o caso 'socio_can_act_on_tenant' DEVE falhar; depois reaplicar a 0108 inteira num banco novo ou recriar a função original
```
Reaplicar a definição original (copiar o bloco `CREATE FUNCTION socio_can_act_on_tenant` como `CREATE OR REPLACE`) e confirmar verde de novo.

- [ ] **Step 6: Checkpoint (sem commit)** — `git status --short` mostra só os 2 arquivos novos.

---

### Task 2: Tipos, permissões e `JwtStrategy`

**Files:**
- Modify: `backend/src/common/types.ts`, `backend/src/common/permissions.ts`, `backend/src/auth/strategies/jwt.strategy.ts`
- Test: `backend/test/jwt-strategy-atuacao.unit-spec.ts`

**Interfaces — Produz:** `AuthenticatedUser { id; tenantId; role; actingTenantId?: string; actingAs?: boolean; mustChangePassword?: boolean }`; claims JWT `act?: string` (uuid) e `mcp?: true`.

- [ ] **Step 1: teste que falha** — `backend/test/jwt-strategy-atuacao.unit-spec.ts`

```ts
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { PERMISSIONS } from '../src/common/permissions';

const U = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';

describe('JwtStrategy — atuação e troca de senha', () => {
  beforeAll(() => { process.env.JWT_SECRET = 'x'.repeat(32); });
  const s = () => new JwtStrategy();

  it('token comum não ganha campos de atuação', async () => {
    expect(await s().validate({ sub: U, tenantId: null, role: 'socio' })).toEqual({ id: U, tenantId: null, role: 'socio' });
  });
  it('socio com act válido carrega actingTenantId', async () => {
    expect(await s().validate({ sub: U, tenantId: null, role: 'socio', act: T })).toMatchObject({ id: U, role: 'socio', actingTenantId: T });
  });
  it.each(['empresa', 'tecnico', 'parceiro', 'admin'] as const)('act com role %s é recusado', async (role) => {
    await expect(s().validate({ sub: U, tenantId: T, role, act: T })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('act que não é uuid é recusado', async () => {
    await expect(s().validate({ sub: U, tenantId: null, role: 'socio', act: 'abc' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('mcp true vira mustChangePassword', async () => {
    expect(await s().validate({ sub: U, tenantId: T, role: 'empresa', mcp: true })).toMatchObject({ mustChangePassword: true });
  });
  it('purpose continua proibido', async () => {
    await expect(s().validate({ sub: U, tenantId: null, role: 'socio', purpose: 'email_confirmation' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('PERMISSIONS inclui as duas novas e tem 25 itens', () => {
    expect(PERMISSIONS).toEqual(expect.arrayContaining(['empresas.criar', 'empresas.atuar']));
    expect(PERMISSIONS).toHaveLength(25);
  });
});
```

- [ ] **Step 2: rodar e ver falhar**

```bash
cd /opt/montese-work/socio-atua-empresa/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json jwt-strategy-atuacao --forceExit > $S/u-jwt.log 2>&1; grep -E "✓|✕|Tests:" $S/u-jwt.log
```
Esperado: FAIL (campos ausentes; `PERMISSIONS` com 23).

- [ ] **Step 3: implementar**

`backend/src/common/types.ts` — substituir a interface:
```ts
export interface AuthenticatedUser {
  id: string;
  tenantId: string | null;
  role: UserRole;
  // Presente só no token de atuação da sócia (claim `act`); o ActingTenantGuard o revalida a cada requisição.
  actingTenantId?: string;
  // Definido SOMENTE pelo ActingTenantGuard depois da revalidação: a requisição roda como `empresa` do tenant X.
  actingAs?: boolean;
  // Claim `mcp`: senha temporária ainda não trocada.
  mustChangePassword?: boolean;
}
```
`backend/src/common/permissions.ts` — acrescentar ao final do array `'alertas.manage',`:
```ts
  'empresas.criar',
  'empresas.atuar',
```
`backend/src/auth/strategies/jwt.strategy.ts` — acrescentar `act?: string; mcp?: boolean;` em `JwtPayload`, a constante `const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;` no topo e trocar o `return` final de `validate`:
```ts
    const user: AuthenticatedUser = { id: payload.sub, tenantId: payload.tenantId, role: payload.role };
    if (payload.act !== undefined) {
      // Token de atuação: só o papel socio, com uuid válido. Qualquer outra combinação é forjada/errada.
      if (payload.role !== 'socio' || typeof payload.act !== 'string' || !UUID_RE.test(payload.act)) {
        throw new UnauthorizedException();
      }
      user.actingTenantId = payload.act;
    }
    if (payload.mcp === true) user.mustChangePassword = true;
    return user;
```

- [ ] **Step 4: rodar e ver passar** — mesmo comando do Step 2. Esperado: 7+ verdes. Depois `npx tsc --noEmit -p tsconfig.json` (em `backend`) = 0 erros.

- [ ] **Step 5: Checkpoint (sem commit).**

---

### Task 3: Guards `ActingTenantGuard` e `PasswordChangeRequiredGuard`

**Files:**
- Create: `backend/src/common/decorators/acting-allowed.decorator.ts`, `backend/src/common/decorators/allow-password-pending.decorator.ts`, `backend/src/common/guards/acting-tenant.guard.ts`, `backend/src/common/guards/password-change-required.guard.ts`
- Modify: `backend/src/app.module.ts` (provedores, entre `JwtAuthGuard` e `SubscriptionStatusGuard`)
- Test: `backend/test/acting-tenant-guard.unit-spec.ts`

**Interfaces — Produz:** `ActingAllowed(): MethodDecorator & ClassDecorator`, `ACTING_ALLOWED_KEY`, `AllowWhilePasswordPending()`, `ALLOW_PASSWORD_PENDING_KEY`; `ActingTenantGuard`, `PasswordChangeRequiredGuard`. Códigos de erro 403: `ACTING_ROUTE_DENIED`, `ACTING_NOT_ALLOWED`, `PASSWORD_CHANGE_REQUIRED`.

- [ ] **Step 1: teste que falha** — `backend/test/acting-tenant-guard.unit-spec.ts`

```ts
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActingTenantGuard } from '../src/common/guards/acting-tenant.guard';
import { PasswordChangeRequiredGuard } from '../src/common/guards/password-change-required.guard';
import { ACTING_ALLOWED_KEY } from '../src/common/decorators/acting-allowed.decorator';
import { ALLOW_PASSWORD_PENDING_KEY } from '../src/common/decorators/allow-password-pending.decorator';

const U = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';

function ctx(user: any, meta: Record<string, boolean> = {}) {
  const request: any = { user, method: 'GET', path: '/employees', ip: '1.1.1.1' };
  const handler = () => undefined;
  class Cls {}
  const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
  return { request, reflector, context: { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => handler, getClass: () => Cls } as any };
}
const dbCom = (ok: boolean | Error) => ({
  withTenantContext: jest.fn(async (_c: any, fn: any) => {
    if (ok instanceof Error) throw ok;
    return fn({ query: async () => ({ rows: [{ ok }] }) });
  }),
});
const audit = { log: jest.fn(async () => undefined) } as any;

describe('ActingTenantGuard', () => {
  it('sem actingTenantId não faz nada', async () => {
    const { context, request, reflector } = ctx({ id: U, tenantId: null, role: 'socio' });
    const db = dbCom(true);
    expect(await new ActingTenantGuard(reflector, db as any, audit).canActivate(context)).toBe(true);
    expect(db.withTenantContext).not.toHaveBeenCalled();
    expect(request.user.role).toBe('socio');
  });
  it('rota sem @ActingAllowed é negada (ACTING_ROUTE_DENIED) sem consultar o banco', async () => {
    const { context, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T });
    const db = dbCom(true);
    await expect(new ActingTenantGuard(reflector, db as any, audit).canActivate(context)).rejects.toMatchObject({ response: { code: 'ACTING_ROUTE_DENIED' } });
    expect(db.withTenantContext).not.toHaveBeenCalled();
  });
  it('banco diz não => ACTING_NOT_ALLOWED', async () => {
    const { context, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T }, { [ACTING_ALLOWED_KEY]: true });
    await expect(new ActingTenantGuard(reflector, dbCom(false) as any, audit).canActivate(context)).rejects.toMatchObject({ response: { code: 'ACTING_NOT_ALLOWED' } });
  });
  it('erro no banco falha fechado', async () => {
    const { context, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T }, { [ACTING_ALLOWED_KEY]: true });
    await expect(new ActingTenantGuard(reflector, dbCom(new Error('boom')) as any, audit).canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('banco diz sim => reescreve request.user como empresa do tenant X, preservando o id da sócia', async () => {
    const { context, request, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T }, { [ACTING_ALLOWED_KEY]: true });
    expect(await new ActingTenantGuard(reflector, dbCom(true) as any, audit).canActivate(context)).toBe(true);
    expect(request.user).toEqual({ id: U, tenantId: T, role: 'empresa', actingAs: true, actingTenantId: T });
  });
  it('rota pública não é tocada', async () => {
    const { context, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T }, { isPublic: true });
    const g = new ActingTenantGuard({ getAllAndOverride: (k: string) => (k === 'isPublic' ? true : undefined) } as any, dbCom(true) as any, audit);
    expect(await g.canActivate(context)).toBe(true);
    void reflector;
  });
});

describe('PasswordChangeRequiredGuard', () => {
  it('sem flag passa', () => {
    const { context, reflector } = ctx({ id: U, tenantId: T, role: 'empresa' });
    expect(new PasswordChangeRequiredGuard(reflector).canActivate(context)).toBe(true);
  });
  it('com flag e rota comum => PASSWORD_CHANGE_REQUIRED', () => {
    const { context, reflector } = ctx({ id: U, tenantId: T, role: 'empresa', mustChangePassword: true });
    expect(() => new PasswordChangeRequiredGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
  });
  it('com flag e rota @AllowWhilePasswordPending passa', () => {
    const { context, reflector } = ctx({ id: U, tenantId: T, role: 'empresa', mustChangePassword: true }, { [ALLOW_PASSWORD_PENDING_KEY]: true });
    expect(new PasswordChangeRequiredGuard(reflector).canActivate(context)).toBe(true);
  });
});
```
Nota: a rota pública usa `IS_PUBLIC_KEY` de `../decorators/public.decorator`; ajustar o teste para importar essa constante em vez de `'isPublic'` (ler o valor real no arquivo).

- [ ] **Step 2: rodar e ver falhar** (`... jest ... acting-tenant-guard`). Esperado: FAIL (módulos inexistentes).

- [ ] **Step 3: implementar**

`acting-allowed.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';

// Lista FECHADA de rotas em que a sócia pode atuar como empresa (token com claim `act`). Sem esta marca,
// o ActingTenantGuard nega. Nunca aplicar em pagamentos, vínculos de técnico/parceiro, auth, IA ou dados cadastrais.
export const ACTING_ALLOWED_KEY = 'acting_allowed';
export const ActingAllowed = () => SetMetadata(ACTING_ALLOWED_KEY, true);
```
`allow-password-pending.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';

// Rotas liberadas mesmo enquanto a senha é temporária (trocar a senha e "quem sou eu").
export const ALLOW_PASSWORD_PENDING_KEY = 'allow_password_pending';
export const AllowWhilePasswordPending = () => SetMetadata(ALLOW_PASSWORD_PENDING_KEY, true);
```
`acting-tenant.guard.ts`:
```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ACTING_ALLOWED_KEY } from '../decorators/acting-allowed.decorator';

const deny = (code: string, message: string) => new ForbiddenException({ statusCode: 403, message, code });

// Roda logo depois do JwtAuthGuard e ANTES de Subscription/Roles/Permissions. Quando o token traz `act`:
//  1. a rota precisa estar marcada @ActingAllowed (lista fechada);
//  2. o banco revalida, a cada requisição, que a sócia pode atuar naquele tenant (permissão, sócia ativa,
//     empresa ativa e SEM vínculo com técnico/parceiro — socio_can_act_on_tenant, migration 0108);
//  3. só então request.user vira { role:'empresa', tenantId:X } (id continua o da sócia), e todo o restante
//     (RolesGuard, TenantContextInterceptor, RLS) enxerga uma empresa comum. Falha SEMPRE fechada.
@Injectable()
export class ActingTenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.actingTenantId) return true;

    if (!this.reflector.getAllAndOverride<boolean>(ACTING_ALLOWED_KEY, targets)) {
      this.auditDenied(user, request, 'rota fora do modo atuação');
      throw deny('ACTING_ROUTE_DENIED', 'Esta área não está disponível no modo "atuar como empresa".');
    }

    let ok = false;
    try {
      ok = await this.db.withTenantContext({ userId: user.id, role: 'socio' }, async (client) => {
        const res = await client.query<{ ok: boolean }>('SELECT socio_can_act_on_tenant($1, $2) AS ok', [user.id, user.actingTenantId]);
        return res.rows[0]?.ok === true;
      });
    } catch {
      ok = false;
    }
    if (!ok) {
      this.auditDenied(user, request, 'empresa não permitida');
      throw deny('ACTING_NOT_ALLOWED', 'Você não pode atuar nesta empresa.');
    }

    request.user = { id: user.id, tenantId: user.actingTenantId, role: 'empresa', actingAs: true, actingTenantId: user.actingTenantId };
    return true;
  }

  private auditDenied(user: { id: string; actingTenantId?: string }, request: any, motivo: string): void {
    void this.audit
      .log({
        actorUserId: user.id, actorRole: 'socio', actorTenantId: null, action: 'atuacao.negada', resourceType: 'tenant',
        resourceId: user.actingTenantId ?? null, method: request.method, path: request.path, statusCode: 403,
        ipAddress: request.ip, detail: motivo,
      })
      ?.catch(() => undefined);
  }
}
```
`password-change-required.guard.ts`:
```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_PASSWORD_PENDING_KEY } from '../decorators/allow-password-pending.decorator';

// Senha temporária (claim `mcp`): tudo é bloqueado exceto as rotas marcadas @AllowWhilePasswordPending.
@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user?.mustChangePassword) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_PENDING_KEY, [context.getHandler(), context.getClass()])) return true;
    throw new ForbiddenException({
      statusCode: 403,
      message: 'Você precisa trocar a senha temporária antes de continuar.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }
}
```
`app.module.ts` — importar os dois guards e inserir logo após `{ provide: APP_GUARD, useClass: JwtAuthGuard },`:
```ts
    { provide: APP_GUARD, useClass: ActingTenantGuard },
    { provide: APP_GUARD, useClass: PasswordChangeRequiredGuard },
```
e atualizar o comentário de ordem ("ActingTenantGuard reescreve request.user antes de Subscription/Roles").

- [ ] **Step 4: rodar e ver passar**; `tsc --noEmit` = 0 erros. Rodar também `tenant-context-callsites` (`jest ... tenant-context-callsites`): o novo guard usa `db.withTenantContext`; se o teste exigir allowlist de arquivos, **não editar a ALLOWED às cegas**: ler como `ctx` é montado e incluir o guard só se for equivalente a `permissions.guard.ts` (mesmo padrão).

- [ ] **Step 5: Checkpoint (sem commit).**

---

### Task 4: Login com `mcp`, `change-password` e `JwtModule` exportado

**Files:**
- Modify: `backend/src/auth/auth.service.ts`, `backend/src/auth/auth.controller.ts`, `backend/src/auth/auth.module.ts`
- Create: `backend/src/auth/dto/change-password.dto.ts`
- Test: `backend/test/auth-change-password.unit-spec.ts` (+ ajustar mocks de testes existentes do `AuthService`)

**Interfaces — Consome:** funções SQL da Task 1; `AllowWhilePasswordPending` (Task 3). **Produz:** `AuthService.changePassword(user: AuthenticatedUser, current: string, next: string, ip?: string): Promise<{ access_token: string }>`; resposta do login com `user.mustChangePassword: boolean`; `POST /auth/change-password` body `{ current_password, new_password }`; `AuthModule` exporta `JwtModule`.

- [ ] **Step 1: localizar testes existentes que mockam o login** — `grep -rln "AuthService" backend/test backend/src --include=*spec.ts`. Rodá-los antes (devem estar verdes) para saber o que o segundo `query` do login vai quebrar.

- [ ] **Step 2: teste que falha** — `backend/test/auth-change-password.unit-spec.ts`

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/auth/auth.service';

const U = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';

function montar(hashAtual: string | null, trocou = true) {
  const queries: string[] = [];
  const client: any = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('auth_own_password_hash')) return { rows: [{ h: hashAtual }] };
      if (sql.includes('auth_change_password')) return { rows: trocou ? [{ user_id: U }] : [] };
      return { rows: [] };
    }),
  };
  const db: any = { withTenantContext: async (_c: any, fn: any) => fn(client), withoutTenantContext: async (fn: any) => fn(client) };
  const jwt: any = { sign: jest.fn(() => 'novo-token') };
  const audit: any = { log: jest.fn(async () => undefined) };
  return { svc: new AuthService(db, jwt, audit), jwt, audit, queries };
}

describe('AuthService.changePassword', () => {
  const user = { id: U, tenantId: T, role: 'empresa' as const, mustChangePassword: true };

  it('troca a senha e devolve token SEM mcp', async () => {
    const atual = await bcrypt.hash('Temporaria1', 4);
    const { svc, jwt } = montar(atual);
    const out = await svc.changePassword(user, 'Temporaria1', 'NovaSenha123', '1.1.1.1');
    expect(out).toEqual({ access_token: 'novo-token' });
    expect(jwt.sign).toHaveBeenCalledWith({ sub: U, tenantId: T, role: 'empresa' });
  });
  it('senha atual errada => 400 sem trocar', async () => {
    const atual = await bcrypt.hash('Temporaria1', 4);
    const { svc, queries } = montar(atual);
    await expect(svc.changePassword(user, 'errada', 'NovaSenha123')).rejects.toBeInstanceOf(BadRequestException);
    expect(queries.some((q) => q.includes('auth_change_password'))).toBe(false);
  });
  it('nova igual à atual => 400', async () => {
    const { svc } = montar(await bcrypt.hash('Temporaria1', 4));
    await expect(svc.changePassword(user, 'Temporaria1', 'Temporaria1')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('sócia atuando como empresa não troca senha', async () => {
    const { svc } = montar(await bcrypt.hash('x', 4));
    await expect(svc.changePassword({ ...user, actingAs: true }, 'x', 'NovaSenha123')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('corrida (CAS sem linha) => 400', async () => {
    const { svc } = montar(await bcrypt.hash('Temporaria1', 4), false);
    await expect(svc.changePassword(user, 'Temporaria1', 'NovaSenha123')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('nunca registra senhas na auditoria', async () => {
    const { svc, audit } = montar(await bcrypt.hash('Temporaria1', 4));
    await svc.changePassword(user, 'Temporaria1', 'NovaSenha123');
    expect(JSON.stringify(audit.log.mock.calls)).not.toMatch(/Temporaria1|NovaSenha123/);
  });
});
```

- [ ] **Step 3: rodar e ver falhar** (`changePassword is not a function`).

- [ ] **Step 4: implementar**

`dto/change-password.dto.ts`:
```ts
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  current_password: string;

  // Mesmas regras do cadastro: 72 bytes é o teto do bcrypt.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  new_password: string;
}
```
`auth.service.ts` — imports: `BadRequestException, ForbiddenException` de `@nestjs/common`, `AuthenticatedUser` de `../common/types`, `BCRYPT_COST` de `../common/auth/bcrypt-cost`. No `login`, **substituir** o bloco `const access_token = ...` e o `return`:
```ts
    const flag = await this.db.withoutTenantContext((client) =>
      client.query<{ v: boolean }>('SELECT auth_user_must_change_password($1) AS v', [user.id]),
    );
    const mustChangePassword = flag.rows[0]?.v === true;

    const access_token = this.jwt.sign({
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      ...(mustChangePassword ? { mcp: true } : {}),
    });
```
```ts
    return {
      access_token,
      user: { id: user.id, tenantId: user.tenant_id, role: user.role, mustChangePassword },
    };
```
Novo método no `AuthService`:
```ts
  async changePassword(user: AuthenticatedUser, current: string, next: string, ip?: string): Promise<{ access_token: string }> {
    // O token de atuação nunca troca a senha da empresa nem a da sócia dentro da empresa.
    if (user.actingAs) throw new ForbiddenException('Operação não disponível neste modo.');
    if (current === next) throw new BadRequestException('A nova senha deve ser diferente da atual.');

    const ctx = { userId: user.id, tenantId: user.tenantId ?? undefined, role: user.role };
    const hashAtual = await this.db.withTenantContext(ctx, async (client) =>
      (await client.query<{ h: string | null }>('SELECT auth_own_password_hash($1) AS h', [user.id])).rows[0]?.h ?? null,
    );
    const log = (action: string, statusCode: number) =>
      void this.audit.log({
        actorUserId: user.id, actorRole: user.role, actorTenantId: user.tenantId, action, resourceType: 'auth',
        resourceId: user.id, method: 'POST', path: '/auth/change-password', statusCode, ipAddress: ip,
      });
    if (!hashAtual || !(await bcrypt.compare(current, hashAtual))) {
      log('password_change_failure', 400);
      // 400 (não 401): o front trata 401 como sessão expirada e deslogaria o usuário.
      throw new BadRequestException('Senha atual incorreta.');
    }

    const novoHash = await bcrypt.hash(next, BCRYPT_COST);
    const trocou = await this.db.withTenantContext(ctx, (client) =>
      client.query('SELECT * FROM auth_change_password($1, $2, $3)', [user.id, hashAtual, novoHash]),
    );
    if (trocou.rows.length === 0) throw new BadRequestException('Não foi possível trocar a senha. Tente novamente.');

    log('password_changed', 200);
    return { access_token: this.jwt.sign({ sub: user.id, tenantId: user.tenantId, role: user.role }) };
  }
```
`auth.controller.ts` — imports: `ChangePasswordDto`, `AllowWhilePasswordPending`; acrescentar `@AllowWhilePasswordPending()` em cima do `@Get('me')` existente e este novo endpoint antes dele:
```ts
  @Roles('empresa', 'tecnico', 'parceiro', 'admin', 'socio')
  @SkipSubscriptionCheck()
  @AllowWhilePasswordPending()
  @RateLimit({
    limit: envInt('CHANGE_PASSWORD_RATE_LIMIT_MAX', 10),
    windowSeconds: envInt('CHANGE_PASSWORD_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('change-password')
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    return this.authService.changePassword(req.user, dto.current_password, dto.new_password, req.ip);
  }
```
`auth.module.ts` — adicionar `exports: [JwtModule],` ao `@Module`.

- [ ] **Step 5: rodar** o spec novo + os specs de `AuthService` existentes localizados no Step 1. Ajustar **apenas os mocks** que não respondem ao novo `SELECT auth_user_must_change_password` (devolver `{ rows: [{ v: false }] }`); não afrouxar asserts. `tsc --noEmit` = 0.

- [ ] **Step 6: Checkpoint (sem commit).**

---

### Task 5: Endpoint de cadastro da empresa (`POST /atuacao/clientes`)

**Files:**
- Create: `backend/src/atuacao/dto/criar-empresa.dto.ts`
- Modify: `backend/src/atuacao/atuacao.service.ts`, `backend/src/atuacao/atuacao.controller.ts`
- Test: `backend/test/atuacao-criar-empresa.unit-spec.ts`

**Interfaces — Consome:** `socio_create_company` (Task 1); `mapPgError` de `../common/pg-error.util`. **Produz:** `AtuacaoService.criarEmpresa(client: PoolClient, socioId: string, dto: CriarEmpresaDto, passwordHash: string): Promise<{ tenant_id: string; user_id: string }>`; `POST /atuacao/clientes` → `201 { tenant_id, user_id, email }`.

- [ ] **Step 1: teste que falha** — `backend/test/atuacao-criar-empresa.unit-spec.ts`

```ts
import { ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AtuacaoService } from '../src/atuacao/atuacao.service';
import { CriarEmpresaDto } from '../src/atuacao/dto/criar-empresa.dto';

const dto = (o: Record<string, unknown>) => plainToInstance(CriarEmpresaDto, o);
const valido = { company_name: 'Empresa Exemplo', cnpj: '11.222.333/0001-81', full_name: 'RH Exemplo', email: 'rh@exemplo.com.br', password: 'Temporaria1' };

describe('CriarEmpresaDto', () => {
  it('aceita payload válido e normaliza o CNPJ', async () => {
    const d = dto(valido);
    expect(await validate(d, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(d.cnpj).toBe('11222333000181');
  });
  it.each([
    ['cnpj inválido', { cnpj: '11111111111111' }],
    ['e-mail inválido', { email: 'sem-arroba' }],
    ['senha curta', { password: '123' }],
    ['senha acima de 72', { password: 'a'.repeat(73) }],
    ['campo extra', { role: 'admin' }],
  ])('recusa %s', async (_n, extra) => {
    const erros = await validate(dto({ ...valido, ...extra }), { whitelist: true, forbidNonWhitelisted: true });
    expect(erros.length).toBeGreaterThan(0);
  });
});

describe('AtuacaoService.criarEmpresa', () => {
  const clientCom = (impl: (sql: string, p: any[]) => any) => ({ query: jest.fn(async (sql: string, p: any[]) => impl(sql, p)) }) as any;

  it('chama socio_create_company com o hash (nunca a senha em claro)', async () => {
    const c = clientCom(() => ({ rows: [{ tenant_id: 't', user_id: 'u' }] }));
    const out = await new AtuacaoService().criarEmpresa(c, 's1', dto(valido), 'HASH');
    expect(out).toEqual({ tenant_id: 't', user_id: 'u' });
    const [sql, params] = c.query.mock.calls[0];
    expect(sql).toContain('socio_create_company');
    expect(params).toEqual(['s1', 'Empresa Exemplo', '11222333000181', 'rh@exemplo.com.br', 'HASH', 'RH Exemplo']);
    expect(JSON.stringify(c.query.mock.calls)).not.toContain('Temporaria1');
  });
  it('42501 do banco vira 403', async () => {
    const c = clientCom(() => { throw Object.assign(new Error('x'), { code: '42501' }); });
    await expect(new AtuacaoService().criarEmpresa(c, 's1', dto(valido), 'H')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('23505 vira conflito amigável (via mapPgError)', async () => {
    const c = clientCom(() => { throw Object.assign(new Error('dup'), { code: '23505', constraint: 'users_email_unique' }); });
    await expect(new AtuacaoService().criarEmpresa(c, 's1', dto(valido), 'H')).rejects.toMatchObject({ status: 409 });
  });
});
```
(Ajustar o CNPJ válido do teste se `IsValidCnpj` rejeitar; usar um CNPJ de teste já presente em outros specs: `grep -rn "cnpj" backend/test/*.unit-spec.ts | head`.)

- [ ] **Step 2: rodar e ver falhar.**

- [ ] **Step 3: implementar**

`dto/criar-empresa.dto.ts` (mesmas regras do `RegisterDto`):
```ts
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { IsValidCnpj } from '../../common/validators/is-valid-cnpj.decorator';
import { normalizeCnpj } from '../../common/validators/cnpj.util';

// Cadastro de empresa pela sócia. A senha é TEMPORÁRIA: o RH troca no primeiro acesso.
export class CriarEmpresaDto {
  @IsString() @MinLength(2) @MaxLength(200) company_name: string;

  @Transform(({ value }) => (typeof value === 'string' ? normalizeCnpj(value) : value))
  @IsValidCnpj()
  cnpj: string;

  @IsString() @MinLength(2) @MaxLength(200) full_name: string;

  @IsEmail() email: string;

  // bcrypt trunca acima de 72 bytes.
  @IsString() @MinLength(8) @MaxLength(72) password: string;
}
```
`atuacao.service.ts` — imports `ForbiddenException` (de `@nestjs/common`), `mapPgError` (`../common/pg-error.util`), `CriarEmpresaDto`; novo método na classe:
```ts
  // O hash vem pronto do controller: este serviço nunca vê a senha em claro.
  async criarEmpresa(client: PoolClient, socioId: string, dto: CriarEmpresaDto, passwordHash: string): Promise<{ tenant_id: string; user_id: string }> {
    try {
      const res = await client.query<{ tenant_id: string; user_id: string }>(
        'SELECT * FROM socio_create_company($1, $2, $3, $4, $5, $6)',
        [socioId, dto.company_name, dto.cnpj, dto.email, passwordHash, dto.full_name],
      );
      return { tenant_id: res.rows[0].tenant_id, user_id: res.rows[0].user_id };
    } catch (err) {
      if ((err as { code?: string })?.code === '42501') {
        throw new ForbiddenException({ statusCode: 403, message: 'Você não tem permissão para esta ação.', code: 'PERMISSION_DENIED' });
      }
      mapPgError(err);
    }
  }
```
`atuacao.controller.ts` — imports `Post, UsePipes, ValidationPipe, HttpCode` (se faltar), `bcrypt`, `BCRYPT_COST` (`../common/auth/bcrypt-cost`), `RateLimit` e `envInt` (`../common/rate-limit/rate-limit.decorator`, `../common/env`), `CriarEmpresaDto`. Novo handler, **antes** do `@Get('clientes/:tenantId')`:
```ts
  @RequirePermission('empresas.criar')
  @RateLimit({ limit: envInt('SOCIO_CREATE_COMPANY_RATE_LIMIT_MAX', 20), windowSeconds: envInt('SOCIO_CREATE_COMPANY_RATE_LIMIT_WINDOW_SECONDS', 3600), keyBy: 'ip' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('clientes')
  async criar(@Body() dto: CriarEmpresaDto, @Req() req: any) {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const out = await req.withTenantContext((c: any) => this.atuacao.criarEmpresa(c, req.user.id, dto, passwordHash));
    await this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action: 'empresa.criada_por_socio', resourceType: 'tenant',
      resourceId: out.tenant_id, method: req.method, path: '/atuacao/clientes', statusCode: 201, ipAddress: req.ip,
      detail: `usuário RH: ${out.user_id}`, // nunca e-mail/senha
    });
    return { tenant_id: out.tenant_id, user_id: out.user_id, email: dto.email };
  }
```
Conferir o nome/assinatura reais de `RateLimit`/`envInt` no `auth.controller.ts` (mesmos imports).

- [ ] **Step 4: rodar e ver passar**; `tsc --noEmit` = 0.

- [ ] **Step 5: Checkpoint (sem commit).**

---

### Task 6: Endpoint "atuar" (`POST /atuacao/clientes/:tenantId/atuar`)

**Files:**
- Modify: `backend/src/atuacao/atuacao.service.ts`, `atuacao.controller.ts`, `atuacao.module.ts`
- Test: `backend/test/atuacao-atuar.unit-spec.ts`

**Interfaces — Consome:** `socio_can_act_on_tenant` (Task 1); `JwtService` via `AuthModule` (Task 4). **Produz:** `AtuacaoService.podeAtuar(client, socioId, tenantId): Promise<{ name: string } | null>`; `export const ACTING_TOKEN_TTL_SECONDS = 1800` (em `atuacao.service.ts`); `POST /atuacao/clientes/:tenantId/atuar` → `{ access_token, expires_in: 1800, tenant: { id, name } }`.

- [ ] **Step 1: teste que falha**

```ts
import { AtuacaoService, ACTING_TOKEN_TTL_SECONDS } from '../src/atuacao/atuacao.service';

const clientCom = (rowsPorSql: Record<string, any[]>) => ({
  query: jest.fn(async (sql: string) => {
    const k = Object.keys(rowsPorSql).find((x) => sql.includes(x));
    return { rows: k ? rowsPorSql[k] : [] };
  }),
}) as any;

describe('AtuacaoService.podeAtuar', () => {
  it('TTL do token é 30 minutos', () => expect(ACTING_TOKEN_TTL_SECONDS).toBe(1800));
  it('devolve o nome quando o banco permite', async () => {
    const c = clientCom({ socio_can_act_on_tenant: [{ ok: true }], 'FROM tenants': [{ name: 'Empresa X' }] });
    expect(await new AtuacaoService().podeAtuar(c, 's', 't')).toEqual({ name: 'Empresa X' });
  });
  it('devolve null quando o banco nega (sem consultar o nome)', async () => {
    const c = clientCom({ socio_can_act_on_tenant: [{ ok: false }], 'FROM tenants': [{ name: 'Empresa X' }] });
    expect(await new AtuacaoService().podeAtuar(c, 's', 't')).toBeNull();
    expect(c.query).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: rodar e ver falhar.**

- [ ] **Step 3: implementar**

`atuacao.service.ts`:
```ts
export const ACTING_TOKEN_TTL_SECONDS = 1800;
```
```ts
  async podeAtuar(client: PoolClient, socioId: string, tenantId: string): Promise<{ name: string } | null> {
    const ok = await client.query<{ ok: boolean }>('SELECT socio_can_act_on_tenant($1, $2) AS ok', [socioId, tenantId]);
    if (ok.rows[0]?.ok !== true) return null;
    const t = await client.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenantId]);
    return t.rows[0] ? { name: t.rows[0].name } : null;
  }
```
`atuacao.module.ts` — `imports: [AuthModule],` no `@Module`. `atuacao.controller.ts` — injetar `private readonly jwt: JwtService` no construtor (import de `@nestjs/jwt`), `ForbiddenException`, `ACTING_TOKEN_TTL_SECONDS`; handler:
```ts
  @RequirePermission('empresas.atuar')
  @Post('clientes/:tenantId/atuar')
  async atuar(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Req() req: any) {
    // Token de atuação nunca gera outro token de atuação: o ActingTenantGuard nega /atuacao/* no modo atuação.
    const tenant = await req.withTenantContext((c: any) => this.atuacao.podeAtuar(c, req.user.id, tenantId));
    if (!tenant) {
      throw new ForbiddenException({ statusCode: 403, message: 'Você não pode atuar nesta empresa.', code: 'ACTING_NOT_ALLOWED' });
    }
    const access_token = this.jwt.sign(
      { sub: req.user.id, tenantId: null, role: 'socio', act: tenantId },
      { expiresIn: ACTING_TOKEN_TTL_SECONDS },
    );
    await this.audit.log({
      actorUserId: req.user.id, actorRole: 'socio', actorTenantId: null, action: 'atuacao.iniciada', resourceType: 'tenant',
      resourceId: tenantId, method: req.method, path: req.path, statusCode: 201, ipAddress: req.ip,
    });
    return { access_token, expires_in: ACTING_TOKEN_TTL_SECONDS, tenant: { id: tenantId, name: tenant.name } };
  }
```
Atualizar o construtor: `constructor(private readonly atuacao: AtuacaoService, private readonly audit: AuditService, private readonly jwt: JwtService) {}` e corrigir qualquer `new AtuacaoController(...)` em testes existentes (`grep -rn "new AtuacaoController" backend/test`).

- [ ] **Step 4: rodar e ver passar**; `tsc --noEmit` = 0; rodar os specs `atuacao-*.unit-spec` existentes.

- [ ] **Step 5: Checkpoint (sem commit).**

---

### Task 7: Auditoria registra a sócia quando atuando

**Files:**
- Modify: `backend/src/common/interceptors/audit.interceptor.ts`
- Test: `backend/test/audit-interceptor-atuacao.unit-spec.ts`

- [ ] **Step 1: teste que falha**

```ts
import { of } from 'rxjs';
import { AuditInterceptor } from '../src/common/interceptors/audit.interceptor';

function rodar(user: any) {
  const log = jest.fn(async () => undefined);
  const request: any = { method: 'POST', route: { path: '/employees' }, path: '/employees', originalUrl: '/employees', url: '/employees', params: {}, ip: '1.1.1.1', user };
  const context: any = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 201 }) }) };
  return new Promise<jest.Mock>((resolve) => {
    new AuditInterceptor({ log } as any).intercept(context, { handle: () => of({ id: 'x' }) } as any).subscribe({ complete: () => resolve(log) });
  });
}

describe('AuditInterceptor — atuação', () => {
  it('empresa comum: ator empresa, sem detail', async () => {
    const log = await rodar({ id: 'u', tenantId: 't', role: 'empresa' });
    expect(log.mock.calls[0][0]).toMatchObject({ actorUserId: 'u', actorRole: 'empresa', actorTenantId: 't', detail: null });
  });
  it('atuando: ator socio (id da sócia), tenant atuado e detail', async () => {
    const log = await rodar({ id: 'socia', tenantId: 'X', role: 'empresa', actingAs: true });
    expect(log.mock.calls[0][0]).toMatchObject({ actorUserId: 'socia', actorRole: 'socio', actorTenantId: 'X', detail: 'atuando_como_empresa' });
  });
});
```

- [ ] **Step 2: ver falhar.** **Step 3: implementar** — em `finish`, trocar:
```ts
        actorRole: user?.actingAs ? 'socio' : (user?.role ?? null),
```
e acrescentar no objeto do `audit.log`: `detail: user?.actingAs ? 'atuando_como_empresa' : null,`.

- [ ] **Step 4: ver passar.** Rodar também o spec existente do interceptor (`grep -rln "AuditInterceptor" backend/test`) — se um assert comparar o objeto inteiro, acrescentar `detail: null`.

- [ ] **Step 5: Checkpoint (sem commit).**

---

### Task 8: Lista fechada de controllers `@ActingAllowed()`

**Files:**
- Modify: controllers abaixo (um `@ActingAllowed()` a nível de classe, logo abaixo de `@Controller(...)`)
- Test: `backend/test/acting-allowed-lista.unit-spec.ts`

**Interfaces — Consome:** `ActingAllowed` (Task 3).

- [ ] **Step 1: descobrir o que as telas realmente chamam** (fonte da verdade da lista; não confiar na memória)

```bash
cd /opt/montese-work/socio-atua-empresa/frontend/src
grep -rhoE "(/api)?/(employees|positions|company-units|documents|epi[a-z-]*|cipa|fire-brigade|fire-safety-equipment|inspections|action-plans|emergency-drill|prevention[a-z-]*|sst-checklist|pente-fino|dashboard|overview|nr-conformidade|caepi|cnpj-lookup|tenants|subscriptions|assistant|visits|payments|ai[a-z-]*)[A-Za-z0-9_/\-]*" app/empresa app/dashboard-v2 components lib 2>/dev/null | sed 's#^/api##' | awk -F/ '{print "/"$2}' | sort | uniq -c | sort -rn > /tmp/claude-0/-opt-Montese/21bc59c2-db11-4f0e-8459-f81e31a3346f/scratchpad/rotas-usadas.txt
cat /tmp/claude-0/-opt-Montese/21bc59c2-db11-4f0e-8459-f81e31a3346f/scratchpad/rotas-usadas.txt
cd ../../backend/src && grep -rn "^@Controller(" --include=*.controller.ts . | sed "s#:.*@Controller(# -> #; s#)##"
```
Para cada prefixo usado pelas telas, achar o `*.controller.ts` correspondente. Regra de decisão:
  - dados operacionais da empresa (funcionários, cargos, unidades, documentos, EPIs, CIPA, brigada, equipamentos, inspeções/planos, simulados, checklists, pente-fino, dashboard, overview, conformidade NR, consulta CA, CNPJ lookup) → **ACTING_ALLOWED**;
  - `subscriptions`, `payments`, `tenant-technicians`, `partners`, `assistant`, `ai-*`, `visits`, `auth` → **FORBIDDEN** (a tela correspondente é ocultada na Task 13);
  - `tenants`: só `GET me` (marca a nível de **método**, o `EmpresaShell` precisa do nome/logo).
Registrar a decisão final na tabela da seção 3 do spec (lista fechada atualizada) se divergir do rascunho abaixo.

- [ ] **Step 2: escrever o teste da lista fechada** — `backend/test/acting-allowed-lista.unit-spec.ts`

```ts
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', 'src');
function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return controllers(p);
    return p.endsWith('.controller.ts') ? [relative(SRC, p).replace(/\\/g, '/')] : [];
  });
}
const marcados = () => controllers(SRC).filter((f) => readFileSync(join(SRC, f), 'utf8').includes('@ActingAllowed(')).sort();

// LISTA FECHADA. Mudar aqui exige atualizar a seção 3 do spec e passar por revisão de segurança.
const PERMITIDOS = [
  'cipa/committees.controller.ts', 'cipa/dds.controller.ts', 'cipa/elections.controller.ts', 'cipa/meetings.controller.ts',
  'cipa/members.controller.ts', 'cipa/pendencias.controller.ts', 'cipa/sipat.controller.ts', 'cipa/trainings.controller.ts',
  'company-units/company-units.controller.ts', 'dashboard/dashboard.controller.ts', 'documents/documents.controller.ts',
  'emergency-drill/emergency-drill.controller.ts', 'employees/employees.controller.ts', 'epi/epis.controller.ts',
  'fire-brigade/fire-brigade.controller.ts', 'fire-safety-equipment/fire-safety-equipment.controller.ts',
  'inspections/action-plans.controller.ts', 'pente-fino/pente-fino.controller.ts', 'positions/positions.controller.ts',
  'prevention-corrective-actions/prevention-corrective-actions.controller.ts',
  'tenants/tenants.controller.ts', // SOMENTE o handler GET me (verificado abaixo)
  // + os que a descoberta do Step 1 acrescentar (epi/*, inspections/*, checklists...), sempre em ordem alfabética.
].sort();

const PROIBIDOS = [
  'payments/subscriptions.controller.ts', 'tenant-technicians/tenant-technicians.controller.ts', 'partners/partners.controller.ts',
  'auth/auth.controller.ts', 'normative/normative-assistant.controller.ts', 'visits/visits.controller.ts',
  'atuacao/atuacao.controller.ts',
];

describe('@ActingAllowed — lista fechada', () => {
  it('exatamente os controllers permitidos', () => expect(marcados()).toEqual(PERMITIDOS));
  it.each(PROIBIDOS)('%s nunca é liberado', (f) => {
    expect(readFileSync(join(SRC, f), 'utf8')).not.toContain('@ActingAllowed(');
  });
  it('em tenants, só o GET me', () => {
    const txt = readFileSync(join(SRC, 'tenants/tenants.controller.ts'), 'utf8');
    expect(txt.match(/@ActingAllowed\(/g)).toHaveLength(1);
    expect(txt).toMatch(/@ActingAllowed\(\)\s*[\r\n]+\s*@Get\('me'\)|@Get\('me'\)\s*[\r\n]+\s*@ActingAllowed\(\)/);
  });
});
```

- [ ] **Step 3: rodar e ver falhar** (lista de marcados vazia).

- [ ] **Step 4: aplicar a marca** — em cada controller de `PERMITIDOS` (exceto `tenants`): `import { ActingAllowed } from '<caminho relativo>/common/decorators/acting-allowed.decorator';` e `@ActingAllowed()` na linha logo abaixo de `@Controller(...)`. Em `tenants.controller.ts`: o mesmo import e `@ActingAllowed()` diretamente em cima de `@Get('me')`. Aplicar também aos controllers que o Step 1 apontar.

- [ ] **Step 5: rodar e ver passar**; `tsc --noEmit` = 0. Rodar `jest ... tenant-context-callsites` para garantir que nada mudou nessa trava.

- [ ] **Step 6: Checkpoint (sem commit).**

---

### Task 9: E2E HTTP de isolamento (critério de aceitação central)

**Files:**
- Test: `backend/test/socio-atua-empresa.e2e-spec.ts`

**Interfaces — Consome:** tudo das Tasks 1–8, rodando contra o **ensaio descartável** (com `0108` aplicada).

- [ ] **Step 1: descobrir rotas reais de leitura** — `grep -n "@Get" backend/src/employees/employees.controller.ts | head` (listagem de funcionários) e `grep -n "@Get\|@Controller" backend/src/documents/documents.controller.ts | head`. Usar nos testes abaixo o caminho exato da listagem (esperado: `GET /employees`); ajustar o corpo se a resposta for paginada.

- [ ] **Step 2: escrever o teste**

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { TestDb, TestUserFixture } from './db-test-helper';

process.env.RATE_LIMIT_MAX = '5000';

describe('socio atua como empresa — isolamento e papéis (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let socio: TestUserFixture;
  let semPerm: TestUserFixture;
  let admin: TestUserFixture;
  let tecnico: TestUserFixture;
  let A: any, B: any, C: any; // A,B = Montese; C = com técnico
  let tSocio: string, tSemPerm: string, tAdmin: string, tTec: string, tEmpA: string;
  const sufixo = randomUUID().slice(0, 8);
  const criados: string[] = [];

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const atuar = (t: string, tenantId: string) => request(app.getHttpServer()).post(`/atuacao/clientes/${tenantId}/atuar`).set(auth(t));
  const tokenDe = async (tenantId: string) => (await atuar(tSocio, tenantId)).body.access_token as string;
  const get = (t: string, path: string) => request(app.getHttpServer()).get(path).set(auth(t));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService).useValue({ createPreapproval: jest.fn() }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', `Socia ${sufixo}`);
    semPerm = await db.createUserWithRole('socio', `Socia sem perm ${sufixo}`);
    admin = await db.createUserWithRole('admin', `Admin ${sufixo}`);
    tecnico = await db.createUserWithRole('tecnico', `Tec ${sufixo}`);
    for (const p of ['empresas.atuar', 'empresas.criar', 'clients.read']) {
      await db.client.query('INSERT INTO socio_permissions (user_id, permission) VALUES ($1,$2)', [socio.userId, p]);
    }
    A = await db.createTenantWithUser(`A ${sufixo}`);
    B = await db.createTenantWithUser(`B ${sufixo}`);
    C = await db.createTenantWithUser(`C ${sufixo}`);
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1,$2)', [C.tenantId, tec.rows[0].id]);
    await db.client.query("UPDATE tenants SET status='ativo' WHERE id = ANY($1)", [[A.tenantId, B.tenantId, C.tenantId]]);
    [tSocio, tSemPerm, tAdmin, tTec, tEmpA] = await Promise.all([socio, semPerm, admin, tecnico, A].map(login));
  }, 90000);

  afterAll(async () => {
    if (criados.length) await db.client.query('DELETE FROM tenants WHERE id = ANY($1)', [criados]);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1)', [[socio.userId, semPerm.userId]]);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [[socio.userId]]);
    await db.cleanup();
    await app.close();
  });

  describe('emissão do token', () => {
    it('sócia com permissão obtém token para empresa Montese', async () => {
      const r = await atuar(tSocio, A.tenantId);
      expect(r.status).toBe(201);
      expect(r.body.expires_in).toBe(1800);
      expect(typeof r.body.access_token).toBe('string');
    });
    it('empresa com vínculo de técnico é recusada', async () => {
      const r = await atuar(tSocio, C.tenantId);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ACTING_NOT_ALLOWED');
    });
    it('sócia sem empresas.atuar é recusada', async () => expect((await atuar(tSemPerm, A.tenantId)).status).toBe(403));
    it.each([['empresa', () => tEmpA], ['tecnico', () => tTec], ['admin', () => tAdmin]])('papel %s não emite token', async (_n, tok) => {
      expect((await atuar(tok(), A.tenantId)).status).toBe(403);
    });
    it('tenant inexistente é recusado', async () => expect((await atuar(tSocio, randomUUID())).status).toBe(403));
  });

  describe('uso do token de atuação', () => {
    it('lê só os dados da empresa atuada', async () => {
      const t = await tokenDe(A.tenantId);
      const r = await get(t, '/employees');
      expect(r.status).toBe(200);
      const txt = JSON.stringify(r.body);
      expect(txt).toContain(A.employeeId);
      expect(txt).not.toContain(B.employeeId);
      expect(txt).not.toContain(C.employeeId);
    });
    it('tokens de empresas diferentes enxergam dados diferentes', async () => {
      const ta = await tokenDe(A.tenantId);
      const tb = await tokenDe(B.tenantId);
      expect(JSON.stringify((await get(tb, '/employees')).body)).toContain(B.employeeId);
      expect(JSON.stringify((await get(tb, '/employees')).body)).not.toContain(A.employeeId);
      expect(JSON.stringify((await get(ta, '/employees')).body)).not.toContain(B.employeeId);
    });
    it('rotas fora da lista fechada são negadas', async () => {
      const t = await tokenDe(A.tenantId);
      for (const path of ['/subscriptions/me', '/tenant-technicians/minha-empresa']) {
        const r = await get(t, path);
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('ACTING_ROUTE_DENIED');
      }
      expect((await request(app.getHttpServer()).post('/assistant').set(auth(t)).send({})).status).toBe(403);
      expect((await request(app.getHttpServer()).patch('/tenants/me').set(auth(t)).send({ name: 'X' })).status).toBe(403);
    });
    it('GET /tenants/me funciona (casca da empresa)', async () => expect((await get(await tokenDe(A.tenantId), '/tenants/me')).status).toBe(200));
    it('token de atuação não emite outro token nem lê /atuacao', async () => {
      const t = await tokenDe(A.tenantId);
      expect((await atuar(t, B.tenantId)).status).toBe(403);
      expect((await get(t, '/atuacao/clientes')).status).toBe(403);
    });
    it('não troca a senha no modo atuação', async () => {
      const t = await tokenDe(A.tenantId);
      const r = await request(app.getHttpServer()).post('/auth/change-password').set(auth(t)).send({ current_password: 'x', new_password: 'NovaSenha123' });
      expect(r.status).toBe(403);
    });
    it('vínculo com técnico criado DEPOIS derruba o token já emitido', async () => {
      const D = await db.createTenantWithUser(`D ${sufixo}`);
      await db.client.query("UPDATE tenants SET status='ativo' WHERE id=$1", [D.tenantId]);
      const t = await tokenDe(D.tenantId);
      expect((await get(t, '/employees')).status).toBe(200);
      const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]).catch(async () => db.client.query('SELECT id FROM technicians WHERE user_id=$1', [tecnico.userId]));
      await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1,$2)', [D.tenantId, tec.rows[0].id]);
      const r = await get(t, '/employees');
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ACTING_NOT_ALLOWED');
    });
    it('revogar empresas.atuar derruba o token já emitido', async () => {
      const t = await tokenDe(A.tenantId);
      await db.client.query("DELETE FROM socio_permissions WHERE user_id=$1 AND permission='empresas.atuar'", [socio.userId]);
      expect((await get(t, '/employees')).status).toBe(403);
      await db.client.query("INSERT INTO socio_permissions (user_id, permission) VALUES ($1,'empresas.atuar')", [socio.userId]);
    });
    it('auditoria grava a sócia como ator, com o tenant atuado', async () => {
      const t = await tokenDe(A.tenantId);
      await request(app.getHttpServer()).post('/employees').set(auth(t)).send({}); // 400 esperado; a auditoria registra mesmo assim
      await new Promise((r) => setTimeout(r, 300));
      const rows = (await db.client.query(
        "SELECT actor_role, actor_tenant_id, detail FROM audit_log WHERE actor_user_id=$1 AND detail='atuando_como_empresa' ORDER BY occurred_at DESC LIMIT 1", [socio.userId])).rows;
      expect(rows[0]).toMatchObject({ actor_role: 'socio', actor_tenant_id: A.tenantId });
    });
  });

  describe('cadastro de empresa pela sócia', () => {
    const body = (o: object = {}) => ({
      company_name: `Nova ${sufixo}`, cnpj: '11.222.333/0001-81', full_name: 'RH Novo', email: `rh-${randomUUID().slice(0, 8)}@teste.montese.local`, password: 'Temporaria1', ...o,
    });
    const criar = (t: string, b: object) => request(app.getHttpServer()).post('/atuacao/clientes').set(auth(t)).send(b);

    it('cria empresa, login do RH exige troca, troca libera e o RH vê só a própria empresa', async () => {
      const b = body();
      const r = await criar(tSocio, b);
      expect(r.status).toBe(201);
      expect(JSON.stringify(r.body)).not.toContain('Temporaria1');
      criados.push(r.body.tenant_id);

      const lg = await request(app.getHttpServer()).post('/auth/login').send({ email: b.email, password: b.password });
      expect(lg.status).toBe(201);
      expect(lg.body.user.mustChangePassword).toBe(true);
      const bloqueada = await get(lg.body.access_token, '/employees');
      expect(bloqueada.status).toBe(403);
      expect(bloqueada.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await get(lg.body.access_token, '/auth/me')).status).toBe(200);

      const tr = await request(app.getHttpServer()).post('/auth/change-password').set(auth(lg.body.access_token)).send({ current_password: 'Temporaria1', new_password: 'SenhaDefinitiva9' });
      expect(tr.status).toBe(201);
      expect((await get(tr.body.access_token, '/employees')).status).toBe(200);
      const outra = await request(app.getHttpServer()).post('/auth/login').send({ email: b.email, password: 'SenhaDefinitiva9' });
      expect(outra.body.user.mustChangePassword).toBe(false);
      expect((await db.client.query('SELECT is_montese_tenant($1) AS ok', [r.body.tenant_id])).rows[0].ok).toBe(true);
    });
    it('recusa sem empresas.criar, papel errado e campos extras', async () => {
      expect((await criar(tSemPerm, body({ cnpj: '11.222.333/0001-81' }))).status).toBe(403);
      expect((await criar(tEmpA, body())).status).toBe(403);
      expect((await criar(tSocio, body({ role: 'admin' }))).status).toBe(400);
    });
    it('e-mail duplicado => 409', async () => {
      const b = body();
      const r1 = await criar(tSocio, b);
      criados.push(r1.body.tenant_id);
      expect((await criar(tSocio, { ...b, cnpj: '22.333.444/0001-81' })).status).toBe(409);
    });
  });
});
```
Ajustes obrigatórios ao rodar: usar CNPJs válidos e **distintos** por teste (o CNPJ é único); o `IsValidCnpj` aceita só dígito verificador correto — gerar com a função de `cnpj.util` ou reutilizar o utilitário de teste existente (`grep -rn "gerarCnpj\|validCnpj" backend/test | head`).

- [ ] **Step 3: rodar contra o ensaio e ver falhar/passar por etapas.** Primeiro rodar sem a Task 8 aplicada (esperado: vários vermelhos), depois com tudo aplicado.

```bash
SPEC=socio-atua-empresa.e2e-spec.ts   # + comando-padrão da Task 0
grep -E "✓|✕|Tests:" $S/e2e-$SPEC.log
```
Esperado final: **todos verdes**. Falhas por 500 em `/employees` etc. no modo atuação indicam código que usa `users`/`req.user.id` de forma incompatível com a sócia (tenant nulo): **esse é o risco principal do spec**. Investigar com `grep -rn "FROM users" backend/src | grep -v auth/` (achado inicial: `cipa/tenant-guards.ts` valida usuário↔tenant ao vincular membros; confirmar se bloqueia a CIPA no modo atuação). Para cada tela quebrada: corrigir o serviço **ou** retirar o controller de `PERMITIDOS`; nunca afrouxar RLS.

- [ ] **Step 4: sweep por tabela (prova de que o RLS vale no modo atuação)** — executar, no ensaio, o `tenant-isolation-sweep` existente: `SPEC=tenant-isolation-sweep.e2e-spec.ts`. Esperado verde (confirma que nada em RLS mudou). Se algum dos controllers liberados escrever em tabela sem policy `tenant_id = app.tenant_id`, o teste desta tarefa precisa de um caso a mais cobrindo essa tabela.

- [ ] **Step 5: sabotagem** — no ensaio, `CREATE OR REPLACE FUNCTION is_montese_tenant(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true'` e rodar o spec: o caso "empresa com vínculo de técnico é recusada" **deve falhar**. Restaurar a função original da 0091 depois.

- [ ] **Step 6: Checkpoint (sem commit).**

---

### Task 10: Frontend — `acting.ts`, faixa e guardas

**Files:**
- Create: `frontend/src/lib/acting.ts`, `frontend/src/components/ActingBanner.tsx`
- Modify: `frontend/src/lib/auth.ts`, `frontend/src/components/RoleGuard.tsx`, `frontend/src/app/empresa/layout.tsx`, `frontend/src/app/dashboard-v2/layout.tsx`
- Test: `frontend/src/lib/__tests__/acting.test.ts`, `frontend/src/components/__tests__/ActingBanner.test.tsx`

**Interfaces — Produz:** `startActing(token: string, expiresInSeconds: number, tenant: { id: string; name: string }): boolean`; `getActing(): ActingInfo | null`; `stopActing(): string | null` (restaura a sessão da sócia e devolve o `tenantId` em que estava); `restoreSocioSessionIfActing(): boolean`; `ActingInfo { tenantId: string; tenantName: string; expiresAt: number }`. Chaves em `localStorage`: `montese_acting`, `montese_socio_session`.

- [ ] **Step 1: teste que falha** — `frontend/src/lib/__tests__/acting.test.ts`

```ts
import { getActing, restoreSocioSessionIfActing, startActing, stopActing } from '../acting';

const loginSocio = () => {
  localStorage.setItem('montese_token', 'TOKEN-SOCIA');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u1', role: 'socio', tenantId: null }));
};

describe('acting', () => {
  beforeEach(() => localStorage.clear());

  it('startActing troca o slot do token por um usuário "empresa" e guarda a sessão da sócia', () => {
    loginSocio();
    expect(startActing('TOKEN-ACT', 1800, { id: 't1', name: 'Empresa X' })).toBe(true);
    expect(localStorage.getItem('montese_token')).toBe('TOKEN-ACT');
    expect(JSON.parse(localStorage.getItem('montese_user')!)).toEqual({ id: 'u1', role: 'empresa', tenantId: 't1' });
    expect(getActing()).toMatchObject({ tenantId: 't1', tenantName: 'Empresa X' });
    expect(getActing()!.expiresAt).toBeGreaterThan(Date.now());
  });
  it('stopActing restaura a sessão original e devolve o tenant', () => {
    loginSocio();
    startActing('TOKEN-ACT', 1800, { id: 't1', name: 'Empresa X' });
    expect(stopActing()).toBe('t1');
    expect(localStorage.getItem('montese_token')).toBe('TOKEN-SOCIA');
    expect(JSON.parse(localStorage.getItem('montese_user')!).role).toBe('socio');
    expect(getActing()).toBeNull();
    expect(localStorage.getItem('montese_socio_session')).toBeNull();
  });
  it('sem sessão não inicia', () => expect(startActing('T', 1800, { id: 't', name: 'x' })).toBe(false));
  it('stopActing fora do modo é no-op', () => { loginSocio(); expect(stopActing()).toBeNull(); expect(localStorage.getItem('montese_token')).toBe('TOKEN-SOCIA'); });
  it('restoreSocioSessionIfActing só age se estiver atuando', () => {
    loginSocio();
    expect(restoreSocioSessionIfActing()).toBe(false);
    startActing('TOKEN-ACT', 1800, { id: 't1', name: 'E' });
    expect(restoreSocioSessionIfActing()).toBe(true);
    expect(localStorage.getItem('montese_token')).toBe('TOKEN-SOCIA');
  });
});
```
`ActingBanner.test.tsx` (RTL; mock de `next/navigation`):
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { ActingBanner } from '../ActingBanner';
import { startActing } from '@/lib/acting';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

describe('ActingBanner', () => {
  beforeEach(() => { localStorage.clear(); replace.mockClear(); });

  it('não renderiza fora do modo atuação', () => {
    const { container } = render(<ActingBanner />);
    expect(container).toBeEmptyDOMElement();
  });
  it('mostra a empresa e o botão sair; sair volta à ficha da empresa', () => {
    localStorage.setItem('montese_token', 'T'); localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'socio', tenantId: null }));
    startActing('ACT', 1800, { id: 'tenant-1', name: 'Empresa X' });
    render(<ActingBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Você está atuando em Empresa X');
    fireEvent.click(screen.getByRole('button', { name: /sair do modo empresa/i }));
    expect(replace).toHaveBeenCalledWith('/atuacao/clientes/tenant-1');
    expect(localStorage.getItem('montese_token')).toBe('T');
  });
});
```

- [ ] **Step 2: rodar e ver falhar** (`cd frontend && npx jest src/lib/__tests__/acting.test.ts src/components/__tests__/ActingBanner.test.tsx > $S/fe-acting.log 2>&1`; confirmar o runner em `frontend/package.json`).

- [ ] **Step 3: implementar**

`frontend/src/lib/acting.ts`:
```ts
// Modo "atuar como empresa" (sócia). As páginas da empresa leem o token direto de localStorage['montese_token'];
// por isso o token de atuação ocupa esse slot e a sessão REAL da sócia fica guardada à parte. Quem autoriza é o
// backend (claim `act` + revalidação a cada requisição); aqui é só UX. Limitação conhecida: localStorage é
// compartilhado entre abas — abrir outra aba durante a atuação mostra a área da empresa.
const SOCIO_KEY = 'montese_socio_session';
const ACTING_KEY = 'montese_acting';

export interface ActingInfo { tenantId: string; tenantName: string; expiresAt: number }

export function getActing(): ActingInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ACTING_KEY);
    return raw ? (JSON.parse(raw) as ActingInfo) : null;
  } catch {
    return null;
  }
}

export function startActing(token: string, expiresInSeconds: number, tenant: { id: string; name: string }): boolean {
  const sessao = localStorage.getItem('montese_token');
  const userRaw = localStorage.getItem('montese_user');
  if (!sessao || !userRaw) return false;
  let userId: string;
  try { userId = (JSON.parse(userRaw) as { id: string }).id; } catch { return false; }
  if (!localStorage.getItem(SOCIO_KEY)) localStorage.setItem(SOCIO_KEY, JSON.stringify({ token: sessao, user: userRaw }));
  const info: ActingInfo = { tenantId: tenant.id, tenantName: tenant.name, expiresAt: Date.now() + expiresInSeconds * 1000 };
  localStorage.setItem(ACTING_KEY, JSON.stringify(info));
  localStorage.setItem('montese_token', token);
  localStorage.setItem('montese_user', JSON.stringify({ id: userId, role: 'empresa', tenantId: tenant.id }));
  return true;
}

// Restaura a sessão da sócia. Devolve o tenant em que estava atuando (ou null se não estava atuando).
export function stopActing(): string | null {
  const info = getActing();
  const backup = localStorage.getItem(SOCIO_KEY);
  if (!info || !backup) return null;
  try {
    const { token, user } = JSON.parse(backup) as { token: string; user: string };
    localStorage.setItem('montese_token', token);
    localStorage.setItem('montese_user', user);
  } catch {
    return null;
  }
  localStorage.removeItem(SOCIO_KEY);
  localStorage.removeItem(ACTING_KEY);
  return info.tenantId;
}

export function restoreSocioSessionIfActing(): boolean {
  return stopActing() !== null;
}
```
`frontend/src/components/ActingBanner.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getActing, stopActing, type ActingInfo } from '@/lib/acting';

// Faixa fixa do modo "atuar como empresa". Ao vencer o token (30 min), volta sozinha para a ficha da empresa.
export function ActingBanner() {
  const router = useRouter();
  const [info, setInfo] = useState<ActingInfo | null>(null);

  useEffect(() => { setInfo(getActing()); }, []);

  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => {
      const id = stopActing();
      router.replace(id ? `/atuacao/clientes/${id}?atuacao=expirada` : '/atuacao/clientes');
    }, Math.max(info.expiresAt - Date.now(), 0));
    return () => clearTimeout(t);
  }, [info, router]);

  if (!info) return null;
  return (
    <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900">
      <span>Você está atuando em <strong>{info.tenantName}</strong>. As ações ficam registradas em seu nome.</span>
      <button
        type="button"
        onClick={() => { const id = stopActing(); router.replace(id ? `/atuacao/clientes/${id}` : '/atuacao/clientes'); }}
        className="rounded-md border border-amber-700 bg-white px-3 py-1 font-semibold text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
      >
        Sair do modo empresa
      </button>
    </div>
  );
}
```
`lib/auth.ts` — import `restoreSocioSessionIfActing` e, no início de `sessionExpired()`:
```ts
  // Token de atuação vencido/recusado: volta para a sessão da sócia em vez de derrubar o login dela.
  if (restoreSocioSessionIfActing()) { window.location.href = '/atuacao/clientes?atuacao=expirada'; return; }
```
`RoleGuard.tsx` — antes de `if (!token || !user || isTokenExpired(token))` acrescentar:
```ts
    if (token && isTokenExpired(token) && restoreSocioSessionIfActing()) {
      setState('redirecionando');
      router.replace('/atuacao/clientes?atuacao=expirada');
      return;
    }
```
(import `restoreSocioSessionIfActing` de `@/lib/acting`). `empresa/layout.tsx` e `dashboard-v2/layout.tsx` — importar `ActingBanner` e renderizá-lo como primeiro filho dentro de `<RoleGuard>`.

- [ ] **Step 4: rodar e ver passar**; rodar também `src/lib/__tests__/auth.test.ts` e os testes do `RoleGuard`/layouts existentes; `npx tsc --noEmit` (em `frontend`) = 0.

- [ ] **Step 5: Checkpoint (sem commit).**

---

### Task 11: Frontend — troca obrigatória de senha

**Files:**
- Create: `frontend/src/app/(site)/trocar-senha/page.tsx`
- Modify: `frontend/src/lib/auth.ts` (`SessionUser.mustChangePassword?: boolean`), `frontend/src/components/RoleGuard.tsx`, `frontend/src/app/(site)/login/page.tsx`
- Test: `frontend/src/app/(site)/trocar-senha/__tests__/page.test.tsx`

- [ ] **Step 1: teste que falha**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TrocarSenhaPage from '../page';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: push }) }));

describe('/trocar-senha', () => {
  beforeEach(() => {
    localStorage.clear(); push.mockClear();
    localStorage.setItem('montese_token', 'T-ANTIGO');
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'empresa', tenantId: 't', mustChangePassword: true }));
    global.fetch = jest.fn(async () => ({ ok: true, status: 201, json: async () => ({ access_token: 'T-NOVO' }) })) as any;
  });

  it('valida confirmação e tamanho antes de enviar', () => {
    render(<TrocarSenhaPage />);
    fireEvent.change(screen.getByLabelText('Senha temporária'), { target: { value: 'Temporaria1' } });
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'curta' } });
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'outra' } });
    fireEvent.click(screen.getByRole('button', { name: /trocar senha/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('troca, guarda o token novo, limpa a flag e vai para a home do papel', async () => {
    render(<TrocarSenhaPage />);
    fireEvent.change(screen.getByLabelText('Senha temporária'), { target: { value: 'Temporaria1' } });
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'SenhaDefinitiva9' } });
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'SenhaDefinitiva9' } });
    fireEvent.click(screen.getByRole('button', { name: /trocar senha/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard-v2'));
    expect(localStorage.getItem('montese_token')).toBe('T-NOVO');
    expect(JSON.parse(localStorage.getItem('montese_user')!).mustChangePassword).toBe(false);
  });
});
```

- [ ] **Step 2: ver falhar.**

- [ ] **Step 3: implementar** — `page.tsx` (`'use client'`; formulário com 3 campos `type="password"`, `autoComplete="current-password"`/`"new-password"`, mensagens `role="alert"`, foco visível; `fetch('/api/auth/change-password', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${getToken()}` }, body: JSON.stringify({ current_password, new_password }) })`; sucesso: `localStorage.setItem('montese_token', data.access_token)`, atualizar `montese_user` com `{ ...user, mustChangePassword: false }`, `router.push(homeFor(user.role))`; erro: exibir `data.message` ou "Não foi possível trocar a senha."). Regras no cliente: nova senha 8–72 caracteres, igual à confirmação, diferente da temporária. `lib/auth.ts`: adicionar `mustChangePassword?: boolean` em `SessionUser`. `RoleGuard.tsx`: depois de validar token/usuário e **antes** do `allow.includes`, `if (user.mustChangePassword) { setState('redirecionando'); router.replace('/trocar-senha'); return; }`. `login/page.tsx`: logo após gravar `montese_user`, `if (data.user.mustChangePassword) { router.push('/trocar-senha'); return; }`.

- [ ] **Step 4: ver passar** + testes existentes de login (`grep -rln "login" frontend/src --include=*.test.tsx`) e `RoleGuard`; `tsc --noEmit` = 0.

- [ ] **Step 5: Checkpoint (sem commit).**

---

### Task 12: Frontend — "Cadastrar nova empresa" e "Abrir como empresa"

**Files:**
- Modify: `frontend/src/app/atuacao/api.ts`, `frontend/src/app/atuacao/clientes/page.tsx`, `frontend/src/app/atuacao/clientes/[tenantId]/page.tsx`
- Create: `frontend/src/app/atuacao/clientes/NovaEmpresaForm.tsx`
- Test: `frontend/src/app/atuacao/__tests__/nova-empresa.test.tsx`, `frontend/src/app/atuacao/__tests__/abrir-como-empresa.test.tsx`

**Interfaces — Consome:** `POST /atuacao/clientes`, `POST /atuacao/clientes/:id/atuar` (Tasks 5–6), `startActing` (Task 10). **Produz:** `CriarEmpresaInput { company_name; cnpj; full_name; email; password }` e `CriarEmpresaResultado { tenant_id; user_id; email }` em `api.ts`; `NovaEmpresaForm({ onCriada }: { onCriada: () => void })`.

- [ ] **Step 1: testes que falham**

`nova-empresa.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NovaEmpresaForm } from '../clientes/NovaEmpresaForm';

describe('NovaEmpresaForm', () => {
  const preencher = (senha = 'Temporaria1') => {
    fireEvent.change(screen.getByLabelText('Razão social'), { target: { value: 'Empresa Exemplo' } });
    fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '11.222.333/0001-81' } });
    fireEvent.change(screen.getByLabelText('Nome do responsável (RH)'), { target: { value: 'RH Exemplo' } });
    fireEvent.change(screen.getByLabelText('E-mail do RH'), { target: { value: 'rh@exemplo.com.br' } });
    fireEvent.change(screen.getByLabelText('Senha temporária'), { target: { value: senha } });
  };
  beforeEach(() => { localStorage.setItem('montese_token', 'T'); });

  it('mostra a senha uma única vez após criar, com aviso, e depois a esconde', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 201, json: async () => ({ tenant_id: 't', user_id: 'u', email: 'rh@exemplo.com.br' }) })) as any;
    const onCriada = jest.fn();
    render(<NovaEmpresaForm onCriada={onCriada} />);
    preencher();
    fireEvent.click(screen.getByRole('button', { name: /cadastrar empresa/i }));
    expect(await screen.findByText('Temporaria1')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/não será exibida novamente/i);
    expect(onCriada).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /concluir/i }));
    expect(screen.queryByText('Temporaria1')).not.toBeInTheDocument();
  });
  it('rejeita senha curta sem chamar a API', () => {
    global.fetch = jest.fn() as any;
    render(<NovaEmpresaForm onCriada={jest.fn()} />);
    preencher('123');
    fireEvent.click(screen.getByRole('button', { name: /cadastrar empresa/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('mostra a mensagem do servidor em conflito (409)', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 409, json: async () => ({ message: 'CNPJ ou e-mail já cadastrado.' }) })) as any;
    render(<NovaEmpresaForm onCriada={jest.fn()} />);
    preencher();
    fireEvent.click(screen.getByRole('button', { name: /cadastrar empresa/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/já cadastrado/i));
  });
});
```
`abrir-como-empresa.test.tsx`: render da ficha (`[tenantId]/page.tsx`) com `fetch` mockado devolvendo a ficha; clicar em **"Abrir como empresa"** chama `POST /api/atuacao/clientes/<id>/atuar`, grava o token (verificar `localStorage.getItem('montese_token') === 'ACT'`) e chama `router.push('/dashboard-v2')`; erro 403 mostra "Você não pode atuar nesta empresa." e **não** altera o token. (Copiar o `jest.mock('next/navigation')` e o mock de `useParams` de `clientes.test.tsx` existente.)

- [ ] **Step 2: ver falhar.**

- [ ] **Step 3: implementar**

`api.ts` — acrescentar os tipos e, em `atuacaoFetch`, **nenhuma mudança**. `NovaEmpresaForm.tsx` (`'use client'`): campos com `<label htmlFor>` + `INPUT` (mesma classe de `clientes/page.tsx`); CNPJ com a consulta existente apenas se já houver helper reutilizável (`grep -rn "cnpj-lookup" frontend/src | head`) — se não houver, sem consulta nesta entrega; validação no cliente (senha 8–72, e-mail com `@`); `atuacaoFetch<CriarEmpresaResultado>('/clientes', { method:'POST', body: JSON.stringify(input) })`; estado `criada` guarda `{ email, senha }` só em memória do componente; tela de sucesso com `<div role="status">` "Empresa cadastrada. Repasse o e-mail e a senha temporária ao RH por um canal seguro. **A senha não será exibida novamente.**", mostrando e-mail e senha e botão "Concluir" que limpa o estado. `clientes/page.tsx`: botão "Cadastrar nova empresa" (abre o formulário no próprio topo da página, `aria-expanded`), `onCriada={carregar}`. Ocultar o botão se a sócia não tiver `empresas.criar`: **não há endpoint de permissões do próprio usuário**; manter o botão visível e tratar 403 com `MSG_403` (o backend é a autoridade). `[tenantId]/page.tsx`: botão "Abrir como empresa" no cabeçalho da ficha:
```tsx
async function abrirComoEmpresa() {
  setAtuando(true); setErroAtuar(null);
  try {
    const r = await atuacaoFetch<{ access_token: string; expires_in: number; tenant: { id: string; name: string } }>(`/clientes/${tenantId}/atuar`, { method: 'POST' });
    if (!startActing(r.access_token, r.expires_in, r.tenant)) throw new Error('Sessão inválida. Entre novamente.');
    router.push('/dashboard-v2');
  } catch (e) {
    setErroAtuar((e as Error).message);
  } finally {
    setAtuando(false);
  }
}
```
Mostrar `?atuacao=expirada` como aviso "O modo empresa expirou. Abra novamente para continuar." (usar `useSearchParams`).

- [ ] **Step 4: ver passar**; testes existentes de `clientes` continuam verdes; `tsc --noEmit` = 0.

- [ ] **Step 5: Checkpoint (sem commit).**

---

### Task 13: Frontend — casca e menu no modo atuação

**Files:**
- Modify: `frontend/src/lib/dashboard/menu.ts`, `frontend/src/components/dashboard/DashboardSidebar.tsx` (ou o ponto onde `MENU_SETORES` é consumido), `frontend/src/components/dashboard/EmpresaShell.tsx`
- Test: `frontend/src/lib/__tests__/menu-atuando.test.ts`, caso novo em `frontend/src/components/dashboard/__tests__/shell.test.tsx`

**Interfaces — Produz:** `filtrarMenuAtuando(setores: MenuSetor[], bloqueados: readonly string[]): MenuSetor[]` e `HREFS_BLOQUEADOS_ATUANDO: readonly string[]` em `lib/dashboard/menu.ts`.

- [ ] **Step 1: levantar quais itens do menu levam a áreas bloqueadas** — ler `frontend/src/lib/dashboard/menu.ts` e cruzar cada `href` com `rotas-usadas.txt` (Task 8): itens cuja página chama `subscriptions`, `assistant`/IA, `visits`/agendamentos, `tenants` (PATCH/logo), `partners`/`tenant-technicians` entram em `HREFS_BLOQUEADOS_ATUANDO` (esperado no mínimo `'/empresa/assistente'`; conferir `agendamentos`, planos/assinatura e dados da empresa). Anotar a lista final no teste.

- [ ] **Step 2: teste que falha** — `menu-atuando.test.ts`

```ts
import { MENU_SETORES, HREFS_BLOQUEADOS_ATUANDO, filtrarMenuAtuando } from '../dashboard/menu';

describe('filtrarMenuAtuando', () => {
  it('remove os itens bloqueados e mantém o resto', () => {
    const out = filtrarMenuAtuando(MENU_SETORES, HREFS_BLOQUEADOS_ATUANDO);
    const hrefs = out.flatMap((s) => s.itens.map((i) => i.href));
    for (const h of HREFS_BLOQUEADOS_ATUANDO) expect(hrefs).not.toContain(h);
    expect(hrefs.length).toBeGreaterThan(0);
  });
  it('não deixa setor vazio', () => {
    const out = filtrarMenuAtuando(MENU_SETORES, HREFS_BLOQUEADOS_ATUANDO);
    expect(out.every((s) => s.itens.length > 0)).toBe(true);
  });
  it('assistente está bloqueado (IA fora do modo atuação)', () => expect(HREFS_BLOQUEADOS_ATUANDO).toContain('/empresa/assistente'));
});
```
(Ajustar `s.itens` ao nome real do campo de `MenuSetor` lido no Step 1.)

- [ ] **Step 3: ver falhar. Step 4: implementar**

```ts
export const HREFS_BLOQUEADOS_ATUANDO: readonly string[] = ['/empresa/assistente' /* + os do Step 1 */];

export function filtrarMenuAtuando(setores: MenuSetor[], bloqueados: readonly string[]): MenuSetor[] {
  return setores
    .map((s) => ({ ...s, itens: s.itens.filter((i) => !bloqueados.includes(i.href)) }))
    .filter((s) => s.itens.length > 0);
}
```
`DashboardSidebar`: no caso (3) "render padrão da empresa", usar `getActing() ? filtrarMenuAtuando(MENU_SETORES, HREFS_BLOQUEADOS_ATUANDO) : MENU_SETORES` (ler `getActing()` num `useEffect`/`useState` para não divergir entre servidor e cliente — inicial `MENU_SETORES`, atualizar após montar). `DashboardHeader`: o link `iaHref` também precisa sumir no modo atuação (verificar o componente e ocultar o botão da IA). `EmpresaShell`: `const [atuando, setAtuando] = useState(false)` (`useEffect(() => setAtuando(!!getActing()), [])`) e `{!atuando && <SubscriptionNotice />}` (a assinatura é rota fora da lista).

- [ ] **Step 5: ver passar**; rodar `shell.test.tsx`, `tecnico-shell.test.tsx` e as suítes de `empresa/__tests__` (regressão do visual da empresa comum); `tsc --noEmit` = 0.

- [ ] **Step 6: Checkpoint (sem commit).**

---

### Task 14: Verificação final, revisões e documento de release

**Files:**
- Create: `docs/operations/release-socio-atua-empresa-2026-11.md`
- Modify: `PROJECT_STATE.md` (nota curta; **na árvore principal só se o proprietário pedir** — por padrão deixar no worktree)

- [ ] **Step 1: suítes completas e comparação com o baseline da Task 0**

```bash
cd /opt/montese-work/socio-atua-empresa/backend
NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json --forceExit > $S/final-unit.log 2>&1; grep -E "^(Tests|Test Suites):" $S/final-unit.log
npx tsc --noEmit -p tsconfig.json; echo "tsc backend: $?"
npm run build > $S/build-be.log 2>&1; echo "build backend: $?"
cd ../frontend && npx tsc --noEmit; echo "tsc frontend: $?"
npx jest > $S/final-fe.log 2>&1; grep -E "^(Tests|Test Suites):" $S/final-fe.log
npm run build > $S/build-fe.log 2>&1; echo "build frontend: $?"
```
Esperado: **sem nenhuma falha além das conhecidas da Task 0**; `tsc` e `build` com código `0`. Registrar números reais no relatório (VERIFICADO só com o comando e o resultado).

- [ ] **Step 2: e2e no ensaio** — rodar `socio-empresa-funcoes`, `socio-atua-empresa`, `tenant-isolation-sweep`, `atuacao-permissoes`, `atuacao-empresas-rls` e os e2e de auth existentes (`register`, `login*`; atenção às falhas esperadas listadas em `reference_running_tests_in_throwaway_container`). Esperado verde nos novos.

- [ ] **Step 3: boot isolado do backend com imagem candidata** (opcional se o proprietário quiser imagens): `docker build` do worktree com tag `candidate-socio-atua-empresa-20261105`, subir **na rede do ensaio** sem publicar porta e sondar `/health` com `docker exec`. **Não** mexer em `latest` nem em containers de produção.

- [ ] **Step 4: revisão independente** — acionar os agentes (um por vez, com o diff real do worktree: `git -C /opt/montese-work/socio-atua-empresa diff release/painel-evelyn-20261103 --stat`):
  - `montese-seguranca`: foco em `ActingTenantGuard`, ordem dos guards, lista `@ActingAllowed`, funções SQL SECURITY DEFINER (search_path, `app.user_id`), vazamento de senha em log/auditoria, token de atuação, LGPD (dado de saúde acessível à sócia).
  - `montese-qa`: critérios de aceitação do spec seção 7, regressões de login/RoleGuard/menu.
  Corrigir achados críticos/altos antes de concluir; registrar os demais no relatório.

- [ ] **Step 5: escrever `docs/operations/release-socio-atua-empresa-2026-11.md`** com: ordem (backup `bash ops/backup-postgres.sh` → migration `0108` aplicada **pelo proprietário** (a trava da sessão bloqueia escrita no banco de produção; entregar o bloco de comando com SQL por stdin) → imagem backend → imagem frontend), checagens pós-release (`SELECT count(*) FROM _migrations WHERE name LIKE '0108%'`; `\d users` mostra `must_change_password`), concessão das permissões `empresas.criar`/`empresas.atuar` à Évelyn pela tela de admin, **retorno** (imagens anteriores; a coluna e as funções são aditivas e podem ficar), limitações (abas compartilham `localStorage`; token de atuação 30 min; IA e pagamentos fora do modo atuação; `SubscriptionStatusGuard` ainda bloqueia empresa com assinatura inativa também no modo atuação), pendências do dono (base legal/LGPD da sócia como operadora; IA no modo atuação; e-mail ao RH com a senha — hoje manual).

- [ ] **Step 6: Checkpoint final (sem commit)** — `git -C /opt/montese-work/socio-atua-empresa status --short` e `git diff --stat release/painel-evelyn-20261103`. Entregar ao proprietário: relatório com rótulos VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO, e a decisão de commit/merge/release que é dele.

---

## Autoavaliação do plano

**Cobertura do spec:** §3 (token, papel efetivo, revalidação, lista fechada) → Tasks 3, 6, 8; §4 (cadastro, senha temporária, troca obrigatória, permissões) → Tasks 1, 2, 4, 5, 11, 12; §5 (token, auditoria, recusa de outros papéis) → Tasks 6, 7, 9; §6 (frontend, faixa, menu) → Tasks 10, 12, 13; §7 (testes) → Tasks 1–13 + 14; §8 (entrega, retorno) → Task 14; §9 (riscos) → Task 9 Steps 3–5.

**Pontos que o executor DEVE confirmar contra o código (marcados no texto, não adivinhar):** caminho real da listagem de funcionários e CNPJs de teste válidos (Task 9); nomes dos campos de `MenuSetor` e hrefs bloqueados (Task 13); runner de jest do frontend (Task 10); mocks dos testes existentes de `AuthService`/`AtuacaoController` (Tasks 4 e 6); lista final de controllers `@ActingAllowed` (Task 8, sai do script de descoberta).

**Consistência de nomes:** `actingTenantId` / `actingAs` / `mustChangePassword` (Task 2) usados igual nas Tasks 3, 4, 7; funções SQL com a mesma assinatura em Tasks 1, 4, 5, 6; `ACTING_TOKEN_TTL_SECONDS = 1800` (Task 6) = `expires_in` do teste da Task 9 e do frontend (Task 10).
