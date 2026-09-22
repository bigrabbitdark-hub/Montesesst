import * as vm from 'vm';
import { DEFAULT_MAX_LLM_CALLS, parseEvalArgs } from '../eval/args';
import { GoldenQuestion, TIPOS } from '../eval/golden/golden-schema';
import {
  ESTIMATED_TOKENS_PER_CALL,
  MAX_REQUESTS_PER_QUESTION,
  planLlmRun,
  sampleByTipo,
} from '../eval/llm-plan';

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

  it('--max-llm-calls e --days só aceitam inteiro decimal positivo (nada de notação científica, hex, sinal ou espaço)', () => {
    const invalid = ['1e3', '1e21', '0x10', '0b11', '+5', ' 7 ', '5.5', '2.5', '0', '-1', 'NaN', 'Infinity', '', ' ', '7\n', '99999999999999999999'];
    for (const value of invalid) {
      expect(() => parseEvalArgs(['--max-llm-calls', value])).toThrow('inteiro positivo');
      expect(() => parseEvalArgs(['--days', value])).toThrow('inteiro positivo');
    }
    expect(parseEvalArgs(['--max-llm-calls', '15']).maxLlmCalls).toBe(15);
    expect(parseEvalArgs(['--days', '365']).days).toBe(365);
  });

  it('--max-llm-calls acima de 15 exige --allow-full: é recusado, não limitado em silêncio', () => {
    for (const value of ['16', '60', '1000']) {
      expect(() => parseEvalArgs(['--llm', '--max-llm-calls', value])).toThrow('acima de 15 exige --allow-full');
    }
    expect(parseEvalArgs(['--llm', '--max-llm-calls', '15']).maxLlmCalls).toBe(15);
    // Com --allow-full o teto deixa de valer, em qualquer ordem dos argumentos.
    expect(parseEvalArgs(['--llm', '--max-llm-calls', '60', '--allow-full']).maxLlmCalls).toBe(60);
    expect(parseEvalArgs(['--allow-full', '--llm', '--max-llm-calls', '60']).maxLlmCalls).toBe(60);
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

  it('amostra cobre um de cada tipo por rodada (ordem de TIPOS entre tipos, ordem do dataset dentro do tipo)', () => {
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
    expect(planLlmRun(parseEvalArgs(['--llm', '--allow-full', '--max-llm-calls', '20']), many).questions).toHaveLength(30);
  });

  it('--allow-full sozinho (sem --llm) nunca planeja chamadas pagas', () => {
    expect(() => planLlmRun(parseEvalArgs(['--allow-full']), dataset)).toThrow('rode com --llm');
    expect(() => planLlmRun(parseEvalArgs(['--allow-full', '--max-llm-calls', '60']), dataset)).toThrow('rode com --llm');
  });

  it('planLlmRun recusa teto acima de 15 sem --allow-full mesmo com args montados à mão', () => {
    const many = Array.from({ length: 60 }, (_, i) => question(`X-${String(i).padStart(3, '0')}`, 'conceitual'));
    const base = parseEvalArgs(['--llm']);
    expect(() => planLlmRun({ ...base, maxLlmCalls: 16 }, many)).toThrow('acima de 15 exige --allow-full');
    expect(() => planLlmRun({ ...base, maxLlmCalls: 60 }, many)).toThrow('acima de 15 exige --allow-full');
    expect(() => planLlmRun({ ...base, maxLlmCalls: 1000 }, many)).toThrow('acima de 15 exige --allow-full');
    expect(planLlmRun({ ...base, maxLlmCalls: 15 }, many).questions).toHaveLength(15);
    expect(planLlmRun({ ...base, maxLlmCalls: 60, allowFull: true }, many).questions).toHaveLength(60);
  });

  it('planLlmRun recusa teto que não é inteiro positivo (2.5 não vira 8 perguntas, 15.9 não vira 16)', () => {
    const many = Array.from({ length: 30 }, (_, i) => question(`X-${String(i).padStart(3, '0')}`, 'conceitual'));
    const base = parseEvalArgs(['--llm']);
    for (const maxLlmCalls of [2.5, 15.9, 0, -1, NaN, Infinity, 1e21]) {
      expect(() => planLlmRun({ ...base, maxLlmCalls }, many)).toThrow('inteiro positivo');
    }
  });

  it('a estimativa é perguntas planejadas x tokens por chamada, e não o teto (teto 15 com 5 perguntas)', () => {
    const five = Array.from({ length: 5 }, (_, i) => question(`Y-${String(i).padStart(3, '0')}`, 'conceitual'));
    const plan = planLlmRun(parseEvalArgs(['--llm']), five);
    expect(plan.questions).toHaveLength(5);
    expect(plan.estimatedTokens).toBe(5 * ESTIMATED_TOKENS_PER_CALL);
  });

  it('o pior caso é o dobro da estimativa: o provedor repete a requisição uma vez com tool call inválido', () => {
    const five = Array.from({ length: 5 }, (_, i) => question(`Y-${String(i).padStart(3, '0')}`, 'conceitual'));
    const plan = planLlmRun(parseEvalArgs(['--llm']), five);
    expect(MAX_REQUESTS_PER_QUESTION).toBe(2);
    expect(plan.worstCaseTokens).toBe(2 * plan.estimatedTokens);
    expect(plan.worstCaseTokens).toBe(5 * ESTIMATED_TOKENS_PER_CALL * 2);
    // Aditivo: a estimativa continua sendo a de 1 requisição por pergunta.
    expect(plan.estimatedTokens).toBe(5 * ESTIMATED_TOKENS_PER_CALL);
  });
});

describe('sampleByTipo com tipo fora de TIPOS (unit)', () => {
  it('não trava: tipo desconhecido não avança a amostra e o laço termina', () => {
    const unknownTipo = 'nao_existe' as GoldenQuestion['tipo'];
    const questions = [
      question('A-001', 'conceitual'),
      question('Z-001', unknownTipo),
      question('Z-002', unknownTipo),
      question('B-001', 'pegadinha'),
      question('Z-003', unknownTipo),
    ];
    // Um laço síncrono infinito não é interrompido pelo timeout do Jest; o vm
    // derruba o script no prazo. Roda o código compilado de sampleByTipo, com
    // o TIPOS entregue ao nome que o compilador deu ao módulo importado.
    const source = sampleByTipo.toString();
    const tiposRef = /(\w+)\.TIPOS/.exec(source);
    expect(tiposRef).not.toBeNull();
    const sandbox = { [tiposRef![1]]: { TIPOS: [...TIPOS] }, questions, n: 4 };
    const sample = vm.runInNewContext(`(${source})(questions, n)`, sandbox, { timeout: 2000 }) as GoldenQuestion[];
    expect(sample.length).toBeLessThanOrEqual(4);
    expect(sample.map((q) => q.id)).toEqual(expect.arrayContaining(['A-001', 'B-001']));
  });
});
