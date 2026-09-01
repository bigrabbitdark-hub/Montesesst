import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CRUD /cipa/members (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let empresaToken: string;
  let memberId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Members Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM cipa_members WHERE company_unit_id = $1', [companyUnitId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa cadastra um membro da CIPA → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/members')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        nome: 'Maria Silva',
        funcao_empresa: 'Operadora de máquina',
        setor: 'Produção',
        funcao_cipa: 'presidente',
        titular_suplente: 'titular',
        representacao: 'empregador',
        inicio_mandato: '2026-01-01',
        fim_mandato: '2027-12-31',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ativo');
    memberId = res.body.id;
  });

  it('GET lista os membros do estabelecimento', async () => {
    const res = await request(app.getHttpServer())
      .get(`/cipa/members?company_unit_id=${companyUnitId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.find((m: { id: string }) => m.id === memberId)).toBeDefined();
  });

  it('empresa atualiza status do membro pra inativo → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/cipa/members/${memberId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ status: 'inativo' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inativo');
  });
});
