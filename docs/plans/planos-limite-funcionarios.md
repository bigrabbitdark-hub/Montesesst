# Limite de funcionário por plano (enforcement real) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer `plans.employee_limit` valer de verdade — bloquear criação/reativação/importação de funcionário quando a empresa já está no limite do plano contratado.

**Architecture:** Um método novo em `SubscriptionsService` (`backend/src/payments/`) calcula o limite ativo de um tenant via JOIN `subscriptions`+`plans`. `EmployeesService` (`backend/src/employees/`) passa a injetar esse service e checar o limite em 3 pontos: criação única, reativação via update, e o loop compartilhado de importação em lote.

**Tech Stack:** NestJS + `pg` (Postgres real, sem migration nova — schema já existe).

**Spec:** `docs/specs/planos-limite-funcionarios.md`

## Global Constraints

- Trial (tenant sem assinatura `authorized`) nunca é bloqueado — `getActiveEmployeeLimit` devolve `null` nesse caso.
- Só `employees.status = 'ativo'` conta pro limite.
- Reativar (`PATCH` mudando `status` pra `'ativo'`) conta igual criar, mas só quando isso é uma mudança real (funcionário não já era `'ativo'`).
- `role === 'admin'` sempre bypassa a checagem, em qualquer um dos 3 pontos.
- Múltiplas assinaturas `authorized` simultâneas: usa o MAIOR `employee_limit` entre elas; qualquer uma sem limite (`NULL`, Enterprise) faz o resultado final ser `null` (sem limite).
- Rejeição de criação/reativação única: `ForbiddenException` (403), mensagem exata `Limite de ${limit} funcionários do plano atingido. Faça upgrade para adicionar mais.`.
- Importação em lote: nunca aborta o lote inteiro — linha que excederia o limite vira erro por linha (`motivo: 'Limite de funcionários do plano atingido'`), mesmo padrão já usado pra CPF/filial inválidos, resto do lote continua.
- Nenhuma migration nova, nenhuma mudança em `/planos`, nenhuma mudança no fluxo de assinatura em si.
- Testes: e2e reais (Postgres real via `TestDb`); fixture de "tenant com assinatura ativa" é um INSERT direto em `subscriptions` via o cliente de superuser do `TestDb` (nunca chama a API real do Mercado Pago).

---

### Task 1: Helper de limite + enforcement em criação única e reativação

**Files:**
- Modify: `backend/src/payments/subscriptions.service.ts` (novo método `getActiveEmployeeLimit`)
- Modify: `backend/src/payments/payments.module.ts` (exporta `SubscriptionsService`)
- Modify: `backend/src/employees/employees.module.ts` (importa `PaymentsModule`)
- Modify: `backend/src/employees/employees.service.ts` (`create`/`update` ganham parâmetro `callerRole`, novo helper privado `assertEmployeeLimitNotExceeded`)
- Modify: `backend/src/employees/employees.controller.ts` (`create`/`update` passam `req.user.role`)
- Test: `backend/test/employees-limit.e2e-spec.ts`

**Interfaces:**
- Produces: `SubscriptionsService.getActiveEmployeeLimit(client: PoolClient, tenantId: string): Promise<number | null>`; `EmployeesService.create(client, tenantId, data, callerRole: string)`; `EmployeesService.update(client, id, data, callerRole: string)` (assinaturas alteradas — Task 2 consome o mesmo padrão de `callerRole` pros métodos de import).

- [ ] **Step 1: Escrever o teste e2e (RED)**

Cria `backend/test/employees-limit.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

async function insertActiveEmployees(db: any, tenantId: string, count: number, cpfStart: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await db.client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, $2, $3, 'ativo')`,
      [tenantId, `Func Extra ${cpfStart + i}`, String(cpfStart + i)],
    );
  }
}

async function countActiveEmployees(db: any, tenantId: string): Promise<number> {
  const res = await db.client.query(`SELECT COUNT(*) FROM employees WHERE tenant_id = $1 AND status = 'ativo'`, [
    tenantId,
  ]);
  return parseInt(res.rows[0].count, 10);
}

