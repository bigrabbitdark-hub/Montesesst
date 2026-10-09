import { diffParagraphs, splitParagraphs } from '../src/normative/paragraph-diff.util';

const texto = (...ps: string[]) => ps.join('\n');

describe('splitParagraphs', () => {
  it('quebra por linha, colapsa espaços, descarta vazios', () => {
    expect(splitParagraphs('  Art. 1º   Fica\n\n\nArt. 2º  \n')).toEqual(['Art. 1º Fica', 'Art. 2º']);
  });
  it('texto vazio dá lista vazia', () => {
    expect(splitParagraphs('  \n \n')).toEqual([]);
  });
});

describe('diffParagraphs', () => {
  it('textos iguais: sem alterações', () => {
    const d = diffParagraphs(texto('a', 'b', 'c'), texto('a', 'b', 'c'));
    expect(d.summary).toEqual({ added: 0, removed: 0, unchanged: 3 });
    expect(d.hunks.filter((h) => h.kind !== 'context')).toEqual([]);
    expect(d.truncated).toBe(false);
  });

  it('um parágrafo alterado vira 1 removido + 1 adicionado, com contexto', () => {
    const d = diffParagraphs(texto('a', 'b', 'c', 'd'), texto('a', 'B', 'c', 'd'));
    expect(d.summary).toEqual({ added: 1, removed: 1, unchanged: 3 });
    const mudancas = d.hunks.filter((h) => h.kind !== 'context');
    expect(mudancas).toEqual([
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
    ]);
    expect(d.hunks.some((h) => h.kind === 'context' && h.text === 'a')).toBe(true);
  });

  it('parágrafo inserido no meio e outro removido', () => {
    const d = diffParagraphs(texto('a', 'b', 'c', 'd', 'e'), texto('a', 'b', 'NOVO', 'c', 'e'));
    expect(d.summary).toEqual({ added: 1, removed: 1, unchanged: 4 });
    expect(d.hunks.filter((h) => h.kind === 'added').map((h) => h.text)).toEqual(['NOVO']);
    expect(d.hunks.filter((h) => h.kind === 'removed').map((h) => h.text)).toEqual(['d']);
  });

  it('ignora diferença só de espaços', () => {
    const d = diffParagraphs('Art.  1º  Fica', 'Art. 1º Fica');
    expect(d.summary).toEqual({ added: 0, removed: 0, unchanged: 1 });
  });

  it('sem versão anterior (texto antigo vazio): tudo adicionado', () => {
    const d = diffParagraphs('', texto('a', 'b'));
    expect(d.summary).toEqual({ added: 2, removed: 0, unchanged: 0 });
  });

  it('blocos grandes sem mudança viram um único contexto resumido', () => {
    const base = Array.from({ length: 50 }, (_, i) => `p${i}`);
    const novo = [...base];
    novo[25] = 'MUDOU';
    const d = diffParagraphs(base.join('\n'), novo.join('\n'));
    expect(d.hunks.length).toBeLessThan(12);
    expect(d.hunks.some((h) => h.kind === 'context' && /parágrafos sem mudança/.test(h.text))).toBe(true);
  });

  it('limita a 500 trechos alterados e marca truncated', () => {
    const velho = Array.from({ length: 600 }, (_, i) => `velho ${i}`).join('\n');
    const novo = Array.from({ length: 600 }, (_, i) => `novo ${i}`).join('\n');
    const d = diffParagraphs(velho, novo);
    expect(d.summary.removed).toBe(600);
    expect(d.summary.added).toBe(600);
    expect(d.hunks.filter((h) => h.kind !== 'context').length).toBeLessThanOrEqual(500);
    expect(d.truncated).toBe(true);
    expect(d.hunks[d.hunks.length - 1].text).toMatch(/parágrafos não exibidos/);
  });

  it('documento enorme (miolo acima de 4 M células): cai para diferença sem ordem e marca truncated', () => {
    const n = 2500;
    const velho = Array.from({ length: n }, (_, i) => `v${i}`);
    const novo = Array.from({ length: n }, (_, i) => `n${i}`);
    novo[10] = 'v10'; // um parágrafo em comum, para provar que não vira tudo "novo"
    const d = diffParagraphs(velho.join('\n'), novo.join('\n'));
    expect(d.truncated).toBe(true);
    expect(d.summary.unchanged).toBe(1);
    expect(d.summary.removed).toBe(n - 1);
    expect(d.summary.added).toBe(n - 1);
  });

  it('desempenho: 20 mil parágrafos com ~40 mudanças dispersas roda em menos de 3 s', () => {
    const base = Array.from({ length: 20000 }, (_, i) => `Parágrafo número ${i} do texto normativo.`);
    const novo = [...base];
    for (let i = 0; i < 40; i++) novo[i * 500] = `ALTERADO ${i}`;
    const inicio = Date.now();
    const d = diffParagraphs(base.join('\n'), novo.join('\n'));
    expect(Date.now() - inicio).toBeLessThan(3000);
    expect(d.summary.added).toBe(40);
    expect(d.summary.removed).toBe(40);
    expect(d.truncated).toBe(false);
  });

  it('corte em 500 após bloco sem mudança: rótulos separados e contagens corretas', () => {
    const a: string[] = [];
    const b: string[] = [];
    for (let i = 0; i < 250; i++) {
      a.push(`o${i}`, `igual-a${i}`);
      b.push(`n${i}`, `igual-a${i}`);
    }
    for (let i = 0; i < 10; i++) {
      a.push(`fixo${i}`);
      b.push(`fixo${i}`);
    }
    for (let i = 0; i < 10; i++) {
      a.push(`xo${i}`);
      b.push(`xn${i}`);
    }
    const d = diffParagraphs(a.join('\n'), b.join('\n'));
    expect(d.truncated).toBe(true);
    const ctx = d.hunks.filter((h) => h.kind === 'context').map((h) => h.text);
    const semMudanca = ctx.findIndex((t) => /parágrafos sem mudança/.test(t));
    const naoExibidos = ctx.findIndex((t) => /parágrafos não exibidos/.test(t));
    expect(semMudanca).toBeGreaterThanOrEqual(0);
    expect(naoExibidos).toBeGreaterThan(semMudanca);
    expect(ctx.filter((t) => /não exibidos/.test(t) && /sem mudança/.test(t))).toEqual([]);
    expect(d.hunks[d.hunks.length - 1].text).toMatch(/^… \d+ parágrafos não exibidos …$/);
    // o que vem depois do corte: 10 fixos + 20 alterações menos o contexto já exibido (<= 30)
    const n = Number(/(\d+)/.exec(d.hunks[d.hunks.length - 1].text)![1]);
    expect(n).toBeGreaterThanOrEqual(20);
    expect(n).toBeLessThanOrEqual(30);
  });

  it('propriedade: conserva as sequências original e nova (PRNG fixo)', () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let caso = 0; caso < 300; caso++) {
      const vocab = 1 + Math.floor(rnd() * 8);
      const gera = () => Array.from({ length: Math.floor(rnd() * 31) }, () => `p${Math.floor(rnd() * vocab)}`);
      const A = gera();
      const B = gera();
      const d = diffParagraphs(A.join('\n'), B.join('\n'));
      expect(d.summary.unchanged + d.summary.removed).toBe(A.length);
      expect(d.summary.unchanged + d.summary.added).toBe(B.length);
      const colapsou = d.hunks.some((h) => h.kind === 'context' && h.text.startsWith('…'));
      if (!d.truncated && !colapsou) {
        const velho = d.hunks.filter((h) => h.kind !== 'added').map((h) => h.text);
        const novo = d.hunks.filter((h) => h.kind !== 'removed').map((h) => h.text);
        expect(velho).toEqual(A);
        expect(novo).toEqual(B);
      }
    }
  });
});
