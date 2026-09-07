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
