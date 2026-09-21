import { DEFAULT_MAX_LLM_CALLS, parseEvalArgs } from '../eval/args';
import { GoldenQuestion, TIPOS } from '../eval/golden/golden-schema';
import { ESTIMATED_TOKENS_PER_CALL, planLlmRun, sampleByTipo } from '../eval/llm-plan';

function question(id: string, tipo: GoldenQuestion['tipo']): GoldenQuestion {
  return {
    id,
    tipo,
    categoria: 'NR-01',
    subcategoria: 'x',
    pergunta: 'p',
    resposta_esperada: 'r',
    comportamento_esperado: 'recusar_sem_evidencia',
    fontes_esperadas: [],
    avisos_esperados: [],
    jurisdicao: 'federal',
    risco_resposta: 'baixo',
    versao_fonte: null,
    data_verificacao: null,
    status: 'rascunho',
    gerado_por: 't',
    validado_por: null,
    validado_em: null,
  };
}

describe('parseEvalArgs (unit)', () => {
  it('sem argumentos devolve os padrões seguros', () => {
    const args = parseEvalArgs([]);
    expect(args.llm).toBe(false);
    expect(args.allowFull).toBe(false);
    expect(args.failOnRegression).toBe(false);
    expect(args.maxLlmCalls).toBe(DEFAULT_MAX_LLM_CALLS);
    expect(args.days).toBe(30);
    expect(args.tipos).toEqual([]);
    expect(args.out).toBeNull();
    expect(args.grep).toBeNull();
  });

  it('lê flags com valor, listas separadas por vírgula e flags booleanas', () => {
    const args = parseEvalArgs([
      '--tipo', 'pegadinha,jurisdicional',
      '--ids', 'NR35-001, NR06-002',
      '--out', 'backend/eval/baselines/x.json',
      '--compare', 'backend/eval/baselines/y.json',
      '--llm', '--allow-full', '--fail-on-regression', '--write',
      '--max-llm-calls', '5', '--days', '7',
    ]);
    expect(args.tipos).toEqual(['pegadinha', 'jurisdicional']);
    expect(args.ids).toEqual(['NR35-001', 'NR06-002']);
    expect(args.out).toBe('backend/eval/baselines/x.json');
    expect(args.compare).toBe('backend/eval/baselines/y.json');
    expect([args.llm, args.allowFull, args.failOnRegression, args.write]).toEqual([true, true, true, true]);
    expect(args.maxLlmCalls).toBe(5);
    expect(args.days).toBe(7);
  });

  it('argumentos posicionais são preservados (eval:nr NR-35 35.4)', () => {
    expect(parseEvalArgs(['NR-35', '35.4']).positional).toEqual(['NR-35', '35.4']);
  });

  it('--grep recebe o termo e convive com os posicionais', () => {
    const args = parseEvalArgs(['NR-35', '--grep', 'altura']);
    expect(args.positional).toEqual(['NR-35']);
    expect(args.grep).toBe('altura');
  });

  it('rejeita flag desconhecida, flag sem valor e número inválido', () => {
    expect(() => parseEvalArgs(['--foo'])).toThrow('Flag desconhecida: --foo');
    expect(() => parseEvalArgs(['--out'])).toThrow('--out exige um valor');
    expect(() => parseEvalArgs(['--out', '--llm'])).toThrow('--out exige um valor');
    expect(() => parseEvalArgs(['--max-llm-calls', '0'])).toThrow('inteiro positivo');
    expect(() => parseEvalArgs(['--days', 'abc'])).toThrow('inteiro positivo');
  });
});

describe('sampleByTipo / planLlmRun (unit)', () => {
  const dataset = [
    question('A-001', 'conceitual'),
    question('A-002', 'conceitual'),
    question('B-001', 'pegadinha'),
    question('B-002', 'pegadinha'),
    question('C-001', 'sem_evidencia'),
  ];

  it('amostra cobre um de cada tipo por rodada, na ordem do dataset', () => {
    expect(sampleByTipo(dataset, 3).map((q) => q.id)).toEqual(['A-001', 'B-001', 'C-001']);
    expect(sampleByTipo(dataset, 4).map((q) => q.id)).toEqual(['A-001', 'B-001', 'C-001', 'A-002']);
  });

  it('amostra maior ou igual ao dataset devolve tudo', () => {
    expect(sampleByTipo(dataset, 99)).toHaveLength(5);
  });

  it('amostra usa só tipos conhecidos e não ultrapassa n', () => {
    const all = TIPOS.flatMap((tipo, i) => [question(`T${i}-001`, tipo), question(`T${i}-002`, tipo)]);
    const sample = sampleByTipo(all, 10);
    expect(sample).toHaveLength(10);
    expect(new Set(sample.slice(0, 8).map((q) => q.tipo)).size).toBe(8);
  });

  it('sem --llm o plano recusa: chamada de LLM é paga e tem que ser explícita', () => {
    expect(() => planLlmRun(parseEvalArgs([]), dataset)).toThrow('rode com --llm');
  });

  it('com --llm roda só o teto (padrão 15) e estima os tokens', () => {
    const many = Array.from({ length: 30 }, (_, i) => question(`X-${String(i).padStart(3, '0')}`, 'conceitual'));
    const plan = planLlmRun(parseEvalArgs(['--llm']), many);
    expect(plan.questions).toHaveLength(15);
    expect(plan.estimatedTokens).toBe(15 * ESTIMATED_TOKENS_PER_CALL);
  });

  it('--max-llm-calls ajusta o teto e --allow-full remove o teto', () => {
    const many = Array.from({ length: 30 }, (_, i) => question(`X-${String(i).padStart(3, '0')}`, 'conceitual'));
    expect(planLlmRun(parseEvalArgs(['--llm', '--max-llm-calls', '4']), many).questions).toHaveLength(4);
    expect(planLlmRun(parseEvalArgs(['--llm', '--allow-full']), many).questions).toHaveLength(30);
  });
});
