import {
  calcular,
  celulas,
  sha256Canonico,
  validarConfig,
  MatrizForaDaEscalaError,
  MatrizSemFaixaError,
  MatrizHashInvalidoError,
} from '../src/atuacao/pgr/matriz/matriz-config';

const esc = (n: number, p = 'TESTE esc') =>
  Array.from({ length: n }, (_, i) => ({ valor: i + 1, rotulo: `${p} ${i + 1}`, descricao: '' }));
const nv = (id: string) => ({ id, rotulo: `TESTE ${id}`, aceitabilidade: 'TESTE a', decisao: 'TESTE d', bloqueia_emissao: false });
const metOk = { formula: 'severidade*probabilidade', validada_por: 'TESTE pessoa', registro: '', data: '2026-10-28', observacoes: '' };

function base(): any {
  // 3x4 => produtos 1..12
  return {
    severidade: esc(3),
    probabilidade: esc(4),
    niveis: [nv('A'), nv('B')],
    faixas: [
      { min: 1, max: 4, nivel_id: 'A' },
      { min: 5, max: 12, nivel_id: 'B' },
    ],
    metodologia: { ...metOk },
  };
}
const v = (c: unknown, publicar = false) => validarConfig(c, { publicar });

describe('validarConfig', () => {
  it('config válida 3x4 publicável', () => {
    const r = v(base(), true);
    expect(r).toEqual({ ok: true, erros: [], pendencias: [] });
  });

  it('lacuna entre faixas', () => {
    const c = base();
    c.faixas = [{ min: 1, max: 4, nivel_id: 'A' }, { min: 6, max: 12, nivel_id: 'B' }];
    const r = v(c);
    expect(r.ok).toBe(false);
    expect(r.erros.join(' ')).toMatch(/lacuna.*5/i);
  });

  it('sobreposição entre faixas', () => {
    const c = base();
    c.faixas = [{ min: 1, max: 5, nivel_id: 'A' }, { min: 5, max: 12, nivel_id: 'B' }];
    const r = v(c);
    expect(r.ok).toBe(false);
    expect(r.erros.join(' ')).toMatch(/sobrepos/i);
  });

  it('borda inclusiva: max de uma faixa e min da próxima consecutivos é válido', () => {
    expect(v(base()).ok).toBe(true);
  });

  it('não cobre o mínimo', () => {
    const c = base();
    c.faixas[0].min = 2;
    const r = v(c);
    expect(r.ok).toBe(false);
    expect(r.erros.join(' ')).toMatch(/lacuna.*1|não cobre.*1/i);
  });

  it('não cobre o máximo', () => {
    const c = base();
    c.faixas[1].max = 11;
    const r = v(c);
    expect(r.ok).toBe(false);
    expect(r.erros.join(' ')).toMatch(/12/);
  });

  it('faixa além do máximo possível é erro', () => {
    const c = base();
    c.faixas[1].max = 13;
    const r = v(c);
    expect(r.ok).toBe(false);
    expect(r.erros.join(' ')).toMatch(/13/);
  });

  it('faixa fora de ordem no array é aceita se a cobertura for total', () => {
    const c = base();
    c.faixas.reverse();
    expect(v(c).ok).toBe(true);
  });

  it('faixa com min > max', () => {
    const c = base();
    c.faixas[0] = { min: 4, max: 1, nivel_id: 'A' };
    expect(v(c).ok).toBe(false);
  });

  it('faixa com número não inteiro', () => {
    const c = base();
    c.faixas[0].max = 4.5;
    expect(v(c).ok).toBe(false);
  });

  it('cobertura total 5x5 com várias faixas', () => {
    const c = {
      severidade: esc(5),
      probabilidade: esc(5),
      niveis: [nv('A'), nv('B'), nv('C')],
      faixas: [
        { min: 1, max: 4, nivel_id: 'A' },
        { min: 5, max: 12, nivel_id: 'B' },
        { min: 13, max: 25, nivel_id: 'C' },
      ],
      metodologia: metOk,
    };
    expect(v(c, true).ok).toBe(true);
    c.faixas[2].max = 24;
    expect(v(c).ok).toBe(false);
  });

  it('escalas não quadradas 2x6 e 6x2', () => {
    const mk = (s: number, p: number) => ({
      severidade: esc(s), probabilidade: esc(p), niveis: [nv('A')],
      faixas: [{ min: 1, max: 12, nivel_id: 'A' }], metodologia: metOk,
    });
    expect(v(mk(2, 6)).ok).toBe(true);
    expect(v(mk(6, 2)).ok).toBe(true);
    const c = mk(2, 6);
    c.faixas[0].max = 11;
    expect(v(c).ok).toBe(false);
  });

  it('escala que começa em 2: cobertura vai do menor produto ao maior', () => {
    const c = base();
    c.severidade = [2, 3].map((n) => ({ valor: n, rotulo: 'TESTE s', descricao: '' }));
    c.probabilidade = [2, 5].map((n) => ({ valor: n, rotulo: 'TESTE p', descricao: '' }));
    c.faixas = [{ min: 4, max: 6, nivel_id: 'A' }, { min: 7, max: 15, nivel_id: 'B' }];
    expect(v(c).ok).toBe(true);
    c.faixas[0].min = 1; // cobre 1..3 sem produto alcançável: sobra de faixa fora do intervalo possível
    expect(v(c).ok).toBe(false);
  });

  it('nível inexistente numa faixa', () => {
    const c = base();
    c.faixas[1].nivel_id = 'ZZ';
    const r = v(c);
    expect(r.ok).toBe(false);
    expect(r.erros.join(' ')).toMatch(/ZZ/);
  });

  it('valores duplicados na escala', () => {
    const c = base();
    c.severidade[1].valor = 1;
    const r = v(c);
    expect(r.ok).toBe(false);
    expect(r.erros.join(' ')).toMatch(/severidade/i);
  });

  it('valores não crescentes', () => {
    const c = base();
    c.probabilidade = [c.probabilidade[1], c.probabilidade[0], c.probabilidade[2], c.probabilidade[3]];
    expect(v(c).ok).toBe(false);
  });

  it('valor < 1 ou não inteiro', () => {
    let c = base(); c.severidade[0].valor = 0; expect(v(c).ok).toBe(false);
    c = base(); c.severidade[0].valor = 1.5; expect(v(c).ok).toBe(false);
    c = base(); c.severidade[0].valor = '1'; expect(v(c).ok).toBe(false);
  });

  it('escala vazia', () => {
    const c = base(); c.severidade = [];
    const r = v(c);
    expect(r.ok).toBe(false);
    expect(r.erros.join(' ')).toMatch(/severidade.*vazi/i);
  });

  it('rótulo vazio ou descrição não string', () => {
    let c = base(); c.severidade[0].rotulo = '  '; expect(v(c).ok).toBe(false);
    c = base(); c.severidade[0].descricao = 5; expect(v(c).ok).toBe(false);
  });

  it('niveis com id duplicado ou vazio', () => {
    let c = base(); c.niveis[1].id = 'A'; expect(v(c).ok).toBe(false);
    c = base(); c.niveis[1].id = ''; expect(v(c).ok).toBe(false);
  });

  it('nível com campos de tipo errado', () => {
    const c = base(); c.niveis[0].bloqueia_emissao = 'sim';
    expect(v(c).ok).toBe(false);
  });

  it('nível sem faixa é pendência, não erro', () => {
    const c = base(); c.niveis.push(nv('C'));
    const r = v(c);
    expect(r.ok).toBe(true);
    expect(r.erros).toEqual([]);
    expect(r.pendencias.join(' ')).toMatch(/C/);
  });

  it('fórmula desconhecida é erro', () => {
    const c = base(); c.metodologia.formula = 'severidade+probabilidade';
    const r = v(c);
    expect(r.ok).toBe(false);
    expect(r.erros.join(' ')).toMatch(/fórmula/i);
  });

  it('metodologia incompleta bloqueia só publicar', () => {
    const c = base(); c.metodologia.validada_por = ''; c.metodologia.data = '';
    const rasc = v(c, false);
    expect(rasc.ok).toBe(true);
    expect(rasc.pendencias.length).toBeGreaterThanOrEqual(2);
    const pub = v(c, true);
    expect(pub.ok).toBe(false);
    expect(pub.pendencias.length).toBeGreaterThanOrEqual(2);
  });

  it('metodologia ausente: rascunho ok com pendência; publicar bloqueia', () => {
    const c = base(); delete c.metodologia;
    expect(v(c, false).ok).toBe(true);
    expect(v(c, false).pendencias.length).toBeGreaterThan(0);
    expect(v(c, true).ok).toBe(false);
  });

  it('registro e observacoes são opcionais', () => {
    const c = base(); delete c.metodologia.registro; delete c.metodologia.observacoes;
    expect(v(c, true).ok).toBe(true);
  });

  it('data inválida é erro estrutural', () => {
    for (const d of ['2026-02-30', '28/10/2026', '2026-13-01', 'abc']) {
      const c = base(); c.metodologia.data = d;
      expect(v(c, false).ok).toBe(false);
    }
    const c = base(); c.metodologia.data = '2024-02-29';
    expect(v(c, true).ok).toBe(true);
  });

  it('entrada não-objeto ou lixo não lança', () => {
    for (const x of [null, undefined, 5, 'x', [], true, { severidade: 'a', probabilidade: {}, niveis: null, faixas: 3 }, {}]) {
      let r: any;
      expect(() => { r = v(x); }).not.toThrow();
      expect(r.ok).toBe(false);
      expect(r.erros.length).toBeGreaterThan(0);
    }
    expect(() => v({ ...base(), faixas: [null, 1, 'x'], niveis: [null], severidade: [null] })).not.toThrow();
  });
});