async function authorizeSubscription(db: any, tenantId: string, planSlug: string): Promise<void> {
  const planRes = await db.client.query('SELECT id FROM plans WHERE slug = $1', [planSlug]);
  await db.client.query(
    `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
     VALUES ($1, $2, 'authorized', $3)`,
    [planRes.rows[0].id, tenantId, `test-preapproval-${tenantId}-${planSlug}`],
  );
}

describe('Limite de funcionário por plano (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('rejeita criar funcionário quando o tenant já está no limite do plano Start (10)', async () => {
    const tenant = await db.createTenantWithUser('Empresa Limite Start');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');

    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 10 - existing, 40000000000);
    expect(await countActiveEmployees(db, tenant.tenantId)).toBe(10);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Funcionário 11', cpf: '40000000099' });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Limite de 10 funcionários do plano atingido. Faça upgrade para adicionar mais.');
  });

  it('rejeita reativar funcionário inativo quando o tenant está no limite, mas aceita editar outro campo de um já ativo', async () => {
    const tenant = await db.createTenantWithUser('Empresa Limite Reativacao');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');

    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 10 - existing, 40000001000);
    const inactiveRes = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Inativo Teste', '40000001999', 'inativo') RETURNING id`,
      [tenant.tenantId],
    );
    const inactiveId = inactiveRes.rows[0].id;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    const reactivateRes = await request(app.getHttpServer())
      .patch(`/employees/${inactiveId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ativo' });
    expect(reactivateRes.status).toBe(403);

    const activeEmployeeId = tenant.employeeId;
    const editRes = await request(app.getHttpServer())
      .patch(`/employees/${activeEmployeeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ position: 'Cargo Editado' });
    expect(editRes.status).toBe(200);
  });

  it('admin bypassa o limite ao criar funcionário pra um tenant já no limite', async () => {
    const tenant = await db.createTenantWithUser('Empresa Limite Admin');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');
    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 10 - existing, 40000002000);

    const adminUser = await db.createUserWithRole('admin', 'Admin Limite Teste');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminUser.email, password: adminUser.password });
    const token = login.body.access_token;

    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Funcionário Via Admin', cpf: '40000002999', tenant_id: tenant.tenantId });

    expect(res.status).toBe(201);
  });

  it('tenant em trial (sem assinatura authorized) nunca é bloqueado', async () => {
    const tenant = await db.createTenantWithUser('Empresa Sem Assinatura');
    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 15 - existing, 40000003000);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Funcionário 16 Sem Plano', cpf: '40000003999' });

    expect(res.status).toBe(201);
  });

  it('duas assinaturas authorized simultâneas usam o maior limite (Premium 50, não Start 10)', async () => {
    const tenant = await db.createTenantWithUser('Empresa Duas Assinaturas');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-premium');

    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 10 - existing, 40000004000);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    // Já tem 10 funcionários (o limite do Start), mas a assinatura Premium
    // (limite 50) também está ativa — não deveria ser bloqueado ainda.
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Funcionário 11 Com Premium Ativo', cpf: '40000004999' });

    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Criar `docker-compose.override.yml` (mesmo padrão já estabelecido: bind mount `./backend:/app` + volume nomeado `/app/node_modules` + `NODE_ENV: development` + `TEST_SUPERUSER_DATABASE_URL` construído a partir de `${POSTGRES_SUPERUSER}`/`${POSTGRES_SUPERUSER_PASSWORD}`/`${POSTGRES_DB}`).

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- employees-limit"`
Expected: FAIL — nenhuma checagem de limite existe ainda, todos os `POST`/`PATCH` que deveriam devolver 403 devolvem 200/201.

- [ ] **Step 3: `getActiveEmployeeLimit` em `SubscriptionsService`**

Em `backend/src/payments/subscriptions.service.ts`, adiciona ao final da classe (antes do `}` de fechamento):

```typescript
  async getActiveEmployeeLimit(client: PoolClient, tenantId: string): Promise<number | null> {
    const result = await client.query<{ employee_limit: number | null }>(
      `SELECT p.employee_limit
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1 AND s.status = 'authorized'`,
      [tenantId],
    );
    if (result.rows.length === 0) return null;
    if (result.rows.some((row) => row.employee_limit === null)) return null;
    return Math.max(...result.rows.map((row) => row.employee_limit as number));
  }
```

- [ ] **Step 4: Exportar `SubscriptionsService` de `PaymentsModule`**

Em `backend/src/payments/payments.module.ts`, troca:
```typescript
  exports: [MercadoPagoService],
```
Por:
```typescript
  exports: [MercadoPagoService, SubscriptionsService],
```

- [ ] **Step 5: `EmployeesModule` importa `PaymentsModule`**

Em `backend/src/employees/employees.module.ts`, substitui o conteúdo inteiro por:

```typescript
import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
})
export class EmployeesModule {}
```

- [ ] **Step 6: `EmployeesService` — constructor, helper, `create`/`update`**

Em `backend/src/employees/employees.service.ts`:

Troca o import do topo:
```typescript
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
```
Por:
```typescript
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
```

Adiciona um import novo, junto dos demais imports do topo do arquivo:
```typescript
import { SubscriptionsService } from '../payments/subscriptions.service';
```

Adiciona o constructor logo no início da classe (`@Injectable()\nexport class EmployeesService {`), antes do método `assertCompanyUnitBelongsToTenant` já existente:
```typescript
  constructor(private readonly subscriptions: SubscriptionsService) {}

```

Adiciona o helper novo, logo depois de `assertCompanyUnitBelongsToTenant` (antes de `create`):
```typescript
  private async assertEmployeeLimitNotExceeded(client: PoolClient, tenantId: string, callerRole: string): Promise<void> {
    if (callerRole === 'admin') return;
    const limit = await this.subscriptions.getActiveEmployeeLimit(client, tenantId);
    if (limit === null) return;
    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) FROM employees WHERE tenant_id = $1 AND status = 'ativo'`,
      [tenantId],
    );
    const count = parseInt(countResult.rows[0].count, 10);
    if (count >= limit) {
      throw new ForbiddenException(`Limite de ${limit} funcionários do plano atingido. Faça upgrade para adicionar mais.`);
    }
  }

