import { TestDb } from './db-test-helper';

// Prova que a extensão vector + as 3 tabelas + o índice HNSW funcionam de
// ponta a ponta neste Postgres real — antes de qualquer código de
// aplicação existir em cima delas. Vetor local (não usa nenhum util de
// src/ ainda, propositalmente: esta é a Task 1, os utils só existem a
// partir da Task 2).
function vectorLiteral(nonZeroIndices: number[]): string {
  const vec = new Array(1536).fill(0);
  for (const i of nonZeroIndices) vec[i] = 1;
  return `[${vec.join(',')}]`;
}

describe('pgvector: extensão e tabelas normativas (e2e)', () => {
  let db: TestDb;
  let sourceId: string;
  let documentId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    const client = (db as any).client;

    const sourceRes = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-06', 'NR-06 - EPI', 'https://exemplo.gov.br/nr-06.pdf')
       RETURNING id`,
    );
    sourceId = sourceRes.rows[0].id;

    const docRes = await client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text, indexed_at)
       VALUES ($1, 'vigente', 'hash-teste-pgvector', 'normative/teste.pdf', 'teste.pdf', 'application/pdf', 'texto de teste', now())
       RETURNING id`,
      [sourceId],
    );
    documentId = docRes.rows[0].id;
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM normative_documents WHERE id = $1', [documentId]);
    await client.query('DELETE FROM official_sources WHERE id = $1', [sourceId]);
    await db.disconnect();
  });

  it('só permite uma versão vigente por fonte (índice único parcial)', async () => {
    const client = (db as any).client;
    await expect(
      client.query(
        `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text)
         VALUES ($1, 'vigente', 'outro-hash', 'normative/outro.pdf', 'outro.pdf', 'application/pdf', 'outro texto')`,
        [sourceId],
      ),
    ).rejects.toThrow();
  });

  it('aceita inserir embeddings e ordena por proximidade real via pgvector', async () => {
    const client = (db as any).client;
    const exact = vectorLiteral([0]);
    const shared = vectorLiteral([0, 1]);
    const orthogonal = vectorLiteral([1]);

    const insertChunk = async (index: number, embedding: string) => {
      const res = await client.query(
        `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4::vector) RETURNING id`,
        [documentId, index, `trecho ${index}`, embedding],
      );
      return res.rows[0].id;
    };

    const orthogonalId = await insertChunk(0, orthogonal);
    const sharedId = await insertChunk(1, shared);
    const exactId = await insertChunk(2, exact);

    const result = await client.query(
      `SELECT id FROM normative_document_chunks WHERE document_id = $1 ORDER BY embedding <=> $2::vector`,
      [documentId, exact],
    );

    expect(result.rows.map((r: any) => r.id)).toEqual([exactId, sharedId, orthogonalId]);

    await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
  });
});