describe('calcular', () => {
  it('score, nível e faixa; bordas inclusivas', () => {
    const c = base();
    expect(calcular(c, 1, 4)).toEqual({ score: 4, nivel_id: 'A', nivel: c.niveis[0], faixa: c.faixas[0] });
    expect(calcular(c, 2, 3).nivel_id).toBe('B'); // 6
    expect(calcular(c, 3, 4)).toMatchObject({ score: 12, nivel_id: 'B' });
    expect(calcular(c, 1, 5 - 1).score).toBe(4);
    expect(calcular(c, 1, 3)).toMatchObject({ score: 3, nivel_id: 'A' });
  });

  it('fora da escala lança erro tipado', () => {
    const c = base();
    expect(() => calcular(c, 4, 1)).toThrow(MatrizForaDaEscalaError);
    expect(() => calcular(c, 1, 5)).toThrow(MatrizForaDaEscalaError);
    expect(() => calcular(c, 0, 1)).toThrow(MatrizForaDaEscalaError);
    expect(() => calcular(c, 1.5, 1)).toThrow(MatrizForaDaEscalaError);
    expect(() => calcular(c, NaN, 1)).toThrow(MatrizForaDaEscalaError);
  });

  it('sem faixa cobrindo o score lança erro tipado', () => {
    const c = base(); c.faixas = [{ min: 1, max: 4, nivel_id: 'A' }];
    expect(() => calcular(c, 3, 4)).toThrow(MatrizSemFaixaError);
  });
});

