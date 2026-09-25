import { Client } from 'pg';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { BCRYPT_COST } from '../src/common/auth/bcrypt-cost';

// Testes de RLS precisam criar fixtures em mais de um tenant ao mesmo tempo —
// a role da aplicação (montese_app) não consegue fazer isso porque ela
// própria está sujeita à RLS (FORCE ROW LEVEL SECURITY). Por isso, e só
// aqui, os testes conectam como superuser do Postgres (bypassa RLS por
// definição), nunca a role da aplicação. Fora deste helper de teste, a
// aplicação nunca usa a credencial de superuser (ver docs/vision.md, regra
// de arquitetura nº 1).
const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL;

export const TEST_PASSWORD = 'senha-teste-123';

export interface TestTenantFixture {
  tenantId: string;
  userId: string;
  email: string;
  password: string;
  employeeId: string;
}

export interface TestUserFixture {
  userId: string;
  email: string;
  password: string;
}

function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 10);
  return out;
}

// Remove acentos/diacríticos (ex.: "Técnico" -> "Tecnico") antes de gerar o
// e-mail de fixture. Sem isso, prefixos acentuados produzem e-mails que
// APIs externas estritas (ex.: Mercado Pago) rejeitam como payer_email
// inválido.
function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export class TestDb {
  private readonly client: Client;
  private tenantIds: string[] = [];
  private userIds: string[] = [];

  constructor() {
    if (!SUPERUSER_URL) {
      throw new Error(
        'TEST_SUPERUSER_DATABASE_URL não definida — necessária apenas para ' +
          'setup/teardown de fixtures de teste (bypassa RLS via superuser).',
      );
    }
    this.client = new Client({ connectionString: SUPERUSER_URL });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.end();
  }

  async createTenantWithUser(namePrefix: string): Promise<TestTenantFixture> {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, BCRYPT_COST);
    const suffix = randomUUID().slice(0, 8);

    const tenantResult = await this.client.query<{ id: string }>(
      `INSERT INTO tenants (name, cnpj, status) VALUES ($1, $2, 'ativo') RETURNING id`,
      [`${namePrefix} ${suffix}`, randomDigits(14)],
    );
    const tenantId = tenantResult.rows[0].id;
    this.tenantIds.push(tenantId);

    const email = `${stripDiacritics(namePrefix).toLowerCase().replace(/\s+/g, '-')}-${suffix}@teste.montese.local`;
    const userResult = await this.client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, role, email, password_hash, full_name, status)
       VALUES ($1, 'empresa', $2, $3, $4, 'ativo') RETURNING id`,
      [tenantId, email, passwordHash, `${namePrefix} Admin`],
    );
    const userId = userResult.rows[0].id;

    const employeeResult = await this.client.query<{ id: string }>(
      `INSERT INTO employees (tenant_id, full_name, cpf, status)
       VALUES ($1, $2, $3, 'ativo') RETURNING id`,
      [tenantId, `Funcionário ${namePrefix}`, randomDigits(11)],
    );

    return {
      tenantId,
      userId,
      email,
      password: TEST_PASSWORD,
      employeeId: employeeResult.rows[0].id,
    };
  }

  async createUserWithRole(role: 'tecnico' | 'parceiro' | 'admin', namePrefix: string): Promise<TestUserFixture> {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, BCRYPT_COST);
    const suffix = randomUUID().slice(0, 8);
    const email = `${stripDiacritics(namePrefix).toLowerCase().replace(/\s+/g, '-')}-${suffix}@teste.montese.local`;

    const result = await this.client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, role, email, password_hash, full_name, status)
       VALUES (NULL, $1, $2, $3, $4, 'ativo') RETURNING id`,
      [role, email, passwordHash, namePrefix],
    );
    const userId = result.rows[0].id;
    this.userIds.push(userId);

    return { userId, email, password: TEST_PASSWORD };
  }

  // Apaga só o que este helper criou. Tenants em CASCADE levam junto users e
  // employees vinculados a eles; users soltos (tecnico/parceiro/admin) são
  // apagados à parte.
  async cleanup(): Promise<void> {
    for (const id of this.tenantIds) {
      await this.client.query('DELETE FROM tenants WHERE id = $1', [id]);
    }
    for (const id of this.userIds) {
      await this.client.query('DELETE FROM users WHERE id = $1', [id]);
    }
    this.tenantIds = [];
    this.userIds = [];
  }
}
