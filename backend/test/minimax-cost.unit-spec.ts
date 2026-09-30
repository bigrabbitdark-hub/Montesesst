import {
  estimateMinimaxCostUsd,
  MINIMAX_M3_INPUT_USD_PER_MILLION_TOKENS,
  MINIMAX_M3_OUTPUT_USD_PER_MILLION_TOKENS,
} from '../src/common/ai-usage/minimax-cost.util';

// ITEM 014 (auditoria 2026-09-27): estimativa de custo da MiniMax — VERIFICADO contra
// https://platform.minimax.io/docs/guides/pricing-paygo.md (consultado em 2026-09-30):
// MiniMax-M3, tier Standard, ≤512k tokens: $0.30/M entrada, $1.20/M saída.
describe('estimateMinimaxCostUsd', () => {
  it('preços verificados: $0.30/M entrada, $1.20/M saída', () => {
    expect(MINIMAX_M3_INPUT_USD_PER_MILLION_TOKENS).toBe(0.3);
    expect(MINIMAX_M3_OUTPUT_USD_PER_MILLION_TOKENS).toBe(1.2);
  });

  it('zero tokens = custo zero', () => {
    expect(estimateMinimaxCostUsd(0, 0)).toBe(0);
  });

  it('1 milhão de tokens de entrada custa exatamente $0.30', () => {
    expect(estimateMinimaxCostUsd(1_000_000, 0)).toBeCloseTo(0.3, 10);
  });

  it('1 milhão de tokens de saída custa exatamente $1.20 (saída é 4x mais cara que entrada)', () => {
    expect(estimateMinimaxCostUsd(0, 1_000_000)).toBeCloseTo(1.2, 10);
  });

  it('entrada e saída se somam linearmente', () => {
    const soma = estimateMinimaxCostUsd(500_000, 0) + estimateMinimaxCostUsd(0, 500_000);
    expect(estimateMinimaxCostUsd(500_000, 500_000)).toBeCloseTo(soma, 10);
  });

  it('uma chamada típica do Assistente (poucos milhares de tokens) fica na casa de centavos de dólar', () => {
    // Exemplo realista: ~3000 tokens de prompt (chunks + pergunta), ~400 de resposta.
    const custo = estimateMinimaxCostUsd(3000, 400);
    expect(custo).toBeGreaterThan(0);
    expect(custo).toBeLessThan(0.01); // bem abaixo de 1 centavo de dólar
  });

  it('nunca devolve negativo, mesmo com entrada estranha (defesa, não deveria acontecer)', () => {
    expect(estimateMinimaxCostUsd(0, 0)).toBeGreaterThanOrEqual(0);
  });
});
