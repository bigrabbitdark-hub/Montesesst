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

describe('POST /pente-fino/run — agentes do LIP × audiometria (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let token: string;
  let tenantId: string;
  let userId: string;
  // Vivos até o afterAll (não por `it`) — mesmo motivo de
  // pente-fino-checklist.e2e-spec.ts: o teste de RLS (último `it`)
  // precisa que o LIP com "Ruído contínuo"/"92 dB(A)" ainda exista
  // quando ele rodar, senão a asserção anti-vazamento não prova nada.
  let lipDocId: string;
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
    const tenant = await db.createTenantWithUser('Empresa Pente-Fino LIP Insalubridade Teste');
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
    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [lipDocId]);
    await redis.del(RATE_LIMIT_KEY);
    await redis.quit();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('LIP com ruído insalubre + PCMSO sem audiometria: achado exame_ausente aparece', async () => {
    const client = (db as any).client;
    const lipDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'lip', 'LIP Insalubridade Teste', 'fixture/lip-insalubridade.pdf', 'lip.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );
    // Não apagado aqui de propósito — ver comentário na declaração de
    // lipDocId no topo do describe. Limpeza real acontece no afterAll.
    lipDocId = lipDoc.rows[0].id;

    const pcmsoDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pcmso', 'PCMSO Sem Audiometria Teste', 'fixture/pcmso-sem-audio.pdf', 'pcmso.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );

    fakeGetObject.mockImplementation(async (key: string) => {
      if (key === 'fixture/lip-insalubridade.pdf') {
        return buildTestPdf('Ruído contínuo medido em 92 dB(A). Conclusão: caracteriza insalubridade em grau médio.');
      }
      if (key === 'fixture/pcmso-sem-audio.pdf') {
        return buildTestPdf('Exames complementares: hemograma completo, glicemia de jejum.');
      }
      throw new Error(`fixture inesperada: ${key}`);
    });
    fakeExtractLipAgents.mockImplementation(async (fullText: string) => {
      if (fullText.includes('Ruído contínuo')) {
        return [
          {
            agent_name_raw: 'Ruído contínuo',
            agent_category: 'ruido',
            measured_value_raw: '92 dB(A)',
            conclusion_excerpt: 'caracteriza insalubridade em grau médio',
            source_excerpt: 'Ruído contínuo medido em 92 dB(A)',
          },
        ];
      }
      return [];
    });
    fakeExtractFunction.mockResolvedValue([
      { function_text: 'Operador de Máquina', description: 'hemograma completo', source_excerpt: 'hemograma completo' },
    ]);

    const res = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.lip_agents).toEqual([
      {
        agent_name_raw: 'Ruído contínuo',
        agent_category: 'ruido',
        measured_value_raw: '92 dB(A)',
        insalubre: true,
        conclusion_excerpt: 'caracteriza insalubridade em grau médio',
        source_excerpt: 'Ruído contínuo medido em 92 dB(A)',
        exam_status: 'exame_ausente',
      },
    ]);

    await client.query('DELETE FROM documents WHERE id = $1', [pcmsoDoc.rows[0].id]);
  });

  it('mesmo LIP em cache + PCMSO agora COM audiometria: achado vira ok, sem nova chamada à IA de agentes', async () => {
    const client = (db as any).client;
    const pcmsoDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pcmso', 'PCMSO Com Audiometria Teste', 'fixture/pcmso-com-audio.pdf', 'pcmso.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );

    fakeGetObject.mockImplementation(async (key: string) => {
      if (key === 'fixture/pcmso-com-audio.pdf') {
        return buildTestPdf('Exames complementares: audiometria tonal, hemograma completo.');
      }
      throw new Error(`fixture inesperada: ${key}`);
    });
    fakeExtractFunction.mockResolvedValue([
      { function_text: 'Operador de Máquina', description: 'audiometria tonal', source_excerpt: 'audiometria tonal' },
    ]);
    fakeExtractLipAgents.mockClear();

    const res = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    // LIP já está em cache (linha persistida no teste anterior) —
    // extractAgents não deve ser chamado de novo.
    expect(fakeExtractLipAgents).not.toHaveBeenCalled();
    expect(res.body.lip_agents).toEqual([
      expect.objectContaining({ agent_name_raw: 'Ruído contínuo', exam_status: 'ok' }),
    ]);

    await client.query('DELETE FROM documents WHERE id = $1', [pcmsoDoc.rows[0].id]);
  });

  it('PCMSO cita audiometria solta no texto, sem vincular a nenhuma função: achado vira ok pelo segundo sinal (texto bruto)', async () => {
    const client = (db as any).client;
    const pcmsoDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pcmso', 'PCMSO Audiometria Solta Teste', 'fixture/pcmso-audiometria-solta.pdf', 'pcmso.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );

    fakeGetObject.mockImplementation(async (key: string) => {
      if (key === 'fixture/pcmso-audiometria-solta.pdf') {
        return buildTestPdf('Exames complementares previstos: audiometria, conforme necessidade clínica.');
      }
      throw new Error(`fixture inesperada: ${key}`);
    });
    // Sem vínculo a função nenhuma — a extração função↔exame não acha
    // nada, então pcmso_function_exams fica vazia pra este documento. Se
    // o segundo sinal (texto bruto) não existisse, o achado ficaria
    // "exame_ausente" mesmo com "audiometria" genuinamente presente.
    fakeExtractFunction.mockResolvedValue([]);
    fakeExtractLipAgents.mockClear();

    const res = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    // LIP já está em cache (persistido no primeiro teste) — não precisa
    // extrair de novo.
    expect(fakeExtractLipAgents).not.toHaveBeenCalled();
    expect(res.body.lip_agents).toEqual([
      expect.objectContaining({ agent_name_raw: 'Ruído contínuo', exam_status: 'ok' }),
    ]);

    await client.query('DELETE FROM documents WHERE id = $1', [pcmsoDoc.rows[0].id]);
  });

  it('técnico não vinculado recebe 403 sem vazar nenhum dado de agente do LIP da empresa', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado LIP Insalubridade Teste');
    const loginTecnico = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });

    const res = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${loginTecnico.body.access_token}`)
      .send({ tenant_id: tenantId });

    expect(res.status).toBe(403);
    // LIP do primeiro teste continua no banco (só é apagado no
    // afterAll) — "92 dB(A)" e "caracteriza insalubridade em grau
    // médio" são dado real que vazaria se o bug de RLS corrigido como
    // achado Crítico na Fase 25 fosse reintroduzido. Sem esse documento
    // ainda existir, esta asserção passaria mesmo com o bug de volta.
    expect(JSON.stringify(res.body)).not.toContain('92 dB(A)');
    expect(JSON.stringify(res.body)).not.toContain('caracteriza insalubridade em grau médio');
    expect(JSON.stringify(res.body)).not.toContain('Ruído contínuo');
  });
});
