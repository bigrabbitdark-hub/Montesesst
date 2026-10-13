import {
  addMonths,
  diffDays,
  documentSituation,
  isDateOnly,
  toDateOnly,
  todayDateOnly,
  type DateOnly,
} from '../src/common/dates/date-only';

describe('isDateOnly', () => {
  it('aceita datas válidas', () => {
    expect(isDateOnly('2026-01-15')).toBe(true);
    expect(isDateOnly('2024-02-29')).toBe(true); // 2024 é bissexto
    expect(isDateOnly('2028-02-29')).toBe(true); // 2028 é bissexto
    expect(isDateOnly('2026-12-31')).toBe(true);
  });

  it('rejeita 29 de fevereiro em ano não bissexto', () => {
    expect(isDateOnly('2025-02-29')).toBe(false);
    expect(isDateOnly('2026-02-29')).toBe(false);
    expect(isDateOnly('2027-02-29')).toBe(false);
  });

  it('rejeita mês inválido', () => {
    expect(isDateOnly('2026-00-15')).toBe(false);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('2026-99-15')).toBe(false);
  });

  it('rejeita dia inexistente no mês', () => {
    expect(isDateOnly('2026-04-31')).toBe(false); // abril tem 30
    expect(isDateOnly('2026-02-30')).toBe(false);
    expect(isDateOnly('2026-02-31')).toBe(false);
    expect(isDateOnly('2026-06-31')).toBe(false); // junho tem 30
  });

  it('rejeita dia zero ou acima de 31', () => {
    expect(isDateOnly('2026-01-00')).toBe(false);
    expect(isDateOnly('2026-01-32')).toBe(false);
  });

  it('rejeita strings com hora, fuso ou lixo', () => {
    expect(isDateOnly('2026-01-15T00:00:00Z')).toBe(false);
    expect(isDateOnly('2026-01-15T03:00:00-03:00')).toBe(false);
    expect(isDateOnly('2026-01-15 00:00:00')).toBe(false);
    expect(isDateOnly(' 2026-01-15')).toBe(false);
    expect(isDateOnly('2026-01-15 ')).toBe(false);
    expect(isDateOnly('2026-1-15')).toBe(false);
    expect(isDateOnly('2026-01-5')).toBe(false);
    expect(isDateOnly('26-01-15')).toBe(false);
    expect(isDateOnly('')).toBe(false);
  });

  it('rejeita tipos não-string', () => {
    expect(isDateOnly(null)).toBe(false);
    expect(isDateOnly(undefined)).toBe(false);
    expect(isDateOnly(new Date('2026-01-15'))).toBe(false);
    expect(isDateOnly(20260115)).toBe(false);
    expect(isDateOnly({})).toBe(false);
  });
});

describe('toDateOnly', () => {
  it('devolve null para null/undefined', () => {
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly(undefined)).toBeNull();
  });

  it('devolve a string inalterada quando já é date-only válida', () => {
    expect(toDateOnly('2026-03-15')).toBe('2026-03-15');
    expect(toDateOnly('2024-02-29')).toBe('2024-02-29');
  });

  it('extrai a parte UTC de Date à meia-noite vinda do pg', () => {
    // new Date('2026-01-15') é meia-noite UTC; getUTC* devolve o dia certo.
    expect(toDateOnly(new Date('2026-01-15T00:00:00.000Z'))).toBe('2026-01-15');
    expect(toDateOnly(new Date(Date.UTC(2024, 1, 29)))).toBe('2024-02-29');
    expect(toDateOnly(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-12-31');
  });

  it('extrai a data de string ISO completa sem deslocar pelo fuso', () => {
    // 2026-07-15T01:00:00Z → meia-noite de 14/jul em SP, mas o dia UTC é 15.
    // Pegamos o prefixo da data na string, antes do T, justamente pra não
    // depender de fuso nem confundir com 'YYYY-MM-DD' UTC.
    expect(toDateOnly('2026-07-15T01:00:00Z')).toBe('2026-07-15');
    expect(toDateOnly('2024-02-29T03:00:00.000-03:00')).toBe('2024-02-29');
    expect(toDateOnly('2026-01-31T23:59:59-03:00')).toBe('2026-01-31');
  });

  it('lança erro para string fora do formato', () => {
    expect(() => toDateOnly('15/01/2026')).toThrow();
    expect(() => toDateOnly('ontem')).toThrow();
    expect(() => toDateOnly(123 as unknown as string)).toThrow();
  });

  it('lança erro para Date inválida', () => {
    expect(() => toDateOnly(new Date('não é data'))).toThrow();
  });
});

describe('addMonths', () => {
  const cases: Array<[DateOnly, number, DateOnly]> = [
    // Casos exigidos pelo briefing.
    ['2024-02-29', 12, '2025-02-28'],
    ['2024-02-29', 48, '2028-02-29'],
    ['2026-01-31', 1, '2026-02-28'],
    ['2026-08-31', 6, '2027-02-28'],
    ['2026-03-15', 12, '2027-03-15'],
    ['2026-03-15', 24, '2028-03-15'],
    ['2025-12-31', 2, '2026-02-28'],
    // Casos adicionais pra endurecer a clampagem.
    ['2024-02-29', 24, '2026-02-28'], // ano não bissexto após 24 meses
    ['2026-05-31', 1, '2026-06-30'],
    ['2026-01-01', 1, '2026-02-01'],
    ['2026-12-15', 1, '2027-01-15'],
    ['2026-12-31', 13, '2028-01-31'],
  ];

  it.each(cases)('%s + %i meses = %s', (origem, meses, esperado) => {
    expect(addMonths(origem, meses)).toBe(esperado);
  });

  it('aceita os extremos do limite (1 e 600)', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
    // 600 meses = 50 anos, dia 15 continua existindo em 2076 (bissexto, sim).
    expect(addMonths('2026-01-15', 600)).toBe('2076-01-15');
  });

  it('lança erro para meses fora de [1, 600]', () => {
    expect(() => addMonths('2026-01-15', 0)).toThrow();
    expect(() => addMonths('2026-01-15', 601)).toThrow();
    expect(() => addMonths('2026-01-15', -1)).toThrow();
    expect(() => addMonths('2026-01-15', 12.5)).toThrow();
    expect(() => addMonths('2026-01-15', Number.NaN)).toThrow();
  });

  it('lança erro para data de origem inválida', () => {
    expect(() => addMonths('2025-02-29', 12)).toThrow();
    expect(() => addMonths('', 12)).toThrow();
  });
});

