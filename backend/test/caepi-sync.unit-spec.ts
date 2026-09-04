// Testes unitários puros pra `backend/db/caepi-sync.ts` — SEM rede, SEM
// banco, SEM FTP. Cobre as funções mais arriscadas do sync (validação de
// contagem de coluna, tolerância a truncamento, semântica de dedup) com
// fixtures sintéticas construídas aqui mesmo, não dado real baixado.
//
// Roda com `npm run test:unit` (config em `test/jest-unit.json`, testRegex
// `.unit-spec.ts$` — mesmo padrão já usado por `test/jest-e2e.json` com
// `.e2e-spec.ts$`, só que apontando pra este arquivo em vez dos specs e2e).
import { dedupeByNumeroCa, parseBrDate, parseCaepiText } from '../db/caepi-sync';

// 19 colunas — mesma ordem de EXPECTED_COLUMNS em caepi-sync.ts:
// numero_ca|data_validade|situacao|numero_processo|cnpj|razao_social|
// natureza|equipamento|descricao_equipamento|marca_ca|referencia|cor|
// aprovado_laudo|restricao_laudo|observacao_laudo|cnpj_laboratorio|
// razao_social_laboratorio|numero_laudo|norma
function fixtureLine(numeroCa: string, opts: Partial<Record<string, string>> = {}): string {
  const cols = [
    numeroCa,
    opts.data_validade ?? '01/03/2027',
    opts.situacao ?? 'VÁLIDO',
    opts.numero_processo ?? 'PROC-1',
    opts.cnpj ?? '11222333000181',
    opts.razao_social ?? 'FABRICANTE TESTE LTDA',
    opts.natureza ?? 'EQUIPAMENTO',
    opts.equipamento ?? 'CAPACETE',
    opts.descricao_equipamento ?? 'CAPACETE DE SEGURANÇA CLASSE A',
    opts.marca_ca ?? 'MARCA X',
    opts.referencia ?? 'REF-1',
    opts.cor ?? 'BRANCO',
    opts.aprovado_laudo ?? 'SIM',
    opts.restricao_laudo ?? '',
    opts.observacao_laudo ?? '',
    opts.cnpj_laboratorio ?? '99888777000166',
    opts.razao_social_laboratorio ?? 'LABORATORIO TESTE LTDA',
    opts.numero_laudo ?? 'LAUDO-1',
    opts.norma ?? 'NR-06',
  ];
  return cols.join('|');
}

const HEADER =
  'NR Registro CA|DATA DE VALIDADE|SITUACAO|NR DO PROCESSO|CNPJ|RAZAO SOCIAL|NATUREZA|EQUIPAMENTO|' +
  'DESCRICAO EQUIPAMENTO|MARCA CA|REFERENCIA|COR|APROVADO PARA LAUDO|RESTRICAO LAUDO|' +
  'OBSERVACAO ANALISE LAUDO|CNPJ LABORATORIO|RAZAO SOCIAL LABORATORIO|NR LAUDO|NORMA';

function buf(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'utf8');
}

describe('parseCaepiText', () => {
  it('parseia corretamente um input multi-linha bem formado', () => {
    const raw = buf([
      HEADER,
      fixtureLine('10001', { data_validade: '01/03/2027', situacao: 'VÁLIDO', descricao_equipamento: 'DESC A', norma: 'NR-06' }),
      fixtureLine('10002', { data_validade: '15/12/2026', situacao: 'VENCIDO', descricao_equipamento: 'DESC B', norma: 'NR-11' }),
    ]);

    const { rows, skipped } = parseCaepiText(raw);

    expect(skipped).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      numero_ca: '10001',
      data_validade: '2027-03-01',
      situacao: 'VÁLIDO',
      descricao_equipamento: 'DESC A',
      norma: 'NR-06',
    });
    expect(rows[1]).toMatchObject({
      numero_ca: '10002',
      data_validade: '2026-12-15',
      situacao: 'VENCIDO',
      descricao_equipamento: 'DESC B',
      norma: 'NR-11',
    });
  });

  it('pula (não lança) uma linha final com contagem de coluna errada — truncamento no fim do arquivo', () => {
    const goodLine = fixtureLine('10001');
    // Linha final cortada no meio: só os 17 primeiros campos, sem o
    // separador final e sem numero_laudo/norma — simula exatamente o
    // truncamento documentado na origem (MTE corta o arquivo no meio
    // de um registro).
    const truncatedLine = goodLine.split('|').slice(0, 17).join('|');
    const raw = buf([HEADER, goodLine, truncatedLine]);

    const { rows, skipped } = parseCaepiText(raw);

    expect(rows).toHaveLength(1);
    expect(rows[0].numero_ca).toBe('10001');
    expect(skipped).toBe(1);
  });

  it('pula linhas em branco/vazias sem lançar e sem contar como "skipped"', () => {
    const raw = buf([HEADER, '', fixtureLine('10001'), '   ', fixtureLine('10002')]);

    const { rows, skipped } = parseCaepiText(raw);

    // Linhas em branco não produzem registro, mas também não são
    // "malformadas" — o contador skipped é reservado pra contagem de
    // coluna errada (ver implementação: `if (!line.trim()) continue;`
    // roda antes da checagem de coluna, sem incrementar skipped).
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.numero_ca)).toEqual(['10001', '10002']);
    expect(skipped).toBe(0);
  });

  it('pula uma linha no meio do arquivo com separador "|" faltando (poucas colunas)', () => {
    const raw = buf([
      HEADER,
      fixtureLine('10001'),
      'LINHA QUEBRADA|SO|TRES|CAMPOS',
      fixtureLine('10002'),
    ]);

    const { rows, skipped } = parseCaepiText(raw);

    expect(rows.map((r) => r.numero_ca)).toEqual(['10001', '10002']);
    expect(skipped).toBe(1);
  });

  it('pula uma linha com separador "|" extra (colunas a mais)', () => {
    const tooManyFields = `${fixtureLine('10003')}|CAMPO EXTRA INESPERADO`;
    const raw = buf([HEADER, fixtureLine('10001'), tooManyFields, fixtureLine('10002')]);

    const { rows, skipped } = parseCaepiText(raw);

    expect(rows.map((r) => r.numero_ca)).toEqual(['10001', '10002']);
    expect(skipped).toBe(1);
  });
});

