import {
  countByTipo,
  GoldenQuestion,
  parseGoldenDataset,
  validateGoldenDataset,
  validateGoldenQuestion,
} from '../eval/golden/golden-schema';

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'NR35-001',
    tipo: 'conceitual',
    categoria: 'NR-35',
    subcategoria: 'Autorização',
    pergunta: 'Quem pode realizar trabalho em altura?',
    resposta_esperada: 'Trabalhador formalmente autorizado pela organização.',
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
    gerado_por: 'claude-sonnet-5 (rascunho)',
    validado_por: null,
    validado_em: null,
    ...overrides,
  };
}

describe('validateGoldenQuestion (unit)', () => {
  it('registro válido não tem erros', () => {
    expect(validateGoldenQuestion(valid())).toEqual([]);
  });

  it('rejeita o que não é objeto', () => {
    expect(validateGoldenQuestion(null)).toEqual(['registro não é um objeto']);
    expect(validateGoldenQuestion([])).toEqual(['registro não é um objeto']);
  });

  it('exige textos obrigatórios e formato do id', () => {
    const errors = validateGoldenQuestion(valid({ id: 'nr35', pergunta: '  ' }));
    expect(errors).toContain('pergunta: texto obrigatório');
    expect(errors).toContain('id: formato esperado como NR35-001');
  });

  it('rejeita valores fora dos enums', () => {
    const errors = validateGoldenQuestion(
      valid({ tipo: 'outro', comportamento_esperado: 'talvez', risco_resposta: 'grande', jurisdicao: 'mundial', status: 'ok' }),
    );
    expect(errors.filter((e) => e.startsWith('tipo:'))).toHaveLength(1);
    expect(errors.filter((e) => e.startsWith('comportamento_esperado:'))).toHaveLength(1);
    expect(errors.filter((e) => e.startsWith('risco_resposta:'))).toHaveLength(1);
    expect(errors.filter((e) => e.startsWith('jurisdicao:'))).toHaveLength(1);
    expect(errors.filter((e) => e.startsWith('status:'))).toHaveLength(1);
  });

  it('jurisdição aceita estadual e municipal (a pergunta pode se referir a elas)', () => {
    expect(validateGoldenQuestion(valid({ jurisdicao: 'estadual' }))).toEqual([]);
    expect(validateGoldenQuestion(valid({ jurisdicao: 'municipal' }))).toEqual([]);
  });

  it('fonte esperada: exige campos e que a evidência comece pelo item', () => {
    const errors = validateGoldenQuestion(
      valid({ fontes_esperadas: [{ fonte: 'norma', source_code: 'NR-35', item: '35.4.1', evidencia: 'Todo trabalho em altura' }] }),
    );
    expect(errors).toContain('fontes_esperadas[0].evidencia: deve começar pelo número do item ("35.4.1 …")');
  });

  it("fonte 'checklist' ainda é rejeitada (segunda leva)", () => {
    const errors = validateGoldenQuestion(
      valid({ fontes_esperadas: [{ fonte: 'checklist', source_code: 'NR-13', item: 'Prontuário', evidencia: 'Prontuário x' }] }),
    );
    expect(errors.some((e) => e.includes("só 'norma' é suportada"))).toBe(true);
  });

  it('responder exige pelo menos uma fonte esperada', () => {
    expect(validateGoldenQuestion(valid({ fontes_esperadas: [] }))).toContain(
      'comportamento responder exige pelo menos 1 fonte esperada',
    );
  });

  it('recusar_sem_evidencia exige fontes vazias', () => {
    expect(validateGoldenQuestion(valid({ comportamento_esperado: 'recusar_sem_evidencia' }))).toContain(
      'comportamento recusar_sem_evidencia exige fontes_esperadas vazio',
    );
    expect(
      validateGoldenQuestion(valid({ comportamento_esperado: 'recusar_sem_evidencia', fontes_esperadas: [] })),
    ).toEqual([]);
  });

  it('pedir_contexto, alertar_jurisdicao e alertar_habilitacao exigem o aviso correspondente', () => {
    const base = { fontes_esperadas: [] as unknown[] };
    expect(validateGoldenQuestion(valid({ ...base, comportamento_esperado: 'pedir_contexto' }))).toContain(
      "comportamento pedir_contexto exige o aviso 'contexto'",
    );
    expect(validateGoldenQuestion(valid({ ...base, comportamento_esperado: 'alertar_jurisdicao' }))).toContain(
      "comportamento alertar_jurisdicao exige o aviso 'jurisdicao'",
    );
    expect(validateGoldenQuestion(valid({ ...base, comportamento_esperado: 'alertar_habilitacao' }))).toContain(
      "comportamento alertar_habilitacao exige o aviso 'profissional_habilitado'",
    );
    expect(
      validateGoldenQuestion(
        valid({ ...base, comportamento_esperado: 'alertar_jurisdicao', avisos_esperados: ['jurisdicao'] }),
      ),
    ).toEqual([]);
  });

  it('aviso desconhecido é rejeitado', () => {
    expect(validateGoldenQuestion(valid({ avisos_esperados: ['outro'] })).some((e) => e.includes('"outro" inválido'))).toBe(true);
  });

  it('proibido_regex precisa compilar', () => {
    expect(validateGoldenQuestion(valid({ proibido_regex: ['sim,? todo'] }))).toEqual([]);
    expect(validateGoldenQuestion(valid({ proibido_regex: ['(nao fecha'] }))).toContain('proibido_regex: "(nao fecha" não compila');
  });

  it('proibido_regex rejeita entrada que não é texto, texto vazio e padrão que casa a string vazia', () => {
    // Um padrão vazio ou que casa "" casaria com QUALQUER resposta e reprovaria a pergunta sempre.
    expect(validateGoldenQuestion(valid({ proibido_regex: [''] })).length).toBeGreaterThan(0);
    expect(validateGoldenQuestion(valid({ proibido_regex: ['   '] })).length).toBeGreaterThan(0);
    expect(validateGoldenQuestion(valid({ proibido_regex: ['.*'] }))).toContain(
      'proibido_regex: ".*" casa a string vazia (casaria com qualquer resposta)',
    );
    expect(validateGoldenQuestion(valid({ proibido_regex: [5] }))).toContain('proibido_regex[0]: deve ser texto');
    expect(validateGoldenQuestion(valid({ proibido_regex: ['sim,? todo', null] }))).toContain('proibido_regex[1]: deve ser texto');
    // Um padrão válido junto de outro válido continua passando.
    expect(validateGoldenQuestion(valid({ proibido_regex: ['sim,? todo', '\\bnão precisa\\b'] }))).toEqual([]);
  });

  it('campo desconhecido no registro é rejeitado (um typo em proibido_regex desligaria a guarda em silêncio)', () => {
    expect(validateGoldenQuestion(valid({ proibido_regx: ['sim'] }))).toEqual(['campo desconhecido: proibido_regx']);
    expect(validateGoldenQuestion(valid({ extra: 1, outro: 2 }))).toEqual([
      'campo desconhecido: extra',
      'campo desconhecido: outro',
    ]);
  });

  it('chave herdada de Object (toString) também conta como campo desconhecido', () => {
    expect(validateGoldenQuestion(valid({ toString: 'x' }))).toContain('campo desconhecido: toString');
  });

  it('campo desconhecido dentro de uma fonte esperada é rejeitado', () => {
    const errors = validateGoldenQuestion(
      valid({
        fontes_esperadas: [
          {
            fonte: 'norma',
            source_code: 'NR-35',
            item: '35.4.1',
            evidencia: '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização.',
            eviddencia: 'typo',
          },
        ],
      }),
    );
    expect(errors).toEqual(['fontes_esperadas[0]: campo desconhecido: eviddencia']);
  });

  it('status validado exige validado_por e validado_em; rascunho exige ambos nulos', () => {
    expect(validateGoldenQuestion(valid({ status: 'validado' }))).toContain('status validado exige validado_por e validado_em');
    expect(
      validateGoldenQuestion(valid({ status: 'validado', validado_por: 'Fulana, Eng. Seg. Trabalho, CREA 123', validado_em: '2026-09-25' })),
    ).toEqual([]);
    expect(validateGoldenQuestion(valid({ validado_por: 'Alguém' }))).toContain(
      'status rascunho exige validado_por e validado_em nulos',
    );
  });

  it('validado exige os DOIS campos (só um deles não basta) e rascunho rejeita qualquer um dos dois', () => {
    const erroValidado = 'status validado exige validado_por e validado_em';
    const erroRascunho = 'status rascunho exige validado_por e validado_em nulos';
    expect(validateGoldenQuestion(valid({ status: 'validado', validado_por: 'Fulana, CREA 123' }))).toContain(erroValidado);
    expect(validateGoldenQuestion(valid({ status: 'validado', validado_em: '2026-09-25' }))).toContain(erroValidado);
    expect(validateGoldenQuestion(valid({ status: 'rascunho', validado_por: 'Fulana, CREA 123' }))).toContain(erroRascunho);
    expect(validateGoldenQuestion(valid({ status: 'rascunho', validado_em: '2026-09-25' }))).toContain(erroRascunho);
  });

  it('data_verificacao precisa estar em YYYY-MM-DD ou ser null', () => {
    expect(validateGoldenQuestion(valid({ data_verificacao: '2026-09-21', versao_fonte: 'NR-35:ab12cd34' }))).toEqual([]);
    expect(validateGoldenQuestion(valid({ data_verificacao: '21/09/2026' }))).toContain('data_verificacao: YYYY-MM-DD ou null');
  });
});

