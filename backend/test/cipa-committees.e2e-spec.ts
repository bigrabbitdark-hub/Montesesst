import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /cipa/committees, POST /cipa/committees/:id/generate-meetings (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let userId: string;
  let companyUnitId: string;
  let empresaToken: string;
  let technicianToken: string;
  let createdCommitteeId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Committees Teste');
    tenantId = tenant.tenantId;
    userId = tenant.userId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico CIPA Committees Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    const technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;
  });

  afterAll(async () => {
    if (createdCommitteeId) {
      await (db as any).client.query('DELETE FROM cipa_committees WHERE id = $1', [createdCommitteeId]);
    }
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa cria uma gestão da CIPA → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/committees')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        ano: 2026,
        data_inicio: '2026-01-01',
        data_termino: '2026-12-31',
        responsavel_user_id: userId,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ativa');
    expect(res.body.company_unit_id).toBe(companyUnitId);
    createdCommitteeId = res.body.id;
  });

  it('técnico não cria gestão da CIPA → 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/committees')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({
        company_unit_id: companyUnitId,
        ano: 2026,
        data_inicio: '2026-01-01',
        data_termino: '2026-12-31',
        responsavel_user_id: userId,
      });

    expect(res.status).toBe(403);
  });

  it('empresa gera as 12 reuniões ordinárias com datas sugeridas → 201, numero 1 a 12', async () => {
    const res = await request(app.getHttpServer())
      .post(`/cipa/committees/${createdCommitteeId}/generate-meetings`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ dia_semana_preferido: 1, horario: '14:00', local: 'Sala de reuniões' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(12);
    expect(res.body.map((m: { numero: number }) => m.numero).sort((a: number, b: number) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    for (const meeting of res.body) {
      expect(meeting.tipo).toBe('ordinaria');
      expect(meeting.status).toBe('planejada');
      expect(meeting.local).toBe('Sala de reuniões');
      expect(meeting.data).toBeTruthy();
      const dataObj = new Date(meeting.data + 'T00:00:00Z');
      expect(dataObj.getUTCDay()).toBe(1); // segunda-feira
    }
  });

  it('gerar de novo na mesma gestão → 409 (já tem reuniões ordinárias)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/cipa/committees/${createdCommitteeId}/generate-meetings`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ dia_semana_preferido: 1 });

    expect(res.status).toBe(409);
  });
});
