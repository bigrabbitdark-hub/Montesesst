import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CRUD /company-units (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let unitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Filial CRUD');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cria uma filial', async () => {
    const res = await request(app.getHttpServer())
      .post('/company-units')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Sede',
        address_street: 'Rua das Flores',
        address_number: '100',
        address_city: 'Criciúma',
        address_state: 'SC',
        address_zip: '88801000',
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Sede');
    unitId = res.body.id;
  });

  it('lista as filiais do próprio tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/company-units')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((u: { id: string }) => u.id)).toContain(unitId);
  });

  it('atualiza uma filial', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/company-units/${unitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sede Renomeada' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Sede Renomeada');
  });

  // Antes do ITEM 019, DELETE apagava a linha de verdade e o ON DELETE SET NULL desvinculava
  // o funcionário. Agora DELETE só marca 'inativo' (nunca apaga a linha), então esse gatilho
  // nunca dispara — o vínculo fica de pé, e é isso que se quer: histórico intacto.
  it('desativar uma filial NÃO desvincula o funcionário — o vínculo fica intacto, revertendo a proteção do ITEM 019', async () => {
    const unitRes = await request(app.getHttpServer())
      .post('/company-units')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Filial Com Funcionário',
        address_street: 'Rua Vínculo',
        address_city: 'Criciúma',
        address_state: 'SC',
        address_zip: '88803000',
      });
    expect(unitRes.status).toBe(201);
    const linkedUnitId = unitRes.body.id;

    const employeeRes = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Func Vinculado À Filial', cpf: '12312312399', company_unit_id: linkedUnitId });
    expect(employeeRes.status).toBe(201);
    const employeeId = employeeRes.body.id;

    const deleteRes = await request(app.getHttpServer())
      .delete(`/company-units/${linkedUnitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.status).toBe(200);

    const getEmployeeRes = await request(app.getHttpServer())
      .get(`/employees/${employeeId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getEmployeeRes.status).toBe(200);
    expect(getEmployeeRes.body.company_unit_id).toBe(linkedUnitId);

    const getUnitRes = await request(app.getHttpServer())
      .get(`/company-units/${linkedUnitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getUnitRes.status).toBe(200);
    expect(getUnitRes.body.status).toBe('inativo');
  });

  // ITEM 019 (auditoria 2026-09-27): DELETE apagava a filial e, em CASCATA, todo o histórico
  // de conformidade vinculado (CIPA, brigada, checklist) — decisão do fundador: nunca apagar
  // de verdade. Agora DELETE marca a filial como 'inativo' (reversível), nunca some do banco.
  it('DELETE não apaga: marca inativo, some da listagem padrão, mas segue consultável e reversível', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/company-units/${unitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    // Continua consultável direto pelo id (histórico não sumiu).
    const getRes = await request(app.getHttpServer())
      .get(`/company-units/${unitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe('inativo');

    // Some da listagem padrão...
    const listRes = await request(app.getHttpServer())
      .get('/company-units')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.body.map((u: { id: string }) => u.id)).not.toContain(unitId);

    // ...mas aparece com includeInactive=true.
    const listAllRes = await request(app.getHttpServer())
      .get('/company-units?includeInactive=true')
      .set('Authorization', `Bearer ${token}`);
    expect(listAllRes.body.map((u: { id: string }) => u.id)).toContain(unitId);

    // Reversível: PATCH status de volta pra ativo.
    const reactivateRes = await request(app.getHttpServer())
      .patch(`/company-units/${unitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ativo' });
    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.status).toBe('ativo');
    const listAgainRes = await request(app.getHttpServer())
      .get('/company-units')
      .set('Authorization', `Bearer ${token}`);
    expect(listAgainRes.body.map((u: { id: string }) => u.id)).toContain(unitId);
  });

  it('DELETE é idempotente: numa filial já inativa não dá erro', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/company-units')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Filial Idempotencia', address_street: 'Rua X', address_city: 'Criciúma', address_state: 'SC', address_zip: '88804000' });
    const id = createRes.body.id;

    expect((await request(app.getHttpServer()).delete(`/company-units/${id}`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    const second = await request(app.getHttpServer()).delete(`/company-units/${id}`).set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(200);
  });

  describe('a matriz nunca pode ser desativada (ITEM 019)', () => {
    let matrizTenant: { email: string; password: string };
    let matrizUnitId: string;

    beforeAll(async () => {
      matrizTenant = await db.createTenantWithUser('Empresa Matriz Protegida');
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: matrizTenant.email, password: matrizTenant.password });
      const matrizToken = loginRes.body.access_token;
      // Mesmo caminho real que cria a matriz: TenantsService.update() com endereço completo.
      await request(app.getHttpServer())
        .patch('/tenants/me')
        .set('Authorization', `Bearer ${matrizToken}`)
        .send({
          address_street: 'Rua da Matriz',
          address_number: '1',
          address_city: 'Criciúma',
          address_state: 'SC',
          address_zip: '88805000',
        });
      const unitsRes = await request(app.getHttpServer()).get('/company-units?includeInactive=true').set('Authorization', `Bearer ${matrizToken}`);
      matrizUnitId = unitsRes.body.find((u: { is_matriz: boolean }) => u.is_matriz).id;
      token = matrizToken; // reusa a variável de token do describe externo pros testes abaixo
    });

    it('DELETE na matriz é recusado (400), nunca vira inativo', async () => {
      const res = await request(app.getHttpServer()).delete(`/company-units/${matrizUnitId}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      const getRes = await request(app.getHttpServer()).get(`/company-units/${matrizUnitId}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.body.status).toBe('ativo');
    });

    it('PATCH status=inativo na matriz também é recusado (400) — mesma proteção pela outra porta', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/company-units/${matrizUnitId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'inativo' });
      expect(res.status).toBe(400);
      const getRes = await request(app.getHttpServer()).get(`/company-units/${matrizUnitId}`).set('Authorization', `Bearer ${token}`);
      expect(getRes.body.status).toBe('ativo');
    });

    it('PATCH de outros campos na matriz continua funcionando normalmente', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/company-units/${matrizUnitId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Matriz Renomeada' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Matriz Renomeada');
    });
  });
});
