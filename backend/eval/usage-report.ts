import { Client } from 'pg';
import { parseEvalArgs } from './args';
import { summarizeUsage, UsageRow } from './usage-summary';

// Linha como vem do banco: `retrieved` é o jsonb inteiro do trace.
interface LogRow extends Omit<UsageRow, 'retrieved'> {
  retrieved: { normative?: UsageRow['retrieved'] } | null;
}

// eval:usage — resume o log de uso real do Assistente (assistant_query_log) dos
// últimos N dias: fallback, similaridade do melhor trecho, números sinalizados
// pelo verificador, papel, latência. É o insumo para o fundador decidir se
// números com unidade já podem virar bloqueio. Só LÊ o banco.
//
// A tabela tem RLS (leitura só do admin): a transação injeta app.role = 'admin'
// da mesma forma que DatabaseService.withTenantContext.
//
// Uso: ./run-backend-tests.sh eval:usage [-- --days 30]
async function main() {
  const { days } = parseEvalArgs(process.argv.slice(2));

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SELECT set_config('app.role', 'admin', true)");
    const { rows } = await client.query<LogRow>(
      `SELECT role, outcome, notices, retrieved, claims_total, claims_dropped_ids,
              claims_dropped_support, blocking_tokens, flagged_numbers, latency_ms
       FROM assistant_query_log
       WHERE created_at >= now() - make_interval(days => $1)`,
      [days],
    );
    await client.query('COMMIT');

    const usageRows: UsageRow[] = rows.map((row) => ({
      ...row,
      // O jsonb guarda { normative, checklist, company, ... }; o resumo usa a
      // similaridade dos trechos normativos candidatos.
      retrieved: row.retrieved?.normative ?? [],
    }));
    console.log(`Log de uso do Assistente — últimos ${days} dia(s)\n`);
    console.log(JSON.stringify(summarizeUsage(usageRows), null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[eval:usage] falhou:', err);
  process.exit(1);
});
