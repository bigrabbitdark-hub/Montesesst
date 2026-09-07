import ExcelJS from 'exceljs';
import { MAX_IMPORT_ROWS, splitCsvLine } from './csv-import.util';

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

function parseCsvRows(content: string): string[][] {
  return content
    .split(/\r\n|\n|\r/)
    .filter((line) => line.length > 0)
    .map((line) => splitCsvLine(line));
}

async function parseXlsxRows(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  const rows: string[][] = [];
  worksheet.eachRow((row) => {
    const values = row.values as unknown[];
    // exceljs é 1-indexed — values[0] é sempre undefined, os valores reais
    // começam em values[1].
    rows.push(
      values.slice(1).map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim())),
    );
  });
  return rows;
}

export async function parseSpreadsheet(buffer: Buffer, mimetype: string): Promise<SpreadsheetParseResult> {
  let rows: string[][];
  if (CSV_MIME_TYPES.includes(mimetype)) {
    rows = parseCsvRows(buffer.toString('utf-8'));
  } else if (mimetype === XLSX_MIME_TYPE) {
    rows = await parseXlsxRows(buffer);
  } else {
    return { headers: [], rows: [], formatError: 'Formato de arquivo não suportado — envie um .csv ou .xlsx' };
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

// Sinônimos reconhecidos, comparação case-insensitive e sem acento (ver
// normalizeHeader). "setor" entra como sinônimo aproximado de "filial" —
// se um dia existir um campo "setor" de funcionário separado, revisitar
// esta entrada (nota já registrada na spec desta fase).
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
    // +2: +1 porque `rows` já excluiu a linha de cabeçalho, +1 porque
    // linha é 1-indexada pro usuário. Aproximado se houve linha em branco
    // no meio do arquivo original (simplificação documentada na spec).
    line: i + 2,
    full_name: mapping.nome !== null ? (row[mapping.nome] ?? '') : '',
    cpf: mapping.cpf !== null ? (row[mapping.cpf] ?? '').replace(/\D/g, '') : '',
    position: mapping.cargo !== null ? (row[mapping.cargo] ?? '') : '',
    company_unit_name: mapping.filial !== null ? (row[mapping.filial] ?? '') : '',
  }));
}