```

Troca a assinatura e o corpo de `create` — de:
```typescript
  async create(client: PoolClient, tenantId: string, data: CreateEmployeeData): Promise<Employee> {
    if (data.company_unit_id) {
```
Por:
```typescript
  async create(client: PoolClient, tenantId: string, data: CreateEmployeeData, callerRole: string): Promise<Employee> {
    await this.assertEmployeeLimitNotExceeded(client, tenantId, callerRole);
    if (data.company_unit_id) {
```

Troca a assinatura de `update` — de:
```typescript
  async update(client: PoolClient, id: string, data: UpdateEmployeeData): Promise<Employee> {
    if (data.company_unit_id) {
```
Por:
```typescript
  async update(client: PoolClient, id: string, data: UpdateEmployeeData, callerRole: string): Promise<Employee> {
    if (data.status === 'ativo') {
      const existing = await client.query<{ tenant_id: string; status: string }>(
        'SELECT tenant_id, status FROM employees WHERE id = $1',
        [id],
      );
      if (existing.rowCount === 0) throw new NotFoundException('Funcionário não encontrado');
      if (existing.rows[0].status !== 'ativo') {
        await this.assertEmployeeLimitNotExceeded(client, existing.rows[0].tenant_id, callerRole);
      }
    }
    if (data.company_unit_id) {
```

(O resto do corpo de `update` — os blocos de `company_unit_id`/`position_id`/`buildSafeSetClause` — continua exatamente igual, só a assinatura ganha o parâmetro novo e o bloco de `status` é inserido antes do bloco de `company_unit_id` já existente.)

- [ ] **Step 7: Controller passa `req.user.role`**

Em `backend/src/employees/employees.controller.ts`, troca:
```typescript
    return req.withTenantContext((client: any) =>
      this.employees.create(client, tenantId, {
        full_name: dto.full_name,
        cpf: dto.cpf,
        birth_date: dto.birth_date,
        position: dto.position,
        admission_date: dto.admission_date,
        company_unit_id: dto.company_unit_id,
      }),
    );
```
Por:
```typescript
    return req.withTenantContext((client: any) =>
      this.employees.create(
        client,
        tenantId,
        {
          full_name: dto.full_name,
          cpf: dto.cpf,
          birth_date: dto.birth_date,
          position: dto.position,
          admission_date: dto.admission_date,
          company_unit_id: dto.company_unit_id,
        },
        user.role,
      ),
    );
```

E troca:
```typescript
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.employees.update(client, id, dto));
  }
```
Por:
```typescript
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.employees.update(client, id, dto, req.user.role));
  }
```

- [ ] **Step 8: Rodar o teste, confirmar que passa**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- employees-limit"`
Expected: `Tests: 5 passed, 5 total`

- [ ] **Step 9: Regressão de `employees` e `payments`**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- employees"`
Expected: todas as suítes de `employees` já existentes continuam verdes (em especial as de import, que ainda não têm a checagem nesta task — Task 2 cuida delas).

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- payments"` (ou o padrão de nome real dos specs de planos/assinaturas, confirme com `ls backend/test/*payment* backend/test/*subscription* backend/test/*plan*` antes de rodar)
Expected: sem regressão.

- [ ] **Step 10: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/src/payments/subscriptions.service.ts backend/src/payments/payments.module.ts backend/src/employees/employees.module.ts backend/src/employees/employees.service.ts backend/src/employees/employees.controller.ts backend/test/employees-limit.e2e-spec.ts
git commit -m "feat: limite de funcionário por plano — criação única e reativação"
```

---

### Task 2: Enforcement na importação em lote

**Files:**
- Modify: `backend/src/employees/employees.service.ts` (`importCsv`/`importMapped`/`processImportRows` ganham `callerRole`)
- Modify: `backend/src/employees/employees.controller.ts` (`importCsv`/`importMapped` passam `req.user.role`)
- Test: `backend/test/employees-limit.e2e-spec.ts` (mesmo arquivo da Task 1 — adiciona os cenários de import)

**Interfaces:**
- Consumes: `SubscriptionsService.getActiveEmployeeLimit` (Task 1), `EmployeesService` já injeta `subscriptions` no constructor (Task 1) — reaproveitado aqui, sem mudança no constructor.
- Produces: `EmployeesService.importCsv(client, tenantId, csvContent, callerRole: string)`, `.importMapped(client, tenantId, buffer, mimetype, mapping, filename, callerRole: string)`.

- [ ] **Step 1: Adicionar os cenários de import ao teste e2e (RED)**

No MESMO arquivo `backend/test/employees-limit.e2e-spec.ts` da Task 1, adiciona os 2 `it(...)` abaixo dentro do `describe` já existente (antes do `});` final):

```typescript
  it('importação em lote: parte aceita, parte rejeitada por limite, resto do lote continua', async () => {
    const tenant = await db.createTenantWithUser('Empresa Limite Import');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');
    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 8 - existing, 40000005000);
    // Tenant agora tem exatamente 8 funcionários ativos, limite Start = 10.

    const unitRes = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Limite Import', 'Rua Teste', 'Cidade Teste', 'SC', '88800000') RETURNING name`,
      [tenant.tenantId],
    );
    const unitName = unitRes.rows[0].name;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    // 4 linhas: só as 2 primeiras cabem no limite (8 + 2 = 10), as 2
    // últimas devem ser rejeitadas por limite, não por outro motivo.
    const csv =
      'nome,cpf,cargo,filial\n' +
      `Linha Um,40000005900,Cargo,${unitName}\n` +
      `Linha Dois,40000005901,Cargo,${unitName}\n` +
      `Linha Tres,40000005902,Cargo,${unitName}\n` +
      `Linha Quatro,40000005903,Cargo,${unitName}\n`;

    const res = await request(app.getHttpServer())
      .post('/employees/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf-8'), { filename: 'funcionarios.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(2);
    expect(res.body.erros).toHaveLength(2);
    expect(res.body.erros[0].motivo).toBe('Limite de funcionários do plano atingido');
    expect(res.body.erros[1].motivo).toBe('Limite de funcionários do plano atingido');
    expect(await countActiveEmployees(db, tenant.tenantId)).toBe(10);
  });

  it('admin bypassa o limite na importação em lote', async () => {
    const tenant = await db.createTenantWithUser('Empresa Limite Import Admin');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');
    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 10 - existing, 40000006000);

    const unitRes = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Limite Import Admin', 'Rua Teste', 'Cidade Teste', 'SC', '88800000') RETURNING name`,
      [tenant.tenantId],
    );
    const unitName = unitRes.rows[0].name;

    const adminUser = await db.createUserWithRole('admin', 'Admin Limite Import');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminUser.email, password: adminUser.password });
    const token = login.body.access_token;

    const csv = 'nome,cpf,cargo,filial\n' + `Via Admin,40000006900,Cargo,${unitName}\n`;

    const res = await request(app.getHttpServer())
      .post(`/employees/import?tenant_id=${tenant.tenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf-8'), { filename: 'funcionarios.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(1);
    expect(res.body.erros).toHaveLength(0);
  });
```

- [ ] **Step 2: Rodar o teste, confirmar que os 2 cenários novos falham**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- employees-limit"`
Expected: os 5 testes da Task 1 continuam passando; os 2 novos falham (nenhuma checagem de limite roda ainda em `processImportRows` — todas as 4 linhas do primeiro teste seriam aceitas, `importados` viria 4 em vez de 2).

- [ ] **Step 3: `processImportRows`/`importCsv`/`importMapped` ganham `callerRole`**

Em `backend/src/employees/employees.service.ts`, troca:
```typescript
  async importCsv(client: PoolClient, tenantId: string, csvContent: string): Promise<ImportResult> {
    const { rows, formatError } = parseEmployeesCsv(csvContent);
    if (formatError) throw new BadRequestException(formatError);
    return this.processImportRows(client, tenantId, rows);
  }
```
Por:
```typescript
  async importCsv(client: PoolClient, tenantId: string, csvContent: string, callerRole: string): Promise<ImportResult> {
    const { rows, formatError } = parseEmployeesCsv(csvContent);
    if (formatError) throw new BadRequestException(formatError);
    return this.processImportRows(client, tenantId, rows, callerRole);
  }
```

Troca:
```typescript
  async importMapped(
    client: PoolClient,
    tenantId: string,
    buffer: Buffer,
    mimetype: string,
    mapping: ColumnMapping,
    filename?: string,
  ): Promise<ImportResult> {
    const { rows, formatError } = await parseSpreadsheet(buffer, mimetype, filename);
    if (formatError) throw new BadRequestException(formatError);

    const mappedRows = applyColumnMapping(rows, mapping);
    return this.processImportRows(client, tenantId, mappedRows);
  }
```
Por:
```typescript
  async importMapped(
    client: PoolClient,
    tenantId: string,
    buffer: Buffer,
    mimetype: string,
    mapping: ColumnMapping,
    filename: string | undefined,
    callerRole: string,
  ): Promise<ImportResult> {
    const { rows, formatError } = await parseSpreadsheet(buffer, mimetype, filename);
    if (formatError) throw new BadRequestException(formatError);

    const mappedRows = applyColumnMapping(rows, mapping);
    return this.processImportRows(client, tenantId, mappedRows, callerRole);
  }
```

Troca a assinatura e o corpo de `processImportRows` — de:
```typescript
  private async processImportRows(
    client: PoolClient,
    tenantId: string,
    rows: (ParsedCsvRow | MappedEmployeeRow)[],
  ): Promise<ImportResult> {
    const unitsResult = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM company_units WHERE tenant_id = $1',
      [tenantId],
    );
    const unitsByName = new Map(unitsResult.rows.map((u) => [u.name, u.id]));

    const erros: ImportRowError[] = [];
    let importados = 0;

    for (const row of rows) {
      if (!row.full_name) {
        erros.push({ linha: row.line, motivo: 'Nome é obrigatório' });
        continue;
      }
      if (!/^\d{11}$/.test(row.cpf)) {
        erros.push({ linha: row.line, motivo: 'CPF inválido (precisa ter 11 dígitos)' });
        continue;
      }
      const unitId = unitsByName.get(row.company_unit_name);
      if (!unitId) {
        erros.push({ linha: row.line, motivo: `Filial "${row.company_unit_name}" não encontrada` });
        continue;
      }
```
Por:
```typescript
  private async processImportRows(
    client: PoolClient,
    tenantId: string,
    rows: (ParsedCsvRow | MappedEmployeeRow)[],
    callerRole: string,
  ): Promise<ImportResult> {
    const unitsResult = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM company_units WHERE tenant_id = $1',
      [tenantId],
    );
    const unitsByName = new Map(unitsResult.rows.map((u) => [u.name, u.id]));

    // Limite e contagem atual buscados UMA vez antes do loop (mesmo padrão
    // de unitsByName acima) — callerRole admin pula a checagem inteira.
    const limit =
      callerRole === 'admin' ? null : await this.subscriptions.getActiveEmployeeLimit(client, tenantId);
    let currentActiveCount = 0;
    if (limit !== null) {
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) FROM employees WHERE tenant_id = $1 AND status = 'ativo'`,
        [tenantId],
      );
      currentActiveCount = parseInt(countResult.rows[0].count, 10);
    }

    const erros: ImportRowError[] = [];
    let importados = 0;

    for (const row of rows) {
      if (!row.full_name) {
        erros.push({ linha: row.line, motivo: 'Nome é obrigatório' });
        continue;
      }
      if (!/^\d{11}$/.test(row.cpf)) {
        erros.push({ linha: row.line, motivo: 'CPF inválido (precisa ter 11 dígitos)' });
        continue;
      }
      const unitId = unitsByName.get(row.company_unit_name);
      if (!unitId) {
        erros.push({ linha: row.line, motivo: `Filial "${row.company_unit_name}" não encontrada` });
        continue;
      }
      if (limit !== null && currentActiveCount + importados >= limit) {
        erros.push({ linha: row.line, motivo: 'Limite de funcionários do plano atingido' });
        continue;
      }
```

(O restante do método — bloco `SAVEPOINT`/`INSERT`/`catch` e o `return { importados, erros };` final — continua exatamente igual, sem nenhuma mudança.)

- [ ] **Step 4: Controller passa `req.user.role` nos 2 endpoints de import**

Em `backend/src/employees/employees.controller.ts`, troca:
```typescript
    return req.withTenantContext((client: any) =>
      this.employees.importCsv(client, tenantId, file.buffer.toString('utf-8')),
    );
```
Por:
```typescript
    return req.withTenantContext((client: any) =>
      this.employees.importCsv(client, tenantId, file.buffer.toString('utf-8'), req.user.role),
    );
```

E troca:
```typescript
    return req.withTenantContext((client: any) =>
      this.employees.importMapped(client, tenantId, file.buffer, file.mimetype, mapping, file.originalname),
    );
```
Por:
```typescript
    return req.withTenantContext((client: any) =>
      this.employees.importMapped(
        client,
        tenantId,
        file.buffer,
        file.mimetype,
        mapping,
        file.originalname,
        req.user.role,
      ),
    );
```

- [ ] **Step 5: Rodar o teste, confirmar que passa**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- employees-limit"`
Expected: `Tests: 7 passed, 7 total`

- [ ] **Step 6: Regressão completa de `employees`**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- employees"`
Expected: todas as suítes de `employees` (incluindo `employees-import`, `employees-import-flexible`, `employees-company-unit`, `employees-tenant-id`, `positions-link` — que também chama `PATCH /employees/:id` e `GET /employees`) continuam verdes. Atenção especial: `positions-link.e2e-spec.ts` (Fase 23) tem um teste chamando `PATCH /employees/:id` com `position_id` — confirme que ele não quebrou com a assinatura nova de `update()` (o controller já foi ajustado no Step 7 da Task 1 pra sempre passar `req.user.role`, então nenhum teste deveria quebrar por isso).

- [ ] **Step 7: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/src/employees/employees.service.ts backend/src/employees/employees.controller.ts backend/test/employees-limit.e2e-spec.ts
git commit -m "feat: limite de funcionário por plano — importação em lote"
```
