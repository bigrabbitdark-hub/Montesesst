import ExcelJS from 'exceljs';
import {
  applyColumnMapping,
  parseSpreadsheet,
  suggestColumnMapping,
} from '../src/employees/spreadsheet-import.util';

async function buildTestXlsx(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Funcionários');
  rows.forEach((row) => worksheet.addRow(row));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('spreadsheet-import.util', () => {
  describe('parseSpreadsheet — CSV', () => {
    it('extrai cabeçalho e linhas de um CSV com cabeçalho não-padrão', async () => {
      const csv = 'Nome Completo,Documento,Função,Unidade\nJoão Silva,12345678900,Eletricista,Matriz\n';
      const result = await parseSpreadsheet(Buffer.from(csv, 'utf-8'), 'text/csv');

      expect(result.formatError).toBeUndefined();
      expect(result.headers).toEqual(['Nome Completo', 'Documento', 'Função', 'Unidade']);
      expect(result.rows).toEqual([['João Silva', '12345678900', 'Eletricista', 'Matriz']]);
    });

    it('devolve formatError pra arquivo vazio', async () => {
      const result = await parseSpreadsheet(Buffer.from('', 'utf-8'), 'text/csv');
      expect(result.formatError).toBe('Arquivo vazio');
    });

    it('devolve formatError quando excede MAX_IMPORT_ROWS', async () => {
      const header = 'nome,cpf,cargo,filial\n';
      const rows = Array.from({ length: 2001 }, (_, i) => `Nome ${i},12345678900,Cargo,Matriz`).join('\n');
      const result = await parseSpreadsheet(Buffer.from(header + rows, 'utf-8'), 'text/csv');
      expect(result.formatError).toContain('2001 linhas');
    });
  });

  describe('parseSpreadsheet — XLSX', () => {
    it('extrai cabeçalho e linhas de um XLSX real', async () => {
      const buffer = await buildTestXlsx([
        ['Nome Completo', 'Documento', 'Função', 'Unidade'],
        ['Maria Souza', '98765432100', 'Técnica', 'Filial SP'],
      ]);
      const result = await parseSpreadsheet(
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      expect(result.formatError).toBeUndefined();
      expect(result.headers).toEqual(['Nome Completo', 'Documento', 'Função', 'Unidade']);
      expect(result.rows).toEqual([['Maria Souza', '98765432100', 'Técnica', 'Filial SP']]);
    });
  });

  describe('parseSpreadsheet — formato não suportado', () => {
    it('devolve formatError pra mimetype desconhecido', async () => {
      const result = await parseSpreadsheet(Buffer.from('qualquer coisa'), 'application/pdf');
      expect(result.formatError).toContain('não suportado');
    });

    it('devolve formatError (sem lançar) pro mimetype genérico sem filename', async () => {
      const result = await parseSpreadsheet(Buffer.from('qualquer coisa'), 'application/octet-stream');
      expect(result.formatError).toContain('não suportado');
    });

    it('devolve formatError (sem lançar) pro mimetype genérico com extensão desconhecida', async () => {
      const result = await parseSpreadsheet(
        Buffer.from('qualquer coisa'),
        'application/octet-stream',
        'planilha.pdf',
      );
      expect(result.formatError).toContain('não suportado');
    });
  });

  describe('parseSpreadsheet — XLSX corrompido/inválido', () => {
    it('buffer aleatório (não é um zip válido) devolve formatError sem lançar', async () => {
      const result = await parseSpreadsheet(
        Buffer.from('isto nao e um arquivo xlsx valido, so bytes aleatorios'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(result.formatError).toContain('corrompido');
    });

    it('zip válido mas sem nenhuma planilha devolve formatError sem lançar', async () => {
      const workbook = new ExcelJS.Workbook();
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const result = await parseSpreadsheet(
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(result.formatError).toContain('corrompido');
    });
  });

  describe('parseSpreadsheet — detecção de formato por extensão (fallback)', () => {
    it('mimetype genérico + filename .csv detecta como CSV', async () => {
      const csv = 'nome,cpf,cargo,filial\nJoão Silva,12345678900,Eletricista,Matriz\n';
      const result = await parseSpreadsheet(
        Buffer.from(csv, 'utf-8'),
        'application/octet-stream',
        'funcionarios.csv',
      );
      expect(result.formatError).toBeUndefined();
      expect(result.headers).toEqual(['nome', 'cpf', 'cargo', 'filial']);
    });

    it('mimetype genérico + filename .xlsx detecta como XLSX', async () => {
      const buffer = await buildTestXlsx([
        ['nome', 'cpf', 'cargo', 'filial'],
        ['João Silva', '12345678900', 'Eletricista', 'Matriz'],
      ]);
      const result = await parseSpreadsheet(buffer, 'application/octet-stream', 'funcionarios.xlsx');
      expect(result.formatError).toBeUndefined();
      expect(result.headers).toEqual(['nome', 'cpf', 'cargo', 'filial']);
    });
  });

  describe('parseSpreadsheet — teto de tamanho do XLSX', () => {
    it('buffer .xlsx maior que 3MB devolve formatError sem chamar ExcelJS.load', async () => {
      const bigBuffer = Buffer.alloc(3 * 1024 * 1024 + 1, 'a');
      const start = Date.now();
      const result = await parseSpreadsheet(
        bigBuffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      const elapsed = Date.now() - start;
      expect(result.formatError).toContain('muito grande');
      // Se estivesse tentando carregar 3MB+ de bytes aleatórios como zip via
      // ExcelJS, levaria (e provavelmente lançaria) — retorno deve ser
      // imediato, confirmando que o guard de tamanho roda ANTES do parse.
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('parseSpreadsheet — célula de fórmula/rich text', () => {
    it('célula de fórmula extrai o result, não "[object Object]"', async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Funcionários');
      worksheet.addRow(['nome', 'cpf', 'cargo', 'filial']);
      const row = worksheet.addRow(['João Silva', '12345678900', '', 'Matriz']);
      row.getCell(3).value = { formula: '=1+1', result: 2 } as any;
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const result = await parseSpreadsheet(
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(result.formatError).toBeUndefined();
      expect(result.rows[0][2]).toBe('2');
      expect(result.rows[0][2]).not.toBe('[object Object]');
    });

    it('célula de rich text concatena os fragmentos de texto', async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Funcionários');
      worksheet.addRow(['nome', 'cpf', 'cargo', 'filial']);
      const row = worksheet.addRow(['', '12345678900', 'Eletricista', 'Matriz']);
      row.getCell(1).value = { richText: [{ text: 'ab' }, { text: 'cd' }] } as any;
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const result = await parseSpreadsheet(
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(result.formatError).toBeUndefined();
      expect(result.rows[0][0]).toBe('abcd');
    });
  });

  describe('suggestColumnMapping', () => {
    it('reconhece o cabeçalho exato já usado hoje', () => {
      const mapping = suggestColumnMapping(['nome', 'cpf', 'cargo', 'filial']);
      expect(mapping).toEqual({ nome: 0, cpf: 1, cargo: 2, filial: 3 });
    });

    it('reconhece sinônimos comuns em ordem diferente', () => {
      const mapping = suggestColumnMapping(['Documento', 'Nome Completo', 'Unidade', 'Função']);
      expect(mapping).toEqual({ nome: 1, cpf: 0, cargo: 3, filial: 2 });
    });

    it('reconhece sinônimo com acento e maiúsculas', () => {
      const mapping = suggestColumnMapping(['FUNÇÃO', 'NOME COMPLETO', 'CPF', 'FILIAL']);
      expect(mapping.cargo).toBe(0);
      expect(mapping.nome).toBe(1);
    });

    it('devolve null pro campo sem cabeçalho reconhecível', () => {
      const mapping = suggestColumnMapping(['Coluna Misteriosa', 'cpf', 'cargo', 'filial']);
      expect(mapping.nome).toBeNull();
      expect(mapping.cpf).toBe(1);
    });
  });

  describe('applyColumnMapping', () => {
    it('extrai os 4 campos usando o mapeamento, removendo formatação do CPF', () => {
      const rows = [['João Silva', '123.456.789-00', 'Eletricista', 'Matriz']];
      const mapping = { nome: 0, cpf: 1, cargo: 2, filial: 3 };
      const result = applyColumnMapping(rows, mapping);

      expect(result).toEqual([
        { line: 2, full_name: 'João Silva', cpf: '12345678900', position: 'Eletricista', company_unit_name: 'Matriz' },
      ]);
    });

    it('campo com índice null vira string vazia', () => {
      const rows = [['João Silva', '12345678900']];
      const mapping = { nome: 0, cpf: 1, cargo: null, filial: null };
      const result = applyColumnMapping(rows, mapping);

      expect(result[0].position).toBe('');
      expect(result[0].company_unit_name).toBe('');
    });
  });
});
