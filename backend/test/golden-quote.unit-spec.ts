import { checkEvidence, chunkContainsItemHeading, escapeRegExp, normalizeForQuote } from '../eval/golden/quote';

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

  it('CRLF e CR solto viram LF antes das demais regras: o hífen no fim da linha se junta igual', () => {
    const comLf = normalizeForQuote('o gru-\npo');
    expect(comLf).toBe('o gru-po');
    expect(normalizeForQuote('o gru-\r\npo')).toBe(comLf);
    expect(normalizeForQuote('o gru-\rpo')).toBe(comLf);
  });

  it('acento decomposto (letra + acento combinante) é composto de volta (NFC)', () => {
    // Construído com códigos de caractere para não depender de como o editor grava o arquivo.
    const decomposto = String.fromCharCode(0x61, 0x301);
    const composto = String.fromCharCode(0xe1);
    expect(decomposto).toHaveLength(2);
    expect(composto).toHaveLength(1);
    expect(normalizeForQuote(decomposto)).toBe(composto);
  });
});

describe('escapeRegExp (unit)', () => {
  it.each(['.', '*', '+', '(', '[', '\\'])('escapa o metacaractere %s para casar literalmente', (meta) => {
    const escapado = escapeRegExp(meta);
    expect(escapado).toBe(`\\${meta}`);
    expect(new RegExp(`^${escapado}$`).test(meta)).toBe(true);
  });

  it('em um item real, o ponto passa a casar só o ponto', () => {
    expect(escapeRegExp('35.4.1')).toBe('35\\.4\\.1');
    expect(new RegExp(escapeRegExp('35.4.1')).test('35x4x1')).toBe(false);
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

  // O que este teste prova é só o PISO de 30 caracteres de texto além do número
  // do item: ele barra a linha CURTA do sumário. Uma linha longa de sumário
  // (título comprido, ou título com pontilhado e número de página) passaria por
  // esse piso; a detecção de sumário mais forte fica para o lint da Task 4.
  it('piso de 30 caracteres: rejeita linha curta do sumário (número e título curto), mas não linha longa', () => {
    const result = checkEvidence(NR35_TEXT, '35.4', '35.4 Capacitação e treinamento');
    expect(result).toEqual({ ok: false, reason: 'evidencia_curta_demais' });
  });

  it('fronteira do piso: 30 caracteres de texto depois do item passam e 29 não', () => {
    const texto = 'abcdefghij'.repeat(3);
    expect(texto).toHaveLength(30);
    const documento = `Sumário\n35.4.1 ${texto}\n35.5 Planejamento`;
    expect(checkEvidence(documento, '35.4.1', `35.4.1 ${texto}`)).toEqual({ ok: true });
    expect(checkEvidence(documento, '35.4.1', `35.4.1 ${texto.slice(0, 29)}`)).toEqual({
      ok: false,
      reason: 'evidencia_curta_demais',
    });
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

  describe('limite à esquerda: a citação precisa começar num item de verdade, não no meio de um número', () => {
    const NAO_ENCONTRADA = { ok: false, reason: 'evidencia_nao_encontrada' };
    const CORPO = 'Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado.';

    it('item 4.1 não casa com o sufixo de 35.4.1', () => {
      expect(checkEvidence(`35.4.1 ${CORPO}`, '4.1', `4.1 ${CORPO}`)).toEqual(NAO_ENCONTRADA);
    });

    it('item 35.4.1 não casa com 135.4.1', () => {
      expect(checkEvidence(`135.4.1 ${CORPO}`, '35.4.1', `35.4.1 ${CORPO}`)).toEqual(NAO_ENCONTRADA);
    });

    it('item "1." não casa com o final de "11." (estilo dos anexos da NR-15)', () => {
      const corpo = 'Os limites de tolerância para ruído contínuo ou intermitente são os do quadro.';
      expect(checkEvidence(`11. ${corpo}`, '1.', `1. ${corpo}`)).toEqual(NAO_ENCONTRADA);
    });

    it('item colado ao marcador de página continua válido (o pdf-parse junta o cabeçalho ao marcador)', () => {
      const documento = ['35.3 Algum assunto anterior que termina aqui', '-- 2 of 12 --', `35.4.1 ${CORPO}`].join('\n\n');
      // Depois da normalização o documento fica "… -- 2 of 12 --35.4.1 Todo trabalho …".
      expect(normalizeForQuote(documento)).toContain('-- 2 of 12 --35.4.1 Todo');
      expect(checkEvidence(documento, '35.4.1', `35.4.1 ${CORPO}`)).toEqual({ ok: true });
    });

    it('item no início do documento é válido', () => {
      expect(checkEvidence(`35.4.1 ${CORPO}\nresto do texto`, '35.4.1', `35.4.1 ${CORPO}`)).toEqual({ ok: true });
    });

    it('item logo depois de uma quebra de linha é válido', () => {
      expect(checkEvidence(`35.3 Anterior\n35.4.1 ${CORPO}`, '35.4.1', `35.4.1 ${CORPO}`)).toEqual({ ok: true });
    });

    it('percorre todas as ocorrências: uma ocorrência ruim antes de uma boa não reprova', () => {
      // A primeira ocorrência de "4.1 Todo …" está dentro de "35.4.1 Todo …" (ruim); a segunda, depois da quebra, é boa.
      const documento = `35.4.1 ${CORPO}\n4.1 ${CORPO}`;
      expect(documento.indexOf(`4.1 ${CORPO}`)).toBeLessThan(documento.lastIndexOf(`4.1 ${CORPO}`));
      expect(checkEvidence(documento, '4.1', `4.1 ${CORPO}`)).toEqual({ ok: true });
    });
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

  it('o ponto do número do item é literal: 35.4.1 não casa com 35x4x1', () => {
    expect(chunkContainsItemHeading('\n35x4x1 texto', '35.4.1')).toBe(false);
  });
});
