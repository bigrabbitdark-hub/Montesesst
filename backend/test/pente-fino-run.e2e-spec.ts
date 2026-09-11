import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { FUNCTION_EXTRACTION_PROVIDER } from '../src/pente-fino/function-extraction-provider.interface';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb } from './db-test-helper';

// Mesmo motivo do RATE_LIMIT_KEY em documents-classify-batch.e2e-spec.ts —
// /pente-fino/run tem contador próprio por rota (RateLimitGuard), com teto
// baixo (5/hora) porque cada chamada pode disparar 2 chamadas de LLM. Sem
// zerar o contador entre os testes, o 6º request deste arquivo (ou uma
// segunda execução da suíte dentro da mesma hora) receberia 429 em vez do
// status esperado.
const RATE_LIMIT_KEY = 'ratelimit:PenteFinoController.run:::ffff:127.0.0.1';

// Mesmo helper de pente-fino-extractor.unit-spec.ts: gera um PDF de
// verdade em memória pra que a extração de texto (pdf-parse) tenha algo
// real pra processar. Necessário aqui porque, diferente do unit-spec,
// este e2e sobe o R2Service de verdade (client S3 real) — sem sobrepor
// getObject com um fake que devolve um PDF válido, a chamada bateria no
// R2 real, a chave de fixture não existiria lá (NoSuchKey), e o catch
// "nunca lança exceção" de PenteFinoExtractorService.extractRows
// devolveria [] silenciosamente. Isso faria o teste passar por um
// motivo errado — o caminho "extrai pela primeira vez via provider
// fake" nunca seria exercitado de verdade, só o caminho de falha de
// download (que é outro, já coberto em pente-fino-extractor.unit-spec.ts).
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

