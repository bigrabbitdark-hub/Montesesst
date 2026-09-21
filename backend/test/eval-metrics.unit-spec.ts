import { GoldenQuestion } from '../eval/golden/golden-schema';
import {
  aggregateAnswer,
  aggregateRetrieval,
  evaluateAnswer,
  evaluateRetrieval,
  findRegressions,
  groupBy,
  RetrievedChunkObs,
} from '../eval/metrics';

function question(overrides: Partial<GoldenQuestion> = {}): GoldenQuestion {
  return {
    id: 'NR35-001',
    tipo: 'conceitual',
    categoria: 'NR-35',
    subcategoria: 'Autorização',
    pergunta: 'Quem pode realizar trabalho em altura?',
    resposta_esperada: 'Trabalhador formalmente autorizado.',
    comportamento_esperado: 'responder',
    fontes_esperadas: [
      {
        fonte: 'norma',
        source_code: 'NR-35',
        item: '35.4.1',
        evidencia: '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização.',
      },
    ],
    avisos_esperados: [],
    jurisdicao: 'federal',
    risco_resposta: 'medio',
    versao_fonte: null,
    data_verificacao: null,
    status: 'rascunho',
    gerado_por: 'teste',
    validado_por: null,
    validado_em: null,
    ...overrides,
  };
}

function chunk(overrides: Partial<RetrievedChunkObs> = {}): RetrievedChunkObs {
  return {
    chunk_id: 'c1',
    source_code: 'NR-35',
    content: '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado',
    similarity: 0.62,
    ...overrides,
  };
}

const THRESHOLD = 0.4;

describe('evaluateRetrieval — Camada A (unit)', () => {
  it('acerta NR e item quando um trecho acima do limiar é da NR esperada e traz o título do item', () => {
    const result = evaluateRetrieval(question(), { chunks: [chunk()], threshold: THRESHOLD, notices: [] });
    expect(result.acerto_nr).toBe(true);
    expect(result.acerto_item).toBe(true);
    expect(result.acerto_item_topk).toBe(true);
    expect(result.melhor_similaridade).toBe(0.62);
    expect(result.passou).toBe(true);
  });

  it('acerta a NR mas erra o item quando o trecho é da NR certa sem o título do item (chunk cortado)', () => {
    const cortado = chunk({ content: ' Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado' });
    const result = evaluateRetrieval(question(), { chunks: [cortado], threshold: THRESHOLD, notices: [] });
    expect(result.acerto_nr).toBe(true);
    expect(result.acerto_item).toBe(false);
    expect(result.passou).toBe(false);
  });

  it('trecho abaixo do limiar não conta no acerto com limiar, mas conta no topk', () => {
    const fraco = chunk({ similarity: 0.31 });
    const result = evaluateRetrieval(question(), { chunks: [fraco], threshold: THRESHOLD, notices: [] });
    expect(result.acerto_item).toBe(false);
    expect(result.acerto_item_topk).toBe(true);
    expect(result.passou).toBe(false);
  });

  it('trecho de outra NR com o mesmo número de item não conta', () => {
    const outraNr = chunk({ source_code: 'NR-18' });
    const result = evaluateRetrieval(question(), { chunks: [outraNr], threshold: THRESHOLD, notices: [] });
    expect(result.acerto_nr).toBe(false);
    expect(result.acerto_item).toBe(false);
  });

  it('pergunta sem fonte esperada: acertos ficam null e não reprovam por isso', () => {
    const q = question({ comportamento_esperado: 'pedir_contexto', fontes_esperadas: [], avisos_esperados: ['contexto'] });
    const result = evaluateRetrieval(q, { chunks: [], threshold: THRESHOLD, notices: ['contexto'] });
    expect(result.acerto_nr).toBeNull();
    expect(result.acerto_item).toBeNull();
    expect(result.melhor_similaridade).toBeNull();
    expect(result.passou).toBe(true);
  });

  it('avisos precisam ser exatamente os esperados: faltando ou sobrando reprova', () => {
    const q = question({ avisos_esperados: ['jurisdicao'], comportamento_esperado: 'alertar_jurisdicao', fontes_esperadas: [] });
    expect(evaluateRetrieval(q, { chunks: [], threshold: THRESHOLD, notices: [] }).avisos_ok).toBe(false);
    expect(evaluateRetrieval(q, { chunks: [], threshold: THRESHOLD, notices: ['jurisdicao', 'contexto'] }).avisos_ok).toBe(false);
    expect(evaluateRetrieval(q, { chunks: [], threshold: THRESHOLD, notices: ['jurisdicao'] }).avisos_ok).toBe(true);
  });

  it('recusa esperada: melhor similaridade acima do limiar é falso relevante e reprova', () => {
    const q = question({ comportamento_esperado: 'recusar_sem_evidencia', fontes_esperadas: [], tipo: 'sem_evidencia' });
    const relevante = evaluateRetrieval(q, { chunks: [chunk({ similarity: 0.48 })], threshold: THRESHOLD, notices: [] });
    expect(relevante.falso_relevante).toBe(true);
    expect(relevante.passou).toBe(false);
    const irrelevante = evaluateRetrieval(q, { chunks: [chunk({ similarity: 0.21 })], threshold: THRESHOLD, notices: [] });
    expect(irrelevante.falso_relevante).toBe(false);
    expect(irrelevante.passou).toBe(true);
  });

  it('falso_relevante é null para perguntas que não esperam recusa', () => {
    expect(evaluateRetrieval(question(), { chunks: [chunk()], threshold: THRESHOLD, notices: [] }).falso_relevante).toBeNull();
  });
});

