import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Validação do POST /epis (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let catId: string;
  const srv = () => app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (body: Record<string, unknown>) =>
    request(srv()).post('/epis').set(auth()).send({ epi_catalog_item_id: catId, ca_number: 'CA-V', ...body });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    const t = await db.createTenantWithUser('Empresa Epi Create Val');
    token = (await request(srv()).post('/auth/login').send({ email: t.email, password: t.password })).body.access_token;
    catId = (await request(srv()).get('/epi-catalog-items').set(auth())).body[0].id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('entradas inválidas retornam 400 (nunca 500)', async () => {
    const bad: Record<string, unknown>[] = [
      { ca_valid_until: '2026-13-45' }, { ca_valid_until: '2026-02-30' }, { ca_valid_until: '2026' },
      { ca_valid_until: '2026-W10-1' }, { ca_valid_until: '0000-01-01' },
      { ca_number: 'a\u0000b' }, { ca_number: '' }, { manufacturer: 'a\u0000b' }, { model: 'a\u0000b' },
      { unit: 'a\u0000b' }, { unit: '' },
      { min_stock: 2147483648 }, { max_stock: 2147483648 }, { replacement_days: 2147483648 },
      { unit_cost: 1e12 }, { unit_cost: -1 },
      { min_stock: 10, max_stock: 5 },
    ];
    for (const b of bad) {
      const r = await post(b);
      expect([JSON.stringify(b), r.status]).toEqual([JSON.stringify(b), 400]);
    }
  });

  it('POST válido continua 201 e GET /epis devolve array', async () => {
    const r = await post({ ca_valid_until: '2099-12-31', min_stock: 1, max_stock: 5 });
    expect(r.status).toBe(201);
    expect(Array.isArray((await request(srv()).get('/epis').set(auth())).body)).toBe(true);
  });
});
