import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /documents/compliance (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  const insertedDocIds: string[] = [];

  function isoDateDaysFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async function insertDocument(category: string, title: string, expiresAt: string | null): Promise<string> {
    const result = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, $2, $3, 'test-key', 'test.pdf', 'application/pdf', 100, $4, (SELECT id FROM users WHERE tenant_id = $1 LIMIT 1), 'empresa')
       RETURNING id`,
      [tenantId, category, title, expiresAt],
    );
    const id = result.rows[0].id;
    insertedDocIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Compliance Teste');
    tenantId = tenant.tenantId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    if (insertedDocIds.length > 0) {
      await (db as any).client.query('DELETE FROM documents WHERE id = ANY($1)', [insertedDocIds]);
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('classifica vencido/aviso/em-dia e calcula o score corretamente', async () => {
    await insertDocument('pgr', 'PGR Vencido', isoDateDaysFromNow(-10));
    await insertDocument('ficha_epi', 'Ficha Vencendo', isoDateDaysFromNow(15));
    await insertDocument('laudo', 'Laudo Em Dia', isoDateDaysFromNow(90));
    await insertDocument('treinamento', 'Sem Vencimento', null);

    const res = await request(app.getHttpServer())
      .get('/documents/compliance')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // 3 documentos com expires_at (o "Sem Vencimento" fica de fora):
    // 1 vencido, 2 em dia (1 deles em aviso) -> score = round(2/3*100) = 67
    expect(res.body.score).toBe(67);
    expect(res.body.pendencias).toHaveLength(1);
    expect(res.body.pendencias[0].title).toBe('PGR Vencido');
    expect(res.body.pendencias[0].dias_vencido).toBe(10);
    expect(res.body.avisos).toHaveLength(1);
    expect(res.body.avisos[0].title).toBe('Ficha Vencendo');
    expect(res.body.avisos[0].dias_restantes).toBe(15);
  });

  it('retorna score null quando não há documento com vencimento definido', async () => {
    const emptyTenant = await db.createTenantWithUser('Empresa Compliance Vazia');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emptyTenant.email, password: emptyTenant.password });

    const res = await request(app.getHttpServer())
      .get('/documents/compliance')
      .set('Authorization', `Bearer ${loginRes.body.access_token}`);

    expect(res.status).toBe(200);
    expect(res.body.score).toBeNull();
    expect(res.body.pendencias).toHaveLength(0);
    expect(res.body.avisos).toHaveLength(0);
  });

  it('exige tenant_id quando quem chama é técnico', async () => {
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Compliance Teste');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });

    const res = await request(app.getHttpServer())
      .get('/documents/compliance')
      .set('Authorization', `Bearer ${loginRes.body.access_token}`);

    expect(res.status).toBe(400);
  });
});
