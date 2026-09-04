import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CAEPI — consulta de CA (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let empresaToken: string;
  let tecnicoToken: string;
  const testCaNumbers = ['TESTE-99001', 'TESTE-99002'];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const client = (db as any).client;

    const tenant = await db.createTenantWithUser('Empresa CAEPI Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;

    // tecnico/parceiro têm tenant_id NULL (podem estar vinculados a
    // múltiplos tenants, não pertencem a um só) — o caso interessante
    // pra confirmar que /caepi/search (sem @Roles, qualquer role
    // autenticada) funciona de fato contra uma tabela sem conceito de
    // tenant nenhum, não só pra empresa.
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico CAEPI Teste');
    const loginTecnico = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });
    tecnicoToken = loginTecnico.body.access_token;

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

    // caepi_sync_status nunca é escrito por este describe (o teste de
    // sync-status abaixo só lê o que já está lá) — nada a restaurar.
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

  it('tecnico (tenant_id NULL) também consegue buscar — sem @Roles, qualquer role autenticada', async () => {
    const res = await request(app.getHttpServer())
      .get('/caepi/search?q=TESTE-99001')
      .set('Authorization', `Bearer ${tecnicoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.some((r: any) => r.numero_ca === 'TESTE-99001')).toBe(true);
  });

  // Não grava nenhum valor em caepi_sync_status — essa tabela é a
  // linha real/global de produção (sem tenant), compartilhada com
  // qualquer sincronização real já rodada neste mesmo Postgres (ver
  // Task 2). Um round anterior deste teste gravava um valor fabricado
  // aqui e restaurava no afterAll — se o processo do teste morresse
  // entre a escrita e o afterAll (Ctrl-C, timeout do Jest, container
  // morto — este projeto roda e2e com --forceExit, evidência de que
  // isso acontece), produção ficaria mostrando dado fabricado até
  // alguém notar e rodar a sincronização de novo. Em vez de mitigar
  // esse risco, elimina a classe inteira: lê o que já está gravado e
  // confere que a API devolve exatamente isso, sem escrever nada.
  it('sync-status devolve exatamente os dados gravados na tabela', async () => {
    const client = (db as any).client;
    const { rows } = await client.query('SELECT last_synced_at, rows_imported, rows_skipped FROM caepi_sync_status WHERE id = 1');
    const existing = rows[0];

    const res = await request(app.getHttpServer())
      .get('/caepi/sync-status')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    if (existing) {
      expect(res.body.rows_imported).toBe(existing.rows_imported);
      expect(res.body.rows_skipped).toBe(existing.rows_skipped);
      expect(new Date(res.body.last_synced_at).toISOString()).toBe(new Date(existing.last_synced_at).toISOString());
    } else {
      expect(res.body).toEqual({ last_synced_at: null, rows_imported: null, rows_skipped: null });
    }
  });
});
