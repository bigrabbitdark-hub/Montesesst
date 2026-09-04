import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import * as zlib from 'zlib';
import { Client } from 'pg';
import * as ftp from 'basic-ftp';

const FTP_HOST = 'ftp.mtps.gov.br';
const FTP_PATH = '/portal/fiscalizacao/seguranca-e-saude-no-trabalho/caepi/tgg_export_caepi.zip';
const EXPECTED_COLUMNS = 19;
const BATCH_SIZE = 1000;

interface CaepiRow {
  numero_ca: string;
  data_validade: string | null;
  situacao: string | null;
  numero_processo: string | null;
  cnpj: string | null;
  razao_social: string | null;
  natureza: string | null;
  equipamento: string | null;
  descricao_equipamento: string | null;
  marca_ca: string | null;
  referencia: string | null;
  cor: string | null;
  aprovado_laudo: string | null;
  restricao_laudo: string | null;
  observacao_laudo: string | null;
  cnpj_laboratorio: string | null;
  razao_social_laboratorio: string | null;
  numero_laudo: string | null;
  norma: string | null;
}

export function parseBrDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const [, day, month, year] = match;
  const dayNum = Number(day);
  const monthNum = Number(month);
  const yearNum = Number(year);
  // Confere que a data é real, não só que o formato bate — Date "rola"
  // dias/meses inválidos pro período seguinte (ex. 30/02/2025 vira
  // 02/03/2025), o que gravaria um valor errado e silencioso no banco.
  // Reconstrói a data a partir dos componentes numéricos e confere que
  // volta exatamente os mesmos — se não voltar, a data de origem não
  // existe no calendário.
  const date = new Date(yearNum, monthNum - 1, dayNum);
  if (date.getFullYear() !== yearNum || date.getMonth() !== monthNum - 1 || date.getDate() !== dayNum) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

function nullIfEmpty(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export async function downloadZip(destPath: string): Promise<void> {
  const client = new ftp.Client(30_000);
  try {
    // Acesso anônimo — user/password default da lib já são
    // "anonymous"/"guest", equivalente ao USER anonymous / PASS guest
    // que o servidor aceita (confirmado nesta sessão via teste real).
    await client.access({ host: FTP_HOST });
    await client.downloadTo(destPath, FTP_PATH);
  } finally {
    client.close();
  }
}

// O ZIP do próprio MTE vem sem o registro de fim de índice central
// (End of Central Directory) — ferramentas de zip padrão (incluindo
// qualquer lib de zip completa) falham ao abrir esse arquivo. A única
// forma confiável de ler o conteúdo, validada nesta sessão com
// download real, é fazer o parsing manual do cabeçalho local do
// primeiro (e único) arquivo dentro do zip, e então descomprimir o
// restante como um stream deflate bruto (`zlib.createInflateRaw`),
// tolerando que ele termine sem o marcador de fim — o arquivo do
// próprio governo já veio cortado no meio de um registro num teste
// real feito durante o brainstorming desta fase, e é esperado que
// isso aconteça de novo.
export async function extractCaepiText(zipPath: string): Promise<Buffer> {
  const data = readFileSync(zipPath);
  if (data.length < 30 || data.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Arquivo não começa com uma assinatura de local file header de ZIP válida (PK\\x03\\x04)');
  }
  const fnameLen = data.readUInt16LE(26);
  const extraLen = data.readUInt16LE(28);
  const headerEnd = 30 + fnameLen + extraLen;
  const compressed = data.subarray(headerEnd);

  return new Promise((resolve) => {
    const inflater = zlib.createInflateRaw();
    const chunks: Buffer[] = [];
    inflater.on('data', (chunk: Buffer) => chunks.push(chunk));
    // Um 'error' aqui é o comportamento normal e esperado deste
    // arquivo (stream deflate sem marcador de fim, por causa do
    // truncamento na origem) — já recebemos em 'data' tudo que deu
    // pra descomprimir até o ponto do corte, que é o que importa.
    // Mas isso não pode ficar silencioso: sem um aviso explícito aqui,
    // nada distingue "baixei o arquivo completo" de "baixei 60% dele" —
    // e essa base alimenta a tela de busca em produção, cujo rodapé
    // ("Base local atualizada em DD/MM/AAAA") dá a entender uma base
    // completa. Ver também a checagem de sanidade em main() contra a
    // sincronização anterior.
    inflater.on('error', () => {
      console.warn(
        '[caepi-sync] AVISO: o stream de descompressão terminou sem o marcador de fim ' +
          '(evento "error" tolerado) — a fonte provavelmente foi cortada no meio de um ' +
          'registro. A importação segue apenas com os dados parciais recebidos até o ' +
          'ponto do corte.',
      );
      resolve(Buffer.concat(chunks));
    });
    inflater.on('end', () => resolve(Buffer.concat(chunks)));
    inflater.end(compressed);
  });
}

// O texto descomprimido já é UTF-8 (confirmado nesta sessão testando
// as três hipóteses de encoding lado a lado contra os bytes reais —
// Windows-1252/Latin-1 corrompem os acentos, só UTF-8 produz texto
// correto) — sem conversão de encoding necessária.
export function parseCaepiText(raw: Buffer): { rows: CaepiRow[]; skipped: number } {
  const text = raw.toString('utf8');
  const lines = text.split(/\r?\n/);
  const rows: CaepiRow[] = [];
  let skipped = 0;

  // Primeira linha é o cabeçalho (nomes de coluna) — não é dado.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split('|');
    if (cols.length !== EXPECTED_COLUMNS) {
      // Linha final cortada, ou qualquer outra linha malformada —
      // pula e conta, não derruba a sincronização inteira por isso.
      skipped++;
      continue;
    }
    const numeroCa = nullIfEmpty(cols[0]);
    if (!numeroCa) {
      skipped++;
      continue;
    }
    rows.push({
      numero_ca: numeroCa,
      data_validade: parseBrDate(cols[1]),
      situacao: nullIfEmpty(cols[2]),
      numero_processo: nullIfEmpty(cols[3]),
      cnpj: nullIfEmpty(cols[4]),
      razao_social: nullIfEmpty(cols[5]),
      natureza: nullIfEmpty(cols[6]),
      equipamento: nullIfEmpty(cols[7]),
      descricao_equipamento: nullIfEmpty(cols[8]),
      marca_ca: nullIfEmpty(cols[9]),
      referencia: nullIfEmpty(cols[10]),
      cor: nullIfEmpty(cols[11]),
      aprovado_laudo: nullIfEmpty(cols[12]),
      restricao_laudo: nullIfEmpty(cols[13]),
      observacao_laudo: nullIfEmpty(cols[14]),
      cnpj_laboratorio: nullIfEmpty(cols[15]),
      razao_social_laboratorio: nullIfEmpty(cols[16]),
      numero_laudo: nullIfEmpty(cols[17]),
      norma: nullIfEmpty(cols[18]),
    });
  }
  return { rows, skipped };
}

