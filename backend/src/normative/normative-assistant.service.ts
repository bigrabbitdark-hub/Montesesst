import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from './embedding-provider.interface';
import { NORMATIVE_ANSWER_PROVIDER, NormativeAnswerProvider } from './normative-answer-provider.interface';
import { toVectorLiteral } from './vector.util';
import { envFloat } from '../common/env';

const FALLBACK_MESSAGE = 'Não encontrei uma norma vigente na base que trate disso.';

export interface NormativeQueryCitation {
  document_id: string;
  title: string;
  official_url: string;
}

export interface NormativeQueryResult {
  answer: string | null;
  message?: string;
  citations: NormativeQueryCitation[];
}

interface RetrievedChunk {
  chunk_id: string;
  content: string;
  document_id: string;
  source_title: string;
  official_url: string;
  similarity: number;
}

@Injectable()
export class NormativeAssistantService {
  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(NORMATIVE_ANSWER_PROVIDER) private readonly answerer: NormativeAnswerProvider,
  ) {}

  async query(client: PoolClient, question: string): Promise<NormativeQueryResult> {
    const questionEmbedding = await this.embeddings.embed(question);
    const threshold = envFloat('OPENROUTER_RAG_MIN_SIMILARITY', 0.75);

    const { rows } = await client.query<RetrievedChunk>(
      `SELECT c.id AS chunk_id, c.content, d.id AS document_id, s.title AS source_title, s.official_url,
              1 - (c.embedding <=> $1::vector) AS similarity
       FROM normative_document_chunks c
       JOIN normative_documents d ON d.id = c.document_id
       JOIN official_sources s ON s.id = d.source_id
       WHERE d.status = 'vigente' AND d.indexed_at IS NOT NULL
       ORDER BY c.embedding <=> $1::vector
       LIMIT 6`,
      [toVectorLiteral(questionEmbedding)],
    );

    const relevant = rows.filter((r) => r.similarity >= threshold);
    if (relevant.length === 0) {
      return { answer: null, message: FALLBACK_MESSAGE, citations: [] };
    }

    const claims = await this.answerer.answer(
      question,
      relevant.map((r) => ({ id: r.chunk_id, content: r.content })),
    );

    const validChunkIds = new Set(relevant.map((r) => r.chunk_id));
    const survivingClaims = claims.filter(
      (claim) => claim.chunk_ids.length > 0 && claim.chunk_ids.every((id) => validChunkIds.has(id)),
    );

    if (survivingClaims.length === 0) {
      return { answer: null, message: FALLBACK_MESSAGE, citations: [] };
    }

    const usedChunkIds = new Set(survivingClaims.flatMap((c) => c.chunk_ids));
    const citationsByDocument = new Map<string, NormativeQueryCitation>();
    for (const chunk of relevant) {
      if (usedChunkIds.has(chunk.chunk_id)) {
        citationsByDocument.set(chunk.document_id, {
          document_id: chunk.document_id,
          title: chunk.source_title,
          official_url: chunk.official_url,
        });
      }
    }

    return {
      answer: survivingClaims.map((c) => c.claim).join('\n\n'),
      citations: Array.from(citationsByDocument.values()),
    };
  }
}