describe('parseBrDate', () => {
  it('parseia uma data válida DD/MM/AAAA pra AAAA-MM-DD', () => {
    expect(parseBrDate('01/03/2027')).toBe('2027-03-01');
    expect(parseBrDate('31/12/2026')).toBe('2026-12-31');
  });

  it('devolve null pra dia de mês inválido (30/02) em vez de deixar o Date "rolar" pro mês seguinte', () => {
    expect(parseBrDate('30/02/2025')).toBeNull();
  });

  it('devolve null pra 31 de abril (mês com só 30 dias)', () => {
    expect(parseBrDate('31/04/2025')).toBeNull();
  });

  it('devolve null pra componentes fora de qualquer faixa de calendário (99/99/9999)', () => {
    expect(parseBrDate('99/99/9999')).toBeNull();
  });

  it('devolve null pra formato malformado (separador errado, não-numérico, vazio)', () => {
    expect(parseBrDate('2025-03-01')).toBeNull();
    expect(parseBrDate('AB/CD/EFGH')).toBeNull();
    expect(parseBrDate('')).toBeNull();
    expect(parseBrDate('   ')).toBeNull();
    expect(parseBrDate('01/03/27')).toBeNull(); // ano com 2 dígitos, fora do formato esperado
  });

  it('aceita 29/02 em ano bissexto e rejeita em ano não-bissexto', () => {
    expect(parseBrDate('29/02/2024')).toBe('2024-02-29'); // 2024 é bissexto
    expect(parseBrDate('29/02/2025')).toBeNull(); // 2025 não é
  });
});

describe('dedupeByNumeroCa', () => {
  function row(numeroCa: string, marker: string) {
    return {
      numero_ca: numeroCa,
      data_validade: null,
      situacao: marker,
      numero_processo: null,
      cnpj: null,
      razao_social: null,
      natureza: null,
      equipamento: null,
      descricao_equipamento: null,
      marca_ca: null,
      referencia: null,
      cor: null,
      aprovado_laudo: null,
      restricao_laudo: null,
      observacao_laudo: null,
      cnpj_laboratorio: null,
      razao_social_laboratorio: null,
      numero_laudo: null,
      norma: null,
    };
  }

  it('mantém a ÚLTIMA ocorrência de cada numero_ca duplicado, na ordem do arquivo', () => {
    const rows = [
      row('A', 'primeira-A'),
      row('B', 'unica-B'),
      row('A', 'segunda-A'),
      row('A', 'terceira-e-ultima-A'),
    ];

    const { deduped, duplicates } = dedupeByNumeroCa(rows);

    const entryA = deduped.find((r) => r.numero_ca === 'A');
    expect(entryA?.situacao).toBe('terceira-e-ultima-A');
    expect(duplicates).toBe(2); // 3 linhas de A viraram 1 -> 2 duplicatas descartadas
  });

  it('devolve exatamente uma entrada por numero_ca distinto', () => {
    const rows = [row('A', '1'), row('B', '1'), row('A', '2'), row('C', '1'), row('B', '2')];

    const { deduped, duplicates } = dedupeByNumeroCa(rows);

    expect(deduped).toHaveLength(3);
    expect(deduped.map((r) => r.numero_ca).sort()).toEqual(['A', 'B', 'C']);
    expect(duplicates).toBe(2);
  });

  it('sem duplicatas, devolve as mesmas linhas e duplicates === 0', () => {
    const rows = [row('A', '1'), row('B', '1'), row('C', '1')];

    const { deduped, duplicates } = dedupeByNumeroCa(rows);

    expect(deduped).toHaveLength(3);
    expect(duplicates).toBe(0);
  });
});
