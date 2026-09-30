import { detectNotices } from '../src/normative/question-notices';

const tipos = (question: string) => detectNotices(question).map((n) => n.tipo);

describe('detectNotices (unit)', () => {
  it('pergunta sem gatilho não gera aviso', () => {
    // "Qual o prazo de validade do ASO periódico?" (usado até 2026-09-28) hoje
    // dispara corretamente vencimento_vencido (Etapa 2) — a pergunta É sobre
    // prazo/validade, então o aviso está certo; o teste que precisava mudar
    // era o exemplo, não o produto. Esta pergunta não tem NENHUM gatilho dos
    // 6 tipos (nem jurisdição/profissional/contexto/vencimento/dado
    // insuficiente/geografia).
    expect(detectNotices('Qual é o objetivo principal de um programa de gerenciamento de riscos ocupacionais?')).toEqual([]);
  });

  it('jurisdição: PPCI e "meu município" disparam o aviso, e "minha empresa precisa" dispara contexto — na ordem fixa', () => {
    expect(tipos('Minha empresa precisa de PPCI no meu município?')).toEqual(['jurisdicao', 'contexto']);
  });

  it('jurisdição dispara com e sem acento', () => {
    expect(tipos('Qual o alvará do Corpo de Bombeiros?')).toEqual(['jurisdicao']);
    expect(tipos('qual o alvara do corpo de bombeiros')).toEqual(['jurisdicao']);
  });

  // ITEM 007 da auditoria do Assistente (2026-09-28): "cidade" é substantivo
  // feminino — "meu cidade" nunca aparece em português real, só "minha
  // cidade". O padrão antigo (`\bmeu (estado|municipio|cidade)\b`) cobria só
  // a forma masculina, então nunca disparava pra "cidade" na prática (achado
  // no banco de 83 perguntas: D-012, "O que vale para a minha cidade?").
  it('jurisdição: "minha cidade" dispara (concordância de gênero — "cidade" é feminino)', () => {
    expect(tipos('A NR é federal. O que vale para a minha cidade?')).toEqual(['jurisdicao']);
    expect(tipos('Isso vale no meu estado?')).toEqual(['jurisdicao']);
    expect(tipos('Isso vale no meu município?')).toEqual(['jurisdicao']);
  });

  it('jurisdição: licença ambiental, licenciamento e legislação estadual/municipal', () => {
    expect(tipos('Preciso de licença ambiental?')).toContain('jurisdicao');
    expect(tipos('Como funciona o licenciamento?')).toEqual(['jurisdicao']);
    expect(tipos('A lei municipal exige algo a mais?')).toEqual(['jurisdicao']);
  });

  it('profissional habilitado: "quem pode assinar" e ART', () => {
    expect(tipos('Quem pode assinar o PGR?')).toEqual(['profissional_habilitado']);
    expect(tipos('Preciso de ART para o laudo?')).toContain('profissional_habilitado');
  });

  it('"art." / "art" seguido de número é artigo de lei e NÃO dispara profissional_habilitado', () => {
    expect(detectNotices('O art. 157 da CLT fala de EPI?')).toEqual([]);
    expect(detectNotices('O art 157 da CLT fala de EPI?')).toEqual([]);
  });

  it('profissional habilitado: responsável técnico, RRT e "legalmente habilitado"', () => {
    expect(tipos('Quem é o responsável técnico?')).toEqual(['profissional_habilitado']);
    expect(tipos('Preciso de RRT?')).toContain('profissional_habilitado');
    expect(tipos('Isso exige profissional legalmente habilitado?')).toEqual(['profissional_habilitado']);
  });

  it('contexto: "sou obrigado" e "é obrigatório"', () => {
    expect(tipos('Sou obrigado a ter CIPA?')).toEqual(['contexto']);
    expect(tipos('É obrigatório ter brigada?')).toContain('contexto');
  });

  it('no máximo um aviso por tipo, mesmo com vários gatilhos do mesmo tipo', () => {
    const notices = detectNotices('PPCI, AVCB e bombeiros no meu estado?');
    expect(notices.filter((n) => n.tipo === 'jurisdicao')).toHaveLength(1);
  });

  it('cada aviso traz o texto fixo do seu tipo', () => {
    const [aviso] = detectNotices('Preciso de PPCI?');
    expect(aviso.tipo).toBe('jurisdicao');
    expect(aviso.texto).toContain('Normas Regulamentadoras federais');
    expect(detectNotices('Quem pode assinar o PGR?')[0].texto).toContain('conselho profissional competente');
    expect(detectNotices('Sou obrigado a ter CIPA?')[0].texto).toContain('número de empregados');
  });

  // Etapa 2 (Fase A) — cobertura que faltava por completo pros 3 tipos
  // novos (vencimento_vencido, dado_insuficiente, geografia): nenhum dos
  // dois tinha um teste unitário sequer até esta auditoria (2026-09-28).
  describe('vencimento_vencido (Etapa 2)', () => {
    it('pergunta sobre prazo/validade dispara o aviso', () => {
      expect(tipos('Qual o prazo de validade do ASO periódico?')).toEqual(['vencimento_vencido']);
      expect(tipos('O PPRA já venceu?')).toContain('vencimento_vencido');
      expect(tipos('Quando expira o CA do capacete?')).toContain('vencimento_vencido');
    });
  });

  describe('geografia (Etapa 2)', () => {
    it('UF isolada e nome de estado disparam o aviso', () => {
      expect(tipos('Quais as regras de segurança em SP?')).toEqual(['geografia']);
      expect(tipos('As regras valem também da Bahia?')).toContain('geografia');
    });

    // ITEM 007: mesmo bug de concordância de gênero do teste de jurisdicao
    // acima — "no cidade de" nunca ocorre em português, só "na cidade de".
    it('"na cidade de" dispara (concordância de gênero — "cidade" é feminino)', () => {
      expect(tipos('Quais as regras na cidade de Santos?')).toEqual(['geografia']);
      expect(tipos('Isso vale no estado de São Paulo?')).toEqual(['geografia']);
    });
  });

  describe('dado_insuficiente (Etapa 2) — e o bug C-4 corrigido', () => {
    it('pergunta com 4 palavras ou menos, sem NR, sem outro gatilho, dispara o aviso', () => {
      expect(tipos('O que é CIPA?')).toEqual(['dado_insuficiente']);
    });

    it('pergunta com mais de 4 palavras nunca dispara, mesmo sem NR', () => {
      expect(tipos('O que devo saber sobre segurança do trabalho na empresa?')).not.toContain('dado_insuficiente');
    });

    it('pergunta curta que já cita NR não dispara (o usuário já sabe o que quer)', () => {
      expect(tipos('Resumo da NR-06?')).toEqual([]);
    });

    // C-4 (auditoria do Assistente, 2026-09-28): antes desta correção, as
    // duas linhas abaixo devolviam ['jurisdicao', 'dado_insuficiente'] e
    // ['profissional_habilitado', 'dado_insuficiente'] — o comentário do
    // código já dizia que isso não deveria acontecer, só a checagem nunca
    // tinha sido escrita.
    it('pergunta curta que já dispara jurisdicao NÃO dispara dado_insuficiente também', () => {
      expect(tipos('Como funciona o licenciamento?')).toEqual(['jurisdicao']);
      expect(tipos('Existe alvará aqui?')).toEqual(['jurisdicao']);
    });

    it('pergunta curta que já dispara profissional_habilitado NÃO dispara dado_insuficiente também', () => {
      expect(tipos('Isso exige RRT?')).toEqual(['profissional_habilitado']);
    });
  });
});