describe('celulas', () => {
  it('uma célula por par com score e nivel_id', () => {
    const c = base();
    const cel = celulas(c);
    expect(cel).toHaveLength(12);
    expect(cel).toContainEqual({ severidade: 3, probabilidade: 4, score: 12, nivel_id: 'B' });
    expect(cel).toContainEqual({ severidade: 1, probabilidade: 1, score: 1, nivel_id: 'A' });
  });
});

describe('sha256Canonico', () => {
  it('hex de 64 e estável à ordem das chaves', () => {
    const a = base();
    const b: any = {};
    for (const k of Object.keys(a).reverse()) b[k] = a[k];
    b.niveis = a.niveis.map((n: any) => Object.fromEntries(Object.entries(n).reverse()));
    const h = sha256Canonico(a);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Canonico(b)).toBe(h);
    expect(sha256Canonico(JSON.parse(JSON.stringify(a)))).toBe(h);
  });

  it('muda com qualquer valor', () => {
    const h = sha256Canonico(base());
    let c = base(); c.severidade[0].rotulo += 'x'; expect(sha256Canonico(c)).not.toBe(h);
    c = base(); c.faixas[0].max = 3; expect(sha256Canonico(c)).not.toBe(h);
    c = base(); c.niveis[0].bloqueia_emissao = true; expect(sha256Canonico(c)).not.toBe(h);
    c = base(); c.metodologia.data = '2026-10-29'; expect(sha256Canonico(c)).not.toBe(h);
  });

  it('ordem de arrays importa', () => {
    const c = base(); c.faixas.reverse();
    expect(sha256Canonico(c)).not.toBe(sha256Canonico(base()));
  });
});

