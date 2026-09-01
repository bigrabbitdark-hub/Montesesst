import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /cipa/meetings/:id/aprovar-ata, /reabrir-ata (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let userId: string;
  let companyUnitId: string;
  let committeeId: string;
  let meetingId: string;
  let empresaToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Ata Approval Teste');
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
      `INSERT INTO cipa_meetings (tenant_id, committee_id, company_unit_id, tipo, titulo, data, pauta, discussoes, deliberacoes)
       VALUES ($1, $2, $3, 'extraordinaria', 'Reunião Teste Ata', '2026-03-10', 'Pauta teste', 'Discussão teste', 'Deliberação teste')
       RETURNING id`,
      [tenantId, committeeId, companyUnitId],
    );
    meetingId = meetingResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM documents WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM cipa_committees WHERE id = $1', [committeeId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa aprova a ata → 200, grava aprovador/data, gera documento cipa_ata', async () => {
    const res = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/aprovar-ata`)
      .set('Authorization', `Bearer ${empresaToken}`);

    // @Post retorna 201 por padrão no NestJS — mesmo padrão das rotas de
    // ação análogas em normative-documents.controller.ts (approve/reject),
    // cujos próprios testes e2e também esperam 201, não 200.
    expect(res.status).toBe(201);
    expect(res.body.status_ata).toBe('aprovada');
    expect(res.body.aprovado_por_user_id).toBe(userId);
    expect(res.body.aprovado_em).toBeTruthy();

    const docResult = await (db as any).client.query(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'cipa_ata'`,
      [tenantId],
    );
    expect(docResult.rows).toHaveLength(1);
    expect(docResult.rows[0].mime_type).toBe('application/pdf');
  });

  it('editar depois de aprovada → 409', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/cipa/meetings/${meetingId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ pauta: 'Tentando editar depois de aprovada' });

    expect(res.status).toBe(409);
  });

  it('reabrir volta pra rascunho e permite editar de novo', async () => {
    const reopenRes = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/reabrir-ata`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(reopenRes.status).toBe(201);
    expect(reopenRes.body.status_ata).toBe('rascunho');

    const editRes = await request(app.getHttpServer())
      .patch(`/cipa/meetings/${meetingId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ pauta: 'Editado depois de reabrir' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.pauta).toBe('Editado depois de reabrir');
  });
});
