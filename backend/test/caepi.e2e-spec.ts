import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CAEPI — consulta de CA (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let empresaToken: string;
  const testCaNumbers = ['TESTE-99001', 'TESTE-99002'];
  // caepi_sync_status é uma tabela global de uma linha só, sem
  // tenant — a Task 2 pode já ter rodado a sincronização real contra
  // este mesmo Postgres antes deste teste (comportamento esperado e
  // correto). O teste de sync-status precisa gravar um valor
  // conhecido pra ser determinístico, então captura o que já existia
  // aqui pra restaurar no afterAll — nunca deixa o registro real
  // (ou a ausência dele) corrompido por dado de teste.
  let originalSyncStatus: { last_synced_at: string; rows_imported: number; rows_skipped: number } | null = null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    // Captura o estado real de caepi_sync_status logo após a conexão,
    // antes de qualquer passo que possa lançar exceção (criação de
    // tenant/usuário, login HTTP, insert dos fixtures TESTE- em
    // caepi_records). Se essa captura acontecer depois de um passo
    // falível, um beforeAll interrompido (ex.: rerun com fixtures
    // TESTE- ainda presentes de uma execução anterior interrompida)
    // deixaria originalSyncStatus em null e o afterAll deletaria a
    // linha real da sincronização de produção — ver comentário na
    // declaração de originalSyncStatus acima.
    const client = (db as any).client;
    const existing = await client.query('SELECT last_synced_at, rows_imported, rows_skipped FROM caepi_sync_status WHERE id = 1');
    originalSyncStatus = existing.rows[0] ?? null;

    const tenant = await db.createTenantWithUser('Empresa CAEPI Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;

    await client.query(
      `INSERT INTO caepi_records (numero_ca, data_validade, situacao, equipamento, marca_ca, razao_social)
       VALUES
         ($1, CURRENT_DATE + INTERVAL '365 days', 'VÁLIDO', 'CAPACETE DE SEGURANÇA TESTE', 'MARCA TESTE X', 'FABRICANTE TESTE LTDA'),
         ($2, CURRENT_DATE - INTERVAL '30 days', 'VENCIDO', 'LUVA DE SEGURANÇA TESTE', 'MARCA TESTE Y', 'OUTRO FABRICANTE TESTE LTDA')`,
      testCaNumbers,
    );
  });

  afterAll(async () => {
    const client = (db as any).client;
    // Limpeza explícita — caepi_records não tem tenant_id, então o
    // cascade de db.cleanup() (abaixo) não alcança essas linhas.
    await client.query('DELETE FROM caepi_records WHERE numero_ca = ANY($1)', [testCaNumbers]);

    // Restaura caepi_sync_status pro estado de antes deste describe —
    // ver comentário na declaração de originalSyncStatus acima.
    if (originalSyncStatus) {
      await client.query(
        `INSERT INTO caepi_sync_status (id, last_synced_at, rows_imported, rows_skipped)
         VALUES (1, $1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           last_synced_at = EXCLUDED.last_synced_at,
           rows_imported = EXCLUDED.rows_imported,
           rows_skipped = EXCLUDED.rows_skipped`,
        [originalSyncStatus.last_synced_at, originalSyncStatus.rows_imported, originalSyncStatus.rows_skipped],
      );
    } else {
      await client.query('DELETE FROM caepi_sync_status WHERE id = 1');
    }

    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('busca por número de CA exato devolve o registro certo primeiro', async () => {
    const res = await request(app.getHttpServer())
      .get('/caepi/search?q=TESTE-99001')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].numero_ca).toBe('TESTE-99001');
    expect(res.body[0].situacao).toBe('VÁLIDO');
  });

  it('busca livre por equipamento encontra por ILIKE', async () => {
    const res = await request(app.getHttpServer())
      .get('/caepi/search?q=CAPACETE DE SEGURANÇA TESTE')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.some((r: any) => r.numero_ca === 'TESTE-99001')).toBe(true);
  });

  it('rejeita busca sem "q" com 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/caepi/search')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(400);
  });

  it('bloqueia acesso sem autenticação', async () => {
    const res = await request(app.getHttpServer()).get('/caepi/search?q=TESTE-99001');
    expect(res.status).toBe(401);
  });

  it('sync-status devolve exatamente os dados gravados na tabela', async () => {
    const client = (db as any).client;
    // Grava um estado conhecido diretamente — não confia em nenhum
    // estado ambiente que a sincronização real da Task 2 possa ou não
    // ter deixado neste mesmo Postgres (caepi_sync_status é uma
    // tabela global, sem tenant, então esse ambiente é compartilhado
    // com qualquer sincronização real já rodada). Torna o teste
    // determinístico independente da ordem de execução das tasks —
    // o valor original é restaurado no afterAll (ver
    // originalSyncStatus), então esta escrita não corrompe o estado
    // real de sincronização de forma permanente.
    await client.query(
      `INSERT INTO caepi_sync_status (id, last_synced_at, rows_imported, rows_skipped)
       VALUES (1, '2026-01-15T10:00:00Z', 12345, 6)
       ON CONFLICT (id) DO UPDATE SET
         last_synced_at = EXCLUDED.last_synced_at,
         rows_imported = EXCLUDED.rows_imported,
         rows_skipped = EXCLUDED.rows_skipped`,
    );

    const res = await request(app.getHttpServer())
      .get('/caepi/sync-status')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.rows_imported).toBe(12345);
    expect(res.body.rows_skipped).toBe(6);
    expect(new Date(res.body.last_synced_at).toISOString()).toBe('2026-01-15T10:00:00.000Z');
  });
});
