import { Client } from 'pg';

// ITEM 010 da auditoria do Assistente (2026-09-28): o embedding dos itens
// do checklist interno (`sst_checklist_items`) só é calculado pelo script
// manual `db:embed-sst-checklist`, rodado uma vez após a migration 0049 —
// não faz parte do boot da aplicação. Se esquecido (ou se um item novo for
// cadastrado sem passar por `SstChecklistService`), o item fica com
// `embedding IS NULL` e desaparece em silêncio da busca do Assistente
// (`WHERE embedding IS NOT NULL` em normative-assistant.service.ts) — sem
// erro, sem log, sem aviso. Este script existe só pra tornar esse silêncio
// visível: rode manualmente após deploy/migration, ou num cron/CI.
//
// Lógica pura (sem banco) separada em describeChecklistEmbeddingHealth pra
// poder ser testada em segundos, sem depender de Postgres — mesmo padrão
// de backend/eval/metrics.ts.
export function describeChecklistEmbeddingHealth(
  total: number,
  missing: number,
): { ok: boolean; message: string } {
  if (total === 0) {
    return {
      ok: false,
      message: '[check-checklist-embeddings] FALHA: sst_checklist_items tem 0 itens — a migration 0049 (seed) não rodou ou a tabela está vazia.',
    };
  }
  if (missing > 0) {
    return {
      ok: false,
      message: `[check-checklist-embeddings] FALHA: ${missing} de ${total} itens do checklist interno estão sem embedding — invisíveis pra busca do Assistente. Rode "npm run db:embed-sst-checklist".`,
    };
  }
  return {
    ok: true,
    message: `[check-checklist-embeddings] OK: ${total} itens, todos com embedding.`,
  };
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ total: string; missing: string }>(
      `SELECT COUNT(*)::text AS total, COUNT(*) FILTER (WHERE embedding IS NULL)::text AS missing
       FROM sst_checklist_items`,
    );
    const total = Number(rows[0].total);
    const missing = Number(rows[0].missing);
    const result = describeChecklistEmbeddingHealth(total, missing);
    console.log(result.message);
    if (!result.ok) process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[check-checklist-embeddings] erro ao consultar o banco:', err);
    process.exit(1);
  });
}
