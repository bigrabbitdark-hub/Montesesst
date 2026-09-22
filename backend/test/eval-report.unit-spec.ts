import { blocksContaining, blocksWithPrefix, splitIntoItemBlocks } from '../eval/golden/nr-blocks';
import { checkEvidence } from '../eval/golden/quote';
import { AnswerResult, RetrievalResult } from '../eval/metrics';
import {
  BaselineMeta,
  buildAnswerBaseline,
  buildRetrievalBaseline,
  datasetHash,
  describeMetaDifferences,
  formatAnswerSummary,
  formatRetrievalSummary,
  ratio,
  renderReviewMarkdown,
} from '../eval/report';

const NR35_TEXT = [
  'Sumário',
  '35.4 Capacitação e treinamento',
  '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela',
  'organização.',
  '35.4.1.1 Considera-se trabalhador autorizado para trabalho em altura aquele capacitado cujo',
  'estado de saúde foi avaliado.',
  'a) as atividades que serão desenvolvidas pelo trabalhador;',
  '35.5.1 Outro assunto qualquer da norma.',
].join('\n');

describe('splitIntoItemBlocks / blocksWithPrefix (unit)', () => {
  it('cada bloco começa numa linha com número de item e junta as continuações e alíneas', () => {
    const blocks = splitIntoItemBlocks(NR35_TEXT);
    expect(blocks.map((b) => b.item)).toEqual(['35.4', '35.4.1', '35.4.1.1', '35.5.1']);
    expect(blocks[1].text).toBe(
      '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização.',
    );
    expect(blocks[2].text).toContain('estado de saúde foi avaliado. a) as atividades que serão desenvolvidas pelo trabalhador;');
  });

  it('o texto antes do primeiro item ("Sumário") é descartado', () => {
    expect(splitIntoItemBlocks(NR35_TEXT).some((b) => b.text.includes('Sumário'))).toBe(false);
  });

  it('a linha do sumário vira um bloco curto, distinguível do item de verdade', () => {
    const [sumario, item] = splitIntoItemBlocks(NR35_TEXT);
    expect(sumario.text).toBe('35.4 Capacitação e treinamento');
    expect(item.text.length).toBeGreaterThan(sumario.text.length);
  });

  it('blocksWithPrefix filtra pelo item e seus descendentes, sem casar 35.4 com 35.40', () => {
    const blocks = [...splitIntoItemBlocks(NR35_TEXT), ...splitIntoItemBlocks('35.40 Item com prefixo parecido e texto longo o bastante')];
    expect(blocksWithPrefix(blocks, '35.4').map((b) => b.item)).toEqual(['35.4', '35.4.1', '35.4.1.1']);
    expect(blocksWithPrefix(blocks, '35.5').map((b) => b.item)).toEqual(['35.5.1']);
  });
});

describe('splitIntoItemBlocks: formatos de cabeçalho do lint (unit)', () => {
  it('cabeçalho com ponto final ("35.4.1. Todo…") abre bloco e o item MANTÉM o ponto (convenção do lint)', () => {
    const blocks = splitIntoItemBlocks(
      ['35.4.1. Todo trabalho em altura deve ser realizado por trabalhador autorizado.', '35.4.2. Outro item da norma.'].join('\n'),
    );
    expect(blocks.map((b) => b.item)).toEqual(['35.4.1.', '35.4.2.']);
    expect(blocks[0].text).toBe('35.4.1. Todo trabalho em altura deve ser realizado por trabalhador autorizado.');
  });

  it('item de 1 nível só com ponto ("1. Os limites…") é item; número sem ponto ("35 Título") não é', () => {
    const blocks = splitIntoItemBlocks(['1. Os limites de tolerância aplicam-se a toda a atividade.', '35 Título solto', '2. Outro item.'].join('\n'));
    expect(blocks.map((b) => b.item)).toEqual(['1.', '2.']);
    // "35 Título solto" é continuação do bloco anterior, não um item.
    expect(blocks[0].text).toBe('1. Os limites de tolerância aplicam-se a toda a atividade. 35 Título solto');
  });

  it('linha indentada abre bloco, com ou sem ponto final', () => {
    const blocks = splitIntoItemBlocks(['   35.4.1 Item com indentação à esquerda.', '\t35.4.2. Item com tabulação.'].join('\n'));
    expect(blocks.map((b) => b.item)).toEqual(['35.4.1', '35.4.2.']);
  });

  it('blocksWithPrefix casa 35.4 com 35.4.1. (com ponto) e não com 35.40; prefixo com ponto final vale o mesmo', () => {
    const blocks = splitIntoItemBlocks(
      ['35.4 Título curto', '35.4.1. Item com ponto final e texto suficiente.', '35.40 Item de prefixo parecido.', '35.5.1 Outro.'].join('\n'),
    );
    expect(blocksWithPrefix(blocks, '35.4').map((b) => b.item)).toEqual(['35.4', '35.4.1.']);
    expect(blocksWithPrefix(blocks, '35.4.').map((b) => b.item)).toEqual(['35.4', '35.4.1.']);
    expect(blocksWithPrefix(blocks, '35.40').map((b) => b.item)).toEqual(['35.40']);
    expect(blocksWithPrefix(blocks, '')).toEqual([]);
  });

  it('blocksWithPrefix de item de 1 nível: "1" casa "1." e "1.1", não "10." nem "11"', () => {
    const blocks = splitIntoItemBlocks(['1. Item um com texto.', '1.1 Subitem com texto.', '10. Item dez com texto.', '11 Nada.'].join('\n'));
    expect(blocksWithPrefix(blocks, '1').map((b) => b.item)).toEqual(['1.', '1.1']);
  });
});

