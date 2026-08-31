import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/normative/embedding-provider.interface';
import { NORMATIVE_ANSWER_PROVIDER } from '../src/normative/normative-answer-provider.interface';
import { toVectorLiteral } from '../src/normative/vector.util';
import { TestDb } from './db-test-helper';

describe('POST /assistant/normative-query (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let tokenTecnico: string;
  let sourceId: string;
  let documentId: string;
  let chunkId: string;
  let expiredDocumentId: string;
  const fakeAnswer = jest.fn();
  // Capturado à parte (em vez de um objeto anônimo) para que um teste
  // isolado possa sobrepor a resposta uma única vez com
  // mockResolvedValueOnce e verificar, via este mesmo spy, que o
  // provedor de resposta nunca é chamado quando nenhum chunk atinge o
  // limiar de similaridade — sem afetar o valor padrão usado pelos
  // demais testes.
  const fakeEmbed = jest.fn().mockResolvedValue(new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)));

  function iso(daysFromToday: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    return d.toISOString().slice(0, 10);
  }

  async function insertExpiredDocument(tenantId: string, userId: string, title: string) {
    const res = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', $2, $3, $3, 'application/pdf', 100, $4, $5, 'empresa')
       RETURNING id`,
      [tenantId, title, `fixture/${tenantId}-pgr-teste.pdf`, iso(-5), userId],
    );
    return res.rows[0].id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      .overrideProvider(NORMATIVE_ANSWER_PROVIDER)
      .useValue({ answer: fakeAnswer })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Assistente Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const tenant = await db.createTenantWithUser('Empresa Assistente Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;

    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Assistente Teste');
    const loginTecnico = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });
    tokenTecnico = loginTecnico.body.access_token;

    expiredDocumentId = await insertExpiredDocument(
      tenant.tenantId,
      tenant.userId,
      'Documento vencido teste operacional',
    );

    const client = (db as any).client;
    const src = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-ASSISTENTE', 'Norma teste assistente', 'https://exemplo.gov.br/assistente.html') RETURNING id`,
    );
    sourceId = src.rows[0].id;

    const doc = await client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text, indexed_at)
       VALUES ($1, 'vigente', 'hash-assistente', 'normative/assistente.html', 'assistente.html', 'text/html', 'Texto vigente de teste', now())
       RETURNING id`,
      [sourceId],
    );
    documentId = doc.rows[0].id;

    const exactVector = toVectorLiteral(new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
    const chunk = await client.query(
      `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
       VALUES ($1, 0, 'Trecho oficial sobre uso de capacete.', $2::vector) RETURNING id`,
      [documentId, exactVector],
    );
    chunkId = chunk.rows[0].id;
  });

  afterEach(() => {
    fakeAnswer.mockReset();
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM documents WHERE id = $1', [expiredDocumentId]);
    await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
    await client.query('DELETE FROM normative_documents WHERE id = $1', [documentId]);
    await client.query('DELETE FROM official_sources WHERE id = $1', [sourceId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('bloqueia admin com 403 (admin não é usuário final do Assistente)', async () => {
    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ question: 'preciso usar capacete?' });
    expect(res.status).toBe(403);
  });

  it('responde com citação quando o Verificador confirma o chunk_id', async () => {
    fakeAnswer.mockResolvedValue([
      { claim: 'É obrigatório o uso de capacete.', chunk_ids: [chunkId], operational_ref_ids: [] },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'preciso usar capacete?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBe('É obrigatório o uso de capacete.');
    expect(res.body.citations).toEqual([
      { document_id: documentId, title: 'Norma teste assistente', official_url: 'https://exemplo.gov.br/assistente.html' },
    ]);
  });

  it('Verificador descarta claim com chunk_id fora do conjunto recuperado', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'Afirmação sem fonte válida.',
        chunk_ids: ['00000000-0000-0000-0000-000000000000'],
        operational_ref_ids: [],
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'pergunta qualquer' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.message).toBe('Não encontrei nada relevante pra essa pergunta.');
    expect(res.body.citations).toEqual([]);
  });

  it('claim com chunk_ids vazio é descartada', async () => {
    fakeAnswer.mockResolvedValue([
      { claim: 'Afirmação sem citação nenhuma.', chunk_ids: [], operational_ref_ids: [] },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'pergunta qualquer' });

    expect(res.body.answer).toBeNull();
  });

  it('não chama o provedor de resposta quando nenhum chunk atinge o limiar de similaridade', async () => {
    // Vetor ortogonal ao do chunk indexado ([1,0,0,...]) — similaridade
    // de cosseno 0, bem abaixo do limiar padrão (0.4, calibrado com dados
    // reais em 2026-08-31 — ver comentário em normative-assistant.service.ts),
    // então a busca retorna zero chunks relevantes.
    fakeEmbed.mockResolvedValueOnce(new Array(1536).fill(0).map((_, i) => (i === 1 ? 1 : 0)));

    // tokenTecnico (não tokenEmpresa) deliberadamente: o tenant de
    // tokenEmpresa agora tem um documento vencido de fixture (ver
    // expiredDocumentId), então operationalItems nunca fica vazio pra
    // esse tenant — o provedor SERIA chamado mesmo com relevant.length
    // === 0. Este teste prova especificamente o corte por limiar de
    // similaridade normativa, isolado da busca operacional — técnico
    // garante operationalItems === [] sempre (ver Fase 10).
    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenTecnico}`)
      .send({ question: 'pergunta sem nenhuma relação com a base indexada' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.message).toBe('Não encontrei nada relevante pra essa pergunta.');
    expect(res.body.citations).toEqual([]);
    expect(fakeAnswer).not.toHaveBeenCalled();
  });

  it('empresa sem nenhuma pendência operacional real cai no fallback (AND-gate) quando também não há chunk relevante — provedor não é chamado', async () => {
    // Tenant "limpo": criado só aqui, sem nenhum documento/EPI/plano de
    // ação — diferente do tenant de tokenEmpresa (que carrega o
    // documento vencido de expiredDocumentId pro resto da suíte). Prova
    // o AND-gate novo desta task (relevant.length === 0 &&
    // operationalItems.length === 0 -> fallback, sem chamar o provedor)
    // pro papel que ele de fato afeta — empresa com uma chamada REAL a
    // DashboardService.getSummary() devolvendo atencao: [], não técnico
    // (que nunca busca operacional) nem um DashboardService mockado.
    const cleanTenant = await db.createTenantWithUser('Empresa Sem Pendencias Teste');
    const loginClean = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: cleanTenant.email, password: cleanTenant.password });
    const tokenCleanEmpresa = loginClean.body.access_token;

    // Vetor ortogonal ao do chunk indexado ([1,0,0,...]) — mesma técnica
    // do teste do técnico acima: zero chunks normativos relevantes.
    fakeEmbed.mockResolvedValueOnce(new Array(1536).fill(0).map((_, i) => (i === 1 ? 1 : 0)));

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenCleanEmpresa}`)
      .send({ question: 'pergunta sem nenhuma relação com a base indexada' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.message).toBe('Não encontrei nada relevante pra essa pergunta.');
    expect(res.body.citations).toEqual([]);
    expect(fakeAnswer).not.toHaveBeenCalled();

    // Limpeza inline — db.cleanup() no afterAll também cobriria via
    // CASCADE de tenants (createTenantWithUser já registra o id em
    // db.tenantIds), mas apaga aqui pra não deixar esse tenant extra
    // pendurado pelo resto da suíte.
    await (db as any).client.query('DELETE FROM tenants WHERE id = $1', [cleanTenant.tenantId]);
  });

  it('empresa recebe itens operacionais reais e o provedor de resposta é chamado com eles', async () => {
    fakeAnswer.mockResolvedValue([]);

    await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'quais minhas pendências?' });

    expect(fakeAnswer).toHaveBeenCalled();
    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    const operationalItemsArg = lastCall[2];
    expect(operationalItemsArg).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ titulo: expect.stringContaining('Documento vencido teste operacional') }),
      ]),
    );
  });

  it('claim que cita só operational_ref_ids (sem chunk_ids) sobrevive ao Verificador', async () => {
    fakeAnswer.mockResolvedValue([
      { claim: 'Você tem um documento vencido.', chunk_ids: [], operational_ref_ids: ['op-0'] },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'quais minhas pendências?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBe('Você tem um documento vencido.');
    expect(res.body.citations).toEqual([]);
  });

  it('claim que cita as duas fontes juntas (chunk_ids e operational_ref_ids válidos) sobrevive ao Verificador', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'Você tem capacete obrigatório e um documento vencido pra regularizar.',
        chunk_ids: [chunkId],
        operational_ref_ids: ['op-0'],
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'preciso de capacete e quais minhas pendências?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBe('Você tem capacete obrigatório e um documento vencido pra regularizar.');
    expect(res.body.citations).toEqual([
      { document_id: documentId, title: 'Norma teste assistente', official_url: 'https://exemplo.gov.br/assistente.html' },
    ]);
  });

  it('claim com operational_ref_id inventado (fora do conjunto calculado) é descartada mesmo com chunk_id válido', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'Afirmação com referência operacional inventada.',
        chunk_ids: [chunkId],
        operational_ref_ids: ['op-999-nao-existe'],
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'preciso usar capacete e quais minhas pendências?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.message).toBe('Não encontrei nada relevante pra essa pergunta.');
  });

  it('técnico nunca recebe busca operacional — operationalItems sempre vazio', async () => {
    fakeAnswer.mockResolvedValue([{ claim: 'Resposta normativa.', chunk_ids: [chunkId], operational_ref_ids: [] }]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenTecnico}`)
      .send({ question: 'preciso usar capacete?' });

    expect(res.status).toBe(201);
    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    expect(lastCall[2]).toEqual([]);
  });

  it('isolamento entre tenants: empresa nunca recebe item operacional de outro tenant', async () => {
    const outroTenant = await db.createTenantWithUser('Empresa Assistente Teste — Outro Tenant');
    const outroDocumentId = await insertExpiredDocument(
      outroTenant.tenantId,
      outroTenant.userId,
      'Documento vencido do OUTRO tenant — nunca deve aparecer',
    );

    fakeAnswer.mockResolvedValue([]);

    await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'quais minhas pendências?' });

    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    const operationalItemsArg = lastCall[2];
    const titulos = operationalItemsArg.map((o: any) => o.titulo);

    expect(titulos.some((t: string) => t.includes('Documento vencido teste operacional'))).toBe(true);
    expect(titulos.some((t: string) => t.includes('OUTRO tenant'))).toBe(false);

    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [outroDocumentId]);
    await (db as any).client.query('DELETE FROM users WHERE tenant_id = $1', [outroTenant.tenantId]);
    await (db as any).client.query('DELETE FROM tenants WHERE id = $1', [outroTenant.tenantId]);
  });
});
