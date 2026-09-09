import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS em fire-brigade (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tenantAId: string;
  let companyUnitAId: string;
  let memberAId: string;

  let unlinkedTechnicianToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Brigada RLS A');
    const tenantB = await db.createTenantWithUser('Empresa Brigada RLS B');
    tenantAId = tenantA.tenantId;

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    tokenA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.email, password: tenantB.password });
    tokenB = loginB.body.access_token;

    // Técnico sem nenhum vínculo (sem linha em technicians/tenant_technicians
    // pra tenant A) — mesmo padrão de fire-safety-equipment-rls.e2e-spec.ts
    // pra provar que a RLS rejeita o INSERT via WITH CHECK (42501 -> 403 via
    // mapPgError).
    const unlinkedTech = await db.createUserWithRole('tecnico', 'Tecnico Brigada RLS Nao Vinculado');
    const loginUnlinkedTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: unlinkedTech.email, password: unlinkedTech.password });
    unlinkedTechnicianToken = loginUnlinkedTech.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial RLS A', 'Rua A', 'Cidade A', 'RS', '90000000') RETURNING id`,
      [tenantAId],
    );
    companyUnitAId = unitResult.rows[0].id;

    const created = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        employee_id: tenantA.employeeId,
        company_unit_id: companyUnitAId,
        funcao_brigada: 'brigadista',
      });
    memberAId = created.body.id;

    // Treinamento vinculado ao membro de tenant A, pra exercitar o caso de
    // GET .../trainings a partir de tenant B (deve vir vazio via RLS, não
    // vazar o treinamento de A).
    await request(app.getHttpServer())
      .post(`/fire-brigade/members/${memberAId}/trainings`)
      .set('Authorization', `Bearer ${tokenA}`)
      .field('data_realizacao', '2026-01-01')
      .field('data_validade', '2027-01-01');
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /fire-brigade/members de tenant B (query do próprio tenant, sem tenant_id) não inclui brigadista de tenant A', async () => {
    const res = await request(app.getHttpServer())
      .get('/fire-brigade/members')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.some((m: any) => m.id === memberAId)).toBe(false);
  });

  it('GET /fire-brigade/members/:id de tenant B no id de tenant A devolve 404 (linha invisível pra RLS)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/fire-brigade/members/${memberAId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  it('PATCH /fire-brigade/members/:id de tenant B no id de tenant A devolve 404', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/fire-brigade/members/${memberAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ turno: 'Tentativa de tenant B' });

    expect(res.status).toBe(404);

    // Confirma que a linha de tenant A não foi alterada.
    const stillA = await request(app.getHttpServer())
      .get(`/fire-brigade/members/${memberAId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(stillA.body.turno).not.toBe('Tentativa de tenant B');
  });

  it('DELETE /fire-brigade/members/:id de tenant B no id de tenant A devolve 404', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/fire-brigade/members/${memberAId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);

    // Confirma que a linha de tenant A ainda existe.
    const stillA = await request(app.getHttpServer())
      .get(`/fire-brigade/members/${memberAId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(stillA.status).toBe(200);
  });

  // Diferente de fire-safety-equipment (onde company_unit_id é opcional e o
  // teste irmão consegue pular direto pra INSERT, batendo na RLS de
  // fire_safety_equipment e voltando 403 via mapPgError/42501),
  // FireBrigadeService.createMember SEMPRE chama
  // assertCompanyUnitBelongsToTenant ANTES do INSERT em fire_brigade_members
  // — e essa checagem faz um SELECT em company_units, tabela que também tem
  // RLS (migration 0038: mesma cláusula `tenant_id IN (SELECT
  // assigned_tenant_ids_for_current_user())`). Um técnico sem vínculo não
  // enxerga a company_unit de tenant A nem por esse SELECT explícito, então
  // o código nunca chega a tentar o INSERT em fire_brigade_members — ele já
  // recebe BadRequestException ("Filial não encontrada") antes disso. O
  // resultado é 400, não o 403 do sibling — mas a garantia de segurança é a
  // mesma (o vínculo nunca é criado pra um tenant ao qual o técnico não tem
  // acesso), só muda QUAL checagem dispara primeiro.
  it('técnico SEM vínculo com tenant A é rejeitado (400, "Filial não encontrada") ao tentar POST com tenant_id de tenant A no corpo', async () => {
    const res = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${unlinkedTechnicianToken}`)
      .send({
        employee_id: memberAId, // valor qualquer de formato UUID; nunca chega a ser usado
        company_unit_id: companyUnitAId,
        funcao_brigada: 'brigadista',
        tenant_id: tenantAId,
      });

    expect(res.status).toBe(400);
  });

  // fire-brigade tem um sub-recurso (trainings) que fire-safety-equipment não
  // tem — findTrainings() (fire-brigade.service.ts) NÃO chama findMember()
  // primeiro pra checar existência/visibilidade do membro; ele só faz
  // `SELECT * FROM fire_brigade_trainings WHERE member_id = $1` e deixa a
  // RLS da própria tabela fire_brigade_trainings filtrar por tenant_id. Como
  // a RLS filtra silenciosamente (sem erro), o resultado pra tenant B
  // consultando o memberId de tenant A é 200 com lista vazia — diferente do
  // 404 que GET /fire-brigade/members/:id devolve pro mesmo caso (ali sim
  // há um "not found" explícito quando a query de SELECT não acha a linha).
  // Nenhum dos dois vaza dado de tenant A: o comportamento é seguro nos dois
  // casos, só a forma de sinalizar "não encontrado" é diferente. Este teste
  // documenta o comportamento real, não impõe consistência entre os dois
  // endpoints (isso é um achado à parte, fora do escopo desta correção).
  it('GET /fire-brigade/members/:id/trainings de tenant B no id de tenant A devolve 200 com lista vazia (RLS filtra sem vazar)', async () => {
    const asA = await request(app.getHttpServer())
      .get(`/fire-brigade/members/${memberAId}/trainings`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(asA.status).toBe(200);
    expect(asA.body.length).toBeGreaterThan(0);

    const asB = await request(app.getHttpServer())
      .get(`/fire-brigade/members/${memberAId}/trainings`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(asB.status).toBe(200);
    expect(asB.body).toEqual([]);
  });

  // upsertCoverageTarget() chama assertCompanyUnitBelongsToTenant(client,
  // companyUnitId, tenantId) ANTES de qualquer INSERT/UPDATE — pra role
  // 'empresa' o tenantId usado é sempre req.user.tenantId (tenant B aqui),
  // nunca um valor vindo do corpo. Buscar
  // `company_units WHERE id = <unidade de A> AND tenant_id = <B>` não acha
  // nada (a unidade pertence a A, não a B) e isso lança BadRequestException
  // -> 400, sem precisar de RLS pra rejeitar (é uma checagem explícita no
  // service, igual a createMember/updateMember).
  it('PUT /fire-brigade/coverage-target de tenant B com company_unit_id de tenant A devolve 400', async () => {
    const res = await request(app.getHttpServer())
      .put('/fire-brigade/coverage-target')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ company_unit_id: companyUnitAId, quantidade_necessaria: 3 });

    expect(res.status).toBe(400);
  });
});
