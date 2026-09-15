import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { FUNCTION_EXTRACTION_PROVIDER } from '../src/pente-fino/function-extraction-provider.interface';
import { DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER } from '../src/pente-fino/document-checklist-provider.interface';
import { LIP_AGENT_EXTRACTION_PROVIDER } from '../src/pente-fino/lip-agent-provider.interface';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb } from './db-test-helper';

// Mesmo motivo de pente-fino-run.e2e-spec.ts: contador próprio por
// rota, teto baixo (5/hora) — sem zerar, o 6º request deste arquivo
// receberia 429 em vez do status esperado.
const RATE_LIMIT_KEY = 'ratelimit:PenteFinoController.run:::ffff:127.0.0.1';

function buildTestPdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.text(text);
    doc.end();
  });
}

const EMPTY_CHECKLIST = {
  elaboration_date: '',
  elaboration_date_excerpt: '',
  professional_name: '',
  professional_registro: '',
  professional_papel: '',
  professional_excerpt: '',
};

describe('POST /pente-fino/run — cobertura de agentes LIP×LTCAT (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let token: string;
  let tenantId: string;
  let userId: string;
  // Vivos até o afterAll (não por `it`) — mesmo motivo dos outros e2e do
  // Pente-Fino: o teste de RLS (último `it`) precisa que os dois
  // documentos com dado sensível ("Ruído contínuo"/"Calor de fundição")
  // ainda existam quando ele rodar, senão a asserção anti-vazamento não
  // prova nada.
  let lipDocId: string;
  let ltcatDocId: string;
  const fakeExtractFunction = jest.fn();
  const fakeExtractChecklist = jest.fn();
  const fakeExtractLipAgents = jest.fn();
  const fakeGetObject = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FUNCTION_EXTRACTION_PROVIDER)
      .useValue({ extract: fakeExtractFunction })
      .overrideProvider(DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER)
      .useValue({ extract: fakeExtractChecklist })
      .overrideProvider(LIP_AGENT_EXTRACTION_PROVIDER)
      .useValue({ extract: fakeExtractLipAgents })
      .overrideProvider(R2Service)
      .useValue({ getObject: fakeGetObject })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    redis = new Redis(process.env.REDIS_URL as string);
    await redis.del(RATE_LIMIT_KEY);

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Pente-Fino Cobertura LIP-LTCAT Teste');
    tenantId = tenant.tenantId;
    userId = tenant.userId;
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    fakeExtractFunction.mockResolvedValue([]);
    fakeExtractChecklist.mockResolvedValue(EMPTY_CHECKLIST);
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM documents WHERE id = ANY($1)', [[lipDocId, ltcatDocId]]);
    await redis.del(RATE_LIMIT_KEY);
    await redis.quit();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('LIP com ruído e LTCAT com calor, sem sobreposição: cobertura aponta os dois lados', async () => {
    const client = (db as any).client;
    const lipDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'lip', 'LIP Cobertura Teste', 'fixture/lip-cobertura.pdf', 'lip.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );
    const ltcatDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'ltcat', 'LTCAT Cobertura Teste', 'fixture/ltcat-cobertura.pdf', 'ltcat.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );
    // Não apagados aqui de propósito — ver comentário na declaração de
    // lipDocId/ltcatDocId no topo do describe. Limpeza real acontece no afterAll.
    lipDocId = lipDoc.rows[0].id;
    ltcatDocId = ltcatDoc.rows[0].id;

    fakeGetObject.mockImplementation(async (key: string) => {
      if (key === 'fixture/lip-cobertura.pdf') {
        return buildTestPdf('Ruído contínuo medido em 88 dB(A). Não caracteriza insalubridade.');
      }
      if (key === 'fixture/ltcat-cobertura.pdf') {
        return buildTestPdf('Calor de fundição avaliado em 29°C IBUTG.');
      }
      throw new Error(`fixture inesperada: ${key}`);
    });
    fakeExtractLipAgents.mockImplementation(async (fullText: string) => {
      if (fullText.includes('Ruído contínuo')) {
        return [
          {
            agent_name_raw: 'Ruído contínuo',
            agent_category: 'ruido',
            measured_value_raw: '88 dB(A)',
            conclusion_excerpt: 'Não caracteriza insalubridade',
            source_excerpt: 'Ruído contínuo medido em 88 dB(A)',
          },
        ];
      }
      if (fullText.includes('Calor de fundição')) {
        return [
          {
            agent_name_raw: 'Calor de fundição',
            agent_category: 'calor',
            measured_value_raw: '29°C IBUTG',
            conclusion_excerpt: '',
            source_excerpt: 'Calor de fundição avaliado em 29°C IBUTG',
          },
        ];
      }
      return [];
    });

    const res = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    const byCategory = Object.fromEntries(
      res.body.agent_coverage.map((f: { agent_category: string; presence: string }) => [f.agent_category, f.presence]),
    );
    expect(byCategory).toEqual({ ruido: 'so_lip', calor: 'so_ltcat' });
  });

  it('LTCAT reenviado citando ruído também: categoria ruído sai da cobertura (agora "ambos"), calor continua so_ltcat (LIP nunca citou calor)', async () => {
    const client = (db as any).client;
    const novoLtcatDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'ltcat', 'LTCAT Cobertura Atualizado Teste', 'fixture/ltcat-cobertura-v2.pdf', 'ltcat.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );
    // Documento LTCAT anterior precisa sair de cena — loadContext sempre
    // pega o LTCAT mais recente (ORDER BY created_at DESC LIMIT 1), mesmo
    // padrão já usado pelos outros tipos de documento.
    await client.query('DELETE FROM documents WHERE id = $1', [ltcatDocId]);
    ltcatDocId = novoLtcatDoc.rows[0].id;

    fakeGetObject.mockImplementation(async (key: string) => {
      if (key === 'fixture/ltcat-cobertura-v2.pdf') {
        return buildTestPdf('Ruído de impacto medido em 125 dB(linear). Calor de fundição avaliado em 29°C IBUTG.');
      }
      throw new Error(`fixture inesperada: ${key}`);
    });
    fakeExtractLipAgents.mockImplementation(async (fullText: string) => {
      if (fullText.includes('Ruído de impacto')) {
        return [
          {
            agent_name_raw: 'Ruído de impacto',
            agent_category: 'ruido',
            measured_value_raw: '125 dB(linear)',
            conclusion_excerpt: '',
            source_excerpt: 'Ruído de impacto medido em 125 dB(linear)',
          },
          {
            agent_name_raw: 'Calor de fundição',
            agent_category: 'calor',
            measured_value_raw: '29°C IBUTG',
            conclusion_excerpt: '',
            source_excerpt: 'Calor de fundição avaliado em 29°C IBUTG',
          },
        ];
      }
      return [];
    });

    const res = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    const byCategory = Object.fromEntries(
      res.body.agent_coverage.map((f: { agent_category: string; presence: string }) => [f.agent_category, f.presence]),
    );
    // ruído: LIP e o novo LTCAT citam os dois -> "ambos". calor: só o
    // LTCAT cita (o LIP do primeiro teste nunca mencionou calor) ->
    // continua "so_ltcat" mesmo depois do reenvio.
    expect(byCategory).toEqual({ ruido: 'ambos', calor: 'so_ltcat' });
  });

  it('técnico não vinculado recebe 403 sem vazar nenhum dado de cobertura da empresa', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado Cobertura Teste');
    const loginTecnico = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });

    const res = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${loginTecnico.body.access_token}`)
      .send({ tenant_id: tenantId });

    expect(res.status).toBe(403);
    // LIP do primeiro teste continua no banco (só é apagado no afterAll)
    // — "Ruído contínuo" e "88 dB(A)" são dado real que vazaria se o bug
    // de RLS corrigido como achado Crítico na Fase 25 fosse reintroduzido.
    expect(JSON.stringify(res.body)).not.toContain('Ruído contínuo');
    expect(JSON.stringify(res.body)).not.toContain('88 dB(A)');
    expect(JSON.stringify(res.body)).not.toContain('Calor de fundição');
  });
});
