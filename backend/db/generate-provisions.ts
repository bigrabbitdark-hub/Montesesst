import { Client } from 'pg';
import { PoolClient } from 'pg';
import { ParseResult, parseProvisions } from '../src/normative/provision-parser';
import { generationAllowedLabel, isGenerationAllowed, ProvisionsService, resolveKind } from '../src/normative/provisions.service';

// Comando manual, mesmo padrão de db/reseed-normative-sources.ts (standalone, sem Nest DI).
// Dry-run por padrão e SOMENTE LEITURA: lê o documento numa transação READ ONLY e imprime o relatório de
// cobertura do parser em memória; não chama o gerador e não toma lock de escrita. Só --apply grava,
// e só com autorização do proprietário (AGENTS.md).
export const MAX_ANOMALIES_PRINTED = 20;

// Percentual com PISO: 99,6% aparece como 99%, nunca arredondado para 100%.
export const pct = (part: number, total: number): number => (total > 0 ? Math.floor((part / total) * 100) : 0);

export function formatCoverageReport(norma: string, r: ParseResult): string {
  const linhas = [
    `${norma} — dispositivos: ${r.provisions.length} | cobertura: ${Math.floor(r.coverage * 100)}% | anomalias: ${r.anomalies.length}`,
    // Todos os anexos reconhecidos e seções (`12/MANGANÊS…`), em ordem de aparição; anexo sem dispositivo é destacado.
    ...r.anexos.map((a) => {
      const rotulo = `  anexo ${a.id || '(corpo)'}`;
      if (a.provisions === 0) return `${rotulo}: 0 dispositivos ⚠`;
      return `${rotulo}: ${a.provisions} ${a.provisions === 1 ? 'dispositivo' : 'dispositivos'}, ${pct(a.covered_chars, a.chars)}% do texto do anexo`;
    }),
    // Texto em quarentena não entra no % de nenhum anexo: aparece aqui, para não esconder o que ficou fora.
    ...r.quarantines.map((q) => `  quarentena (linha ${q.header_line}, "${q.header}"): ${q.chars} caracteres sem dispositivo`),
    ...(r.quarantines.length > 0
      ? [
          `  quarentena total: ${r.quarantines.reduce((s, q) => s + q.chars, 0)} caracteres sem dispositivo em ${r.quarantines.length} ${r.quarantines.length === 1 ? 'trecho' : 'trechos'}`,
        ]
      : []),
    ...(r.anomalies.length > MAX_ANOMALIES_PRINTED ? [`  anomalias: mostrando ${MAX_ANOMALIES_PRINTED} de ${r.anomalies.length}`] : []),
    ...r.anomalies.slice(0, MAX_ANOMALIES_PRINTED).map((a) => `  ! ${a.kind} ${a.detail} (linha ${a.line})`),
  ];
  return linhas.join('\n');
}

export function parseArgs(argv: string[]): { documentId: string | undefined; apply: boolean } {
  return { documentId: argv.find((a) => !a.startsWith('--')), apply: argv.includes('--apply') };
}

async function main() {
  const { documentId, apply } = parseArgs(process.argv.slice(2));
  if (!documentId) throw new Error('uso: npm run db:generate-provisions -- <documentId> [--apply]');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (apply) {
      await client.query('BEGIN');
      const report = await new ProvisionsService().generate(client as unknown as PoolClient, documentId);
      await client.query('COMMIT');
      console.log(
        `[apply] gravado: ${report.norma} v=${report.parser_version} encontrados=${report.found} inseridos=${report.inserted} cobertura=${Math.floor(report.coverage * 100)}%`,
      );
      if (report.anomalies_total > MAX_ANOMALIES_PRINTED) console.log(`  anomalias: mostrando ${MAX_ANOMALIES_PRINTED} de ${report.anomalies_total}`);
      report.anomalies.slice(0, MAX_ANOMALIES_PRINTED).forEach((a) => console.log(`  ! ${a.kind} ${a.detail} (linha ${a.line})`));
      return;
    }
    await client.query('BEGIN READ ONLY');
    const found = await client.query<{ status: string; raw_text: string; code: string | null }>(
      `SELECT d.status, d.raw_text, s.code FROM normative_documents d JOIN official_sources s ON s.id = d.source_id WHERE d.id = $1`,
      [documentId],
    );
    await client.query('ROLLBACK');
    const doc = found.rows[0];
    if (!doc) throw new Error('documento não encontrado');
    const { norma, kind } = resolveKind(doc.code);
    console.log(formatCoverageReport(norma, parseProvisions(doc.raw_text, kind)));
    // Dry-run é somente leitura e vale para qualquer norma (é como se avalia o parser); o --apply passa por generate(), que recusa.
    if (!isGenerationAllowed(norma)) console.log(`! ${norma} não está liberada para --apply (parser validado só para ${generationAllowedLabel()})`);
    if (doc.status !== 'vigente') console.log(`! o documento está "${doc.status}": --apply só aceita documentos vigentes`);
    console.log('[dry-run] somente leitura; nada foi gravado (use --apply com autorização)');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