describe('aggregateRetrieval (unit)', () => {
  it('conta só perguntas com fonte nos acertos e só recusas no falso relevante', () => {
    const ok = evaluateRetrieval(question(), { chunks: [chunk()], threshold: THRESHOLD, notices: [] });
    const semAcerto = evaluateRetrieval(question({ id: 'NR35-002' }), { chunks: [], threshold: THRESHOLD, notices: [] });
    const recusa = evaluateRetrieval(
      question({ id: 'GERAL-001', comportamento_esperado: 'recusar_sem_evidencia', fontes_esperadas: [], tipo: 'sem_evidencia' }),
      { chunks: [chunk({ similarity: 0.5 })], threshold: THRESHOLD, notices: [] },
    );
    expect(aggregateRetrieval([ok, semAcerto, recusa])).toEqual({
      total: 3,
      passou: 1,
      com_fontes: 2,
      acerto_nr: 1,
      acerto_item: 1,
      acerto_item_topk: 1,
      recusa_total: 1,
      falso_relevante: 1,
      avisos_ok: 3,
    });
  });
});

describe('evaluateAnswer — Camada B (unit)', () => {
  const retrieved = [chunk({ chunk_id: 'c-item' }), chunk({ chunk_id: 'c-outro', content: 'texto de outro item' })];

  it('responder passa quando responde, cita o trecho do item esperado e nada proibido aparece', () => {
    const result = evaluateAnswer(question(), {
      answer: 'O trabalho em altura exige trabalhador autorizado.',
      notices: [],
      retrieved,
      kept_claims_chunk_ids: [['c-item']],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.citou_item).toBe(true);
    expect(result.passou).toBe(true);
  });

  it('responder reprova quando só cita um trecho que não tem o item esperado', () => {
    const result = evaluateAnswer(question(), {
      answer: 'Resposta qualquer.',
      notices: [],
      retrieved,
      kept_claims_chunk_ids: [['c-outro']],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.citou_item).toBe(false);
    expect(result.passou).toBe(false);
  });

  it('responder reprova quando o Assistente recusa (resposta nula)', () => {
    const result = evaluateAnswer(question(), {
      answer: null,
      notices: [],
      retrieved,
      kept_claims_chunk_ids: [],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.respondeu).toBe(false);
    expect(result.passou).toBe(false);
  });

  it('proibido_regex reprova a resposta que aceita a premissa errada', () => {
    const q = question({ tipo: 'pegadinha', proibido_regex: ['sim,? todo trabalhador que usa escada'] });
    const result = evaluateAnswer(q, {
      answer: 'Sim, todo trabalhador que usa escada precisa de NR-35.',
      notices: [],
      retrieved,
      kept_claims_chunk_ids: [['c-item']],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.proibido_ok).toBe(false);
    expect(result.passou).toBe(false);
  });

  it('recusar_sem_evidencia passa só se a resposta é nula', () => {
    const q = question({ comportamento_esperado: 'recusar_sem_evidencia', fontes_esperadas: [], tipo: 'sem_evidencia' });
    const base = { notices: [], retrieved: [], kept_claims_chunk_ids: [], claims_dropped_support: 0, flagged_numbers: [] };
    expect(evaluateAnswer(q, { ...base, answer: null }).passou).toBe(true);
    expect(evaluateAnswer(q, { ...base, answer: 'Inventou uma resposta.' }).passou).toBe(false);
  });

  it('pedir_contexto passa quando o aviso esperado disparou e marca a lacuna de não perguntar de volta', () => {
    const q = question({ comportamento_esperado: 'pedir_contexto', fontes_esperadas: [], avisos_esperados: ['contexto'], tipo: 'contexto_incompleto' });
    const result = evaluateAnswer(q, {
      answer: 'Depende da atividade.',
      notices: ['contexto'],
      retrieved: [],
      kept_claims_chunk_ids: [],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.passou).toBe(true);
    expect(result.nao_pergunta_de_volta).toBe(true);
  });

  it('alertar_jurisdicao reprova quando o aviso esperado não disparou', () => {
    const q = question({ comportamento_esperado: 'alertar_jurisdicao', fontes_esperadas: [], avisos_esperados: ['jurisdicao'], tipo: 'jurisdicional' });
    const result = evaluateAnswer(q, {
      answer: null,
      notices: [],
      retrieved: [],
      kept_claims_chunk_ids: [],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.avisos_ok).toBe(false);
    expect(result.passou).toBe(false);
  });

  it('registra claims descartadas por suporte e números sinalizados sem usá-los como critério', () => {
    const result = evaluateAnswer(question(), {
      answer: 'Resposta.',
      notices: [],
      retrieved,
      kept_claims_chunk_ids: [['c-item']],
      claims_dropped_support: 2,
      flagged_numbers: ['8 horas', '30 dias'],
    });
    expect(result.claims_dropped_support).toBe(2);
    expect(result.flagged_numbers).toBe(2);
    expect(result.passou).toBe(true);
  });
});

describe('aggregateAnswer (unit)', () => {
  it('soma as contagens', () => {
    const base = { notices: [], retrieved: [chunk({ chunk_id: 'c-item' })], claims_dropped_support: 1, flagged_numbers: ['8 horas'] };
    const a = evaluateAnswer(question(), { ...base, answer: 'ok', kept_claims_chunk_ids: [['c-item']] });
    const b = evaluateAnswer(question({ id: 'NR35-002' }), { ...base, answer: null, kept_claims_chunk_ids: [] });
    expect(aggregateAnswer([a, b])).toEqual({
      total: 2,
      passou: 1,
      responderam: 1,
      com_fontes: 2,
      citaram_item: 1,
      claims_descartadas_por_suporte: 2,
      numeros_sinalizados: 2,
    });
  });
});

describe('findRegressions / groupBy (unit)', () => {
  it('regressão = validado que passava e deixou de passar', () => {
    const baseline = [
      { id: 'A', status: 'validado' as const, passou: true },
      { id: 'B', status: 'validado' as const, passou: true },
      { id: 'C', status: 'validado' as const, passou: false },
      { id: 'D', status: 'rascunho' as const, passou: true },
    ];
    const current = [
      { id: 'A', status: 'validado' as const, passou: true },
      { id: 'B', status: 'validado' as const, passou: false },
      { id: 'C', status: 'validado' as const, passou: false },
      { id: 'D', status: 'rascunho' as const, passou: false },
      { id: 'E', status: 'validado' as const, passou: false },
    ];
    expect(findRegressions(baseline, current)).toEqual([{ id: 'B', motivo: 'passava no baseline e deixou de passar' }]);
  });

  it('pergunta removida do dataset não é regressão', () => {
    expect(findRegressions([{ id: 'A', status: 'validado', passou: true }], [])).toEqual([]);
  });

  it('groupBy agrupa por chave', () => {
    expect(groupBy([1, 2, 3, 4], (n) => (n % 2 === 0 ? 'par' : 'impar'))).toEqual({ par: [2, 4], impar: [1, 3] });
  });
});
