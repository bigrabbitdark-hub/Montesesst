import ExcelJS from 'exceljs';
import { verifyFileContent } from '../common/files/file-content.util';

export const SHEET_FIELDS = [
  'full_name', 'esocial_registration', 'cpf', 'birth_date', 'sex', 'position', 'admission_date', 'cbo_code', 'activity_description',
] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];
// reviewOnly: campos que nunca são auto-aplicados (texto livre ou IA); evidence: trecho de origem, já mascarado pelo chamador.
export interface SheetRow { line: number; values: Partial<Record<SheetField, string>>; reviewOnly?: SheetField[]; evidence?: string }
export interface SheetParseResult { rows: SheetRow[]; ignored: number; formatError?: string }

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_MAX_BYTES = 3 * 1024 * 1024;
const MAX_DATA_ROWS = 2000;
const HEADER_SCAN_ROWS = 40;
// Teto de linhas EXISTENTES varridas (dados + vazias com formatação) e de colunas lidas: planilhas
// malformadas (célula em XFD ou na linha 1048576) não podem estourar a memória.
const MAX_SCANNED_ROWS = 20000;
const MAX_COLS = 30;
const ZIP_LIMITS = { maxEntries: 200, maxEntryBytes: 20 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024 };
const INVISIBLE = /[\u200B-\u200D\uFEFF]/g;
const UNREADABLE = 'Não foi possível ler o arquivo .xlsx — verifique se não está corrompido';

const SYNONYMS: Record<SheetField, string[]> = {
  full_name: ['funcionario', 'nome', 'nome completo', 'colaborador', 'nome do funcionario'],
  esocial_registration: ['matricula esocial', 'matricula e-social', 'matricula'],
  cpf: ['cpf', 'cpf/mf'],
  birth_date: ['data de nascimento', 'data nascimento', 'nascimento'],
  sex: ['sexo f/m', 'sexo', 'sexo (f/m)'],
  position: ['funcao/cargo', 'cargo/funcao', 'cargo', 'funcao'],
  admission_date: ['data de admissao', 'data admissao', 'admissao'],
  cbo_code: ['cbo'],
  activity_description: ['descricao da atividade', 'atividade'],
};

function normalizeHeader(h: string): string {
  return h.replace(INVISIBLE, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Texto de uma célula do exceljs. Data vira AAAA-MM-DD pelas partes UTC (o exceljs entrega
// datas do Excel em UTC; nunca serializar com fuso local). Número vira texto inteiro, sem notação científica.
function cellText(cell: unknown): string {
  return rawCellText(cell).replace(INVISIBLE, '').trim();
}

function rawCellText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${cell.getUTCFullYear()}-${p(cell.getUTCMonth() + 1)}-${p(cell.getUTCDate())}`;
  }
  if (typeof cell === 'number') return Number.isInteger(cell) ? cell.toFixed(0) : String(cell);
  if (typeof cell === 'object') {
    const o = cell as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((x) => x.text ?? '').join('').trim();
    if ('result' in o) return cellText(o.result);
    if (typeof o.text === 'string') return o.text.trim();
    return '';
  }
  return String(cell).trim();
}

export async function parseEmployeeSheet(buffer: Buffer): Promise<SheetParseResult> {
  const fail = (formatError: string): SheetParseResult => ({ rows: [], ignored: 0, formatError });
  if (buffer.length > XLSX_MAX_BYTES) return fail(`Arquivo .xlsx muito grande (máximo ${XLSX_MAX_BYTES / (1024 * 1024)}MB)`);
  try {
    // Confere o conteúdo real (inclui o teto de descompressão contra zip bomb) antes de montar o workbook.
    if (await verifyFileContent(buffer, XLSX_MIME, ZIP_LIMITS)) return fail(UNREADABLE);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) return fail(UNREADABLE);

    // Nunca usar getRow/getCell fora de linhas existentes: eles CRIAM linhas/células no modelo.
    let headerRow = 0;
    let readCols = MAX_COLS;
    const colOf: Partial<Record<SheetField, number>> = {};
    const rows: SheetRow[] = [];
    let ignored = 0;
    let scanned = 0;
    let tooMany: string | undefined;

    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (tooMany) return;
      if (++scanned > MAX_SCANNED_ROWS) {
        tooMany = 'Planilha com linhas demais para leitura — use a planilha modelo, sem formatação nas linhas vazias';
        return;
      }
      // 1) cabeçalho: primeira linha (até HEADER_SCAN_ROWS) com, no mínimo, Funcionário/Nome e CPF.
      if (!headerRow) {
        if (r > HEADER_SCAN_ROWS) return;
        const found: Partial<Record<SheetField, number>> = {};
        for (let c = 1; c <= MAX_COLS; c++) {
          const h = normalizeHeader(cellText(row.getCell(c).value));
          if (!h) continue;
          for (const f of SHEET_FIELDS) if (found[f] === undefined && SYNONYMS[f].includes(h)) found[f] = c;
        }
        if (found.full_name !== undefined && found.cpf !== undefined) {
          headerRow = r;
          Object.assign(colOf, found);
          readCols = Math.min(MAX_COLS, Math.max(...(Object.values(found) as number[])) + 2);
        }
        return;
      }
      // 2) linhas de dados
      const cells: string[] = [];
      for (let c = 1; c <= readCols; c++) cells.push(cellText(row.getCell(c).value));
      const filled = cells.filter((x) => x !== '');
      if (filled.length === 0) return;
      // Observação mesclada: o exceljs repete o mesmo texto em todas as células da mescla.
      if (filled.length >= 2 && new Set(filled).size === 1) { ignored++; return; }
      const values: Partial<Record<SheetField, string>> = {};
      for (const f of SHEET_FIELDS) {
        const c = colOf[f];
        const v = c === undefined ? '' : cells[c - 1];
        if (v !== '') values[f] = v;
      }
      if (values.full_name === undefined && values.cpf === undefined) { ignored++; return; }
      rows.push({ line: r, values });
    });

    if (tooMany) return fail(tooMany);
    if (!headerRow) return fail('Cabeçalho não reconhecido — use a planilha modelo (colunas Funcionário e CPF são obrigatórias)');
    if (rows.length > MAX_DATA_ROWS) return fail(`A planilha tem mais de ${MAX_DATA_ROWS} linhas de dados (máximo ${MAX_DATA_ROWS})`);
    return { rows, ignored };
  } catch {
    return fail(UNREADABLE);
  }
}
