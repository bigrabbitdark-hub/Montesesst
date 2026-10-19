import ExcelJS from 'exceljs';
import { parseEmployeeSheet } from '../src/employees/employee-sheet.parser';

const HEADER = ['Qtde', 'Funcionário ', 'Matrícula esocial', 'CPF', 'Data de nascimento', 'Sexo F/M', 'Função/Cargo', 'Data de Admissão', 'CBO', 'Descrição da atividade'];

async function build(fill: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Plan1');
  fill(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Layout do modelo: título nas linhas 1-7, cabeçalho na 8, linha 9 vazia, dados a partir da 10.
function modelSheet(ws: ExcelJS.Worksheet, dataRows: unknown[][], tail: (ws: ExcelJS.Worksheet) => void = () => {}) {
  ws.mergeCells('A1:J1');
  ws.getCell('A1').value = 'CADASTRO DE FUNCIONÁRIOS';
  ws.getCell('A3').value = 'Empresa: ';
  ws.getCell('C3').value = 'EMPRESA FICTICIA LTDA';
  ws.getRow(8).values = HEADER;
  dataRows.forEach((r, i) => (ws.getRow(10 + i).values = r as ExcelJS.CellValue[]));
  tail(ws);
}

describe('parseEmployeeSheet', () => {
  it('acha o cabeçalho na linha 8, mapeia as 9 colunas e devolve a linha real da planilha', async () => {
    const buf = await build((ws) =>
      modelSheet(ws, [
        [1, 'ANA FICTICIA', '00012345678', '529.982.247-25', new Date(Date.UTC(1990, 1, 3)), 'F', 'SOLDADORA', new Date(Date.UTC(2020, 0, 5)), 623115, 'Solda'],
        [2, 'BRUNO FICTICIO', '00012345679', '111.444.777-35', new Date(Date.UTC(1985, 10, 20)), 'M', 'ELETRICISTA', new Date(Date.UTC(2018, 5, 18)), 51210, ''],
      ]),
    );
    const res = await parseEmployeeSheet(buf);
    expect(res.formatError).toBeUndefined();
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual({
      line: 10,
      values: {
        full_name: 'ANA FICTICIA', registration_number: '00012345678', cpf: '529.982.247-25',
        birth_date: '1990-02-03', sex: 'F', position: 'SOLDADORA', admission_date: '2020-01-05',
        cbo_code: '623115', activity_description: 'Solda',
      },
    });
    expect(res.rows[1].line).toBe(11);
    expect(res.rows[1].values.cbo_code).toBe('51210'); // número do Excel: o zero à esquerda é restaurado pelo classificador
    expect(res.rows[1].values.activity_description).toBeUndefined(); // vazio é omitido
  });

  it('ignora linhas em branco e linhas de observação mescladas (texto repetido em todas as colunas)', async () => {
    const buf = await build((ws) =>
      modelSheet(
        ws,
        [[1, 'CARLA FICTICIA', '', '123.456.789-09', '', 'F', 'AUXILIAR', '', '', '']],
        (w) => {
          w.mergeCells('A30:J30');
          w.getCell('A30').value = 'OBSERVAÇÕES: preencher todos os campos';
          w.getCell('A32').value = 'texto solto sem nome nem CPF';
        },
      ),
    );
    const res = await parseEmployeeSheet(buf);
    expect(res.rows.map((r) => r.line)).toEqual([10]);
    expect(res.ignored).toBe(2);
  });

  it('uma linha com nome mas sem CPF (ou CPF sem nome) continua sendo dado (o classificador a marca inválida)', async () => {
    const buf = await build((ws) =>
      modelSheet(ws, [
        [1, 'SEM CPF FICTICIO', '', '', '', '', '', '', '', ''],
        [2, '', '', '987.654.321-00', '', '', '', '', '', ''],
      ]),
    );
    const res = await parseEmployeeSheet(buf);
    expect(res.rows.map((r) => r.line)).toEqual([10, 11]);
  });

  it('aceita cabeçalho na linha 1 e sinônimos (Nome, Cargo, Admissão)', async () => {
    const buf = await build((ws) => {
      ws.getRow(1).values = ['Nome', 'CPF', 'Cargo', 'Admissão'];
      ws.getRow(2).values = ['DUDA FICTICIA', '12345678909', 'AUXILIAR', '05/01/2020'];
    });
    const res = await parseEmployeeSheet(buf);
    expect(res.rows).toEqual([
      { line: 2, values: { full_name: 'DUDA FICTICIA', cpf: '12345678909', position: 'AUXILIAR', admission_date: '05/01/2020' } },
    ]);
  });

  it('CPF e matrícula numéricos do Excel viram texto sem notação científica', async () => {
    const buf = await build((ws) => modelSheet(ws, [[1, 'EDU FICTICIO', 32000006, 52998224725, '', '', '', '', '', '']]));
    const res = await parseEmployeeSheet(buf);
    expect(res.rows[0].values.cpf).toBe('52998224725');
    expect(res.rows[0].values.registration_number).toBe('32000006');
  });

  it('sem cabeçalho reconhecível devolve formatError em português; arquivo corrompido também', async () => {
    const semCab = await build((ws) => (ws.getRow(1).values = ['a', 'b', 'c']));
    expect((await parseEmployeeSheet(semCab)).formatError).toMatch(/cabeçalho/i);
    const lixo = await parseEmployeeSheet(Buffer.from('isto não é um xlsx'));
    expect(lixo.formatError).toMatch(/ler o arquivo/i);
    expect(lixo.rows).toEqual([]);
  });

  it('respeita o limite de linhas de dados', async () => {
    const buf = await build((ws) => {
      ws.getRow(1).values = ['Nome', 'CPF'];
      for (let i = 0; i < 2001; i++) ws.getRow(2 + i).values = [`PESSOA ${i}`, '52998224725'];
    });
    expect((await parseEmployeeSheet(buf)).formatError).toMatch(/2000/);
  });

  it('células distantes (XFD2, A5000) não estouram memória nem tempo', async () => {
    const buf = await build((ws) => {
      modelSheet(ws, [[1, 'ANA FICTICIA', '', '529.982.247-25', '', '', '', '', '', '']]);
      ws.getCell('XFD2').value = 'x';
      ws.getCell('A5000').value = 'y';
    });
    const t0 = Date.now();
    const res = await parseEmployeeSheet(buf);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(res.rows.map((r) => r.line)).toContain(10);
  });

  it('célula na última linha possível (A1048576) não estoura memória nem tempo', async () => {
    const buf = await build((ws) => {
      modelSheet(ws, [[1, 'ANA FICTICIA', '', '529.982.247-25', '', '', '', '', '', '']]);
      ws.getCell('A1048576').value = 'z';
    });
    const t0 = Date.now();
    const res = await parseEmployeeSheet(buf);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(res.rows.map((r) => r.line)).toContain(10);
  });

  it('exatamente 2000 linhas de dados é aceito', async () => {
    const buf = await build((ws) => {
      ws.getRow(1).values = ['Nome', 'CPF'];
      for (let i = 0; i < 2000; i++) ws.getRow(2 + i).values = [`PESSOA ${i}`, '52998224725'];
    });
    const res = await parseEmployeeSheet(buf);
    expect(res.formatError).toBeUndefined();
    expect(res.rows).toHaveLength(2000);
  });

  it('linha só com caractere invisível é ignorada e cabeçalho com ZWSP é reconhecido', async () => {
    const buf = await build((ws) => {
      ws.getRow(1).values = ['Nome\u200B', 'CPF'];
      ws.getRow(2).values = ['\u200B', '\u200B'];
      ws.getRow(3).values = ['FULANA FICTICIA', '52998224725'];
    });
    const res = await parseEmployeeSheet(buf);
    expect(res.formatError).toBeUndefined();
    expect(res.rows.map((r) => r.line)).toEqual([3]);
  });

  it('linha com uma única coluna preenchida (nome) continua sendo dado', async () => {
    const buf = await build((ws) => {
      ws.getRow(1).values = ['Nome', 'CPF', 'Cargo'];
      ws.getRow(2).values = ['SO NOME FICTICIO'];
    });
    const res = await parseEmployeeSheet(buf);
    expect(res.rows).toEqual([{ line: 2, values: { full_name: 'SO NOME FICTICIO' } }]);
  });

  it('rich text, fórmula com result e hyperlink viram texto', async () => {
    const buf = await build((ws) => {
      ws.getRow(1).values = ['Nome', 'CPF', 'Cargo', 'CBO'];
      ws.getCell('A2').value = { richText: [{ text: 'GILDA ' }, { text: 'FICTICIA' }] };
      ws.getCell('B2').value = { formula: 'A1', result: '52998224725' } as ExcelJS.CellFormulaValue;
      ws.getCell('C2').value = { text: 'AUXILIAR', hyperlink: 'http://exemplo.invalid' };
      ws.getCell('D2').value = { formula: '1+1', result: 2 } as ExcelJS.CellFormulaValue;
    });
    const res = await parseEmployeeSheet(buf);
    expect(res.rows[0].values).toEqual({ full_name: 'GILDA FICTICIA', cpf: '52998224725', position: 'AUXILIAR', cbo_code: '2' });
  });

  it('arquivo acima de 3 MB devolve formatError sem tocar no exceljs', async () => {
    const res = await parseEmployeeSheet(Buffer.alloc(3 * 1024 * 1024 + 1));
    expect(res.formatError).toMatch(/muito grande/i);
  });
});