describe('limites e robustez (fix round 1)', () => {
  it('escala gigante (60k) rejeitada rápido', () => {
    const c = base();
    c.severidade = Array.from({ length: 60000 }, (_, i) => ({ valor: i + 1, rotulo: 'TESTE x', descricao: '' }));
    const t0 = Date.now();
    const r = v(c);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.ok).toBe(false);
    expect(r.erros.join(' ')).toMatch(/itens demais/);
  });

  it('niveis > 100 e faixas > 100 rejeitados', () => {
    let c = base();
    c.niveis = Array.from({ length: 101 }, (_, i) => nv(`N${i}`));
    expect(v(c).erros.join(' ')).toMatch(/niveis.*demais/);
    c = base();
    c.faixas = Array.from({ length: 101 }, () => ({ min: 1, max: 1, nivel_id: 'A' }));
    expect(v(c).erros.join(' ')).toMatch(/faixas.*demais/);
  });

  it('escala com 21 itens rejeitada, 20 aceita na estrutura', () => {
    const c = base(); c.severidade = esc(21);
    expect(v(c).ok).toBe(false);
    c.severidade = esc(20);
    c.faixas = [{ min: 1, max: 80, nivel_id: 'A' }];
    expect(v(c).ok).toBe(true);
  });

  it('valores enormes: 1e9, 1e200, Infinity, valor > 1000', () => {
    for (const x of [1e9, 1e200, Infinity, 1001, Number.MAX_SAFE_INTEGER + 2]) {
      let c = base(); c.severidade[2].valor = x;
      let r = v(c); expect(r.ok).toBe(false);
      expect(r.erros.join(' ')).not.toMatch(/Infinity|NaN/);
      c = base(); c.faixas[1].max = x;
      r = v(c); expect(r.ok).toBe(false);
      expect(r.erros.join(' ')).not.toMatch(/Infinity|NaN/);
    }
  });

  it('chaves __proto__/constructor não poluem nem lançam', () => {
    const c = JSON.parse(
      '{"__proto__":{"polluted":1},"constructor":{"x":1},"severidade":[],"probabilidade":[],"niveis":[],"faixas":[]}',
    );
    expect(() => v(c)).not.toThrow();
    expect(() => sha256Canonico(c)).not.toThrow();
    expect(({} as any).polluted).toBeUndefined();
  });

  it('faixa contida em outra é sobreposição', () => {
    const c = base();
    c.faixas = [{ min: 1, max: 12, nivel_id: 'A' }, { min: 3, max: 5, nivel_id: 'B' }];
    expect(v(c).erros.join(' ')).toMatch(/sobrepos/i);
  });

  it('faixa com min == max (borda) é válida', () => {
    const c = base();
    c.faixas = [{ min: 1, max: 1, nivel_id: 'A' }, { min: 2, max: 12, nivel_id: 'B' }];
    expect(v(c).ok).toBe(true);
  });

  it('formula null ou undefined é pendência, não erro', () => {
    for (const f of [null, undefined]) {
      const c = base(); c.metodologia.formula = f;
      const r = v(c, false);
      expect(r.ok).toBe(true);
      expect(r.pendencias.join(' ')).toMatch(/fórmula/i);
      expect(v(c, true).ok).toBe(false);
    }
  });

  it('hash: -0 igual a 0, unicode estável, undefined ignorado', () => {
    expect(sha256Canonico({ a: -0 })).toBe(sha256Canonico({ a: 0 }));
    expect(sha256Canonico({ a: 'ação ✓ 😀' })).toBe(sha256Canonico({ a: 'ação ✓ 😀' }));
    expect(sha256Canonico({ a: 'ação' })).not.toBe(sha256Canonico({ a: 'acao' }));
    expect(sha256Canonico({ a: 1, b: undefined })).toBe(sha256Canonico({ a: 1 }));
  });

  it('hash: NaN, Infinity, bigint, função, circular, profundo, não simples => erro tipado', () => {
    const circ: any = {}; circ.self = circ;
    let fundo: any = {}; const raiz = fundo;
    for (let i = 0; i < 30; i++) { fundo.n = {}; fundo = fundo.n; }
    for (const x of [{ a: NaN }, { a: Infinity }, { a: BigInt(1) }, { a: () => 1 }, circ, raiz, { d: new Date() }, new Map()]) {
      expect(() => sha256Canonico(x)).toThrow(MatrizHashInvalidoError);
    }
  });
});

describe('validarConfig — lista branca de chaves (todos os níveis)', () => {
  it('raiz, escala, nível, faixa e metodologia: chave desconhecida ⇒ erro pt-BR (rascunho e publicar)', () => {
    const casos: Array<[string, (c: any) => void, RegExp]> = [
      ['raiz', (c) => { c.extra = 1; }, /Configuração: campo desconhecido "extra"/],
      ['severidade', (c) => { c.severidade[0].peso = 3; }, /Escala severidade\[1\]: campo desconhecido "peso"/],
      ['probabilidade', (c) => { c.probabilidade[1].cor = 'x'; }, /Escala probabilidade\[2\]: campo desconhecido "cor"/],
      ['nível', (c) => { c.niveis[0].cor = 'x'; }, /Nível niveis\[1\]: campo desconhecido "cor"/],
      ['faixa', (c) => { c.faixas[0].rotulo = 'x'; }, /Faixa faixas\[1\]: campo desconhecido "rotulo"/],
      ['metodologia', (c) => { c.metodologia.aprovado = true; }, /Metodologia: campo desconhecido "aprovado"/],
    ];
    for (const [, mut, re] of casos) {
      const c = base();
      mut(c);
      for (const publicar of [false, true]) {
        const r = v(c, publicar);
        expect(r.ok).toBe(false);
        expect(r.erros.join(' ')).toMatch(re);
      }
    }
  });

  it('chave enorme é truncada na mensagem; config válida segue ok', () => {
    const c = base();
    c['x'.repeat(500)] = 1;
    expect(v(c).erros.join(' ').length).toBeLessThan(400);
    expect(v(base(), true).ok).toBe(true);
  });
});
