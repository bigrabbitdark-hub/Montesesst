import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /dashboard/overview (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  // O helper de fixture já cria alguns registros por empresa; mede a linha de base
  // antes de inserir os dados do teste, em vez de supor que começa em zero.
  let baseA: { filiais: number; funcionarios: number; documentos: number };
  let baseB: { filiais: number; funcionarios: number; documentos: number };
  let esperadoA: { filiais: number; funcionarios: number; documentos: number };

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    return res.body.access_token;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa Overview A Teste');
    const b = await db.createTenantWithUser('Empresa Overview B Teste');
    tenantA = a.tenantId;
    tenantB = b.tenantId;
    userA = a.userId;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);

    const client = (db as any).client;
    const contar = async (tenantId: string) => {
      const r = await client.query(
        `SELECT (SELECT count(*) FROM company_units WHERE tenant_id = $1 AND status = 'ativo' AND NOT is_matriz)::int AS filiais,
                (SELECT count(*) FROM employees WHERE tenant_id = $1 AND status = 'ativo')::int AS funcionarios,
                (SELECT count(*) FROM documents WHERE tenant_id = $1)::int AS documentos`,
        [tenantId],
      );
      return r.rows[0];
    };
    baseA = await contar(tenantA);
    baseB = await contar(tenantB);
    // Empresa A: matriz + 2 filiais ativas + 1 inativa, 3 funcionários ativos + 1 inativo, 2 documentos.
    for (const [name, status] of [['F1', 'ativo'], ['F2', 'ativo'], ['F3', 'inativo']]) {
      await client.query(
        `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip, status)
         VALUES ($1, $2, 'Rua Teste', 'Cidade', 'SP', '01000000', $3)`,
        [tenantA, name, status],
      );
    }
    // A matriz também é uma company_unit (is_matriz) e NÃO pode entrar na contagem de filiais.
    await client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip, status, is_matriz)
       VALUES ($1, 'Matriz', 'Rua Teste', 'Cidade', 'SP', '01000000', 'ativo', true)`,
      [tenantA],
    );
    const cpfs = ['11111111111', '22222222222', '33333333333', '44444444444'];
    for (let i = 0; i < cpfs.length; i++) {
      await client.query(
        `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, $2, $3, $4)`,
        [tenantA, `Funcionario Overview ${i}`, cpfs[i], i === 3 ? 'inativo' : 'ativo'],
      );
    }
    for (const title of ['Doc 1', 'Doc 2']) {
      await client.query(
        `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
         VALUES ($1, 'pgr', $2, 'fixture/x.pdf', 'x.pdf', 'application/pdf', 100, $3, 'empresa')`,
        [tenantA, title, userA],
      );
    }
    esperadoA = { filiais: baseA.filiais + 2, funcionarios: baseA.funcionarios + 3, documentos: baseA.documentos + 2 };
  });

  afterAll(async () => {
    // Tenants apagados em CASCADE por db.cleanup() levam junto as linhas da fixture.
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('conta filiais ativas (sem a matriz), funcionários ativos e todos os documentos da própria empresa', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/overview').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(esperadoA);
  });

  it('isolamento: a empresa B vê zero e nunca os números da A', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/overview').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(baseB);
  });

  it('empresa ignora tenant_id da query: mandar o id da A logado como B continua devolvendo os números da B', async () => {
    const res = await request(app.getHttpServer())
      .get(`/dashboard/overview?tenant_id=${tenantA}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(baseB);
  });

  it('a resposta só tem números: nenhum nome, CPF ou título', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/overview').set('Authorization', `Bearer ${tokenA}`);
    const texto = JSON.stringify(res.body);
    expect(texto).not.toContain('Funcionario Overview');
    expect(texto).not.toContain('11111111111');
    expect(Object.keys(res.body).sort()).toEqual(['documentos', 'filiais', 'funcionarios']);
  });

  it('técnico sem tenant_id → 400; técnico NÃO vinculado → 403; admin → 403; sem login → 401', async () => {
    const tec = await db.createUserWithRole('tecnico', 'Tecnico Overview Teste');
    const tokenTec = await login(tec.email, tec.password);
    const semId = await request(app.getHttpServer()).get('/dashboard/overview').set('Authorization', `Bearer ${tokenTec}`);
    expect(semId.status).toBe(400);
    const naoVinculado = await request(app.getHttpServer())
      .get(`/dashboard/overview?tenant_id=${tenantA}`)
      .set('Authorization', `Bearer ${tokenTec}`);
    expect(naoVinculado.status).toBe(403);
    expect(JSON.stringify(naoVinculado.body)).not.toContain('funcionarios');

    const admin = await db.createUserWithRole('admin', 'Admin Overview Teste');
    const tokenAdmin = await login(admin.email, admin.password);
    const comoAdmin = await request(app.getHttpServer()).get('/dashboard/overview').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(comoAdmin.status).toBe(403);

    const anonimo = await request(app.getHttpServer()).get('/dashboard/overview');
    expect(anonimo.status).toBe(401);
  });

  it('técnico vinculado vê as contagens da empresa vinculada', async () => {
    const client = (db as any).client;
    const tec = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Overview Teste');
    const t = await client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tec.userId]);
    await client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tenantA, t.rows[0].id]);
    const tokenTec = await login(tec.email, tec.password);

    const res = await request(app.getHttpServer())
      .get(`/dashboard/overview?tenant_id=${tenantA}`)
      .set('Authorization', `Bearer ${tokenTec}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(esperadoA);

    await client.query('DELETE FROM tenant_technicians WHERE technician_id = $1', [t.rows[0].id]);
    await client.query('DELETE FROM technicians WHERE id = $1', [t.rows[0].id]);
  });
});
