import { detectNotices } from '../src/normative/question-notices';

const tipos = (question: string) => detectNotices(question).map((n) => n.tipo);

describe('detectNotices (unit)', () => {
  it('pergunta sem gatilho não gera aviso', () => {
    expect(detectNotices('Qual o prazo de validade do ASO periódico?')).toEqual([]);
  });

  it('jurisdição: PPCI e "meu município" disparam o aviso, e "minha empresa precisa" dispara contexto — na ordem fixa', () => {
    expect(tipos('Minha empresa precisa de PPCI no meu município?')).toEqual(['jurisdicao', 'contexto']);
  });

  it('jurisdição dispara com e sem acento', () => {
    expect(tipos('Qual o alvará do Corpo de Bombeiros?')).toEqual(['jurisdicao']);
    expect(tipos('qual o alvara do corpo de bombeiros')).toEqual(['jurisdicao']);
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
});
