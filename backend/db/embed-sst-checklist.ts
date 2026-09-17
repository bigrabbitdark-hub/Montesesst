import { Client } from 'pg';
import { OpenRouterEmbeddingService } from '../src/common/embedding/openrouter-embedding.service';
import { toVectorLiteral } from '../src/common/vector/vector.util';

// Script standalone, rodado manualmente UMA VEZ após a migration
// 0049_sst_checklist_catalog.sql — não faz parte do boot da aplicação.
// Mesmo padrão de db/seed.ts/db/caepi-sync.ts: instancia o serviço
// diretamente (sem passar pelo container de DI do Nest), já que
// OpenRouterEmbeddingService não tem dependências de construtor.
//
// A fórmula de texto embedado abaixo (nr_code — document_name:
// description — legal_requirement) precisa ficar IDÊNTICA à usada em
// SstChecklistService (backend/src/sst-checklist/sst-checklist.service.ts)
// ao recalcular embedding na edição de um item — senão a mesma linha
// teria embeddings diferentes dependendo de quem/quando calculou.
function buildEmbeddingText(row: {
  nr_code: string;
  document_name: string;
  description: string;
  legal_requirement: string;
}): string {
  return `${row.nr_code} — ${row.document_name}: ${row.description} — ${row.legal_requirement}`;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const embeddings = new OpenRouterEmbeddingService();

  const { rows } = await client.query<{
    id: string;
    nr_code: string;
    document_name: string;
    description: string;
    legal_requirement: string;
  }>(
    `SELECT id, nr_code, document_name, description, legal_requirement
     FROM sst_checklist_items WHERE embedding IS NULL`,
  );

  console.log(`[embed-sst-checklist] ${rows.length} itens sem embedding — gerando um por um...`);

  let done = 0;
  for (const row of rows) {
    const vector = await embeddings.embed(buildEmbeddingText(row));
    await client.query('UPDATE sst_checklist_items SET embedding = $2::vector WHERE id = $1', [
      row.id,
      toVectorLiteral(vector),
    ]);
    done++;
    if (done % 25 === 0) console.log(`[embed-sst-checklist] ${done}/${rows.length}`);
  }

  console.log(`[embed-sst-checklist] concluído — ${done} itens embedados.`);
  await client.end();
}

main().catch((err) => {
  console.error('[embed-sst-checklist] falhou:', err);
  process.exit(1);
});
