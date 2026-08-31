import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/normative/embedding-provider.interface';
import { NormativeDocumentsService } from '../src/normative/normative-documents.service';
import { TestDb } from './db-test-helper';

// A coluna normative_document_chunks.embedding é vector(1536) (migration
// 0021_normative_base.sql) — o Postgres rejeita qualquer array de
// dimensão diferente ("expected 1536 dimensions, not N"), então o fake
// do EMBEDDING_PROVIDER precisa devolver um vetor de 1536 posições,
// mesmo padrão já usado em normative-pgvector.e2e-spec.ts.
function fakeEmbeddingVector(): number[] {
  return new Array(1536).fill(0.001);
}

describe('Fluxo de aprovação/indexação de normative_documents (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let adminUserId: string;
  let sourceId: string;
  let fakeEmbed: jest.Mock;

  beforeAll(async () => {
    fakeEmbed = jest.fn().mockResolvedValue(fakeEmbeddingVector());
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Aprovacao Normativa Teste');
    adminUserId = admin.userId;
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const src = await (db as any).client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-APROVACAO', 'Norma teste aprovacao', 'https://exemplo.gov.br/aprovacao.html') RETURNING id`,
    );
    sourceId = src.rows[0].id;
  });

  afterEach(() => {
    fakeEmbed.mockClear();
    fakeEmbed.mockResolvedValue(fakeEmbeddingVector());
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM normative_document_chunks WHERE document_id IN (SELECT id FROM normative_documents WHERE source_id = $1)', [sourceId]);
    await client.query('DELETE FROM normative_documents WHERE source_id = $1', [sourceId]);
    await client.query('DELETE FROM official_sources WHERE id = $1', [sourceId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  async function insertPendingDocument(text: string) {
    const res = await (db as any).client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text)
       VALUES ($1, 'aguardando_validacao', $2, $3, $3, 'text/html', $4) RETURNING id`,
      [sourceId, `hash-${Date.now()}-${Math.random()}`, `normative/${sourceId}/teste.html`, text],
    );
    return res.rows[0].id;
  }

  it('aprova, indexa em chunks com embedding, e marca indexed_at', async () => {
    const documentId = await insertPendingDocument('Texto curto de norma para indexar.');

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('vigente');
    expect(res.body.indexed_at).not.toBeNull();

    const chunks = await (db as any).client.query(
      'SELECT chunk_index FROM normative_document_chunks WHERE document_id = $1 ORDER BY chunk_index',
      [documentId],
    );
    expect(chunks.rows).toHaveLength(1);
    expect(fakeEmbed).toHaveBeenCalledTimes(1);
  });

  it('segunda aprovação da mesma fonte substitui a vigente anterior', async () => {
    const documentId = await insertPendingDocument('Texto novo que substitui o anterior.');

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('vigente');
    expect(res.body.supersedes_document_id).not.toBeNull();

    const vigentes = await (db as any).client.query(
      `SELECT id FROM normative_documents WHERE source_id = $1 AND status = 'vigente'`,
      [sourceId],
    );
    expect(vigentes.rows).toHaveLength(1);
    expect(vigentes.rows[0].id).toBe(documentId);

    const anterior = await (db as any).client.query(
      `SELECT status FROM normative_documents WHERE id = $1`,
      [res.body.supersedes_document_id],
    );
    expect(anterior.rows[0].status).toBe('substituido');
  });

  it('falha JS pura no provedor de embedding aborta a aprovação inteira, sem mudar o status', async () => {
    // No design pós-C1b, computeEmbeddedChunks roda ANTES de qualquer
    // withTenantContext de escrita (prepareApproval só lê/valida) — uma
    // rejeição de Promise aqui nunca chega perto de mudar o status pra
    // vigente, então a resposta é um erro e o documento continua
    // exatamente como estava (aguardando_validacao, indexed_at nulo).
    // Isso é diferente da falha de SQL real testada abaixo, que só
    // acontece DEPOIS que o status já mudou dentro da mesma transação de
    // finalizeApproval — daí o SAVEPOINT.
    const documentId = await insertPendingDocument('Texto que vai falhar ao computar embeddings.');
    fakeEmbed.mockRejectedValueOnce(new Error('falha simulada no provedor de embedding'));

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBeGreaterThanOrEqual(500);

    const doc = await (db as any).client.query(
      'SELECT status, indexed_at FROM normative_documents WHERE id = $1',
      [documentId],
    );
    expect(doc.rows[0].status).toBe('aguardando_validacao');
    expect(doc.rows[0].indexed_at).toBeNull();
  });

  it('falha SQL real (dimensão de vetor errada) dentro de replaceChunks também não desfaz a aprovação', async () => {
    const documentId = await insertPendingDocument('Texto que vai falhar com erro real de SQL ao indexar.');
    // Diferente do teste acima (rejeição JS da Promise do provider, que
    // agora acontece em computeEmbeddedChunks ANTES de qualquer escrita),
    // aqui o provider RESOLVE normalmente, mas com um vetor de dimensão
    // errada (3, não 1536) — passa por computeEmbeddedChunks sem erro, e
    // o erro só acontece dentro do client.query do INSERT em
    // replaceChunks, já dentro de finalizeApproval (depois que o status
    // já virou vigente na mesma transação). É um erro de Postgres
    // (25P02) que aborta a transação inteira até um ROLLBACK/ROLLBACK TO
    // SAVEPOINT explícito. Sem o SAVEPOINT em replaceChunks, o findOne
    // subsequente dentro de finalizeApproval falharia com "current
    // transaction is aborted", propagando pro withTenantContext e
    // desfazendo a troca de status pra vigente.
    fakeEmbed.mockResolvedValueOnce([0.1, 0.2, 0.3]);

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('vigente');
    expect(res.body.indexed_at).toBeNull();

    const chunks = await (db as any).client.query(
      'SELECT chunk_index FROM normative_document_chunks WHERE document_id = $1',
      [documentId],
    );
    expect(chunks.rows).toHaveLength(0);
  });

  it('reindex reprocessa um documento vigente com indexação pendente', async () => {
    const documentId = await insertPendingDocument('Texto pra reindexar depois.');
    // Deixa o documento vigente com indexed_at nulo via uma falha real de
    // SQL (vetor de dimensão errada) — não mais via rejeição JS pura do
    // provider, que sob o novo design de fases aborta a aprovação inteira
    // antes de qualquer mudança de status (ver primeiro teste do arquivo).
    fakeEmbed.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    const approveRes = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(approveRes.body.status).toBe('vigente');
    expect(approveRes.body.indexed_at).toBeNull();

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/reindex`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.indexed_at).not.toBeNull();
  });

  it('reindex com falha SQL real não apaga os chunks antigos (corrige I3)', async () => {
    const documentId = await insertPendingDocument('Texto vigente com chunk bom antes do reindex quebrado.');
    const approveRes = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(approveRes.body.status).toBe('vigente');
    expect(approveRes.body.indexed_at).not.toBeNull();

    const chunksBefore = await (db as any).client.query(
      'SELECT id, chunk_index FROM normative_document_chunks WHERE document_id = $1',
      [documentId],
    );
    expect(chunksBefore.rows).toHaveLength(1);
    const originalChunkId = chunksBefore.rows[0].id;
    const originalIndexedAt = approveRes.body.indexed_at;

    // Reindexação com vetor de dimensão errada — falha real de SQL dentro
    // do savepoint que agora TAMBÉM guarda o DELETE (é isso que corrige
    // I3): antes desta correção, reindex() apagava os chunks antigos
    // ANTES de abrir o savepoint, então um reindex que falhasse destruía
    // um índice saudável sem colocar nada no lugar. Com o DELETE dentro
    // do mesmo savepoint que o INSERT que falha, o ROLLBACK TO SAVEPOINT
    // desfaz os dois juntos — os chunks antigos sobrevivem intactos.
    fakeEmbed.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    const reindexRes = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/reindex`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(reindexRes.status).toBe(201);
    // indexed_at não é tocado pelo ROLLBACK TO SAVEPOINT — continua com o
    // valor da aprovação original, não nulo e não atualizado.
    expect(reindexRes.body.indexed_at).toBe(originalIndexedAt);

    const chunksAfter = await (db as any).client.query(
      'SELECT id, chunk_index FROM normative_document_chunks WHERE document_id = $1',
      [documentId],
    );
    expect(chunksAfter.rows).toHaveLength(1);
    expect(chunksAfter.rows[0].id).toBe(originalChunkId);
  });

  it('aprovação com raw_text vazio marca vigente mas deixa indexed_at nulo, sem lançar (corrige I4)', async () => {
    // Simula uma extração de texto que falhou upstream no monitor (ver
    // NormativeMonitorService) e salvou raw_text vazio/só espaços — o DTO
    // de criação normal nunca permitiria isso, então insere direto via
    // SQL, contornando a validação de entrada, só pra simular o estado.
    // splitIntoChunks('') devolve [] (chunking.util.ts), então
    // computeEmbeddedChunks nunca chama o provider de embedding.
    const documentId = await insertPendingDocument('   ');

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('vigente');
    expect(res.body.indexed_at).toBeNull();
    expect(fakeEmbed).not.toHaveBeenCalled();

    const chunks = await (db as any).client.query(
      'SELECT id FROM normative_document_chunks WHERE document_id = $1',
      [documentId],
    );
    expect(chunks.rows).toHaveLength(0);
  });

  it('rejeição concorrente durante a espera do embedding impede a ressurreição do documento', async () => {
    // Simula a condição de corrida achada na revisão final: entre
    // prepareApproval (lê/valida) e finalizeApproval (escreve), o
    // controller roda computeEmbeddedChunks — uma espera de segundos a
    // minutos, sem nenhum lock no banco. Se outro admin (ou o mesmo, em
    // outra aba) rejeitar o mesmo documento nessa janela, a aprovação em
    // andamento não pode reverter a rejeição.
    const documentId = await insertPendingDocument(
      'Texto que será rejeitado enquanto uma aprovação concorrente está em andamento.',
    );
    const documents = app.get(NormativeDocumentsService);
    const client = (db as any).client;

    const doc = await documents.prepareApproval(client, documentId);
    expect(doc.status).toBe('aguardando_validacao');

    // A "outra aba" rejeita o documento enquanto a primeira aprovação
    // ainda estaria esperando a IA gerar os embeddings.
    await documents.reject(client, documentId, adminUserId, 'Rejeitado por outro admin durante aprovação concorrente.');

    const embeddedChunks = await documents.computeEmbeddedChunks(doc.raw_text);

    await expect(documents.finalizeApproval(client, documentId, adminUserId, embeddedChunks)).rejects.toThrow(
      ConflictException,
    );

    const final = await client.query('SELECT status FROM normative_documents WHERE id = $1', [documentId]);
    expect(final.rows[0].status).toBe('rejeitado');

    const chunks = await client.query('SELECT id FROM normative_document_chunks WHERE document_id = $1', [
      documentId,
    ]);
    expect(chunks.rows).toHaveLength(0);
  });

  it('rejeita com motivo', async () => {
    const documentId = await insertPendingDocument('Texto que vai ser rejeitado.');

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/reject`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ reason: 'Fonte extraiu texto corrompido, revisar manualmente.' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('rejeitado');
    expect(res.body.rejection_reason).toBe('Fonte extraiu texto corrompido, revisar manualmente.');
  });

  it('download só funciona pra documento vigente', async () => {
    const pendingId = await insertPendingDocument('Ainda não aprovado.');
    const pendingRes = await request(app.getHttpServer())
      .get(`/normative-documents/${pendingId}/download`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(pendingRes.status).toBe(404);
  });
});