describe('splitIntoItemBlocks: roundtrip com checkEvidence do lint (unit)', () => {
  const SOFT_HYPHEN = String.fromCharCode(0x00ad);
  // Documento no estilo do pdf-parse: páginas separadas por "\n\n-- N of 12 --\n\n",
  // hífen de fim de linha, hífen-fantasma (categoria Cf) e o cabeçalho do DOU.
  const PAGES = [
    [
      'NR-35 - Trabalho em Altura',
      '35.1 Objetivo e campo de aplicação',
      '35.1.1 Esta Norma estabelece os requisitos mínimos e as medidas de pro-',
      'teção para o trabalho em altura, abrangendo o planejamento.',
      '35.1.2 Esta Norma se complementa com as normas técnicas oficiais vigentes.',
    ],
    [
      `35.4.1. Todo trabalho em altura deve ser realizado por trabalhador formalmente auto${SOFT_HYPHEN}rizado pela`,
      'organização.',
      '1. Os limites de tolerância indicados aplicam-se a toda a atividade.',
      '35.4.2 Outro item da norma, com texto suficiente para uma citação literal.',
    ],
    ['Este texto não substitui o publicado no DOU', '35.5.1 Outro assunto da norma, com texto suficiente para o teste.'],
  ].map((lines) => lines.join('\n'));
  const DOC = PAGES.map((page, i) => (i === 0 ? page : `\n\n-- ${i + 1} of 12 --\n\n${page}`)).join('');
  const blocks = splitIntoItemBlocks(DOC);
  const check = (item: string) => {
    const block = blocks.find((b) => b.item === item);
    expect(block).toBeDefined();
    return checkEvidence(DOC, item, block!.text);
  };

  it('o texto de um bloco que não cruza página e tem texto suficiente passa em checkEvidence (com ponto, de 1 nível, hifenizado)', () => {
    expect(blocks.map((b) => b.item)).toEqual(['35.1', '35.1.1', '35.1.2', '35.4.1.', '1.', '35.4.2', '35.5.1']);
    expect(check('35.1.1')).toEqual({ ok: true });
    expect(check('35.4.1.')).toEqual({ ok: true });
    expect(check('1.')).toEqual({ ok: true });
    expect(check('35.5.1')).toEqual({ ok: true });
  });

  it('as únicas falhas possíveis são as ressalvas conhecidas: marcador de página e bloco curto', () => {
    // Bloco que termina na quebra de página engole o marcador; a linha do sumário é curta.
    expect(check('35.1.2')).toEqual({ ok: false, reason: 'evidencia_com_marcador_de_pagina' });
    expect(check('35.4.2')).toEqual({ ok: false, reason: 'evidencia_com_marcador_de_pagina' });
    expect(check('35.1')).toEqual({ ok: false, reason: 'evidencia_curta_demais' });
    for (const block of blocks) {
      const result = checkEvidence(DOC, block.item, block.text);
      if (!result.ok) {
        expect(['evidencia_com_marcador_de_pagina', 'evidencia_curta_demais']).toContain(result.reason);
      }
    }
  });
});

