import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CIPA elections (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let employeeId: string;
  let empresaToken: string;
  let outroTenantEmployeeId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Eleição Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const employeeResult = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status)
       VALUES ($1, 'Fulano Candidato Teste', '11122233344', 'ativo') RETURNING id`,
      [tenantId],
    );
    employeeId = employeeResult.rows[0].id;

    // Tenant totalmente diferente — pra provar que addCandidate rejeita um
    // employee_id que não pertence ao tenant da eleição (achado da revisão
    // final: sem essa checagem, o conclude() travava pra sempre). Mesmo
    // padrão de outroTenant em cipa-meetings.e2e-spec.ts.
    // createTenantWithUser já cria um funcionário-fixture nesse tenant.
    const outroTenant = await db.createTenantWithUser('Empresa CIPA Eleição Outro Tenant');
    outroTenantEmployeeId = outroTenant.employeeId;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM company_units WHERE id = $1', [companyUnitId]);
    await (db as any).client.query('DELETE FROM employees WHERE id = $1', [employeeId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cria eleição, rejeita segunda eleição aberta pro mesmo estabelecimento com 409', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/cipa/elections')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        ano: 2026,
        inicio_mandato: '2026-06-01',
        fim_mandato: '2027-05-31',
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('aberta');
    const electionId = createRes.body.id;

    const duplicateRes = await request(app.getHttpServer())
      .post('/cipa/elections')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        ano: 2026,
        inicio_mandato: '2026-06-01',
        fim_mandato: '2027-05-31',
      });
    expect(duplicateRes.status).toBe(409);

    await (db as any).client.query('DELETE FROM cipa_elections WHERE id = $1', [electionId]);
  });

  it('fluxo completo: candidato vinculado + nome livre, rejeita ambos/nenhum, vota, conclui e cria os membros', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/cipa/elections')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        ano: 2026,
        data_eleicao: '2026-05-10',
        inicio_mandato: '2026-06-01',
        fim_mandato: '2027-05-31',
      });
    const electionId = createRes.body.id;

    const rejectBothRes = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ employee_id: employeeId, nome_livre: 'Não pode os dois' });
    expect(rejectBothRes.status).toBe(400);

    const rejectNeitherRes = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({});
    expect(rejectNeitherRes.status).toBe(400);

    const candidate1Res = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ employee_id: employeeId });
    expect(candidate1Res.status).toBe(201);
    const candidate1Id = candidate1Res.body.id;

    const candidate2Res = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ nome_livre: 'Beltrano Candidato Nome Livre' });
    expect(candidate2Res.status).toBe(201);
    const candidate2Id = candidate2Res.body.id;

    const eleitoSemTitularRes = await request(app.getHttpServer())
      .patch(`/cipa/elections/${electionId}/candidates/${candidate1Id}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ votos: 42, eleito: true });
    expect(eleitoSemTitularRes.status).toBe(400);

    const updateCandidate1Res = await request(app.getHttpServer())
      .patch(`/cipa/elections/${electionId}/candidates/${candidate1Id}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ votos: 42, eleito: true, titular_suplente: 'titular' });
    expect(updateCandidate1Res.status).toBe(200);
    expect(updateCandidate1Res.body.eleito).toBe(true);
    expect(updateCandidate1Res.body.titular_suplente).toBe('titular');

    const updateCandidate2Res = await request(app.getHttpServer())
      .patch(`/cipa/elections/${electionId}/candidates/${candidate2Id}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ votos: 10, eleito: false });
    expect(updateCandidate2Res.status).toBe(200);
    expect(updateCandidate2Res.body.eleito).toBe(false);

    const concludeRes = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/concluir`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');

    const membersRes = await request(app.getHttpServer())
      .get('/cipa/members')
      .query({ company_unit_id: companyUnitId })
      .set('Authorization', `Bearer ${empresaToken}`);
    const createdMember = membersRes.body.find((m: any) => m.nome === 'Fulano Candidato Teste');
    expect(createdMember).toBeDefined();
    expect(createdMember.representacao).toBe('empregados');
    expect(createdMember.titular_suplente).toBe('titular');
    expect(createdMember.inicio_mandato).toBe('2026-06-01');
    expect(createdMember.fim_mandato).toBe('2027-05-31');
    const notElectedMember = membersRes.body.find((m: any) => m.nome === 'Beltrano Candidato Nome Livre');
    expect(notElectedMember).toBeUndefined();

    const addAfterConcludeRes = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ nome_livre: 'Tarde Demais' });
    expect(addAfterConcludeRes.status).toBe(409);

    const concludeAgainRes = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/concluir`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(concludeAgainRes.status).toBe(409);

    await (db as any).client.query('DELETE FROM cipa_members WHERE company_unit_id = $1', [companyUnitId]);
    await (db as any).client.query('DELETE FROM cipa_elections WHERE id = $1', [electionId]);
  });

  it('rejeita employee_id de outro tenant ao adicionar candidato (400) — achado da revisão final', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/cipa/elections')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        ano: 2027,
        inicio_mandato: '2027-06-01',
        fim_mandato: '2028-05-31',
      });
    expect(createRes.status).toBe(201);
    const electionId = createRes.body.id;

    const crossTenantRes = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ employee_id: outroTenantEmployeeId });
    expect(crossTenantRes.status).toBe(400);

    // Confirma que a eleição não fica com um candidato "fantasma" — sem
    // isso, conclude() travaria pra sempre (COALESCE vira NULL, viola
    // cipa_members.nome NOT NULL).
    const candidatesRes = await request(app.getHttpServer())
      .get(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(candidatesRes.body).toHaveLength(0);

    await (db as any).client.query('DELETE FROM cipa_elections WHERE id = $1', [electionId]);
  });

  it('não é possível apagar um funcionário que já foi candidato em uma eleição da CIPA (409)', async () => {
    const employeeRes = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status)
       VALUES ($1, 'Ciclano Candidato Apaga Teste', '55566677788', 'ativo') RETURNING id`,
      [tenantId],
    );
    const candidateEmployeeId = employeeRes.rows[0].id;

    const createRes = await request(app.getHttpServer())
      .post('/cipa/elections')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        ano: 2028,
        inicio_mandato: '2028-06-01',
        fim_mandato: '2029-05-31',
      });
    expect(createRes.status).toBe(201);
    const electionId = createRes.body.id;

    const candidateRes = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ employee_id: candidateEmployeeId });
    expect(candidateRes.status).toBe(201);

    const deleteBlockedRes = await request(app.getHttpServer())
      .delete(`/employees/${candidateEmployeeId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(deleteBlockedRes.status).toBe(409);
    expect(deleteBlockedRes.body.message).toMatch(/candidato/i);

    // Sem regressão: um funcionário SEM candidatura continua apagável
    // normalmente.
    const freeEmployeeRes = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status)
       VALUES ($1, 'Funcionario Sem Candidatura Teste', '99988877766', 'ativo') RETURNING id`,
      [tenantId],
    );
    const freeEmployeeId = freeEmployeeRes.rows[0].id;
    const deleteFreeRes = await request(app.getHttpServer())
      .delete(`/employees/${freeEmployeeId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(deleteFreeRes.status).toBe(200);

    // Cleanup — remove a eleição (cascade tira o candidato) e só então o
    // funcionário, provando que o bloqueio era mesmo a candidatura.
    await (db as any).client.query('DELETE FROM cipa_elections WHERE id = $1', [electionId]);
    const deleteAfterCleanupRes = await request(app.getHttpServer())
      .delete(`/employees/${candidateEmployeeId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(deleteAfterCleanupRes.status).toBe(200);
  });
});