// A base do MTE tem várias linhas com o mesmo numero_ca (uma por
// laudo/variante de equipamento sob o mesmo CA) — confirmado contra o
// arquivo real: de 56.748 linhas válidas num teste real, só 23.282
// numero_ca distintos, quase 10 mil CAs com 2+ linhas. Como
// numero_ca é PK em caepi_records (Task 1), não dá pra manter mais
// de uma linha por CA. Um INSERT ... ON CONFLICT DO UPDATE não aceita
// a mesma chave duas vezes no mesmo comando ("cannot affect row a
// second time") — descoberto rodando contra o arquivo real, não
// previsto no brief original. Dedup global (mantendo a última
// ocorrência de cada numero_ca na ordem do arquivo) antes de montar
// os lotes reproduz exatamente o mesmo estado final que upserts
// sequenciais um-a-um produziriam, e evita colisão dentro do lote
// não importa como as duplicatas caiam nos batches de 1000.
export function dedupeByNumeroCa(rows: CaepiRow[]): { deduped: CaepiRow[]; duplicates: number } {
  const map = new Map<string, CaepiRow>();
  for (const row of rows) {
    map.set(row.numero_ca, row);
  }
  return { deduped: Array.from(map.values()), duplicates: rows.length - map.size };
}

async function upsertRows(client: Client, rows: CaepiRow[]): Promise<void> {
  const columns = [
    'numero_ca', 'data_validade', 'situacao', 'numero_processo', 'cnpj', 'razao_social',
    'natureza', 'equipamento', 'descricao_equipamento', 'marca_ca', 'referencia', 'cor',
    'aprovado_laudo', 'restricao_laudo', 'observacao_laudo', 'cnpj_laboratorio',
    'razao_social_laboratorio', 'numero_laudo', 'norma',
  ] as const;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    batch.forEach((row, idx) => {
      const base = idx * columns.length;
      const rowPlaceholders = columns.map((_, k) => `$${base + k + 1}`);
      placeholders.push(`(${rowPlaceholders.join(', ')}, now())`);
      for (const col of columns) {
        values.push(row[col]);
      }
    });

    await client.query(
      `INSERT INTO caepi_records (${columns.join(', ')}, updated_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (numero_ca) DO UPDATE SET
         ${columns
           .filter((c) => c !== 'numero_ca')
           .map((c) => `${c} = EXCLUDED.${c}`)
           .join(', ')},
         updated_at = EXCLUDED.updated_at`,
      values,
    );
  }
}

