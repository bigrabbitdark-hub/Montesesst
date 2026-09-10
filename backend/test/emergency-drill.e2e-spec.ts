import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Simulado de emergência (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let companyUnitId: string;
  let employeeId: string;
  let secondEmployeeId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Simulado Emergencia');
    tenantId = tenant.tenantId;
    employeeId = tenant.employeeId;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = login.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Matriz', 'Rua A', 'Cidade A', 'RS', '90000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const secondEmployee = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Segundo Funcionário Simulado', '22233344455', 'ativo') RETURNING id`,
      [tenantId],
    );
    secondEmployeeId = secondEmployee.rows[0].id;

    await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: employeeId, company_unit_id: companyUnitId, funcao_brigada: 'brigadista' });
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('registra um simulado com lista de presença e devolve o relatório calculado', async () => {
    const res = await request(app.getHttpServer())
      .post('/emergency-drills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        company_unit_id: companyUnitId,
        data_realizacao: '2026-03-01',
        horario: '14:00',
        tempo_evacuacao_segundos: 272,
        ponto_encontro_adequado: true,
        falhas_sinalizacao: true,
        participants: [
          { employee_id: employeeId, presente: true },
          { employee_id: secondEmployeeId, presente: false },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.participantes_total).toBe(2);
    expect(res.body.participantes_ausentes).toBe(1);
    expect(res.body.brigadistas_presentes).toBe(1);
    expect(res.body.nao_conformidades).toBe(2);
  });

  it('gera ação corretiva pra cada flag de problema marcada', async () => {
    const res = await request(app.getHttpServer())
      .post('/emergency-drills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        company_unit_id: companyUnitId,
        data_realizacao: '2026-03-02',
        falhas_iluminacao: true,
        portas_bloqueadas: true,
        participants: [{ employee_id: employeeId, presente: true }],
      });

    const actionsRes = await request(app.getHttpServer())
      .get(`/prevention-corrective-actions?tenant_id=${tenantId}`)
      .set('Authorization', `Bearer ${token}`);

    const drillActions = actionsRes.body.filter((a: any) => a.drill_id === res.body.id);
    expect(drillActions.length).toBe(2);
    // Assert the exact full description (not just a substring) — a Postgres
    // `date` column comes back from `pg` as a JS Date, not a string, so a
    // naive `.replace('{data}', drill.data_realizacao)` would silently
    // coerce it via Date.prototype.toString() into something like
    // "Sun Mar 01 2026 00:00:00 GMT+0000 (Coordinated Universal Time)"
    // instead of "2026-03-02". A substring check on a word like
    // "iluminação" wouldn't catch that regression; the exact-string
    // comparison does.
    const descriptions = drillActions.map((a: any) => a.description).sort();
    expect(descriptions).toEqual(
      [
        'Falha de iluminação de emergência identificada no simulado de 2026-03-02',
        'Porta de emergência bloqueada identificada no simulado de 2026-03-02',
      ].sort(),
    );
    expect(descriptions.some((d: string) => /GMT/.test(d))).toBe(false);
  });

  it('rejeita company_unit_id de outro tenant', async () => {
    const otherTenant = await db.createTenantWithUser('Empresa Simulado Outro Tenant');

    const res = await request(app.getHttpServer())
      .post('/emergency-drills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        company_unit_id: (
          await (db as any).client.query(
            `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
             VALUES ($1, 'Filial Alheia', 'Rua X', 'Cidade X', 'SC', '88000000') RETURNING id`,
            [otherTenant.tenantId],
          )
        ).rows[0].id,
        data_realizacao: '2026-03-03',
        participants: [],
      });

    expect(res.status).toBe(400);
  });

  it('lista simulados do tenant', async () => {
    const res = await request(app.getHttpServer())
      .get(`/emergency-drills?tenant_id=${tenantId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