describe('validateGoldenDataset / parseGoldenDataset / countByTipo (unit)', () => {
  it('dataset precisa ser um array', () => {
    expect(validateGoldenDataset({})).toEqual(['o dataset deve ser um array']);
  });

  it('detecta id duplicado e prefixa os erros com o id', () => {
    const errors = validateGoldenDataset([valid(), valid(), valid({ id: 'NR35-002', pergunta: '' })]);
    expect(errors).toContain('NR35-001: id duplicado');
    expect(errors).toContain('NR35-002: pergunta: texto obrigatório');
  });

  it('parseGoldenDataset devolve o array tipado quando válido e lança quando inválido', () => {
    const parsed = parseGoldenDataset([valid()]);
    expect(parsed[0].id).toBe('NR35-001');
    expect(() => parseGoldenDataset([valid({ tipo: 'x' })])).toThrow(/Dataset golden inválido/);
  });

  it('countByTipo conta por tipo e devolve zero para os tipos ausentes', () => {
    const questions = [valid(), valid({ id: 'NR35-002', tipo: 'pegadinha' }), valid({ id: 'NR35-003', tipo: 'pegadinha' })] as unknown as GoldenQuestion[];
    const counts = countByTipo(questions);
    expect(counts.conceitual).toBe(1);
    expect(counts.pegadinha).toBe(2);
    expect(counts.sem_evidencia).toBe(0);
  });
});