describe('blocksContaining (unit)', () => {
  it('busca por termo sem acento e sem diferenciar maiúsculas', () => {
    const blocks = splitIntoItemBlocks(NR35_TEXT);
    expect(blocksContaining(blocks, 'ORGANIZACAO').map((b) => b.item)).toEqual(['35.4.1']);
    expect(blocksContaining(blocks, 'capacitado').map((b) => b.item)).toEqual(['35.4.1.1']);
  });

  it('termo que não aparece devolve lista vazia (é assim que se confirma a ausência de um assunto)', () => {
    expect(blocksContaining(splitIntoItemBlocks(NR35_TEXT), 'eSocial')).toEqual([]);
  });

  it('termo vazio ou só de espaços devolve lista vazia, não todos os blocos', () => {
    const blocks = splitIntoItemBlocks(NR35_TEXT);
    expect(blocksContaining(blocks, '')).toEqual([]);
    expect(blocksContaining(blocks, ' ')).toEqual([]);
    expect(blocksContaining(blocks, '  \t ')).toEqual([]);
  });

  it('acha a palavra hifenizada na quebra de linha ("trabalha-\\ndor") e ignora espaços duplos no termo', () => {
    // block.text vem de normalizeForQuote, que MANTÉM o hífen do fim de linha
    // ("trabalha-dor"; fiel ao PDF, sem adivinhar se era palavra composta). A
    // busca é que ignora o hífen, para não dar falso "a base não cobre".
    const blocks = splitIntoItemBlocks('35.4.2 O trabalha-\ndor deve ser capacitado antes de iniciar a atividade.\n35.4.3 Outro item.');
    expect(blocks[0].text).toContain('trabalha-dor');
    expect(blocksContaining(blocks, 'trabalhador').map((b) => b.item)).toEqual(['35.4.2']);
    expect(blocksContaining(blocks, 'trabalha-dor').map((b) => b.item)).toEqual(['35.4.2']);
    expect(blocksContaining(blocks, 'trabalhador   deve').map((b) => b.item)).toEqual(['35.4.2']);
    expect(blocksContaining(blocks, 'eSocial')).toEqual([]);
  });
});

const META: BaselineMeta = {
  layer: 'retrieval',
  gerado_em: '2026-09-21T12:00:00.000Z',
  commit: 'abc1234',
  dataset_sha256: 'x',
  questions: 2,
  threshold: 0.4,
  chunk_limit: 6,
  model: null,
  llm_calls: null,
  llm_tokens_delta: null,
};

function retrievalResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    id: 'NR35-001',
    tipo: 'conceitual',
    status: 'rascunho',
    acerto_nr: true,
    acerto_item: true,
    acerto_item_topk: true,
    melhor_similaridade: 0.6,
    falso_relevante: null,
    avisos_esperados: [],
    avisos_detectados: [],
    avisos_ok: true,
    passou: true,
    ...overrides,
  };
}

