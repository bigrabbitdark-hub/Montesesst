import ExcelJS from 'exceljs';
import { MAX_IMPORT_ROWS, splitCsvLine } from './csv-import.util';
import { verifyFileContent } from '../common/files/file-content.util';

export interface SpreadsheetParseResult {
  headers: string[];
  rows: string[][];
  formatError?: string;
}

export interface ColumnMapping {
  nome: number | null;
  cpf: number | null;
  cargo: number | null;
  filial: number | null;
}

export interface MappedEmployeeRow {
  line: number;
  full_name: string;
  cpf: string;
  position: string;
  company_unit_name: string;
}

const CSV_MIME_TYPES = ['text/csv', 'application/vnd.ms-excel'];
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_MAX_BYTES = 3 * 1024 * 1024;

type SpreadsheetKind = 'csv' | 'xlsx';

// Nem todo navegador/SO manda o mimetype "certo" pra .csv/.xlsx (ex.:
// text/plain, application/octet-stream) — cai pra extensão do nome do
// arquivo quando o mimetype não bate com nenhum dos dois formatos
// suportados.
function detectKind(mimetype: string, filename?: string): SpreadsheetKind | null {
  if (CSV_MIME_TYPES.includes(mimetype)) return 'csv';
  if (mimetype === XLSX_MIME_TYPE) return 'xlsx';
  const ext = filename?.toLowerCase().split('.').pop();
  if (ext === 'csv') return 'csv';
  if (ext === 'xlsx') return 'xlsx';
  return null;
}

function parseCsvRows(content: string): string[][] {
  return content
    .split(/\r\n|\n|\r/)
    .filter((line) => line.length > 0)
    .map((line) => splitCsvLine(line));
}

// Célula de fórmula/rich text/hyperlink do exceljs não é um valor
// escalar — é um objeto ({formula, result}, {richText:[...]},
// {text, hyperlink}, {error}). Sem tratar essas formas, String(cell)
// virava o literal "[object Object]" gravado como nome/cargo do
// funcionário.
function cellToText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString();
  if (typeof cell === 'object') {
    const obj = cell as Record<string, unknown>;
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map((part) => part.text ?? '').join('').trim();
    }
    if ('result' in obj) {
      return cellToText(obj.result);
    }
    if ('text' in obj && typeof obj.text === 'string') {
      return obj.text.trim();
    }
    if ('error' in obj) {
      return '';
    }
    return '';
  }
  return String(cell).trim();
}

async function parseXlsxRows(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Planilha .xlsx sem nenhuma aba');
  }
  const rows: string[][] = [];
  worksheet.eachRow((row) => {
    const values = row.values as unknown[];
    rows.push(values.slice(1).map((cell) => cellToText(cell)));
  });
  return rows;
}

export async function parseSpreadsheet(
  buffer: Buffer,
  mimetype: string,
  filename?: string,
): Promise<SpreadsheetParseResult> {
  const kind = detectKind(mimetype, filename);
  if (kind === null) {
    return { headers: [], rows: [], formatError: 'Formato de arquivo não suportado — envie um .csv ou .xlsx' };
  }

  let rows: string[][];
  if (kind === 'csv') {
    rows = parseCsvRows(buffer.toString('utf-8'));
  } else {
    // Checagem de tamanho ANTES de carregar o workbook: um .xlsx
    // comprimido pequeno pode expandir bem além do próprio tamanho em
    // memória — mais barato rejeitar cedo do que confiar só no limite de
    // MAX_IMPORT_ROWS, que só é checado depois do workbook inteiro já
    // estar montado.
    if (buffer.length > XLSX_MAX_BYTES) {
      return {
        headers: [],
        rows: [],
        formatError: `Arquivo .xlsx muito grande (máximo ${XLSX_MAX_BYTES / (1024 * 1024)}MB)`,
      };
    }
    // O teto acima é do tamanho COMPRIMIDO; um zip bomb passa por ele. Aqui o
    // conteúdo é conferido de verdade (incluindo o teto de descompressão)
    // antes do exceljs montar o workbook na memória.
    if (await verifyFileContent(buffer, XLSX_MIME_TYPE)) {
      return {
        headers: [],
        rows: [],
        formatError: 'Não foi possível ler o arquivo .xlsx — verifique se não está corrompido',
      };
    }
    try {
      rows = await parseXlsxRows(buffer);
    } catch {
      return {
        headers: [],
        rows: [],
        formatError: 'Não foi possível ler o arquivo .xlsx — verifique se não está corrompido',
      };
    }
  }

  if (rows.length === 0) {
    return { headers: [], rows: [], formatError: 'Arquivo vazio' };
  }

  const [headers, ...dataRows] = rows;
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      headers: [],
      rows: [],
      formatError: `Arquivo tem ${dataRows.length} linhas, o máximo permitido é ${MAX_IMPORT_ROWS}`,
    };
  }

  return { headers, rows: dataRows };
}

const SYNONYMS: Record<keyof ColumnMapping, string[]> = {
  nome: ['nome', 'nome completo', 'funcionario', 'colaborador', 'nome do funcionario'],
  cpf: ['cpf', 'documento', 'cpf/mf', 'numero do cpf', 'n do cpf'],
  cargo: ['cargo', 'funcao', 'cargo/funcao', 'posicao'],
  filial: ['filial', 'unidade', 'local', 'unidade/filial', 'setor'],
};

function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function suggestColumnMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: ColumnMapping = { nome: null, cpf: null, cargo: null, filial: null };
  (Object.keys(SYNONYMS) as (keyof ColumnMapping)[]).forEach((field) => {
    const idx = normalized.findIndex((h) => SYNONYMS[field].includes(h));
    if (idx !== -1) mapping[field] = idx;
  });
  return mapping;
}

export function applyColumnMapping(rows: string[][], mapping: ColumnMapping): MappedEmployeeRow[] {
  return rows.map((row, i) => ({
    line: i + 2,
    full_name: mapping.nome !== null ? (row[mapping.nome] ?? '') : '',
    cpf: mapping.cpf !== null ? (row[mapping.cpf] ?? '').replace(/\D/g, '') : '',
    position: mapping.cargo !== null ? (row[mapping.cargo] ?? '') : '',
    company_unit_name: mapping.filial !== null ? (row[mapping.filial] ?? '') : '',
  }));
}
