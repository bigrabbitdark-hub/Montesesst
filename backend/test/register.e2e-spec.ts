import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/common/email/email.service';

const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;

// RateLimitGuard isola o contador de /auth/register por rota
// (ratelimit:AuthController.register:<ip>) — todo teste deste arquivo bate
// nessa mesma chave (mesmo IP de loopback do supertest). Sem limpar entre
// testes, a contagem cumulativa de testes anteriores faria o teste
// dedicado de rate limit (e qualquer um depois dele) estourar o limite
// prematuramente por causa de chamadas de OUTROS testes, não das próprias.
const REGISTER_RATE_LIMIT_KEY = 'ratelimit:AuthController.register:::ffff:127.0.0.1';

// Gera um CNPJ aleatório com dígito verificador correto — 14 dígitos
// puramente aleatórios (como o antigo randomDigits usado em
// db-test-helper.ts) quase nunca passam em IsValidCnpj, porque
// POST /auth/register valida o dígito de verdade (diferente dos fixtures
// de teste que inserem direto via SQL, bypassando o DTO). Mesmo algoritmo
// de common/validators/cnpj.util.ts.
function calcCnpjCheckDigit(base: string): number {
  const weights =
    base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = base
    .split('')
    .reduce((acc, digit, idx) => acc + parseInt(digit, 10) * weights[idx], 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function randomValidCnpj(): string {
  let base = '';
  for (let i = 0; i < 12; i++) base += Math.floor(Math.random() * 10);
  const digit1 = calcCnpjCheckDigit(base);
  const digit2 = calcCnpjCheckDigit(base + digit1);
  return `${base}${digit1}${digit2}`;
}

// CNPJ matematicamente válido (dígito verificador conferido manualmente —
// ver comentário em common/validators/cnpj.util.ts).
const VALID_CNPJ = '11222333000181';

describe('Cadastro — POST /auth/register, GET /auth/confirm (e2e)', () => {
  let app: INestApplication;
  let db: Client;
  let redis: Redis;
  const fakeEmail = { send: jest.fn().mockResolvedValue(undefined) };
  const createdCnpjs: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(fakeEmail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new Client({ connectionString: SUPERUSER_URL });
    await db.connect();

    redis = new Redis(process.env.REDIS_URL as string);
  });

  beforeEach(async () => {
    fakeEmail.send.mockClear();
    await redis.del(REGISTER_RATE_LIMIT_KEY);
  });

  afterAll(async () => {
    if (createdCnpjs.length) {
      await db.query('DELETE FROM tenants WHERE cnpj = ANY($1)', [createdCnpjs]);
    }
    await redis.del(REGISTER_RATE_LIMIT_KEY);
    redis.disconnect();
    await db.end();
    await app.close();
  });

  it('cria tenant e user pendentes, e dispara o e-mail de confirmação', async () => {
    const email = `cadastro-${randomUUID()}@teste.montese.local`;
    createdCnpjs.push(VALID_CNPJ);

    const res = await request(app.getHttpServer()).post('/auth/register').send({
      company_name: 'Empresa Teste Cadastro',
      cnpj: VALID_CNPJ,
      full_name: 'Responsável Teste',
      email,
      password: 'senha-segura-123',
    });

    expect(res.status).toBe(201);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
    expect(fakeEmail.send.mock.calls[0][0].to).toBe(email);

    const row = await db.query(
      `SELECT t.status AS tenant_status, u.status AS user_status
       FROM tenants t JOIN users u ON u.tenant_id = t.id
       WHERE t.cnpj = $1`,
      [VALID_CNPJ],
    );
    expect(row.rows[0]).toMatchObject({ tenant_status: 'pendente', user_status: 'pendente' });
  });

  it('rejeita CNPJ com dígito verificador inválido com 400', async () => {
    const res = await request(app.getHttpServer()).post('/auth/register').send({
      company_name: 'Empresa Inválida',
      cnpj: '11222333000180',
      full_name: 'X',
      email: `invalido-${randomUUID()}@teste.montese.local`,
      password: 'senha-segura-123',
    });
    expect(res.status).toBe(400);
    expect(fakeEmail.send).not.toHaveBeenCalled();
  });

  it('rejeita CNPJ duplicado com 409', async () => {
    const cnpj = randomValidCnpj();
    createdCnpjs.push(cnpj);
    const first = {
      company_name: 'Original',
      cnpj,
      full_name: 'Responsável A',
      email: `a-${randomUUID()}@teste.montese.local`,
      password: 'senha-segura-123',
    };
    await request(app.getHttpServer()).post('/auth/register').send(first).expect(201);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...first, email: `b-${randomUUID()}@teste.montese.local` });
    expect(res.status).toBe(409);
  });

  it('rejeita e-mail duplicado com 409', async () => {
    const email = `dup-${randomUUID()}@teste.montese.local`;
    const cnpjA = randomValidCnpj();
    const cnpjB = randomValidCnpj();
    createdCnpjs.push(cnpjA, cnpjB);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ company_name: 'Empresa A', cnpj: cnpjA, full_name: 'Responsável A', email, password: 'senha-segura-123' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ company_name: 'Empresa B', cnpj: cnpjB, full_name: 'Responsável B', email, password: 'senha-segura-123' });
    expect(res.status).toBe(409);
  });

  it('bloqueia com 429 depois do limite de cadastros por IP', async () => {
    const limit = parseInt(process.env.REGISTER_RATE_LIMIT_MAX ?? '5', 10);
    for (let i = 0; i < limit; i++) {
      const cnpj = randomValidCnpj();
      createdCnpjs.push(cnpj);
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          company_name: `Rate ${i}`,
          cnpj,
          full_name: 'Responsável Rate',
          email: `rate-${randomUUID()}@teste.montese.local`,
          password: 'senha-segura-123',
        });
    }
    const res = await request(app.getHttpServer()).post('/auth/register').send({
      company_name: 'Estourou',
      cnpj: randomValidCnpj(),
      full_name: 'Responsável Estourou',
      email: `estourou-${randomUUID()}@teste.montese.local`,
      password: 'senha-segura-123',
    });
    expect(res.status).toBe(429);
  });

  it('confirma o e-mail e ativa tenant+user; clicar duas vezes não quebra', async () => {
    const email = `confirmar-${randomUUID()}@teste.montese.local`;
    const cnpj = randomValidCnpj();
    createdCnpjs.push(cnpj);

    await request(app.getHttpServer()).post('/auth/register').send({
      company_name: 'Empresa Confirmar',
      cnpj,
      full_name: 'Responsável',
      email,
      password: 'senha-segura-123',
    });

    const confirmUrl: string = fakeEmail.send.mock.calls[0][0].html.match(/href="([^"]+)"/)[1];
    const token = new URL(confirmUrl).searchParams.get('token') as string;

    const first = await request(app.getHttpServer()).get('/auth/confirm').query({ token });
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe('/cadastro/confirmado?status=ok');

    const row = await db.query(
      `SELECT t.status AS tenant_status, u.status AS user_status
       FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE t.cnpj = $1`,
      [cnpj],
    );
    expect(row.rows[0]).toMatchObject({ tenant_status: 'ativo', user_status: 'ativo' });

    const second = await request(app.getHttpServer()).get('/auth/confirm').query({ token });
    expect(second.status).toBe(302);
    expect(second.headers.location).toBe('/cadastro/confirmado?status=ok');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'senha-segura-123' });
    expect(loginRes.status).toBe(201);
  });

  it('token inválido ou expirado redireciona com status=erro', async () => {
    const jwt = app.get(JwtService);
    const expired = jwt.sign(
      { sub: randomUUID(), purpose: 'email_confirmation' },
      { expiresIn: '-10s' },
    );

    const resExpired = await request(app.getHttpServer()).get('/auth/confirm').query({ token: expired });
    expect(resExpired.status).toBe(302);
    expect(resExpired.headers.location).toBe('/cadastro/confirmado?status=erro');

    const resGarbage = await request(app.getHttpServer())
      .get('/auth/confirm')
      .query({ token: 'nao-e-um-jwt' });
    expect(resGarbage.status).toBe(302);
    expect(resGarbage.headers.location).toBe('/cadastro/confirmado?status=erro');
  });
});