async function main() {
  const tmpZipPath = join(tmpdir(), `caepi-${randomUUID()}.zip`);
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    console.log('[caepi-sync] baixando base do FTP do MTE...');
    await downloadZip(tmpZipPath);

    console.log('[caepi-sync] extraindo e descomprimindo...');
    const raw = await extractCaepiText(tmpZipPath);

    console.log('[caepi-sync] parseando linhas...');
    const { rows: parsedRows, skipped: skippedMalformed } = parseCaepiText(raw);
    const { deduped: rows, duplicates } = dedupeByNumeroCa(parsedRows);
    const skipped = skippedMalformed + duplicates;
    console.log(
      `[caepi-sync] ${parsedRows.length} linhas válidas, ${skippedMalformed} puladas por formato, ` +
        `${duplicates} duplicadas por numero_ca (mantida só a última), ${rows.length} registros distintos a gravar`,
    );

    if (rows.length === 0) {
      throw new Error('Nenhuma linha válida extraída — abortando sem gravar (provável falha de download/parsing, não um estado real da base)');
    }

    await client.connect();
    console.log('[caepi-sync] gravando no banco (upsert em lote)...');
    await upsertRows(client, rows);

    // Checagem de sanidade contra a sincronização anterior — só avisa,
    // não aborta nem muda o exit code (script rodado manualmente pelo
    // operador, que decide se investiga/re-roda; ver comentário no
    // 'error' de extractCaepiText acima sobre por que isso importa: um
    // truncamento na origem produz um sync "bem sucedido" com muito
    // menos linhas, sem nenhum outro sinal de erro).
    const previousStatus = await client.query<{ rows_imported: number }>(
      'SELECT rows_imported FROM caepi_sync_status WHERE id = 1',
    );
    const previousRowsImported = previousStatus.rows[0]?.rows_imported ?? null;
    if (previousRowsImported !== null && previousRowsImported > 0) {
      const dropRatio = (previousRowsImported - rows.length) / previousRowsImported;
      if (dropRatio > 0.2) {
        const dropPct = (dropRatio * 100).toFixed(1);
        console.warn('='.repeat(70));
        console.warn(
          `ATENÇÃO: importação caiu de ${previousRowsImported} para ${rows.length} registros ` +
            `(${dropPct}% menor que a sincronização anterior) — possível truncamento ou falha na fonte`,
        );
        console.warn('='.repeat(70));
      }
    }
    // Se previousRowsImported for null, é a primeira sincronização
    // deste ambiente (ou a linha nunca foi escrita) — nada pra comparar,
    // pula a checagem sem erro.

    await client.query(
      `INSERT INTO caepi_sync_status (id, last_synced_at, rows_imported, rows_skipped)
       VALUES (1, now(), $1, $2)
       ON CONFLICT (id) DO UPDATE SET
         last_synced_at = EXCLUDED.last_synced_at,
         rows_imported = EXCLUDED.rows_imported,
         rows_skipped = EXCLUDED.rows_skipped`,
      [rows.length, skipped],
    );

    console.log(`[caepi-sync] concluído — ${rows.length} registros importados/atualizados, ${skipped} pulados.`);
  } finally {
    await client.end().catch(() => {});
    try {
      unlinkSync(tmpZipPath);
    } catch {
      // Arquivo temporário já pode não existir se o download falhou
      // antes de completar — não é um erro que importa aqui.
    }
  }
}

// Só dispara a sincronização de verdade (download real, conexão real
// com o banco, `process.exit`) quando este arquivo é executado
// diretamente como script (`npm run caepi:sync`) — nunca como efeito
// colateral de simplesmente importar as funções puras exportadas
// acima (ex.: os testes unitários deste arquivo, ou o script de
// investigação read-only da Fase 17, que reusa downloadZip/
// extractCaepiText/parseCaepiText via import). Sem essa guarda,
// `require(...)` deste módulo em qualquer contexto já dispararia um
// download FTP real, uma tentativa de conexão com Postgres e um
// `process.exit(1)` matando o processo host em caso de falha — foi
// exatamente o que aconteceu ao rodar os testes unitários pela
// primeira vez antes desta guarda existir.
if (require.main === module) {
  main().catch((err) => {
    console.error('[caepi-sync] falhou:', err);
    process.exit(1);
  });
}
