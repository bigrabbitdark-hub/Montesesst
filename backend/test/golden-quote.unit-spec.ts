import { checkEvidence, chunkContainsItemHeading, normalizeForQuote } from '../eval/golden/quote';

// Trecho REAL da NR-35 vigente (35.4.1), com as quebras de linha do PDF, e o
// sumário que antecede o texto nas NRs — o "35.4 Capacitação e treinamento"
// do sumário não pode ser confundido com a seção de verdade.
const NR35_TEXT = [
  'Sumário',
  '35.4 Capacitação e treinamento',
  '35.5 Planejamento',
  '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela',
  'organização.',
  '35.4.1.1 Considera-se trabalhador autorizado para trabalho em altura aquele capacitado cujo',
  'estado de saúde foi avaliado, tendo sido considerado apto para executar suas atividades.',
].join('\n');

describe('normalizeForQuote (unit)', () => {
  it('colapsa quebras de linha e espaços em um espaço só', () => {
    expect(normalizeForQuote('pela\n  organização.\n\n')).toBe('pela organização.');
  });

  it('troca espaço sem quebra (NBSP) por espaço comum e remove hífen suave', () => {
    const nbsp = String.fromCharCode(160);
    const softHyphen = String.fromCharCode(173);
    expect(normalizeForQuote(`trabalho${nbsp}em al${softHyphen}tura`)).toBe('trabalho em altura');
  });

  it('hífen no fim da linha é mantido e a linha seguinte é juntada (fiel ao PDF)', () => {
    expect(normalizeForQuote('o gru-\npo de trabalho')).toBe('o gru-po de trabalho');
  });
});

describe('checkEvidence (unit)', () => {
  it('aceita uma citação literal que começa pelo item, mesmo atravessando quebra de linha', () => {
    const result = checkEvidence(
      NR35_TEXT,
      '35.4.1',
      '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização.',
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejeita evidência que não começa pelo número do item', () => {
    const result = checkEvidence(
      NR35_TEXT,
      '35.4.1',
      'Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização.',
    );
    expect(result).toEqual({ ok: false, reason: 'evidencia_nao_comeca_pelo_item' });
  });

  it('rejeita linha do sumário: só o número e o título não são citação', () => {
    const result = checkEvidence(NR35_TEXT, '35.4', '35.4 Capacitação e treinamento');
    expect(result).toEqual({ ok: false, reason: 'evidencia_curta_demais' });
  });

  it('rejeita citação que não existe no texto vigente', () => {
    const result = checkEvidence(
      NR35_TEXT,
      '35.4.1',
      '35.4.1 Todo trabalho em altura deve ser realizado somente por engenheiro de segurança do trabalho.',
    );
    expect(result).toEqual({ ok: false, reason: 'evidencia_nao_encontrada' });
  });

  it('rejeita citação que atravessa a quebra de página (marcador e cabeçalho do DOU no meio do item)', () => {
    const paginado = [
      '6.5.1 Cabe à organização, quanto ao EPI:',
      'c) fornecer ao empregado, gratuitamente, EPI adequado ao risco, nas situações previstas',
      '-- 2 of 12 --Este texto não substitui o publicado no DOU',
      'no subitem 1.5.5.1.2 da Norma.',
    ].join('\n');
    const suja = '6.5.1 Cabe à organização, quanto ao EPI: c) fornecer ao empregado, gratuitamente, EPI adequado ao risco, nas situações previstas -- 2 of 12 --Este texto não substitui o publicado no DOU no subitem 1.5.5.1.2 da Norma.';
    expect(checkEvidence(paginado, '6.5.1', suja)).toEqual({ ok: false, reason: 'evidencia_com_marcador_de_pagina' });
    const limpa = '6.5.1 Cabe à organização, quanto ao EPI: c) fornecer ao empregado, gratuitamente, EPI adequado ao risco, nas situações previstas';
    expect(checkEvidence(paginado, '6.5.1', limpa)).toEqual({ ok: true });
  });

  it('a normalização vale para os dois lados: espaços duplos na evidência não atrapalham', () => {
    const result = checkEvidence(
      NR35_TEXT,
      '35.4.1.1',
      '35.4.1.1  Considera-se trabalhador autorizado para trabalho em altura aquele capacitado cujo estado de saúde foi avaliado',
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('chunkContainsItemHeading (unit)', () => {
  it('reconhece o título do item no começo de uma linha do trecho', () => {
    expect(chunkContainsItemHeading('texto anterior\n35.4.1 Todo trabalho em altura', '35.4.1')).toBe(true);
  });

  it('reconhece o título no começo do próprio trecho', () => {
    expect(chunkContainsItemHeading('35.4.1 Todo trabalho em altura', '35.4.1')).toBe(true);
  });

  it('uma simples menção ao item no meio do texto não conta', () => {
    expect(chunkContainsItemHeading('conforme o item 35.4.1 desta norma', '35.4.1')).toBe(false);
  });

  it('35.4.1 não casa com o título do item 35.4.10', () => {
    expect(chunkContainsItemHeading('\n35.4.10 Outro assunto', '35.4.1')).toBe(false);
  });

  it('trecho que começa depois do número (título cortado) não contém o item', () => {
    expect(chunkContainsItemHeading(' Todo trabalho em altura deve ser realizado', '35.4.1')).toBe(false);
  });
});
