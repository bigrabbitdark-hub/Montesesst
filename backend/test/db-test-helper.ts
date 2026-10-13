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

  // Insere um aso_records mínimo direto via superuser (bypassa RLS/HTTP) —
  // usado por specs de RLS que precisam de uma linha em outro tenant sem
  // passar pela API (ex.: esocial-events-rls.e2e-spec.ts, Task 4).
  async insertMinimalAsoRecord(tenant: {
    tenantId: string;
    employeeId: string;
    userId: string;
  }): Promise<string> {
    const result = await this.client.query<{ id: string }>(
      `INSERT INTO aso_records (
        tenant_id, employee_id, exam_type, exam_date, result,
        result_disclosure_authorized, doctor_name, doctor_crm, doctor_crm_uf, created_by_user_id
      ) VALUES ($1, $2, 'periodico', CURRENT_DATE, 'apto', false, 'Dr. Teste', '12345', 'SP', $3)
      RETURNING id`,
      [tenant.tenantId, tenant.employeeId, tenant.userId],
    );
    return result.rows[0].id;
  }

  // Insere um esocial_certificates mínimo direto via superuser (bypassa RLS/HTTP) —
  // usado por specs de RLS (Task 12, esocial-certificates-rls.e2e-spec.ts) que
  // precisam de um certificado em outro tenant sem passar pelo fluxo de upload
  // (que cifra via envelope-encryption). Os campos cifrados recebem placeholder
  // textual — nenhum spec tenta decifrar, e o teste de RLS só verifica visibilidade.
  async insertMinimalCertificate(tenant: {
    tenantId: string;
    userId: string;
  }): Promise<string> {
    const result = await this.client.query<{ id: string }>(
      `INSERT INTO esocial_certificates (
        tenant_id, label, subject_cn, thumbprint_sha256, not_before, not_after,
        status, pfx_r2_key, encrypted_password, encrypted_data_key, uploaded_by_user_id
      ) VALUES ($1, 'Teste', 'TESTE LTDA', 'aaaa', now() - interval '1 day', now() + interval '1 year',
        'ativo', 'fake-key', 'fake:fake:fake', 'fake:fake:fake', $2)
      RETURNING id`,
      [tenant.tenantId, tenant.userId],
    );
    return result.rows[0].id;
  }

  // Consulta/ajuste direto via superuser (bypassa RLS): só para montar o cenário do teste.
  async rawQuery<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.client.query(sql, params);
    return r.rows as T[];
  }

  async getActiveLayoutVersionId(): Promise<string> {
    const r = await this.client.query<{ id: string }>(
      'SELECT id FROM esocial_layout_versions WHERE is_active ORDER BY effective_from DESC LIMIT 1',
    );
    return r.rows[0].id;
  }

  async insertRawRow(table: string, row: Record<string, unknown>): Promise<string> {
    if (!/^[a-z_]+$/.test(table)) throw new Error('nome de tabela inválido');
    const cols = Object.keys(row);
    const result = await this.client.query<{ id: string }>(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      cols.map((c) => row[c]),
    );
    return result.rows[0].id;
  }
}
