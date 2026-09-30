// ITEM 014 (auditoria 2026-09-27): a MiniMax não expõe endpoint de saldo/uso (só painel
// web deles — ver comentário de 0034_minimax_usage_log.sql), então o único jeito de ter
// visibilidade de custo é ESTIMAR a partir dos tokens que a própria resposta já devolve.
//
// Preços do modelo MiniMax-M3, tier "Standard" pay-as-you-go, faixa ≤512k tokens de
// contexto — VERIFICADO em https://platform.minimax.io/docs/guides/pricing-paygo.md
// (consultado em 2026-09-30; já reflete o desconto permanente de 50% que a MiniMax
// aplica sobre a tabela cheia). Preço da faixa >512k e de "prompt caching" NÃO são
// modelados aqui: nenhuma chamada deste projeto (RAG por chunk, checklist, classificador)
// chega perto de 512k tokens de contexto. Sempre reconferir este link se MINIMAX_MODEL
// mudar — a tabela é só para "MiniMax-M3".
export const MINIMAX_M3_INPUT_USD_PER_MILLION_TOKENS = 0.3;
export const MINIMAX_M3_OUTPUT_USD_PER_MILLION_TOKENS = 1.2;

// Estimativa, nunca fatura real — por isso "estimated_cost_usd", nunca exposta como
// cobrança exata em nenhuma tela.
export function estimateMinimaxCostUsd(promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens * MINIMAX_M3_INPUT_USD_PER_MILLION_TOKENS) / 1_000_000 +
    (completionTokens * MINIMAX_M3_OUTPUT_USD_PER_MILLION_TOKENS) / 1_000_000
  );
}