describe('diffDays', () => {
  it('devolve 0 para o mesmo dia', () => {
    expect(diffDays('2026-01-15', '2026-01-15')).toBe(0);
  });

  it('conta dias atravessando o mês', () => {
    expect(diffDays('2026-01-30', '2026-02-05')).toBe(6);
    expect(diffDays('2026-02-27', '2026-03-01')).toBe(2);
  });

  it('conta dias atravessando o ano', () => {
    expect(diffDays('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('devolve negativo quando to < from', () => {
    expect(diffDays('2026-01-15', '2026-01-10')).toBe(-5);
  });

  it('não é afetado pelo fuso da máquina (usa UTC nas duas pontas)', () => {
    // Só pra documentar: o cálculo é puramente UTC, então o teste não
    // depende de TZ nem de horário de verão.
    expect(diffDays('2024-03-01', '2024-03-02')).toBe(1);
  });

  it('lança erro para datas inválidas', () => {
    expect(() => diffDays('invalida', '2026-01-15')).toThrow();
    expect(() => diffDays('2026-01-15', '2025-02-29')).toThrow();
  });
});

describe('documentSituation', () => {
  const HOJE = '2026-10-01';

  it('sem data de vencimento → sem_vencimento', () => {
    expect(documentSituation(null, HOJE, 30)).toBe('sem_vencimento');
  });

  it('ontem → vencido', () => {
    expect(documentSituation('2026-09-30', HOJE, 30)).toBe('vencido');
  });

  it('hoje → vencendo (ainda não venceu)', () => {
    expect(documentSituation(HOJE, HOJE, 30)).toBe('vencendo');
  });

  it('hoje + alertDays → ainda vencendo (limite incluso)', () => {
    expect(documentSituation('2026-10-31', HOJE, 30)).toBe('vencendo');
  });

  it('hoje + alertDays + 1 → valido (passou da janela)', () => {
    expect(documentSituation('2026-11-01', HOJE, 30)).toBe('valido');
  });

  it('alertDays=0: vencer hoje ainda é vencendo, amanhã já é valido', () => {
    expect(documentSituation(HOJE, HOJE, 0)).toBe('vencendo');
    expect(documentSituation('2026-10-02', HOJE, 0)).toBe('valido');
  });

  it('lança erro para alertDays inválido', () => {
    expect(() => documentSituation('2026-10-15', HOJE, -1)).toThrow();
    expect(() => documentSituation('2026-10-15', HOJE, 1.5)).toThrow();
  });
});

describe('todayDateOnly', () => {
  it('devolve a data no fuso de São Paulo quando UTC ainda está no dia anterior', () => {
    // 2026-07-15T02:00Z → SP (UTC-3, sem DST desde 2019) = 2026-07-14 23:00.
    // Em SP é 14/jul, em UTC é 15/jul.
    const instant = new Date('2026-07-15T02:00:00.000Z');
    expect(todayDateOnly(instant, 'America/Sao_Paulo')).toBe('2026-07-14');
    // Sanity check: confirmamos que em UTC o dia seria outro.
    expect(todayDateOnly(instant, 'UTC')).toBe('2026-07-15');
  });

  it('devolve a data no fuso de São Paulo quando UTC já virou o próximo dia', () => {
    // 2026-07-15T05:00Z → SP = 2026-07-15 02:00. Mesmo dia nos dois fusos.
    const instant = new Date('2026-07-15T05:00:00.000Z');
    expect(todayDateOnly(instant, 'America/Sao_Paulo')).toBe('2026-07-15');
  });

  it('devolve a mesma data sem depender do fuso da máquina quando o instante não cruza meia-noite em nenhum fuso comum', () => {
    const instant = new Date('2026-01-15T12:00:00.000Z');
    expect(todayDateOnly(instant, 'America/Sao_Paulo')).toBe('2026-01-15');
    expect(todayDateOnly(instant, 'UTC')).toBe('2026-01-15');
  });

  it('usa America/Sao_Paulo como fuso padrão', () => {
    const instant = new Date('2026-07-15T02:00:00.000Z');
    expect(todayDateOnly(instant)).toBe('2026-07-14');
  });

  it('lança erro para Date inválida', () => {
    expect(() => todayDateOnly(new Date('não é data'))).toThrow();
  });
});
