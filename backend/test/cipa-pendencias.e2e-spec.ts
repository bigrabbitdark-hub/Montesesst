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
  let outroTenantMeetingId: string;
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

    // Comitê + reunião reais do outro tenant, só pra provar que create()
    // também rejeita meeting_id de outro tenant (mesmo achado de
    // company_unit_id, um passo abaixo: FK-only não bastava aqui também).
    const outroCommitteeResult = await (db as any).client.query(
      `INSERT INTO cipa_committees (tenant_id, company_unit_id, ano, data_inicio, data_termino, responsavel_user_id)
       VALUES ($1, $2, 2026, '2026-01-01', '2026-12-31', $3) RETURNING id`,
      [outroTenant.tenantId, outroTenantCompanyUnitId, outroTenant.userId],
    );
    const outroCommitteeId = outroCommitteeResult.rows[0].id;

    const outroMeetingResult = await (db as any).client.query(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, company_unit_id, tipo, titulo)
       VALUES ($1, $2, $3, 'extraordinaria', 'Reunião Outro Tenant') RETURNING id`,
      [outroTenant.tenantId, outroCommitteeId, outroTenantCompanyUnitId],
    );
    outroTenantMeetingId = outroMeetingResult.rows[0].id;

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

  it('rejeita registrar pendência com meeting_id de outro tenant → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/pendencias')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        meeting_id: outroTenantMeetingId,
        descricao: 'Pendência maliciosa via meeting_id',
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

  it('mescla pendência computada de treinamento vencido, some quando renovado (Fase 15)', async () => {
    const employeeResult = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status)
       VALUES ($1, 'Funcionário Treinamento Pendência', '99988877766', 'ativo') RETURNING id`,
      [tenantId],
    );
    const trainingEmployeeId = employeeResult.rows[0].id;

    const vencido = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', trainingEmployeeId)
      .field('tipo', 'nr-35')
      .field('data_realizacao', '2020-01-10')
      .field('data_validade', '2021-01-10');
    expect(vencido.status).toBe(201);

    const semFiltro = await request(app.getHttpServer())
      .get('/cipa/pendencias')
      .set('Authorization', `Bearer ${empresaToken}`);
    const computada = semFiltro.body.find((p: any) => p.origem === 'treinamento' && p.id === `treinamento:${vencido.body.id}`);
    expect(computada).toBeTruthy();
    expect(computada.prioridade).toBe('alta');
    expect(computada.descricao).toContain('Funcionário Treinamento Pendência');

    // Renova o mesmo tipo pro mesmo funcionário com validade futura —
    // a pendência do registro vencido não deve mais aparecer (só o
    // mais recente conta, decisão da spec).
    const renovado = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', trainingEmployeeId)
      .field('tipo', 'nr-35')
      .field('data_realizacao', '2026-06-01')
      .field('data_validade', '2028-06-01');
    expect(renovado.status).toBe(201);

    const depoisDaRenovacao = await request(app.getHttpServer())
      .get('/cipa/pendencias')
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(depoisDaRenovacao.body.some((p: any) => p.id === `treinamento:${vencido.body.id}`)).toBe(false);
    expect(depoisDaRenovacao.body.some((p: any) => p.id === `treinamento:${renovado.body.id}`)).toBe(false);
  });

  it('tipo="outro" com tipo_outro diferentes são séries distintas — pendência vencida de uma não some quando a outra é criada (Fix 1 da revisão final)', async () => {
    const employeeResult = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status)
       VALUES ($1, 'Funcionário Treinamento Outro', '99977766655', 'ativo') RETURNING id`,
      [tenantId],
    );
    const trainingEmployeeId = employeeResult.rows[0].id;

    const brigada = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', trainingEmployeeId)
      .field('tipo', 'outro')
      .field('tipo_outro', 'Brigada de Incêndio')
      .field('data_realizacao', '2020-01-10')
      .field('data_validade', '2021-01-10');
    expect(brigada.status).toBe(201);

    const antesDoSegundo = await request(app.getHttpServer())
      .get('/cipa/pendencias')
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(
      antesDoSegundo.body.some((p: any) => p.id === `treinamento:${brigada.body.id}`),
    ).toBe(true);

    // Segundo treinamento tipo='outro', mesmo funcionário, mas tipo_outro
    // DIFERENTE ("Primeiros Socorros" != "Brigada de Incêndio") — não é
    // renovação do primeiro, é uma série distinta. A pendência do
    // primeiro (vencido, nunca renovado) precisa continuar aparecendo.
    const primeirosSocorros = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', trainingEmployeeId)
      .field('tipo', 'outro')
      .field('tipo_outro', 'Primeiros Socorros')
      .field('data_realizacao', '2026-06-01')
      .field('data_validade', '2028-06-01');
    expect(primeirosSocorros.status).toBe(201);

    const depoisDoSegundo = await request(app.getHttpServer())
      .get('/cipa/pendencias')
      .set('Authorization', `Bearer ${empresaToken}`);
    const pendenciaBrigada = depoisDoSegundo.body.find(
      (p: any) => p.id === `treinamento:${brigada.body.id}`,
    );
    expect(pendenciaBrigada).toBeTruthy();
    expect(pendenciaBrigada.prioridade).toBe('alta');
    expect(pendenciaBrigada.descricao).toContain('Brigada de Incêndio');
    // Primeiros Socorros é válido (vence em 2028, fora da janela de 60
    // dias) — não deve gerar pendência própria.
    expect(
      depoisDoSegundo.body.some((p: any) => p.id === `treinamento:${primeirosSocorros.body.id}`),
    ).toBe(false);
  });

  it('rejeita PATCH numa pendência computada de treinamento (Fase 15)', async () => {
    const res = await request(app.getHttpServer())
      .patch('/cipa/pendencias/treinamento:00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ status: 'concluida' });
    expect(res.status).toBe(400);
  });
});
