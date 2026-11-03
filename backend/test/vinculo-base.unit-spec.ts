import { avisosDaBase } from '../src/atuacao/documentos/vinculo-base';

describe('avisosDaBase', () => {
  const ontem = '2026-11-01T10:00:00Z';
  const hoje = '2026-11-02T10:00:00Z';
  it('sem base: nenhum aviso', () => {
    expect(avisosDaBase(null, { status: 'em_elaboracao', versao_em: ontem })).toEqual([]);
  });
  it('base com versão mais nova que a do documento', () => {
    const r = avisosDaBase({ status: 'publicado', versao_em: hoje }, { status: 'publicado', versao_em: ontem });
    expect(r.map((a) => a.codigo)).toEqual(['base_mais_nova']);
  });
  it('documento sem versão e base com versão: base mais nova', () => {
    expect(avisosDaBase({ status: 'publicado', versao_em: hoje }, { status: 'em_elaboracao', versao_em: null }).map((a) => a.codigo)).toEqual(['base_mais_nova']);
  });
  it('base ainda não publicada gera aviso próprio', () => {
    expect(avisosDaBase({ status: 'em_revisao', versao_em: ontem }, { status: 'em_elaboracao', versao_em: hoje }).map((a) => a.codigo)).toEqual(['base_nao_publicada']);
  });
  it('base cancelada: só o aviso de cancelamento', () => {
    expect(avisosDaBase({ status: 'cancelado', versao_em: hoje }, { status: 'publicado', versao_em: ontem }).map((a) => a.codigo)).toEqual(['base_cancelada']);
  });
  it('documento cancelado ou base sem versão e publicada: sem aviso', () => {
    expect(avisosDaBase({ status: 'publicado', versao_em: hoje }, { status: 'cancelado', versao_em: ontem })).toEqual([]);
    expect(avisosDaBase({ status: 'publicado', versao_em: null }, { status: 'publicado', versao_em: ontem })).toEqual([]);
  });
  it('mensagens não carregam título nem dado pessoal', () => {
    const r = avisosDaBase({ status: 'em_revisao', versao_em: hoje }, { status: 'publicado', versao_em: ontem });
    expect(r.every((a) => a.mensagem.length < 140 && !/\d{11,}/.test(a.mensagem))).toBe(true);
  });
});