describe('POST /pente-fino/run (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let token: string;
  let tenantId: string;
  let pgrDocId: string;
  let pcmsoDocId: string;
  let positionId: string;
  let linkedTechnicianToken: string;
  let unlinkedTechnicianToken: string;
  let linkedTechnicianId: string;
  let unlinkedTechnicianId: string;
  const fakeExtract = jest.fn();
  const fakeGetObject = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FUNCTION_EXTRACTION_PROVIDER)
      .useValue({ extract: fakeExtract })
      .overrideProvider(R2Service)
      .useValue({ getObject: fakeGetObject })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    // PCMSO nunca teve extração persistida (só o PGR ganha um INSERT
    // manual abaixo), então ensureExtracted vai baixar do "R2" (fake) e
    // rodar o pipeline de extração de verdade — daí precisar de um PDF
    // real aqui, não um buffer qualquer.
    fakeGetObject.mockResolvedValue(await buildTestPdf('Documento PCMSO de teste, sem função relevante.'));

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Pente-Fino Run Teste');
    tenantId = tenant.tenantId;
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    const client = (db as any).client;
    const pos = await client.query(`INSERT INTO positions (tenant_id, name) VALUES ($1, 'Soldador') RETURNING id`, [
      tenantId,
    ]);
    positionId = pos.rows[0].id;

    const pgrDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR Teste', 'fixture/pgr-run-teste.pdf', 'pgr.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, tenant.userId],
    );
    pgrDocId = pgrDoc.rows[0].id;

    const pcmsoDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pcmso', 'PCMSO Teste', 'fixture/pcmso-run-teste.pdf', 'pcmso.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, tenant.userId],
    );
    pcmsoDocId = pcmsoDoc.rows[0].id;

    // Extração já persistida só pro PGR — simula que o Pente-Fino já
    // processou esse documento antes, então o endpoint reaproveita em
    // vez de chamar a IA/R2 de novo (path "reuse cached extraction").
    // O PCMSO fica de propósito sem nenhuma linha aqui: é ele quem
    // exercita o path "extrai pela primeira vez" (via o R2Service e o
    // FUNCTION_EXTRACTION_PROVIDER fakeados acima) — ver a asserção
    // `fakeExtract` no teste abaixo, que confirma que o provider fake
    // foi de fato chamado, não só que o resultado bateu por acidente.
    await client.query(
      `INSERT INTO pgr_function_risks (tenant_id, document_id, position_id, function_text_raw, risk_description, source_excerpt)
       VALUES ($1, $2, $3, 'Soldador', 'Fumos metálicos', 'trecho pgr')`,
      [tenantId, pgrDocId, positionId],
    );

    // Dois técnicos com o MESMO cenário do ponto de vista do atacante —
    // ambos conhecem (ou chutam) o tenant_id desta empresa e mandam ele no
    // corpo. A única diferença é o vínculo em tenant_technicians; é ele, e
    // não o tenant_id do corpo, que precisa decidir quem consegue rodar o
    // Pente-Fino nesta empresa. Mesmo padrão de fixture de
    // pente-fino-function-extraction-rls.e2e-spec.ts.
    const linkedTechUser = await db.createUserWithRole('tecnico', 'Tecnico Vinculado PenteFino Run');
    const unlinkedTechUser = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado PenteFino Run');

    const linkedTech = await client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [
      linkedTechUser.userId,
    ]);
    linkedTechnicianId = linkedTech.rows[0].id;
    const unlinkedTech = await client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [
      unlinkedTechUser.userId,
    ]);
    unlinkedTechnicianId = unlinkedTech.rows[0].id;

    await client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      tenantId,
      linkedTechnicianId,
    ]);

    const linkedLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: linkedTechUser.email, password: linkedTechUser.password });
    linkedTechnicianToken = linkedLogin.body.access_token;

    const unlinkedLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: unlinkedTechUser.email, password: unlinkedTechUser.password });
    unlinkedTechnicianToken = unlinkedLogin.body.access_token;

    redis = new Redis(process.env.REDIS_URL as string);
  });

  beforeEach(async () => {
    await redis.del(RATE_LIMIT_KEY);
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM pgr_function_risks WHERE document_id = $1', [pgrDocId]);
    await (db as any).client.query('DELETE FROM pcmso_function_exams WHERE document_id = $1', [pcmsoDocId]);
    await (db as any).client.query('DELETE FROM documents WHERE id = ANY($1)', [[pgrDocId, pcmsoDocId]]);
    await (db as any).client.query('DELETE FROM positions WHERE id = $1', [positionId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = ANY($1)', [
      [linkedTechnicianId, unlinkedTechnicianId],
    ]);
    await db.cleanup();
    await db.disconnect();
    await redis.del(RATE_LIMIT_KEY);
    redis.disconnect();
    await app.close();
  });

  it('devolve o relatório com risco_sem_exame pra Soldador (PGR tem extração pronta, PCMSO nunca foi extraído e o fake devolve vazio)', async () => {
    fakeExtract.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.pgr_document.id).toBe(pgrDocId);
    expect(res.body.pcmso_document.id).toBe(pcmsoDocId);
    expect(res.body.functions).toEqual([
      expect.objectContaining({
        position_id: positionId,
        position_name: 'Soldador',
        status: 'risco_sem_exame',
      }),
    ]);
    expect(res.body.warnings).toEqual([]);

    // Confirma que o resultado vazio pro PCMSO veio de fato do path
    // "extrai pela primeira vez" (download via R2 fakeado + provider
    // fake chamado e devolvendo []), não de uma falha silenciosa de
    // download que coincidentemente também devolve [] — os dois
    // produzem a mesma resposta HTTP, então sem esta asserção o teste
    // passaria mesmo se o R2Service real (sem fixture cadastrada)
    // estivesse sendo usado por engano.
    expect(fakeGetObject).toHaveBeenCalledWith('fixture/pcmso-run-teste.pdf');
    expect(fakeExtract).toHaveBeenCalledWith(expect.any(String), 'exame');
  });

  it('bloqueia sem token com 401', async () => {
    const res = await request(app.getHttpServer()).post('/pente-fino/run').send({});
    expect(res.status).toBe(401);
  });

  // Regressão da vulnerabilidade de bypass de RLS multi-tenant encontrada na
  // revisão final da Fase 25: o service montava o TenantContext com o
  // tenant_id ALVO (vindo do corpo, controlado por quem chama) em vez do
  // tenant_id do JWT. Como toda policy de RLS deste projeto aceita
  // `tenant_id = current_setting('app.tenant_id')`, qualquer técnico
  // autenticado que soubesse o UUID de uma empresa lia os documentos, o PGR e
  // o PCMSO dela. Este teste tem que dar 403 — nunca 200 com relatório, nunca
  // 200 com relatório vazio (vazio esconderia uma regressão parcial).
  it('técnico NÃO vinculado à empresa recebe 403 mesmo mandando o tenant_id real no corpo', async () => {
    fakeExtract.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${unlinkedTechnicianToken}`)
      .send({ tenant_id: tenantId });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(pgrDocId);
    expect(JSON.stringify(res.body)).not.toContain('Fumos metálicos');
  });

  // Contraprova do teste acima: o vínculo real em tenant_technicians (e não o
  // tenant_id do corpo) é o que libera o acesso — o caminho legítimo do
  // técnico continua funcionando e devolve o MESMO relatório que a empresa vê.
  it('técnico vinculado à empresa roda o Pente-Fino dela e recebe o relatório completo', async () => {
    fakeExtract.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${linkedTechnicianToken}`)
      .send({ tenant_id: tenantId });

    expect(res.status).toBe(201);
    expect(res.body.pgr_document.id).toBe(pgrDocId);
    expect(res.body.pcmso_document.id).toBe(pcmsoDocId);
    expect(res.body.functions).toEqual([
      expect.objectContaining({
        position_id: positionId,
        position_name: 'Soldador',
        status: 'risco_sem_exame',
      }),
    ]);
    expect(res.body.warnings).toEqual([]);
  });
});
