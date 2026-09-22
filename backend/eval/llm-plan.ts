// Plano de custo da Camada B (chamadas reais e PAGAS ao LLM) — spec
// docs/specs/assistente-confiabilidade-etapa-2-3.md §5.3. Módulo puro.
import { GoldenQuestion, TIPOS } from './golden/golden-schema';
import { EvalArgs, assertLlmCallLimit } from './args';

// ~4,3 mil tokens por chamada, medido no log real (27 chamadas de
// `assistant_normative_query` = 116.645 tokens em 2026-09-20).
export const ESTIMATED_TOKENS_PER_CALL = 4300;

// O provedor repete a requisição UMA vez quando o tool call volta inválido e a
// 1ª tentativa foi rápida (minimax-normative-answer.service.ts, requestOnce), e
// cada requisição paga é registrada em minimax_usage_log. Então cada pergunta
// pode custar até 2 requisições, não 1.
export const MAX_REQUESTS_PER_QUESTION = 2;

// Amostra determinística que cobre todos os tipos: pega uma pergunta de cada
// tipo, em rodadas, até completar `n`. Entre tipos vale a ordem de TIPOS;
// dentro de um tipo, a ordem em que as perguntas aparecem no dataset.
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
  // 1 requisição por pergunta (o caso comum).
  estimatedTokens: number;
  // Teto de custo: até MAX_REQUESTS_PER_QUESTION requisições por pergunta.
  worstCaseTokens: number;
}

// Sem --llm não roda (nem com --allow-full); com --allow-full roda todas as
// selecionadas; senão roda no máximo --max-llm-calls (padrão 15; acima disso
// exige --allow-full), em amostra que cobre os tipos.
export function planLlmRun(args: EvalArgs, selected: GoldenQuestion[]): LlmPlan {
  if (!args.llm) {
    throw new Error('eval:answer chama o LLM real e PAGO — rode com --llm (e, para além do teto, --allow-full)');
  }
  // `args` pode ter sido montado sem parseEvalArgs: um teto inválido (2.5,
  // NaN…) não pode virar uma amostra de tamanho arredondado.
  assertLlmCallLimit(args.maxLlmCalls, args.allowFull);
  const questions = args.allowFull ? [...selected] : sampleByTipo(selected, args.maxLlmCalls);
  const estimatedTokens = questions.length * ESTIMATED_TOKENS_PER_CALL;
  return { questions, estimatedTokens, worstCaseTokens: estimatedTokens * MAX_REQUESTS_PER_QUESTION };
}
