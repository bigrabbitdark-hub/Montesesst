import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID, createHash } from 'crypto';
import { R2Service } from '../common/r2/r2.service';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../common/embedding/embedding-provider.interface';
import { splitIntoChunks } from '../common/chunking/chunking.util';
import { toVectorLiteral } from '../common/vector/vector.util';

export type NormativeDocumentStatus = 'aguardando_validacao' | 'vigente' | 'rejeitado' | 'substituido';

interface EmbeddedChunk {
  index: number;
  content: string;
  embedding: number[];
}

export interface NormativeDocument {
  id: string;
  source_id: string;
  status: NormativeDocumentStatus;
  content_hash: string;
  file_key: string;
  file_name: string;
  mime_type: string;
  raw_text: string;
  detected_at: string;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  supersedes_document_id: string | null;
  indexed_at: string | null;
  created_at: string;
}

@Injectable()
export class NormativeDocumentsService {
  private readonly logger = new Logger(NormativeDocumentsService.name);

  constructor(
    private readonly r2: R2Service,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
  ) {}

  // Compara com a linha MAIS RECENTE da fonte, qualquer status — não só
  // `vigente` (correção sobre a spec seção 4.2, ver Global Constraints
  // do plano). Comparar só com `vigente` recriaria uma linha
  // `aguardando_validacao` duplicada a cada execução do monitor enquanto
  // a mesma versão ficasse pendente de revisão ou já rejeitada.
  async recordDetectedVersion(
    client: PoolClient,
    sourceId: string,
    text: string,
    fileBuffer: Buffer,
    mimeType: string,
    sourceUrl: string,
  ): Promise<NormativeDocument | null> {
    const hash = createHash('sha256').update(text).digest('hex');

    const mostRecent = await client.query<{ content_hash: string }>(
      `SELECT content_hash FROM normative_documents WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [sourceId],
    );
    if (mostRecent.rows[0]?.content_hash === hash) {
      return null;
    }

    const id = randomUUID();
    const fileName = sourceUrl.split('/').pop() || 'documento';
    const fileKey = `normative/${sourceId}/${id}/${fileName}`;
    await this.r2.putObject(fileKey, fileBuffer, mimeType);

    const result = await client.query<NormativeDocument>(
      `INSERT INTO normative_documents (id, source_id, status, content_hash, file_key, file_name, mime_type, raw_text)
       VALUES ($1, $2, 'aguardando_validacao', $3, $4, $5, $6, $7) RETURNING *`,
      [id, sourceId, hash, fileKey, fileName, mimeType, text],
    );
    return result.rows[0];
  }

  async findOne(client: PoolClient, id: string): Promise<NormativeDocument> {
    const result = await client.query<NormativeDocument>(
      'SELECT * FROM normative_documents WHERE id = $1',
      [id],
    );
    const document = result.rows[0];
    if (!document) throw new NotFoundException('Documento normativo não encontrado');
    return document;
  }

  async findByStatus(client: PoolClient, status?: string): Promise<NormativeDocument[]> {
    if (status) {
      const result = await client.query<NormativeDocument>(
        'SELECT * FROM normative_documents WHERE status = $1 ORDER BY detected_at DESC',
        [status],
      );
      return result.rows;
    }
    const result = await client.query<NormativeDocument>(
      'SELECT * FROM normative_documents ORDER BY detected_at DESC',
    );
    return result.rows;
  }

  async findOneWithPrevious(
    client: PoolClient,
    id: string,
  ): Promise<{ document: NormativeDocument; previous_text: string | null }> {
    const document = await this.findOne(client, id);
    const previous = await client.query<{ raw_text: string }>(
      `SELECT raw_text FROM normative_documents WHERE source_id = $1 AND status = 'vigente' AND id != $2`,
      [document.source_id, id],
    );
    return { document, previous_text: previous.rows[0]?.raw_text ?? null };
  }

  // approve()/reindex() foram divididos em fases (prepare/compute/finalize)
  // pra que a chamada lenta ao provedor de embedding (this.embeddings.embed,
  // uma por chunk, ~segundos cada) nunca aconteça com uma conexão do pool
  // do Postgres presa "idle in transaction" — ver Finding C1b da revisão
  // final da Fase 9. O controller chama prepareApproval (transação curta
  // de leitura/validação), depois computeEmbeddedChunks (zero conexão de
  // banco aberta) e só então finalizeApproval (transação curta, só SQL).
  async prepareApproval(client: PoolClient, documentId: string): Promise<NormativeDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'aguardando_validacao') {
      throw new BadRequestException('Só documentos aguardando validação podem ser aprovados');
    }
    return doc;
  }

  async finalizeApproval(
    client: PoolClient,
    documentId: string,
    reviewerUserId: string,
    embeddedChunks: EmbeddedChunk[],
  ): Promise<NormativeDocument> {
    const doc = await this.findOne(client, documentId);
    // Reconfere o status aqui — não só em prepareApproval — porque
    // computeEmbeddedChunks roda entre as duas transações sem nenhum lock,
    // e pode levar de segundos a minutos (uma chamada de embedding por
    // chunk). Nessa janela outro admin (ou o mesmo, em outra aba) pode
    // rejeitar este mesmo documento; sem essa reconferência, a aprovação
    // em andamento reverteria a rejeição e publicaria conteúdo já
    // explicitamente rejeitado. Achado da revisão final da Fase 9 (fix
    // wave), corrigido como ajuste separado após aprovação do fundador.
    if (doc.status !== 'aguardando_validacao') {
      throw new ConflictException(
        'O status deste documento mudou enquanto a indexação estava em andamento — aprovação cancelada',
      );
    }
    // AND id <> $2: proteção redundante contra o documento se tornar "a
    // vigente anterior" de si mesmo (ex.: clique duplo no botão Aprovar).
    // Na prática, a reconferência de status acima já torna isso
    // inalcançável — um documento não pode estar simultaneamente
    // aguardando_validacao (checado acima) e vigente (o que essa query
    // busca) — mas custa nada manter a exclusão explícita aqui também.
    const previous = await client.query<{ id: string }>(
      `SELECT id FROM normative_documents WHERE source_id = $1 AND status = 'vigente' AND id <> $2`,
      [doc.source_id, documentId],
    );
    const previousId = previous.rows[0]?.id ?? null;

    if (previousId) {
      await client.query(`UPDATE normative_documents SET status = 'substituido' WHERE id = $1`, [previousId]);
    }
    // WHERE ... AND status = 'aguardando_validacao' (não só WHERE id = $1)
    // fecha a lacuna que sobrava mesmo com a checagem acima: duas chamadas
    // concorrentes (ex.: clique duplo) podiam passar as duas pelo `if`
    // acima antes de qualquer uma escrever. O UPDATE com status na
    // cláusula WHERE é atômico — o Postgres trava a linha na primeira
    // chamada que chegar; a segunda, ao reavaliar o WHERE depois que a
    // trava libera, já vê status = 'vigente' e não casa nenhuma linha
    // (rowCount 0), então lança em vez de reaplicar dados possivelmente
    // obsoletos por cima. Achado da revisão de código deste próprio ajuste.
    const updated = await client.query(
      `UPDATE normative_documents
       SET status = 'vigente', reviewed_by_user_id = $2, reviewed_at = now(), supersedes_document_id = $3
       WHERE id = $1 AND status = 'aguardando_validacao'`,
      [documentId, reviewerUserId, previousId],
    );
    if (updated.rowCount === 0) {
      throw new ConflictException(
        'O status deste documento mudou enquanto a indexação estava em andamento — aprovação cancelada',
      );
    }

    await this.replaceChunks(client, documentId, embeddedChunks);

    return this.findOne(client, documentId);
  }

  async reject(client: PoolClient, documentId: string, reviewerUserId: string, reason: string): Promise<NormativeDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'aguardando_validacao') {
      throw new BadRequestException('Só documentos aguardando validação podem ser rejeitados');
    }
    await client.query(
      `UPDATE normative_documents
       SET status = 'rejeitado', reviewed_by_user_id = $2, reviewed_at = now(), rejection_reason = $3
       WHERE id = $1`,
      [documentId, reviewerUserId, reason],
    );
    return this.findOne(client, documentId);
  }

  async prepareReindex(client: PoolClient, documentId: string): Promise<NormativeDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'vigente') {
      throw new BadRequestException('Só documentos vigentes podem ser reindexados');
    }
    return doc;
  }

  async finalizeReindex(
    client: PoolClient,
    documentId: string,
    embeddedChunks: EmbeddedChunk[],
  ): Promise<NormativeDocument> {
    // Mesma reconferência de finalizeApproval, mesmo motivo: o documento
    // pode ter deixado de ser 'vigente' (ex.: substituído por uma
    // aprovação concorrente da mesma fonte) durante a janela de
    // computeEmbeddedChunks.
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'vigente') {
      throw new ConflictException(
        'O status deste documento mudou enquanto a indexação estava em andamento — reindexação cancelada',
      );
    }
    await this.replaceChunks(client, documentId, embeddedChunks);
    return this.findOne(client, documentId);
  }

  // Computa os embeddings de todos os chunks do texto SEM nenhuma conexão
  // de banco aberta — cada this.embeddings.embed() é uma chamada HTTP
  // externa (~segundos, sequencial por chunk); rodar isso fora de
  // qualquer client do pool é o ponto central do Finding C1b.
  async computeEmbeddedChunks(rawText: string): Promise<EmbeddedChunk[]> {
    const chunks = splitIntoChunks(rawText);
    const embedded: EmbeddedChunk[] = [];
    for (let i = 0; i < chunks.length; i++) {
      embedded.push({ index: i, content: chunks[i], embedding: await this.embeddings.embed(chunks[i]) });
    }
    return embedded;
  }

  async getDownloadUrl(client: PoolClient, id: string): Promise<{ url: string; file_name: string }> {
    const document = await this.findOne(client, id);
    if (document.status !== 'vigente') {
      throw new NotFoundException('Documento normativo não encontrado');
    }
    const url = await this.r2.getPresignedDownloadUrl(document.file_key);
    return { url, file_name: document.file_name };
  }

  // Nunca deixa uma falha de indexação desfazer a aprovação/reindexação — o
  // try/catch fica dentro deste método (não propaga), senão o
  // withTenantContext do controller reverteria a transação inteira,
  // inclusive a troca de status já aplicada em finalizeApproval.
  // `indexed_at` simplesmente continua NULL/inalterado (ver Global
  // Constraints do plano).
  //
  // Isso sozinho NÃO basta pra falhas de SQL (ex.: embedding com
  // dimensão errada pro `vector(1536)`, violação de constraint): o
  // Postgres aborta a transação inteira no erro (25P02), e qualquer
  // comando seguinte no mesmo client — inclusive o `findOne` que
  // finalizeApproval/finalizeReindex chamam depois — falha com "current
  // transaction is aborted", propagando pra fora e derrubando o
  // withTenantContext (rollback da transação inteira, desfazendo a troca
  // de status já aplicada). Por isso o SAVEPOINT: ROLLBACK TO SAVEPOINT
  // desfaz só o trabalho de indexação parcial e limpa o estado abortado,
  // deixando a transação externa livre pra prosseguir e commitar
  // normalmente.
  //
  // O DELETE dos chunks antigos agora mora DENTRO deste mesmo savepoint
  // (corrige I3): antes, reindex() apagava os chunks antigos ANTES de
  // abrir o savepoint, então uma falha de indexação destruía um índice
  // saudável sem colocar nada no lugar. Na aprovação inicial não existem
  // chunks antigos pra esse documento, então o DELETE ali é um no-op
  // inofensivo — por isso o mesmo helper serve os dois fluxos.
  private async replaceChunks(
    client: PoolClient,
    documentId: string,
    embeddedChunks: EmbeddedChunk[],
  ): Promise<void> {
    if (embeddedChunks.length === 0) {
      // Corrige I4: zero chunks (extração de texto vazia/só espaços)
      // não é mais marcado como indexado silenciosamente — fica
      // registrado no log e `indexed_at` continua NULL, igual a
      // qualquer outra falha de indexação.
      this.logger.error(
        `Documento ${documentId} não gerou nenhum pedaço pra indexar — extração de texto provavelmente falhou`,
      );
      return;
    }

    await client.query('SAVEPOINT indexing');
    try {
      await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
      for (const chunk of embeddedChunks) {
        await client.query(
          `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4::vector)`,
          [documentId, chunk.index, chunk.content, toVectorLiteral(chunk.embedding)],
        );
      }
      await client.query(`UPDATE normative_documents SET indexed_at = now() WHERE id = $1`, [documentId]);
      await client.query('RELEASE SAVEPOINT indexing');
    } catch (err) {
      this.logger.error(`Falha ao indexar documento ${documentId}`, (err as Error).stack);
      await client.query('ROLLBACK TO SAVEPOINT indexing');
    }
  }
}
