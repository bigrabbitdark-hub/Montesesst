import { Client } from 'pg';
import { parseEvalArgs } from './args';
import { blocksContaining, blocksWithPrefix, splitIntoItemBlocks } from './golden/nr-blocks';

// eval:nr — ajuda de autoria do dataset golden: imprime, já normalizados na
// MESMA forma que o eval:lint confere, os itens de uma NR. Só LÊ o banco.
//
// Uso: ./run-backend-tests.sh eval:nr -- NR-35 35.4          (itens sob um prefixo)
//      ./run-backend-tests.sh eval:nr -- NR-35 --grep altura  (itens que citam o termo)
//      ./run-backend-tests.sh eval:nr -- --grep "grau de risco" (busca em TODAS as NRs;
//        use para confirmar que a base NÃO cobre um assunto antes de escrever uma
//        pergunta sem_evidencia)
// Os itens do sumário aparecem como blocos curtos; o tamanho ajuda a distinguir.
const PREVIEW_CHARS = 420;

async function main() {
  const args = parseEvalArgs(process.argv.slice(2));
  const [sourceCode, prefix] = args.positional;
  if (!sourceCode && !args.grep) {
    console.error('Uso: eval:nr -- <NR-XX> [prefixo] [--grep termo]   ou   eval:nr -- --grep termo');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{ source_code: string; raw_text: string }>(
    `SELECT s.code AS source_code, d.raw_text
     FROM normative_documents d
     JOIN official_sources s ON s.id = d.source_id
     WHERE d.status = 'vigente' AND ($1::text IS NULL OR s.code = $1)
     ORDER BY s.code`,
    [sourceCode ?? null],
  );
  await client.end();
  if (rows.length === 0) {
    console.error(`"${sourceCode}" não tem documento vigente no banco`);
    process.exit(1);
  }

  let total = 0;
  for (const row of rows) {
    let blocks = splitIntoItemBlocks(row.raw_text);
    if (prefix) blocks = blocksWithPrefix(blocks, prefix);
    if (args.grep) blocks = blocksContaining(blocks, args.grep);
    if (blocks.length === 0) continue;
    total += blocks.length;
    console.log(`=== ${row.source_code}: ${blocks.length} item(ns) ===\n`);
    for (const block of blocks) {
      const preview = block.text.length > PREVIEW_CHARS ? `${block.text.slice(0, PREVIEW_CHARS)}…` : block.text;
      console.log(`[${block.text.length} chars] ${preview}\n`);
    }
  }
  if (total === 0) console.log('Nenhum item encontrado.');
}

main().catch((err) => {
  console.error('[eval:nr] falhou:', err);
  process.exit(1);
});
