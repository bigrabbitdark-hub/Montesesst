import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CRUD /cipa/pendencias (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let userId: string;
  let companyUnitId: string;
  let committeeId: string;
  let meetingId: string;
  let empresaToken: string;
  let outroTenantCompanyUnitId: string;
  let pendenciaSoltaId: string;
  let pendenciaDeReuniaoId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Pendencias Teste');
    tenantId = tenant.tenantId;
    userId = tenant.userId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const committeeResult = await (db as any).client.query(
      `INSERT INTO cipa_committees (tenant_id, company_unit_id, ano, data_inicio, data_termino, responsavel_user_id)
       VALUES ($1, $2, 2026, '2026-01-01', '2026-12-31', $3) RETURNING id`,
      [tenantId, companyUnitId, userId],
    );
    committeeId = committeeResult.rows[0].id;

    const meetingResult = await (db as any).client.query(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, company_unit_id, tipo, titulo)
       VALUES ($1, $2, $3, 'extraordinaria', 'Reunião Teste Pendencias') RETURNING id`,
      [tenantId, committeeId, companyUnitId],
    );
    meetingId = meetingResult.rows[0].id;

    // Segundo tenant só pra provar que create() rejeita company_unit_id de
    // fora do tenant do caller (mesmo achado da revisão de Task 4: FK-only
    // não bastava).
    const outroTenant = await db.createTenantWithUser('Empresa CIPA Pendencias Outro Tenant');
    const outroUnitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Outro Tenant', 'Rua Outra', 'Cidade Outra', 'SP', '02000000') RETURNING id`,
      [outroTenant.tenantId],
    );
    outroTenantCompanyUnitId = outroUnitResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM cipa_committees WHERE id = $1', [committeeId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa registra pendência solta (sem reunião de origem) → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/pendencias')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        descricao: 'Instalar sinalização na área de risco',
        prazo: '2026-04-01',
        prioridade: 'alta',
      });

    expect(res.status).toBe(201);
    expect(res.body.meeting_id).toBeNull();
    expect(res.body.status).toBe('aberta');
    pendenciaSoltaId = res.body.id;
  });

  it('empresa registra pendência nascida de reunião (plano de ação) → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/pendencias')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        meeting_id: meetingId,
        descricao: 'Revisar procedimento de bloqueio de máquina',
        prazo: '2026-04-15',
        prioridade: 'media',
      });

    expect(res.status).toBe(201);
    expect(res.body.meeting_id).toBe(meetingId);
    pendenciaDeReuniaoId = res.body.id;
  });

  it('rejeita registrar pendência com company_unit_id de outro tenant → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/pendencias')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: outroTenantCompanyUnitId,
        descricao: 'Pendência maliciosa',
        prioridade: 'baixa',
      });

    expect(res.status).toBe(400);
  });

  it('GET lista as duas pendências do estabelecimento', async () => {
    const res = await request(app.getHttpServer())
      .get(`/cipa/pendencias?company_unit_id=${companyUnitId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.map((p: { id: string }) => p.id);
    expect(ids).toContain(pendenciaSoltaId);
    expect(ids).toContain(pendenciaDeReuniaoId);
  });

  it('empresa marca pendência como concluída → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/cipa/pendencias/${pendenciaSoltaId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ status: 'concluida' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('concluida');
  });
});
