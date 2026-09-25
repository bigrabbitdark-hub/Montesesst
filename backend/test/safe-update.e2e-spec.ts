import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { BCRYPT_COST } from '../src/common/auth/bcrypt-cost';

const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;
const TEST_PASSWORD = 'senha-teste-123';

function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 10);
  return out;
}

// Reproduz a técnica de exfiltração encontrada na revisão final do
// cadastro de técnico: PATCH /technicians/:id (e /employees/:id,
// /partners/:id) montavam o SET a partir das CHAVES do body sem allowlist
// — uma chave manipulada virava injeção de SQL no nome da coluna, não só
// no valor. Como `tenants` não tem RLS própria, isso vazava dados de
// qualquer empresa através de um RETURNING *. Corrigido via
// common/safe-update.util.ts (allowlist de colunas). Este teste prova que
// o ataque documentado na revisão não funciona mais.
describe('Proteção contra injeção de nome de coluna via update (e2e)', () => {
  let app: INestApplication;
  let db: Client;
  let tenantId: string;
  let tenantCnpj: string;
  let technicianUserId: string;
  let technicianId: string;
  let technicianToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new Client({ connectionString: SUPERUSER_URL });
    await db.connect();

    // Empresa "alvo" cujo CNPJ o ataque tenta exfiltrar.
    tenantCnpj = randomDigits(14);
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, cnpj, status) VALUES ($1, $2, 'ativo') RETURNING id`,
      ['Empresa Alvo Injeção', tenantCnpj],
    );
    tenantId = tenantResult.rows[0].id;

    // Técnico ativo com perfil (mesmo shape que auth_register_technician
    // cria após confirmação) — inserido direto via superuser só pra
    // montar o fixture rápido, sem precisar rodar o fluxo de cadastro
    // completo aqui (esse fluxo já tem sua própria suíte de testes).
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, BCRYPT_COST);
    const email = `tecnico-injecao-${randomUUID()}@teste.montese.local`;
    const userResult = await db.query<{ id: string }>(
      `INSERT INTO users (tenant_id, role, email, password_hash, full_name, status)
       VALUES (NULL, 'tecnico', $1, $2, 'Técnico Injeção', 'ativo') RETURNING id`,
      [email, passwordHash],
    );
    technicianUserId = userResult.rows[0].id;
    const techResult = await db.query<{ id: string }>(
      `INSERT INTO technicians (user_id, status) VALUES ($1, 'ativo') RETURNING id`,
      [technicianUserId],
    );
    technicianId = techResult.rows[0].id;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: TEST_PASSWORD });
    technicianToken = loginRes.body.access_token;
  });

  afterAll(async () => {
    await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await db.query('DELETE FROM users WHERE id = $1', [technicianUserId]);
    await db.end();
    await app.close();
  });

  it('não vaza dados de outra empresa e não injeta a coluna maliciosa', async () => {
    const maliciousKey =
      "specialization = (SELECT string_agg(cnpj, ',') FROM tenants), registration_number";

    const res = await request(app.getHttpServer())
      .patch(`/technicians/${technicianId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ [maliciousKey]: 'x' });

    // O CNPJ da empresa alvo nunca deve aparecer na resposta.
    expect(JSON.stringify(res.body)).not.toContain(tenantCnpj);

    // A chave maliciosa inteira não bate com nenhum campo da allowlist —
    // nada deveria ter mudado no registro.
    const row = await db.query<{ specialization: string | null; registration_number: string | null }>(
      'SELECT specialization, registration_number FROM technicians WHERE id = $1',
      [technicianId],
    );
    expect(row.rows[0]).toMatchObject({ specialization: null, registration_number: null });
  });

  it('continua aceitando updates legítimos normalmente', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/technicians/${technicianId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ specialization: 'Segurança do Trabalho' });

    expect(res.status).toBe(200);
    expect(res.body.specialization).toBe('Segurança do Trabalho');
  });
});
