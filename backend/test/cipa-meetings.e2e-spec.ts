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
  let outroTenantId: string;
  let outroTenantMemberId: string;
  let outroCompanyUnitId: string;
  let outroCompanyUnitMemberId: string;
  let technicianLinkedToken: string;
  let technicianUnlinkedToken: string;
  let technicianLinkedId: string;
  let technicianUnlinkedId: string;

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

    // Segundo estabelecimento do MESMO tenant — só pra provar o Fix 10b
    // (cipa_member_id precisa bater com o company_unit_id da reunião, não
    // só com o tenant).
    const outroUnitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Teste', 'Rua Filial', 'Cidade Teste', 'SP', '03000000') RETURNING id`,
      [tenantId],
    );
    outroCompanyUnitId = outroUnitResult.rows[0].id;
    const outroCompanyUnitMemberResult = await (db as any).client.query(
      `INSERT INTO cipa_members (tenant_id, company_unit_id, nome, funcao_cipa, titular_suplente, representacao, inicio_mandato, fim_mandato)
       VALUES ($1, $2, 'Membro de Outro Estabelecimento', 'membro', 'titular', 'empregados', '2026-01-01', '2027-12-31') RETURNING id`,
      [tenantId, outroCompanyUnitId],
    );
    outroCompanyUnitMemberId = outroCompanyUnitMemberResult.rows[0].id;

    // Tenant totalmente diferente — pra provar o Fix 5 (cipa_member_id
    // precisa bater com o tenant da reunião).
    const outroTenant = await db.createTenantWithUser('Empresa CIPA Meetings Outro Tenant');
    outroTenantId = outroTenant.tenantId;
    const outroTenantUnitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Outro Tenant', 'Rua Outra', 'Cidade Outra', 'SP', '02000000') RETURNING id`,
      [outroTenantId],
    );
    const outroTenantMemberResult = await (db as any).client.query(
      `INSERT INTO cipa_members (tenant_id, company_unit_id, nome, funcao_cipa, titular_suplente, representacao, inicio_mandato, fim_mandato)
       VALUES ($1, $2, 'Membro Malicioso Outro Tenant', 'membro', 'titular', 'empregados', '2026-01-01', '2027-12-31') RETURNING id`,
      [outroTenantId, outroTenantUnitResult.rows[0].id],
    );
    outroTenantMemberId = outroTenantMemberResult.rows[0].id;

    // Técnico vinculado ao tenant principal e técnico sem vínculo nenhum
    // — pra matriz de leitura/403/404 (Fix de teste bounded-scope da
    // revisão final: cipa_meetings é o recurso mais central do módulo,
    // cobertura aqui vale pelo padrão das RLS policies byte-idênticas nas
    // outras tabelas cipa_*).
    const linkedTech = await db.createUserWithRole('tecnico', 'Tecnico Vinculado CIPA Meetings');
    const unlinkedTech = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado CIPA Meetings');
    const linkedTechResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [linkedTech.userId],
    );
    technicianLinkedId = linkedTechResult.rows[0].id;
    const unlinkedTechResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [unlinkedTech.userId],
    );
    technicianUnlinkedId = unlinkedTechResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianLinkedId],
    );

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;

    const loginLinkedTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: linkedTech.email, password: linkedTech.password });
    technicianLinkedToken = loginLinkedTech.body.access_token;

    const loginUnlinkedTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: unlinkedTech.email, password: unlinkedTech.password });
    technicianUnlinkedToken = loginUnlinkedTech.body.access_token;
  });

  afterAll(async () => {
    // db.cleanup() cascateia a partir dos tenants rastreados (tenantId E
    // outroTenantId, os dois criados via db.createTenantWithUser) —
    // tenants → company_units → cipa_committees/cipa_members em CASCADE,
    // sem precisar de delete manual pra cada tabela filha. tenant_technicians
    // é deletado explicitamente antes (mesmo padrão de
    // cipa-committees.e2e-spec.ts) porque os users de técnico são
    // apagados à parte em db.cleanup() (rastreados via userIds, não
    // tenantIds).
    await (db as any).client.query('DELETE FROM cipa_committees WHERE id = $1', [committeeId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = ANY($1)', [
      [technicianLinkedId, technicianUnlinkedId],
    ]);
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

  it('participante com cipa_member_id de outro tenant → 400 (Fix 5)', async () => {
    const res = await request(app.getHttpServer())
      .put(`/cipa/meetings/${extraordinariaId}/participants`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        participants: [{ cipa_member_id: outroTenantMemberId, presente: true }],
      });

    expect(res.status).toBe(400);
  });

  it('participante com cipa_member_id de outro estabelecimento do MESMO tenant → 400 (Fix 10b)', async () => {
    const res = await request(app.getHttpServer())
      .put(`/cipa/meetings/${extraordinariaId}/participants`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        participants: [{ cipa_member_id: outroCompanyUnitMemberId, presente: true }],
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

  // Matriz de leitura/403/404 pra técnico em cipa_meetings (recurso mais
  // central do módulo) — item de cobertura da revisão final. As policies
  // de RLS das outras tabelas cipa_* já foram verificadas byte-idênticas
  // a esta, então esta cobertura vale pelo padrão inteiro.
  describe('matriz técnico vinculado/não vinculado', () => {
    it('técnico vinculado ao tenant: GET funciona (200), PATCH é rejeitado por papel (403)', async () => {
      const getRes = await request(app.getHttpServer())
        .get(`/cipa/meetings/${extraordinariaId}`)
        .set('Authorization', `Bearer ${technicianLinkedToken}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(extraordinariaId);

      const patchRes = await request(app.getHttpServer())
        .patch(`/cipa/meetings/${extraordinariaId}`)
        .set('Authorization', `Bearer ${technicianLinkedToken}`)
        .send({ pauta: 'Técnico tentando editar' });
      expect(patchRes.status).toBe(403);
    });

    // Nota sobre a matriz descrita pela revisão: PATCH/PUT participants
    // têm @Roles('empresa') — o RolesGuard (global, roda antes de
    // qualquer query) rejeita QUALQUER papel != 'empresa' com 403 antes
    // mesmo de a RLS entrar em jogo, então um técnico sem vínculo também
    // recebe 403 (não 404) numa tentativa de mutação — o 404 só se aplica
    // a GET, onde a RLS filtra a linha e o service lança
    // NotFoundException. Comportamento confirmado empiricamente contra
    // RolesGuard (backend/src/common/guards/roles.guard.ts), que decide
    // só pelo papel do usuário, sem consultar vínculo tenant/técnico.
    it('técnico NÃO vinculado a nenhum tenant: GET não encontra a reunião (404), PATCH é rejeitado por papel (403)', async () => {
      const getRes = await request(app.getHttpServer())
        .get(`/cipa/meetings/${extraordinariaId}`)
        .set('Authorization', `Bearer ${technicianUnlinkedToken}`);
      expect(getRes.status).toBe(404);

      const patchRes = await request(app.getHttpServer())
        .patch(`/cipa/meetings/${extraordinariaId}`)
        .set('Authorization', `Bearer ${technicianUnlinkedToken}`)
        .send({ pauta: 'Técnico sem vínculo tentando editar' });
      expect(patchRes.status).toBe(403);

      const putRes = await request(app.getHttpServer())
        .put(`/cipa/meetings/${extraordinariaId}/participants`)
        .set('Authorization', `Bearer ${technicianUnlinkedToken}`)
        .send({ participants: [{ nome_livre: 'Tentativa sem vínculo', presente: true }] });
      expect(putRes.status).toBe(403);
    });
  });
});
