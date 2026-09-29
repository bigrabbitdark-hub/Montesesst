import { AvisoTipo, GoldenQuestion } from '../eval/golden/golden-schema';
import {
  aggregateAnswer,
  aggregateNotices,
  aggregateRetrieval,
  evaluateAnswer,
  evaluateRetrieval,
  findRegressions,
  groupBy,
  RetrievalResult,
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
      // Proxy automático da rubrica (spec
      // docs/specs/assistente-banco-testes-12-niveis.md §4). Apenas
      // FONTE e TRANSPARÊNCIA têm proxy aqui; as outras categorias
      // ficam `null` até revisão humana.
      rubrica_media: expect.objectContaining({
        FONTE: expect.any(Number),
        PRECISAO: null,
        CONTEXTO: null,
        TRANSPARENCIA: expect.any(Number),
        ACAO: null,
      }),
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

  it('recusar_sem_evidencia passa quando recusa, ou quando inventa do nada é reprovado', () => {
    const q = question({ comportamento_esperado: 'recusar_sem_evidencia', fontes_esperadas: [], tipo: 'sem_evidencia' });
    const base = { notices: [], retrieved: [], kept_claims_chunk_ids: [], claims_dropped_support: 0, flagged_numbers: [] };
    expect(evaluateAnswer(q, { ...base, answer: null }).passou).toBe(true);
    // "Inventou uma resposta." sem nenhum chunk_id real sobrevivente — não há
    // grounding nenhum, é uma alucinação de verdade. Continua reprovado.
    expect(evaluateAnswer(q, { ...base, answer: 'Inventou uma resposta.' }).passou).toBe(false);
  });

  // ITEM 016 da auditoria do Assistente (2026-09-28): a pergunta A-002 ("A
  // NR-35 obriga exame de sangue anual?") tem comportamento_esperado
  // recusar_sem_evidencia, mas a resposta real do MiniMax negou a premissa
  // falsa citando NR-35/NR-07 de verdade ("não estabelece... a avaliação é
  // feita conforme NR-07") — uma correção segura e fundamentada, não uma
  // invenção. A regra antiga (`passou = !respondeu`) reprovava os dois casos
  // (invenção real e correção segura) do mesmo jeito, escondendo a diferença
  // mais importante que uma auditoria de alucinação quer enxergar.
  it('recusar_sem_evidencia: responder negando a premissa com evidência real (chunk_id que sobreviveu ao Verificador) passa e é marcado como correção de premissa falsa', () => {
    const q = question({ comportamento_esperado: 'recusar_sem_evidencia', fontes_esperadas: [], tipo: 'sem_evidencia' });
    const result = evaluateAnswer(q, {
      answer: 'A NR-35 não estabelece essa obrigação nos trechos fornecidos; a avaliação de saúde segue a NR-07.',
      notices: [],
      retrieved,
      kept_claims_chunk_ids: [['c-item']],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.passou).toBe(true);
    expect(result.corrigiu_premissa_falsa).toBe(true);
  });

  it('recusar_sem_evidencia: responder afirmando a premissa proibida continua reprovado mesmo citando algo', () => {
    const q = question({
      comportamento_esperado: 'recusar_sem_evidencia',
      fontes_esperadas: [],
      tipo: 'sem_evidencia',
      proibido_regex: ['exame de sangue anual é obrigat'],
    });
    const result = evaluateAnswer(q, {
      answer: 'Sim, o exame de sangue anual é obrigatório conforme a NR-35.',
      notices: [],
      retrieved,
      kept_claims_chunk_ids: [['c-item']],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.passou).toBe(false);
    expect(result.corrigiu_premissa_falsa).toBe(false);
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
      // Proxy automático da rubrica (spec
      // docs/specs/assistente-banco-testes-12-niveis.md §4).
      rubrica_media: expect.objectContaining({
        FONTE: expect.any(Number),
        PRECISAO: null,
        CONTEXTO: null,
        TRANSPARENCIA: expect.any(Number),
        ACAO: null,
      }),
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

// Lacunas de cobertura apontadas pela revisão (mutações que sobreviviam à
// primeira versão do spec): limiar, máximo, regras por comportamento, gate.
describe('bordas e regras do gate (unit)', () => {
  const semFonte = { fontes_esperadas: [] as GoldenQuestion['fontes_esperadas'] };
  const baseB = {
    notices: [] as AvisoTipo[],
    retrieved: [] as RetrievedChunkObs[],
    kept_claims_chunk_ids: [] as string[][],
    claims_dropped_support: 0,
    flagged_numbers: [] as string[],
  };

  it('similaridade exatamente no limiar conta (>=, igual à produção)', () => {
    expect(evaluateRetrieval(question(), { chunks: [chunk({ similarity: THRESHOLD })], threshold: THRESHOLD, notices: [] }).acerto_item).toBe(true);
    const recusa = question({ ...semFonte, comportamento_esperado: 'recusar_sem_evidencia', tipo: 'sem_evidencia' });
    expect(evaluateRetrieval(recusa, { chunks: [chunk({ similarity: THRESHOLD })], threshold: THRESHOLD, notices: [] }).falso_relevante).toBe(true);
  });

  it('melhor similaridade é o máximo entre vários trechos', () => {
    const result = evaluateRetrieval(question(), {
      chunks: [chunk({ chunk_id: 'a', similarity: 0.3 }), chunk({ chunk_id: 'b', similarity: 0.7 }), chunk({ chunk_id: 'c', similarity: 0.5 })],
      threshold: THRESHOLD,
      notices: [],
    });
    expect(result.melhor_similaridade).toBe(0.7);
    const recusa = question({ ...semFonte, comportamento_esperado: 'recusar_sem_evidencia', tipo: 'sem_evidencia' });
    expect(
      evaluateRetrieval(recusa, { chunks: [chunk({ similarity: 0.1 }), chunk({ similarity: 0.9 })], threshold: THRESHOLD, notices: [] }).falso_relevante,
    ).toBe(true);
  });

  it('aviso divergente reprova o passou da Camada A mesmo com o item certo', () => {
    const result = evaluateRetrieval(question({ avisos_esperados: ['contexto'] }), { chunks: [chunk()], threshold: THRESHOLD, notices: [] });
    expect(result.acerto_item).toBe(true);
    expect(result.avisos_ok).toBe(false);
    expect(result.passou).toBe(false);
  });

  it('acerto de NR também respeita o limiar', () => {
    const result = evaluateRetrieval(question(), { chunks: [chunk({ similarity: 0.2 })], threshold: THRESHOLD, notices: [] });
    expect(result.acerto_nr).toBe(false);
  });

  it('menção ao item ("conforme o item 35.4.1") não conta como título', () => {
    const mencao = chunk({ content: 'texto conforme o item 35.4.1 desta norma' });
    const result = evaluateRetrieval(question(), { chunks: [mencao], threshold: THRESHOLD, notices: [] });
    expect(result.acerto_nr).toBe(true);
    expect(result.acerto_item).toBe(false);
  });

  it('proibido_regex reprova também em pedir_contexto e alertar_*', () => {
    const q = question({
      ...semFonte,
      comportamento_esperado: 'alertar_jurisdicao',
      avisos_esperados: ['jurisdicao'],
      tipo: 'jurisdicional',
      proibido_regex: ['não precisa'],
    });
    const result = evaluateAnswer(q, { ...baseB, notices: ['jurisdicao'], answer: 'Não precisa de nada.' });
    expect(result.avisos_ok).toBe(true);
    expect(result.proibido_ok).toBe(false);
    expect(result.passou).toBe(false);
  });

  it('na Camada B, aviso a mais não reprova (contém, não igualdade)', () => {
    const q = question({ ...semFonte, comportamento_esperado: 'pedir_contexto', avisos_esperados: ['contexto'], tipo: 'contexto_incompleto' });
    expect(evaluateAnswer(q, { ...baseB, notices: ['contexto', 'jurisdicao'], answer: 'x' }).passou).toBe(true);
  });

  it('responder com resposta nula reprova mesmo que uma claim cite o item', () => {
    const result = evaluateAnswer(question(), { ...baseB, retrieved: [chunk()], kept_claims_chunk_ids: [['c1']], answer: null });
    expect(result.citou_item).toBe(true);
    expect(result.passou).toBe(false);
  });

  it('resposta só com espaços conta como recusa', () => {
    expect(evaluateAnswer(question(), { ...baseB, answer: '   ' }).respondeu).toBe(false);
  });

  it('basta UMA claim citar o item; ids de outras claims não atrapalham', () => {
    const retrieved = [chunk({ chunk_id: 'c-item' }), chunk({ chunk_id: 'c-outro', content: 'nada' })];
    expect(evaluateAnswer(question(), { ...baseB, retrieved, answer: 'x', kept_claims_chunk_ids: [['c-outro'], ['c-item']] }).citou_item).toBe(true);
    expect(evaluateAnswer(question(), { ...baseB, retrieved, answer: 'x', kept_claims_chunk_ids: [['c-outro', 'c-item']] }).citou_item).toBe(true);
  });

  it('nao_pergunta_de_volta só vale em pedir_contexto', () => {
    expect(evaluateAnswer(question(), { ...baseB, answer: 'x' }).nao_pergunta_de_volta).toBe(false);
  });

  it('o gate lê o status ATUAL (baseline gerado com tudo rascunho)', () => {
    expect(findRegressions([{ id: 'A', status: 'rascunho', passou: true }], [{ id: 'A', status: 'validado', passou: false }])).toEqual([
      { id: 'A', motivo: 'passava no baseline e deixou de passar' },
    ]);
    expect(findRegressions([{ id: 'A', status: 'validado', passou: true }], [{ id: 'A', status: 'rascunho', passou: false }])).toEqual([]);
  });

  it('várias regressões saem na ordem de `current`', () => {
    const baseline = ['Z', 'A', 'M'].map((id) => ({ id, status: 'validado' as const, passou: true }));
    const current = ['Z', 'A', 'M'].map((id) => ({ id, status: 'validado' as const, passou: false }));
    expect(findRegressions(baseline, current).map((r) => r.id)).toEqual(['Z', 'A', 'M']);
  });
});

describe('avisos comparados como conjunto (unit)', () => {
  it('Camada A: esperado com aviso repetido não casa com detectados distintos', () => {
    const q = question({ fontes_esperadas: [], comportamento_esperado: 'alertar_jurisdicao', avisos_esperados: ['jurisdicao', 'jurisdicao'] });
    const result = evaluateRetrieval(q, { chunks: [], threshold: THRESHOLD, notices: ['jurisdicao', 'contexto'] });
    expect(result.avisos_ok).toBe(false);
  });

  it('Camada A: aviso detectado em duplicidade não derruba o acerto', () => {
    const q = question({ fontes_esperadas: [], comportamento_esperado: 'alertar_jurisdicao', avisos_esperados: ['jurisdicao'] });
    expect(evaluateRetrieval(q, { chunks: [], threshold: THRESHOLD, notices: ['jurisdicao', 'jurisdicao'] }).avisos_ok).toBe(true);
  });

  it('Camada A: esperado repetido casa com o mesmo aviso detectado uma vez', () => {
    const q = question({ fontes_esperadas: [], comportamento_esperado: 'alertar_jurisdicao', avisos_esperados: ['jurisdicao', 'jurisdicao'] });
    expect(evaluateRetrieval(q, { chunks: [], threshold: THRESHOLD, notices: ['jurisdicao'] }).avisos_ok).toBe(true);
  });

  it('Camada B: repetição nos avisos não muda o resultado', () => {
    const q = question({ fontes_esperadas: [], comportamento_esperado: 'alertar_jurisdicao', avisos_esperados: ['jurisdicao', 'jurisdicao'] });
    const base = { answer: null, retrieved: [], kept_claims_chunk_ids: [], claims_dropped_support: 0, flagged_numbers: [] };
    expect(evaluateAnswer(q, { ...base, notices: ['jurisdicao'] }).avisos_ok).toBe(true);
    expect(evaluateAnswer(q, { ...base, notices: ['contexto'] }).avisos_ok).toBe(false);
  });

  // Lacunas de cobertura achadas por mutação na revisão final (Fix Wave):
  // sameSet reduzido a comparar só o TAMANHO dos conjuntos, e isSubset com
  // `every` trocado por `some` (ou retornando `false` para `expected` vazio)
  // sobreviviam aos testes acima porque nenhum cobria esses casos.

  it('Camada A: esperado e detectado do MESMO tamanho mas com tipos diferentes reprova (sameSet checa os elementos, não só o tamanho)', () => {
    const q = question({ fontes_esperadas: [], comportamento_esperado: 'alertar_jurisdicao', avisos_esperados: ['jurisdicao'] });
    const result = evaluateRetrieval(q, { chunks: [], threshold: THRESHOLD, notices: ['contexto'] });
    expect(result.avisos_ok).toBe(false);
  });

  it('Camada B: 2 avisos esperados e só 1 detectado não cobre (isSubset exige TODOS os elementos, não `some`)', () => {
    const q = question({
      fontes_esperadas: [],
      comportamento_esperado: 'alertar_jurisdicao',
      avisos_esperados: ['jurisdicao', 'contexto'],
    });
    const result = evaluateAnswer(q, {
      answer: null,
      notices: ['jurisdicao'],
      retrieved: [],
      kept_claims_chunk_ids: [],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.avisos_ok).toBe(false);
  });

  it('Camada B: avisos_esperados vazio é sempre subconjunto (isSubset com `expected` vazio dá true)', () => {
    const q = question({
      fontes_esperadas: [],
      comportamento_esperado: 'pedir_contexto',
      avisos_esperados: [],
    });
    const result = evaluateAnswer(q, {
      answer: 'Depende da atividade.',
      notices: ['contexto'],
      retrieved: [],
      kept_claims_chunk_ids: [],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.avisos_ok).toBe(true);
  });
});

describe('aggregateNotices — precisão e recall por tipo de aviso (unit)', () => {
  // Resultado da Camada A só com o que importa aqui: os avisos esperados e os
  // detectados (o restante é neutro).
  function resultado(id: string, esperados: AvisoTipo[], detectados: AvisoTipo[]): RetrievalResult {
    return {
      id,
      tipo: 'conceitual',
      status: 'rascunho',
      acerto_nr: null,
      acerto_item: null,
      acerto_item_topk: null,
      melhor_similaridade: null,
      falso_relevante: null,
      avisos_esperados: esperados,
      avisos_detectados: detectados,
      avisos_ok: false,
      rubrica: { FONTE: 0, PRECISAO: null, CONTEXTO: null, TRANSPARENCIA: 0, ACAO: null },
      passou: false,
    };
  }

  it('caso misto com os 3 tipos: tp, fp, fn, precisão e recall conferidos à mão', () => {
    const casos: Array<[AvisoTipo[], AvisoTipo[]]> = [
      // jurisdicao: 3 acertos e 1 falso positivo
      [['jurisdicao'], ['jurisdicao']],
      [['jurisdicao'], ['jurisdicao']],
      [['jurisdicao'], ['jurisdicao']],
      [[], ['jurisdicao']],
      // contexto: 1 acerto e 1 falso negativo
      [['contexto'], ['contexto']],
      [['contexto'], []],
      // profissional_habilitado: 1 acerto, 3 falsos positivos e 1 falso negativo
      [['profissional_habilitado'], ['profissional_habilitado']],
      [['profissional_habilitado'], []],
      [[], ['profissional_habilitado']],
      [[], ['profissional_habilitado']],
      [[], ['profissional_habilitado']],
      // pergunta sem nenhum aviso, esperado ou detectado: não entra em conta nenhuma
      [[], []],
    ];
    const stats = aggregateNotices(casos.map(([esperados, detectados], index) => resultado(`Q-${index}`, esperados, detectados)));
    expect(stats).toEqual({
      jurisdicao: { tp: 3, fp: 1, fn: 0, precisao: 0.75, recall: 1 },
      contexto: { tp: 1, fp: 0, fn: 1, precisao: 1, recall: 0.5 },
      profissional_habilitado: { tp: 1, fp: 3, fn: 1, precisao: 0.25, recall: 0.5 },
      vencimento_vencido: { tp: 0, fp: 0, fn: 0, precisao: null, recall: null },
      dado_insuficiente: { tp: 0, fp: 0, fn: 0, precisao: null, recall: null },
      geografia: { tp: 0, fp: 0, fn: 0, precisao: null, recall: null },
    });
  });

  it('lista vazia: tudo zerado e precisão/recall null (nunca NaN)', () => {
    const zerado = { tp: 0, fp: 0, fn: 0, precisao: null, recall: null };
    expect(aggregateNotices([])).toEqual({
      jurisdicao: zerado,
      contexto: zerado,
      profissional_habilitado: zerado,
      vencimento_vencido: zerado,
      dado_insuficiente: zerado,
      geografia: zerado,
    });
  });

  it('tipo que nunca foi detectado nem esperado fica null/null, sem atrapalhar os demais', () => {
    const stats = aggregateNotices([resultado('Q-1', ['jurisdicao'], ['jurisdicao'])]);
    expect(stats.jurisdicao).toEqual({ tp: 1, fp: 0, fn: 0, precisao: 1, recall: 1 });
    expect(stats.contexto).toEqual({ tp: 0, fp: 0, fn: 0, precisao: null, recall: null });
    expect(stats.profissional_habilitado).toEqual({ tp: 0, fp: 0, fn: 0, precisao: null, recall: null });
  });

  it('esperado e nunca detectado: precisão null e recall 0; detectado e nunca esperado: precisão 0 e recall null', () => {
    const stats = aggregateNotices([resultado('Q-1', ['contexto'], []), resultado('Q-2', [], ['profissional_habilitado'])]);
    expect(stats.contexto).toEqual({ tp: 0, fp: 0, fn: 1, precisao: null, recall: 0 });
    expect(stats.profissional_habilitado).toEqual({ tp: 0, fp: 1, fn: 0, precisao: 0, recall: null });
  });

  it('avisos repetidos na mesma pergunta contam uma vez só', () => {
    const stats = aggregateNotices([resultado('Q-1', ['jurisdicao', 'jurisdicao'], ['jurisdicao', 'jurisdicao'])]);
    expect(stats.jurisdicao).toEqual({ tp: 1, fp: 0, fn: 0, precisao: 1, recall: 1 });
    const soDetectado = aggregateNotices([resultado('Q-2', [], ['contexto', 'contexto'])]);
    expect(soDetectado.contexto).toEqual({ tp: 0, fp: 1, fn: 0, precisao: 0, recall: null });
  });

  it('uma pergunta com vários avisos conta cada tipo separadamente', () => {
    const stats = aggregateNotices([resultado('Q-1', ['jurisdicao', 'contexto'], ['contexto', 'profissional_habilitado'])]);
    expect(stats.jurisdicao).toEqual({ tp: 0, fp: 0, fn: 1, precisao: null, recall: 0 });
    expect(stats.contexto).toEqual({ tp: 1, fp: 0, fn: 0, precisao: 1, recall: 1 });
    expect(stats.profissional_habilitado).toEqual({ tp: 0, fp: 1, fn: 0, precisao: 0, recall: null });
  });
});
