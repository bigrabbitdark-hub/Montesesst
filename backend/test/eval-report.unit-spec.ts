import { blocksContaining, blocksWithPrefix, splitIntoItemBlocks } from '../eval/golden/nr-blocks';
import { AnswerResult, RetrievalResult } from '../eval/metrics';
import {
  BaselineMeta,
  buildAnswerBaseline,
  buildRetrievalBaseline,
  datasetHash,
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

describe('blocksContaining (unit)', () => {
  it('busca por termo sem acento e sem diferenciar maiúsculas', () => {
    const blocks = splitIntoItemBlocks(NR35_TEXT);
    expect(blocksContaining(blocks, 'ORGANIZACAO').map((b) => b.item)).toEqual(['35.4.1']);
    expect(blocksContaining(blocks, 'capacitado').map((b) => b.item)).toEqual(['35.4.1.1']);
  });

  it('termo que não aparece devolve lista vazia (é assim que se confirma a ausência de um assunto)', () => {
    expect(blocksContaining(splitIntoItemBlocks(NR35_TEXT), 'eSocial')).toEqual([]);
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
});
