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
});
