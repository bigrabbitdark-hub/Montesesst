// Plano de custo da Camada B (chamadas reais e PAGAS ao LLM) — spec
// docs/specs/assistente-confiabilidade-etapa-2-3.md §5.3. Módulo puro.
import { GoldenQuestion, TIPOS } from './golden/golden-schema';
import { EvalArgs } from './args';

// ~4,3 mil tokens por chamada, medido no log real (27 chamadas de
// `assistant_normative_query` = 116.645 tokens em 2026-09-20).
export const ESTIMATED_TOKENS_PER_CALL = 4300;

// Amostra determinística que cobre todos os tipos: pega uma pergunta de cada
// tipo, em rodadas, na ordem em que aparecem no dataset, até completar `n`.
export function sampleByTipo(questions: GoldenQuestion[], n: number): GoldenQuestion[] {
  if (n >= questions.length) return [...questions];
  const queues = new Map(TIPOS.map((tipo) => [tipo, questions.filter((q) => q.tipo === tipo)]));
  const sample: GoldenQuestion[] = [];
  while (sample.length < n) {
    let progressed = false;
    for (const tipo of TIPOS) {
      const next = queues.get(tipo)?.shift();
      if (next) {
        sample.push(next);
        progressed = true;
        if (sample.length === n) break;
      }
    }
    if (!progressed) break;
  }
  return sample;
}

export interface LlmPlan {
  questions: GoldenQuestion[];
  estimatedTokens: number;
}

// Sem --llm não roda; com --allow-full roda todas as selecionadas; senão roda
// no máximo --max-llm-calls (padrão 15), em amostra que cobre os tipos.
export function planLlmRun(args: EvalArgs, selected: GoldenQuestion[]): LlmPlan {
  if (!args.llm) {
    throw new Error('eval:answer chama o LLM real e PAGO — rode com --llm (e, para além do teto, --allow-full)');
  }
  const questions = args.allowFull ? [...selected] : sampleByTipo(selected, args.maxLlmCalls);
  return { questions, estimatedTokens: questions.length * ESTIMATED_TOKENS_PER_CALL };
}
