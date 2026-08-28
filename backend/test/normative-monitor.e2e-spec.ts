import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { NormativeMonitorService } from '../src/normative/normative-monitor.service';
import { TestDb } from './db-test-helper';

// Usa o AppModule inteiro (não um módulo mínimo) porque
// NormativeMonitorService depende de DatabaseService, que por sua vez
// abre um Pool real de conexões a partir de DATABASE_URL — bootstrapar
// só os providers deste módulo deixaria essa dependência sem prover.
// Mesmo padrão já usado em ai-copilot-openrouter-extractor.e2e-spec.ts.
describe('NormativeMonitorService (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let monitor: NormativeMonitorService;
  let sourceIdPdf: string;
  let sourceIdFalha: string;
  let fetchSpy: jest.SpyInstance | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    monitor = moduleRef.get(NormativeMonitorService);

    db = new TestDb();
    await db.connect();
    const client = (db as any).client;

    const src1 = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url, active)
       VALUES ('MTE', 'NR-TESTE', 'Norma de teste', 'https://exemplo.gov.br/norma-teste.html', true) RETURNING id`,
    );
    sourceIdPdf = src1.rows[0].id;

    const src2 = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url, active)
       VALUES ('MTE', 'NR-FALHA', 'Fonte que falha', 'https://exemplo.gov.br/fora-do-ar.html', true) RETURNING id`,
    );
    sourceIdFalha = src2.rows[0].id;
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM normative_documents WHERE source_id IN ($1, $2)', [sourceIdPdf, sourceIdFalha]);
    await client.query('DELETE FROM official_sources WHERE id IN ($1, $2)', [sourceIdPdf, sourceIdFalha]);
    await db.disconnect();
    await app.close();
  });

  it('cria normative_document aguardando_validacao quando o conteúdo muda, e não repete quando não muda', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (url === 'https://exemplo.gov.br/norma-teste.html') {
        return new Response('<html><body><p>Conteúdo da norma de teste.</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      throw new Error('URL inesperada nesta chamada do teste: ' + url);
    });

    await monitor.runOnce();

    const client = (db as any).client;
    const afterFirstRun = await client.query(
      `SELECT status, mime_type FROM normative_documents WHERE source_id = $1`,
      [sourceIdPdf],
    );
    expect(afterFirstRun.rows).toHaveLength(1);
    expect(afterFirstRun.rows[0].status).toBe('aguardando_validacao');
    expect(afterFirstRun.rows[0].mime_type).toBe('text/html');

    // Segunda execução com o MESMO conteúdo: não deve criar segunda linha.
    await monitor.runOnce();
    const afterSecondRun = await client.query(
      `SELECT id FROM normative_documents WHERE source_id = $1`,
      [sourceIdPdf],
    );
    expect(afterSecondRun.rows).toHaveLength(1);
  });

  it('falha numa fonte não impede o processamento das demais', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (url === 'https://exemplo.gov.br/norma-teste.html') {
        return new Response('<html><body><p>Conteúdo mudou de novo.</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (url === 'https://exemplo.gov.br/fora-do-ar.html') {
        throw new Error('ECONNREFUSED');
      }
      throw new Error('URL inesperada nesta chamada do teste: ' + url);
    });

    await expect(monitor.runOnce()).resolves.not.toThrow();

    const client = (db as any).client;
    const result = await client.query(
      `SELECT status FROM normative_documents WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [sourceIdPdf],
    );
    expect(result.rows[0].status).toBe('aguardando_validacao');
  });
});
