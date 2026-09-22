import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { parseEvalArgs } from './args';
import { checkEvidence } from './golden/quote';
import { GoldenQuestion, validateGoldenDataset } from './golden/golden-schema';

// eval:lint — confere, por código, que cada `evidencia` do dataset golden existe
// LITERALMENTE no texto vigente da NR indicada (spec
// docs/specs/assistente-confiabilidade-etapa-2-3.md §3.5). Só LÊ o banco.
// Com --write, grava versao_fonte (hash do documento vigente) e
// data_verificacao — e só se o dataset inteiro estiver sem erro.
//
// Uso: ./run-backend-tests.sh eval:lint [-- --file caminho.json] [-- --write]
const DEFAULT_FILE = join(__dirname, 'golden', 'perguntas.json');

interface VigenteDocument {
  source_code: string;
  content_hash: string;
  raw_text: string;
}

async function main() {
  const args = parseEvalArgs(process.argv.slice(2));
  const file = args.file ?? DEFAULT_FILE;
  const raw = JSON.parse(readFileSync(file, 'utf8'));

  const schemaErrors = validateGoldenDataset(raw);
  if (schemaErrors.length > 0) {
    console.error(`[eval:lint] schema inválido em ${file}:`);
    for (const error of schemaErrors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const questions = raw as GoldenQuestion[];

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<VigenteDocument>(
    `SELECT s.code AS source_code, d.content_hash, d.raw_text
     FROM normative_documents d
     JOIN official_sources s ON s.id = d.source_id
     WHERE d.status = 'vigente'`,
  );
  await client.end();
  const vigentes = new Map(rows.map((row) => [row.source_code, row]));

  const today = new Date().toISOString().slice(0, 10);
  let errors = 0;
  let checked = 0;
  for (const q of questions) {
    const hashes = new Set<string>();
    for (const fonte of q.fontes_esperadas) {
      const doc = vigentes.get(fonte.source_code);
      if (!doc) {
        console.error(`${q.id}: "${fonte.source_code}" não tem documento vigente no banco`);
        errors += 1;
        continue;
      }
      const check = checkEvidence(doc.raw_text, fonte.item, fonte.evidencia);
      checked += 1;
      if (!check.ok) {
        console.error(`${q.id}: ${fonte.source_code} ${fonte.item} — ${check.reason}`);
        errors += 1;
      } else {
        hashes.add(`${fonte.source_code}:${doc.content_hash.slice(0, 8)}`);
      }
    }
    if (args.write && hashes.size > 0) {
      q.versao_fonte = Array.from(hashes).join(',');
      q.data_verificacao = today;
    }
  }

  if (errors > 0) {
    console.error(`[eval:lint] ${errors} problema(s) em ${checked} citação(ões) — nada foi gravado`);
    process.exit(1);
  }
  if (args.write) {
    writeFileSync(file, `${JSON.stringify(questions, null, 2)}\n`);
    console.log(`[eval:lint] versao_fonte e data_verificacao gravadas em ${file}`);
  }
  console.log(`[eval:lint] OK — ${questions.length} perguntas, ${checked} citação(ões) conferida(s) contra o texto vigente`);
}

main().catch((err) => {
  console.error('[eval:lint] falhou:', err);
  process.exit(1);
});
