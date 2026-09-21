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

  it('soma claims e agrega os tokens mais frequentes com desempate estável', () => {
    const summary = summarizeUsage([
      row({ claims_total: 3, claims_dropped_ids: 1, claims_dropped_support: 1, flagged_numbers: ['8 horas', '30 dias'], blocking_tokens: ['item 35.4.7'] }),
      row({ claims_total: 1, flagged_numbers: ['8 horas'] }),
    ]);
    expect(summary.claims).toEqual({ total: 4, descartadas_ids: 1, descartadas_suporte: 1 });
    expect(summary.numeros_sinalizados_top).toEqual([
      { token: '8 horas', vezes: 2 },
      { token: '30 dias', vezes: 1 },
    ]);
    expect(summary.tokens_bloqueados_top).toEqual([{ token: 'item 35.4.7', vezes: 1 }]);
  });

  it('latência média arredondada', () => {
    expect(summarizeUsage([row({ latency_ms: 1000 }), row({ latency_ms: 2001 })]).latencia_media_ms).toBe(1501);
  });
});
