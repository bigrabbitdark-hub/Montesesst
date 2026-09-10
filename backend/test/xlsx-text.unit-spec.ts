import ExcelJS from 'exceljs';
import { extractXlsxRows } from '../src/common/xlsx/xlsx-text.util';

async function buildTestXlsx(sheetName: string, rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  rows.forEach((row) => sheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe('extractXlsxRows', () => {
  it('transforma cada linha em frase usando o cabeçalho como rótulo, prefixada pelo nome da aba', async () => {
    const xlsx = await buildTestXlsx('Ruído', [
      ['Função', 'Medição'],
      ['Soldador', '92 dB(A)'],
    ]);
    const rows = await extractXlsxRows(xlsx);
    expect(rows).toEqual(['Aba: Ruído | Função: Soldador | Medição: 92 dB(A)']);
  });

  it('ignora aba sem linha de dado além do cabeçalho', async () => {
    const xlsx = await buildTestXlsx('Vazia', [['Função', 'Medição']]);
    const rows = await extractXlsxRows(xlsx);
    expect(rows).toEqual([]);
  });

  it('devolve array vazio pra buffer que não é um .xlsx válido', async () => {
    const rows = await extractXlsxRows(Buffer.from('isto não é um xlsx'));
    expect(rows).toEqual([]);
  });

  it('devolve array vazio quando o workbook carrega mas a iteração de linhas lança (ex.: shared-strings corrompida)', async () => {
    const xlsx = await buildTestXlsx('Ruído', [
      ['Função', 'Medição'],
      ['Soldador', '92 dB(A)'],
    ]);
    // workbook.xlsx.load() bem-sucedido não garante que a leitura das
    // linhas depois não lance — ex.: uma tabela de shared-strings
    // corrompida no .xlsx faz load() aceitar, mas a leitura de célula
    // falha durante a iteração. Simula isso espionando eachRow no
    // protótipo compartilhado por toda instância de Worksheet do
    // exceljs (não dá pra pegar a instância interna que
    // extractXlsxRows cria a partir do buffer, mas o protótipo é
    // compartilhado por qualquer Worksheet, inclusive aquela).
    const probeWorkbook = new ExcelJS.Workbook();
    const probeWorksheet = probeWorkbook.addWorksheet('probe');
    const worksheetProto = Object.getPrototypeOf(probeWorksheet);
    const eachRowSpy = jest.spyOn(worksheetProto, 'eachRow').mockImplementation(() => {
      throw new Error('Simulated ExcelJS row-iteration failure');
    });
    try {
      const rows = await extractXlsxRows(xlsx);
      expect(rows).toEqual([]);
    } finally {
      eachRowSpy.mockRestore();
    }
  });
});
