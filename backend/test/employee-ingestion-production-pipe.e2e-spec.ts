import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import request from 'supertest';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb } from './db-test-helper';
import { randomValidCnpj } from './helpers/cnpj';

const UPLOAD_RATE_LIMIT_KEY = 'ratelimit:EmployeesController.uploadDocument:::ffff:127.0.0.1';

// Upload multipart com o ValidationPipe real de produção (configureApp): campos não declarados em DTO não podem dar 400.
describe('Ingestão de funcionários com o ValidationPipe de produção (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let unitId: string;
  let redis: Redis;
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const sheet = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cadastro');
    ws.getRow(8).getCell(1).value = 'Funcionário';
    ws.getRow(8).getCell(3).value = 'CPF';
    ws.getRow(10).getCell(1).value = 'PIPE FICTICIO';
    ws.getRow(10).getCell(3).value = '52998224725';
    return Buffer.from(await wb.xlsx.writeBuffer());
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2Service)
      .useValue({ putObject: jest.fn(), deleteObject: jest.fn(), getObject: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    const t = await db.createTenantWithUser('Empresa Ingestao Pipe');
    token = (await request(app.getHttpServer()).post('/auth/login').send({ email: t.email, password: t.password })).body.access_token;
    const u = await request(app.getHttpServer())
      .post('/company-units').set(auth())
      .send({ name: 'Filial Pipe', cnpj: randomValidCnpj(), address_street: 'Rua T', address_city: 'Criciúma', address_state: 'SC', address_zip: '88801000' });
    unitId = u.body.id;
    redis = new Redis(process.env.REDIS_URL as string);
  });

  beforeEach(async () => {
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
  });

  afterAll(async () => {
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    redis.disconnect();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('company_unit_id válido -> 201 e extração criada', async () => {
    const res = await request(app.getHttpServer()).post('/employees/documents').set(auth())
      .field('company_unit_id', unitId)
      .attach('file', await sheet(), { filename: 'pipe.xlsx', contentType: XLSX });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('requer_revisao');
    expect(res.body.summary.novo).toBe(1);
  });

  it('company_unit_id inválido -> 400', async () => {
    const res = await request(app.getHttpServer()).post('/employees/documents').set(auth())
      .field('company_unit_id', 'nao-e-uuid')
      .attach('file', await sheet(), { filename: 'pipe2.xlsx', contentType: XLSX });
    expect(res.status).toBe(400);
  });

  it('resolve com o pipe de produção: corpo válido passa; campo extra no DTO ou na decisão é recusado; tipos errados 400', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cadastro');
    ws.getRow(8).getCell(1).value = 'Funcionário';
    ws.getRow(8).getCell(3).value = 'CPF';
    ws.getRow(10).getCell(1).value = 'RESOLVE PIPE FICTICIO';
    ws.getRow(10).getCell(3).value = '11144477735';
    const up = await request(app.getHttpServer()).post('/employees/documents').set(auth())
      .attach('file', Buffer.from(await wb.xlsx.writeBuffer()), { filename: 'pipe3.xlsx', contentType: XLSX });
    expect(up.status).toBe(201);
    const line = up.body.items[0].line;
    const post = (body: unknown) => request(app.getHttpServer()).post(`/employees/extractions/${up.body.id}/resolve`).set(auth()).send(body as any);
    expect((await post({ decisions: [{ line, action: 'ignorar' }], extra: 1 })).status).toBe(400);
    expect((await post({ decisions: [{ line, action: 'ignorar', extra: 1 }] })).status).toBe(400);
    expect((await post({ decisions: [{ line: 0, action: 'ignorar' }] })).status).toBe(400);
    expect((await post({ decisions: [{ line: 1.5, action: 'ignorar' }] })).status).toBe(400);
    expect((await post({ decisions: [{ line, action: 'apagar' }] })).status).toBe(400);
    expect((await post({ decisions: [{ line, action: 'ignorar', fields: 'x' }] })).status).toBe(400);
    expect((await post({ decisions: 'x' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    const ok = await post({ decisions: [{ line, action: 'ignorar' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('aplicado');
  });
  // Limite padrão 20/hora por IP (EMPLOYEE_DOCUMENTS_RATE_LIMIT_MAX); o mesmo arquivo é idempotente, então o custo é baixo.
  it('rota de upload: abaixo do limite responde normalmente e acima dele responde 429', async () => {
    const limit = Number(process.env.EMPLOYEE_DOCUMENTS_RATE_LIMIT_MAX ?? 20);
    const buf = await sheet();
    for (let i = 0; i < limit; i++) {
      const ok = await request(app.getHttpServer()).post('/employees/documents').set(auth())
        .field('company_unit_id', unitId)
        .attach('file', buf, { filename: 'pipe.xlsx', contentType: XLSX });
      // 201 na primeira; reenvio do mesmo arquivo (reused) responde 200.
      expect([200, 201]).toContain(ok.status);
    }
    const res = await request(app.getHttpServer()).post('/employees/documents').set(auth())
      .field('company_unit_id', unitId)
      .attach('file', buf, { filename: 'pipe.xlsx', contentType: XLSX });
    expect(res.status).toBe(429);
  });
});
