import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS em fire-safety-equipment (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tenantAId: string;
  let equipmentAId: string;

  let unlinkedTechnicianToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Equip RLS A');
    const tenantB = await db.createTenantWithUser('Empresa Equip RLS B');
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
    // pra tenant A) — mesmo padrão de epis-crud.e2e-spec.ts pra provar que a
    // RLS rejeita o INSERT via WITH CHECK (42501 -> 403 via mapPgError).
    const unlinkedTech = await db.createUserWithRole('tecnico', 'Tecnico Equip RLS Nao Vinculado');
    const loginUnlinkedTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: unlinkedTech.email, password: unlinkedTech.password });
    unlinkedTechnicianToken = loginUnlinkedTech.body.access_token;

    const created = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ tipo: 'extintor', codigo: 'EXT-RLS-A' });
    equipmentAId = created.body.id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /fire-safety-equipment de tenant B (query do próprio tenant, sem tenant_id) não inclui equipamento de tenant A', async () => {
    const res = await request(app.getHttpServer())
      .get('/fire-safety-equipment')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.some((eq: any) => eq.id === equipmentAId)).toBe(false);
  });

  it('GET /fire-safety-equipment/:id de tenant B no id de tenant A devolve 404 (linha invisível pra RLS)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/fire-safety-equipment/${equipmentAId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  it('PATCH /fire-safety-equipment/:id de tenant B no id de tenant A devolve 404', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/fire-safety-equipment/${equipmentAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ localizacao: 'Tentativa de tenant B' });

    expect(res.status).toBe(404);

    // Confirma que a linha de tenant A não foi alterada.
    const stillA = await request(app.getHttpServer())
      .get(`/fire-safety-equipment/${equipmentAId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(stillA.body.localizacao).not.toBe('Tentativa de tenant B');
  });

  it('DELETE /fire-safety-equipment/:id de tenant B no id de tenant A devolve 404', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/fire-safety-equipment/${equipmentAId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);

    // Confirma que a linha de tenant A ainda existe.
    const stillA = await request(app.getHttpServer())
      .get(`/fire-safety-equipment/${equipmentAId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(stillA.status).toBe(200);
  });

  it('técnico SEM vínculo com tenant A é rejeitado (403) ao tentar POST com tenant_id de tenant A no corpo', async () => {
    const res = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${unlinkedTechnicianToken}`)
      .send({ tipo: 'extintor', codigo: 'EXT-RLS-NAO-VINCULADO', tenant_id: tenantAId });

    expect(res.status).toBe(403);
  });
});