describe('report (unit)', () => {
  it('ratio mostra n/d e o percentual, ou traço quando não há denominador', () => {
    expect(ratio(3, 4)).toBe('3/4 (75%)');
    expect(ratio(0, 0)).toBe('0/0 (—)');
    // Arredonda (2/3 = 66,7%), não trunca.
    expect(ratio(2, 3)).toBe('2/3 (67%)');
  });

  it('datasetHash é um SHA-256 estável do conteúdo', () => {
    expect(datasetHash('a')).toBe(datasetHash('a'));
    expect(datasetHash('a')).not.toBe(datasetHash('b'));
    expect(datasetHash('a')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('baseline da Camada A separa geral, validado, rascunho e por tipo', () => {
    const baseline = buildRetrievalBaseline(META, [
      retrievalResult(),
      retrievalResult({ id: 'NR35-002', tipo: 'pegadinha', status: 'validado', passou: false, acerto_item: false }),
    ]);
    expect(baseline.agregados.geral.total).toBe(2);
    expect(baseline.agregados.validado.total).toBe(1);
    expect(baseline.agregados.validado.passou).toBe(0);
    expect(baseline.agregados.rascunho.passou).toBe(1);
    expect(Object.keys(baseline.agregados.por_tipo).sort()).toEqual(['conceitual', 'pegadinha']);
    expect(baseline.resultados).toHaveLength(2);
  });

  it('resumo da Camada A traz os números e o gate (validado) em linhas próprias', () => {
    const summary = formatRetrievalSummary(buildRetrievalBaseline(META, [retrievalResult()]));
    expect(summary).toContain('Camada A — recuperação e avisos (2 perguntas, limiar 0.4, top 6)');
    expect(summary).toContain('GERAL');
    expect(summary).toContain('validado (gate)');
    expect(summary).toContain('passou 1/1 (100%)');
    expect(summary).toContain('conceitual');
  });

  it('resumo da Camada A mostra cada métrica com o numerador e o denominador certos', () => {
    const summary = formatRetrievalSummary(
      buildRetrievalBaseline(META, [
        // Com fonte esperada: NR 3/3, item 1/3, item no top-k 2/3.
        retrievalResult({ id: 'NR35-001' }),
        retrievalResult({ id: 'NR35-002', tipo: 'pegadinha', status: 'validado', acerto_item: false, passou: false }),
        retrievalResult({ id: 'NR35-003', tipo: 'jurisdicional', acerto_item: false, acerto_item_topk: false, passou: false }),
        // Recusas (sem fonte esperada): falso relevante em 1 de 2.
        retrievalResult({
          id: 'NR35-004',
          tipo: 'sem_evidencia',
          acerto_nr: null,
          acerto_item: null,
          acerto_item_topk: null,
          falso_relevante: true,
          avisos_ok: false,
          passou: false,
        }),
        retrievalResult({
          id: 'NR35-005',
          tipo: 'sem_evidencia',
          acerto_nr: null,
          acerto_item: null,
          acerto_item_topk: null,
          falso_relevante: false,
        }),
      ]),
    );
    const lines = summary.split('\n');
    const geral = lines.find((line) => line.startsWith('GERAL')) ?? '';
    expect(geral).toContain('passou 2/5 (40%)');
    expect(geral).toContain('acerto NR 3/3 (100%)');
    expect(geral).toContain('acerto item 1/3 (33%)');
    expect(geral).toContain('(topk 2/3 (67%))');
    expect(geral).toContain('falso relevante 1/2 (50%)');
    expect(geral).toContain('avisos ok 4/5 (80%)');

    // O gate olha só as perguntas validadas: 1 pergunta, que não passou.
    const gate = lines.find((line) => line.includes('validado (gate)')) ?? '';
    expect(gate).toContain('passou 0/1 (0%)');
    expect(gate).toContain('acerto item 0/1 (0%)');
    expect(gate).toContain('falso relevante 0/0 (—)');

    // Uma linha por tipo presente.
    expect(lines.some((line) => line.includes('sem_evidencia') && line.includes('falso relevante 1/2 (50%)'))).toBe(true);
  });

  it('resumo da Camada A traz precisão e recall dos avisos por tipo, com n/d sem denominador', () => {
    const summary = formatRetrievalSummary(
      buildRetrievalBaseline(META, [
        retrievalResult({ avisos_esperados: ['jurisdicao'], avisos_detectados: ['jurisdicao'] }),
        retrievalResult({ id: 'NR35-002', avisos_esperados: ['jurisdicao'], avisos_detectados: [], avisos_ok: false }),
      ]),
    );
    expect(summary).toContain('  avisos por tipo: ');
    expect(summary).toContain('jurisdicao P 1.00 R 0.50 (tp 1, fp 0, fn 1)');
    // Tipo que não apareceu nem esperado nem detectado: sem denominador, n/d.
    expect(summary).toContain('contexto P n/d R n/d (tp 0, fp 0, fn 0)');
    expect(summary).toContain('profissional_habilitado P n/d R n/d (tp 0, fp 0, fn 0)');
  });

  it('linha de avisos por tipo mostra n/d só do lado sem denominador (aviso detectado sem ser esperado)', () => {
    const summary = formatRetrievalSummary(
      buildRetrievalBaseline(META, [
        retrievalResult({ avisos_esperados: [], avisos_detectados: ['contexto'], avisos_ok: false }),
      ]),
    );
    // Só falso positivo: precisão 0/1 = 0.00; recall sem esperado = n/d.
    expect(summary).toContain('contexto P 0.00 R n/d (tp 0, fp 1, fn 0)');
  });

  it('baseline e resumo da Camada B trazem chamadas, tokens e contagens de alucinação', () => {
    const answer: AnswerResult = {
      id: 'NR35-001',
      tipo: 'conceitual',
      status: 'rascunho',
      comportamento: 'responder',
      respondeu: true,
      citou_item: true,
      avisos_ok: true,
      proibido_ok: true,
      claims_dropped_support: 1,
      flagged_numbers: 2,
      nao_pergunta_de_volta: false,
      passou: true,
    };
    const meta = { ...META, layer: 'answer' as const, llm_calls: 1, llm_tokens_delta: 4321 };
    const summary = formatAnswerSummary(buildAnswerBaseline(meta, [answer]));
    expect(summary).toContain('1 chamadas ao LLM, tokens 4321');
    expect(summary).toContain('claims descartadas 1');
    expect(summary).toContain('números sinalizados 2');
  });

  describe('Camada B com várias perguntas', () => {
    function answerResult(overrides: Partial<AnswerResult> = {}): AnswerResult {
      return {
        id: 'NR35-001',
        tipo: 'conceitual',
        status: 'rascunho',
        comportamento: 'responder',
        respondeu: true,
        citou_item: true,
        avisos_ok: true,
        proibido_ok: true,
        claims_dropped_support: 0,
        flagged_numbers: 0,
        nao_pergunta_de_volta: false,
        passou: true,
        ...overrides,
      };
    }

    const answerMeta = { ...META, layer: 'answer' as const, model: 'MiniMax-M3', llm_calls: 6, llm_tokens_delta: 25800 };
    const results: AnswerResult[] = [
      answerResult({ id: 'NR35-001', claims_dropped_support: 1, flagged_numbers: 2 }),
      answerResult({
        id: 'NR35-002',
        tipo: 'pegadinha',
        status: 'validado',
        citou_item: false,
        proibido_ok: false,
        claims_dropped_support: 3,
        passou: false,
      }),
      answerResult({
        id: 'NR35-003',
        tipo: 'sem_evidencia',
        comportamento: 'recusar_sem_evidencia',
        respondeu: false,
        citou_item: null,
      }),
      answerResult({
        id: 'NR35-004',
        tipo: 'contexto_incompleto',
        comportamento: 'pedir_contexto',
        respondeu: false,
        citou_item: null,
        nao_pergunta_de_volta: true,
      }),
      answerResult({
        id: 'NR35-005',
        tipo: 'contexto_incompleto',
        comportamento: 'pedir_contexto',
        citou_item: null,
        nao_pergunta_de_volta: true,
      }),
      answerResult({ id: 'NR35-006', flagged_numbers: 1 }),
    ];

    it('resumo mostra cada métrica com o numerador e o denominador certos', () => {
      const summary = formatAnswerSummary(buildAnswerBaseline(answerMeta, results));
      const lines = summary.split('\n');
      const geral = lines.find((line) => line.startsWith('GERAL')) ?? '';
      expect(geral).toContain('passou 5/6 (83%)');
      expect(geral).toContain('responderam 4/6 (67%)');
      expect(geral).toContain('citaram item 2/3 (67%)');
      expect(geral).toContain('claims descartadas 4');
      expect(geral).toContain('números sinalizados 3');

      // O gate olha só a pergunta validada (NR35-002).
      const gate = lines.find((line) => line.includes('validado (gate)')) ?? '';
      expect(gate).toContain('passou 0/1 (0%)');
      expect(gate).toContain('citaram item 0/1 (0%)');
      expect(gate).toContain('claims descartadas 3');
    });

    it('marca à parte a lacuna "não pergunta de volta" (pedir_contexto), sem reprovar por ela', () => {
      const summary = formatAnswerSummary(buildAnswerBaseline(answerMeta, results));
      expect(summary).toContain('lacuna à parte (não reprova): o sistema ainda não pergunta de volta — perguntas pedir_contexto afetadas: 2');
      // As duas perguntas pedir_contexto passaram: a lacuna não entra no passou.
      expect(summary).toContain('passou 5/6 (83%)');
    });

    it('conta quantas respostas violaram proibido_regex', () => {
      const summary = formatAnswerSummary(buildAnswerBaseline(answerMeta, results));
      expect(summary).toContain('respostas que violaram proibido_regex: 1');
      const limpo = formatAnswerSummary(buildAnswerBaseline(answerMeta, [answerResult()]));
      expect(limpo).toContain('respostas que violaram proibido_regex: 0');
      expect(limpo).toContain('perguntas pedir_contexto afetadas: 0');
    });

    it('tokens ausentes aparecem como n/d, e as chamadas como 0', () => {
      const summary = formatAnswerSummary(buildAnswerBaseline({ ...answerMeta, llm_calls: null, llm_tokens_delta: null }, results));
      expect(summary).toContain('0 chamadas ao LLM, tokens n/d');
    });
  });
});

describe('describeMetaDifferences (unit)', () => {
  it('metas iguais, ou que só diferem em commit e data, são comparáveis', () => {
    expect(describeMetaDifferences(META, { ...META })).toEqual([]);
    expect(
      describeMetaDifferences(META, { ...META, commit: 'def5678', gerado_em: '2026-10-01T00:00:00.000Z' }),
    ).toEqual([]);
  });

  it('cada campo divergente vira uma frase que o cita e traz os dois valores', () => {
    const cases: [string, Partial<BaselineMeta>, string, string][] = [
      ['dataset_sha256', { dataset_sha256: 'y' }, 'x', 'y'],
      ['threshold', { threshold: 0.5 }, '0.4', '0.5'],
      ['chunk_limit', { chunk_limit: 8 }, '6', '8'],
      ['model', { model: 'MiniMax-M3' }, 'n/d', 'MiniMax-M3'],
    ];
    for (const [field, override, valueA, valueB] of cases) {
      const phrases = describeMetaDifferences(META, { ...META, ...override });
      expect(phrases).toHaveLength(1);
      expect(phrases[0]).toContain(field);
      expect(phrases[0]).toContain(valueA);
      expect(phrases[0]).toContain(valueB);
      // Simétrico: a ordem dos baselines não muda quais campos divergem.
      expect(describeMetaDifferences({ ...META, ...override }, META)).toHaveLength(1);
    }
  });

  it('várias divergências geram uma frase por campo', () => {
    const phrases = describeMetaDifferences(META, {
      ...META,
      dataset_sha256: 'y',
      threshold: 0.5,
      chunk_limit: 8,
      model: 'MiniMax-M3',
    });
    expect(phrases).toHaveLength(4);
  });

  it('camadas sem modelo (Camada A) com model nulo dos dois lados são comparáveis', () => {
    expect(describeMetaDifferences({ ...META, model: null }, { ...META, model: null })).toEqual([]);
  });
});

describe('renderReviewMarkdown (unit)', () => {
  const item = {
    id: 'NR35-001',
    tipo: 'conceitual',
    pergunta: 'Que condição o trabalhador precisa cumprir para executar trabalho em altura?',
    resposta_esperada: 'Ser formalmente autorizado pela organização.',
    answer: 'O trabalhador deve ser formalmente autorizado.',
    notices: [] as string[],
    citations: ['NR-35 - Trabalho em Altura'],
    passou: true,
  };

  it('mostra pergunta, resposta esperada e obtida lado a lado, com as fontes e a linha de revisão', () => {
    const markdown = renderReviewMarkdown([item]);
    expect(markdown).toContain('# Revisão lado a lado — Camada B');
    expect(markdown).toContain('### NR35-001 — conceitual — passou');
    expect(markdown).toContain('**Resposta esperada:** Ser formalmente autorizado pela organização.');
    expect(markdown).toContain('**Resposta obtida:** O trabalhador deve ser formalmente autorizado.');
    expect(markdown).toContain('**Fontes citadas:** NR-35 - Trabalho em Altura');
    expect(markdown).toContain('[ ] resposta correta');
  });

  it('resposta nula aparece como recusa, e pergunta que não passou fica marcada', () => {
    const markdown = renderReviewMarkdown([{ ...item, answer: null, citations: [], passou: false, notices: ['contexto'] }]);
    expect(markdown).toContain('NÃO passou');
    expect(markdown).toContain('_(o Assistente recusou: sem resposta)_');
    expect(markdown).toContain('**Avisos:** contexto');
    expect(markdown).toContain('**Fontes citadas:** —');
  });

  it('não corta a lista: 12 perguntas viram 12 blocos', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ ...item, id: `NR35-${String(i + 1).padStart(3, '0')}` }));
    const markdown = renderReviewMarkdown(items);
    expect(markdown.match(/^### /gm)).toHaveLength(12);
    expect(markdown).toContain('### NR35-012 — conceitual — passou');
  });
});
