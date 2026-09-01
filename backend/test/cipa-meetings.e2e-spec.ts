import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CRUD /cipa/meetings (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let userId: string;
  let companyUnitId: string;
  let committeeId: string;
  let empresaToken: string;
  let memberId: string;
  let extraordinariaId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Meetings Teste');
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

    const memberResult = await (db as any).client.query(
      `INSERT INTO cipa_members (tenant_id, company_unit_id, nome, funcao_cipa, titular_suplente, representacao, inicio_mandato, fim_mandato)
       VALUES ($1, $2, 'Fulano de Tal', 'membro', 'titular', 'empregados', '2026-01-01', '2027-12-31') RETURNING id`,
      [tenantId, companyUnitId],
    );
    memberId = memberResult.rows[0].id;

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

  it('empresa cria reunião extraordinária → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/meetings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        committee_id: committeeId,
        titulo: 'Reunião sobre acidente na linha 3',
        data: '2026-03-10',
        hora: '10:00',
        local: 'Sala de reuniões',
        modalidade: 'presencial',
        motivo: 'Acidente de trabalho',
      });

    expect(res.status).toBe(201);
    expect(res.body.tipo).toBe('extraordinaria');
    expect(res.body.status_ata).toBe('rascunho');
    extraordinariaId = res.body.id;
  });

  it('empresa edita campos de ata (rascunho) → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/cipa/meetings/${extraordinariaId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        pauta: 'Discutir causas do acidente',
        discussoes: 'Falta de sinalização na área',
        deliberacoes: 'Instalar sinalização em 15 dias',
        chk_pauta_definida: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.pauta).toBe('Discutir causas do acidente');
    expect(res.body.chk_pauta_definida).toBe(true);
  });

  it('empresa registra participantes (membro + convidado externo) → 200', async () => {
    const res = await request(app.getHttpServer())
      .put(`/cipa/meetings/${extraordinariaId}/participants`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        participants: [
          { cipa_member_id: memberId, presente: true },
          { nome_livre: 'Técnico convidado', presente: true },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('participante sem cipa_member_id e sem nome_livre → 400', async () => {
    const res = await request(app.getHttpServer())
      .put(`/cipa/meetings/${extraordinariaId}/participants`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        participants: [{ presente: true }],
      });

    expect(res.status).toBe(400);
  });

  it('participante com cipa_member_id E nome_livre ao mesmo tempo → 400', async () => {
    const res = await request(app.getHttpServer())
      .put(`/cipa/meetings/${extraordinariaId}/participants`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        participants: [{ cipa_member_id: memberId, nome_livre: 'Técnico convidado', presente: true }],
      });

    expect(res.status).toBe(400);
  });

  it('GET lista as reuniões da gestão', async () => {
    const res = await request(app.getHttpServer())
      .get(`/cipa/meetings?committee_id=${committeeId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.find((m: { id: string }) => m.id === extraordinariaId)).toBeDefined();
  });
});
