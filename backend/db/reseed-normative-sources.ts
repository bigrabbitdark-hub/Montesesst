import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { splitIntoChunks } from '../src/common/chunking/chunking.util';
import { toVectorLiteral } from '../src/common/vector/vector.util';
import { OpenRouterEmbeddingService } from '../src/common/embedding/openrouter-embedding.service';

// Achado da auditoria do Assistente (2026-09-28, C-2): as ~36 NRs reais que
// sustentam o RAG normativo foram cadastradas manualmente em produção em
// 2026-08-31 — `db/seed.ts` só recria 7 fontes-placeholder (landing pages,
// não o texto da norma). Se o ambiente de produção fosse perdido, não
// havia como recriar o conhecimento normativo do Assistente a partir do
// repositório. Este script fecha essa lacuna.
//
// `db/seed-data/normative-sources/manifest.json` + um `.txt` por NR (36
// arquivos, ~3MB no total) são uma cópia EXPORTADA do texto real — cada
// arquivo foi conferido byte a byte contra o `content_hash` (SHA-256) que
// já existia em produção antes de entrar no repositório (nenhum texto foi
// digitado ou gerado por IA). É texto de norma federal pública (MTE/
// Fundacentro/TST) — não é dado de cliente, não tem PII, não tem segredo.
//
// Mesmo padrão de script standalone de db/seed.ts e db/embed-sst-checklist.ts:
// instancia os serviços direto (sem Nest DI), roda uma vez manualmente.
//
// NÃO destrutivo por desenho: se já existe uma normative_documents
// 'vigente' para a fonte (qualquer hash), o script PULA essa fonte e
// avisa — nunca sobrescreve nem cria um 2º 'vigente' (a migration 0021 já
// impede isso via índice único, mas o script confere antes de tentar,
// pra logar um aviso claro em vez de deixar a constraint estourar).
// Seguro de rodar contra um banco que já tem as NRs reais (produção) —
// vira um no-op de leitura, não um re-embedding caro por engano.
//
// NÃO TESTADO ponta-a-ponta contra um banco vazio real (exigiria subir um
// Postgres descartável só pra isso) — revisado e com typecheck limpo, mas
// a garantia "recria o Assistente do zero" descrita no comentário acima é
// até aqui uma inferência de código, não uma execução verificada. Rodar
// esse teste é o primeiro item de verificação antes de confiar nisso como
// plano de disaster recovery de verdade.

// Parametrizável só pra teste (ver Verificação no plano de correção) — sem
// a variável, sempre aponta pro manifesto real de 36 fontes.
const SEED_DATA_DIR = process.env.RESEED_DATA_DIR || join(__dirname, 'seed-data', 'normative-sources');

interface ManifestEntry {
  entity: string;
  code: string;
  title: string;
  official_url: string;
  mime_type: string;
  file_name: string;
  content_hash: string;
  text_file: string;
}

async function main() {
  const manifest: ManifestEntry[] = JSON.parse(readFileSync(join(SEED_DATA_DIR, 'manifest.json'), 'utf8'));
  console.log(`[reseed-normative-sources] ${manifest.length} fontes no manifesto`);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const embeddings = new OpenRouterEmbeddingService();

  let created = 0;
  let skipped = 0;

  try {
    for (const entry of manifest) {
      const rawText = readFileSync(join(SEED_DATA_DIR, entry.text_file), 'utf8');
      const actualHash = createHash('sha256').update(rawText).digest('hex');
      if (actualHash !== entry.content_hash) {
        // Nunca deveria acontecer (os arquivos foram conferidos na
        // exportação) — mas se o .txt for editado à mão depois, é melhor
        // parar do que indexar um texto que não bate com o hash declarado.
        throw new Error(
          `[reseed-normative-sources] ${entry.code}: hash do arquivo (${actualHash}) não bate com o manifesto (${entry.content_hash}) — arquivo foi editado?`,
        );
      }

      await client.query('BEGIN');
      try {
        const source = await client.query<{ id: string }>(
          `INSERT INTO official_sources (entity, code, title, official_url, active)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, official_url = EXCLUDED.official_url
           RETURNING id`,
          [entry.entity, entry.code, entry.title, entry.official_url],
        );
        const sourceId = source.rows[0].id;

        const existing = await client.query(
          `SELECT id FROM normative_documents WHERE source_id = $1 AND status = 'vigente'`,
          [sourceId],
        );
        if (existing.rows.length > 0) {
          console.log(`[reseed-normative-sources] ${entry.code}: já existe documento vigente — pulado (não sobrescrito)`);
          skipped++;
          await client.query('ROLLBACK');
          continue;
        }

        const documentId = randomUUID();
        await client.query(
          `INSERT INTO normative_documents
             (id, source_id, status, content_hash, file_key, file_name, mime_type, raw_text, reviewed_at)
           VALUES ($1, $2, 'vigente', $3, $4, $5, $6, $7, now())`,
          [
            documentId,
            sourceId,
            entry.content_hash,
            // Não é um objeto real no R2 — este reseed reconstrói o
            // CONHECIMENTO (raw_text → chunks → embeddings), não o
            // arquivo binário original. O botão de download deste
            // documento no admin não funcionaria até alguém re-upload
            // o PDF de origem; isso é uma limitação aceita, documentada
            // aqui, não um bug silencioso.
            `seed-data/normative-sources/${entry.text_file}`,
            entry.file_name,
            entry.mime_type,
            rawText,
          ],
        );

        const chunks = splitIntoChunks(rawText);
        for (let i = 0; i < chunks.length; i++) {
          const embedding = await embeddings.embed(chunks[i]);
          await client.query(
            `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
             VALUES ($1, $2, $3, $4::vector)`,
            [documentId, i, chunks[i], toVectorLiteral(embedding)],
          );
        }
        await client.query(`UPDATE normative_documents SET indexed_at = now() WHERE id = $1`, [documentId]);

        await client.query('COMMIT');
        created++;
        console.log(`[reseed-normative-sources] ${entry.code}: criado e indexado (${chunks.length} chunks)`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }

  console.log(`[reseed-normative-sources] concluído — ${created} criadas, ${skipped} já existiam (puladas)`);
}

main().catch((err) => {
  console.error('[reseed-normative-sources] falhou:', err);
  process.exit(1);
});
