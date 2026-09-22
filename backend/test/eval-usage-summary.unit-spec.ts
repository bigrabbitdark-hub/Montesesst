import { summarizeUsage, UsageRow } from '../eval/usage-summary';

function row(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    role: 'empresa',
    outcome: 'respondeu',
    notices: [],
    retrieved: [{ similarity: 0.6, passed_threshold: true }],
    claims_total: 2,
    claims_dropped_ids: 0,
    claims_dropped_support: 0,
    blocking_tokens: [],
    flagged_numbers: [],
    latency_ms: 1000,
    ...overrides,
  };
}

describe('summarizeUsage (unit)', () => {
  it('sem linhas devolve zeros e nulls, sem dividir por zero', () => {
    const summary = summarizeUsage([]);
    expect(summary.total).toBe(0);
    expect(summary.taxa_fallback).toBeNull();
    expect(summary.latencia_media_ms).toBeNull();
    expect(summary.melhor_similaridade).toEqual({ p50: null, p90: null });
    expect(summary.numeros_sinalizados_top).toEqual([]);
  });

  it('conta desfechos, papéis e avisos e calcula a taxa de fallback', () => {
    const summary = summarizeUsage([
      row(),
      row({ outcome: 'fallback_sem_evidencia', role: 'tecnico', notices: ['jurisdicao'] }),
      row({ outcome: 'fallback_claims_descartadas', notices: ['jurisdicao', 'contexto'] }),
      row(),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.por_desfecho).toEqual({
      respondeu: 2,
      fallback_sem_evidencia: 1,
      fallback_claims_descartadas: 1,
    });
    expect(summary.taxa_fallback).toBe(0.5);
    expect(summary.por_papel).toEqual({ empresa: 3, tecnico: 1 });
    expect(summary.avisos).toEqual({ jurisdicao: 2, contexto: 1 });
  });

  it('percentis da melhor similaridade por linha (nearest-rank), ignorando linhas sem trecho', () => {
    const summary = summarizeUsage([
      row({ retrieved: [{ similarity: 0.2, passed_threshold: false }, { similarity: 0.3, passed_threshold: false }] }),
      row({ retrieved: [{ similarity: 0.5, passed_threshold: true }] }),
      row({ retrieved: [{ similarity: 0.7, passed_threshold: true }] }),
      row({ retrieved: [{ similarity: 0.9, passed_threshold: true }] }),
      row({ retrieved: [] }),
    ]);
    // melhores por linha, ordenadas: 0.3, 0.5, 0.7, 0.9 -> p50 = 0.5, p90 = 0.9
    expect(summary.melhor_similaridade).toEqual({ p50: 0.5, p90: 0.9 });
  });

  it('a melhor similaridade é o MAIOR valor de cada linha: não o primeiro, não o menor, não o último', () => {
    // Em cada linha o melhor trecho não é o primeiro nem o último.
    const hits = (...similarities: number[]) => similarities.map((similarity) => ({ similarity, passed_threshold: similarity >= 0.4 }));
    const summary = summarizeUsage([
      row({ retrieved: hits(0.3, 0.9, 0.1) }),
      row({ retrieved: hits(0.35, 0.8, 0.15) }),
      row({ retrieved: hits(0.4, 0.7, 0.2) }),
      row({ retrieved: hits(0.45, 0.6, 0.25) }),
      row({ retrieved: hits(0.5, 0.55, 0.05) }),
    ]);
    // melhores: 0.55, 0.6, 0.7, 0.8, 0.9 -> p50 = 0.7, p90 = 0.9
    // (pelo primeiro trecho seria 0.4 / 0.5; pelo menor, 0.15 / 0.25).
    expect(summary.melhor_similaridade).toEqual({ p50: 0.7, p90: 0.9 });
  });

  it('soma claims e agrega os tokens mais frequentes', () => {
    const summary = summarizeUsage([
      row({ claims_total: 3, claims_dropped_ids: 1, claims_dropped_support: 2, flagged_numbers: ['8 horas', '30 dias'], blocking_tokens: ['item 35.4.7'] }),
      row({ claims_total: 1, claims_dropped_ids: 1, claims_dropped_support: 3, flagged_numbers: ['8 horas'] }),
    ]);
    // Valores diferentes nos dois descartes: trocar um pelo outro seria notado.
    expect(summary.claims).toEqual({ total: 4, descartadas_ids: 2, descartadas_suporte: 5 });
    expect(summary.numeros_sinalizados_top).toEqual([
      { token: '8 horas', vezes: 2 },
      { token: '30 dias', vezes: 1 },
    ]);
    expect(summary.tokens_bloqueados_top).toEqual([{ token: 'item 35.4.7', vezes: 1 }]);
  });

  it('empate em número de vezes desempata pelo token, e a ordem de entrada não muda a saída', () => {
    const tokens = ['3 dias', '2 dias', '4 dias', '2 dias', '3 dias', '4 dias', '1 dia'];
    const esperado = [
      { token: '2 dias', vezes: 2 },
      { token: '3 dias', vezes: 2 },
      { token: '4 dias', vezes: 2 },
      { token: '1 dia', vezes: 1 },
    ];
    const normal = summarizeUsage(tokens.map((token) => row({ flagged_numbers: [token] })));
    const invertida = summarizeUsage([...tokens].reverse().map((token) => row({ flagged_numbers: [token] })));
    expect(normal.numeros_sinalizados_top).toEqual(esperado);
    expect(invertida.numeros_sinalizados_top).toEqual(esperado);
  });

  it('as listas de tokens mais frequentes têm no máximo 10 itens, os mais frequentes primeiro', () => {
    // 12 números distintos; o k-ésimo aparece (13 - k) vezes: n1 x12 ... n12 x1.
    const rows = Array.from({ length: 12 }, (_, i) =>
      Array.from({ length: 12 - i }, () => row({ flagged_numbers: [`n${String(i + 1).padStart(2, '0')}`], blocking_tokens: [`b${String(i + 1).padStart(2, '0')}`] })),
    ).flat();
    const summary = summarizeUsage(rows);
    expect(summary.numeros_sinalizados_top).toHaveLength(10);
    expect(summary.numeros_sinalizados_top[0]).toEqual({ token: 'n01', vezes: 12 });
    expect(summary.numeros_sinalizados_top[9]).toEqual({ token: 'n10', vezes: 3 });
    expect(summary.numeros_sinalizados_top.map((t) => t.token)).not.toContain('n11');
    expect(summary.tokens_bloqueados_top).toHaveLength(10);
    expect(summary.tokens_bloqueados_top.map((t) => t.token)).not.toContain('b12');
  });

  it('latência média arredondada', () => {
    expect(summarizeUsage([row({ latency_ms: 1000 }), row({ latency_ms: 2001 })]).latencia_media_ms).toBe(1501);
  });
});
