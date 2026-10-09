import { extractHtmlText } from '../src/normative/normative-monitor.service';
import { normalizeForComparison } from '../src/normative/normative-text.util';

describe('extractHtmlText (quebras de linha em elementos de bloco)', () => {
  it('(a) parágrafos viram linhas', () => {
    expect(extractHtmlText('<p>A</p><p>B</p>')).toBe('A\nB');
  });

  it('(b) tags inline não quebram linha', () => {
    expect(extractHtmlText('Art. <b>1º</b> Fica <a href=x>aqui</a>')).toBe('Art. 1º Fica aqui');
    const inline = extractHtmlText('<p>x <span>y</span> <i>z</i> <sup>1</sup> <u>w</u></p>');
    expect(inline).toBe('x y z 1 w');
  });

  it('(c) <br> e itens de lista quebram linha', () => {
    expect(extractHtmlText('linha 1<br>linha 2<br/>linha 3')).toBe('linha 1\nlinha 2\nlinha 3');
    expect(extractHtmlText('<ul><li>um</li><li>dois</li></ul><ol><li>três</li></ol>')).toBe('um\ndois\ntrês');
  });

  it('(d) script e style são removidos', () => {
    const html = '<style>p{color:red}</style><p>Texto</p><script>var a = "<p>x</p>";</script><p>Fim</p>';
    expect(extractHtmlText(html)).toBe('Texto\nFim');
  });

  it('(e) &nbsp; e espaços múltiplos colapsam dentro da linha', () => {
    expect(extractHtmlText('<p>  Art.&nbsp;1º \t  Fica&nbsp;&nbsp; valendo  </p>')).toBe('Art. 1º Fica valendo');
  });

  it('(f) nunca há linha vazia nem duas quebras seguidas', () => {
    const html = '<div>\n\n<p>A</p>\n\n<p> &nbsp; </p><br><br><p>B</p><table><tr><td>C</td></tr></table></div>';
    const text = extractHtmlText(html);
    expect(text).not.toContain('\n\n');
    expect(text.split('\n').every((l) => l.length > 0 && l === l.trim())).toBe(true);
    expect(text).toBe('A\nB\nC');
  });

  it('(g) preserva o escopo content-core', () => {
    const html = '<header><p>Menu</p></header><div id="content-core"><p>Art. 1</p><p>Art. 2</p></div><div id="viewlet-below-content"><p>Rodapé</p></div>';
    const text = extractHtmlText(html);
    expect(text.startsWith('Art. 1\nArt. 2')).toBe(true);
    expect(text).not.toContain('Menu');
    expect(text).not.toContain('Rodapé');
  });

  it('(h) não gera pendente falso: texto antigo colapsado e novo com quebras são iguais após normalizar', () => {
    const html = `
      <html><body><style>.a{}</style>
        <h1>Norma  X</h1>
        <p>Art. 1º  Esta norma&nbsp;estabelece <b>regras</b>.</p>
        <ul><li>I - item um;</li><li>II - item dois.</li></ul>
        <p>Art. 2º Fica <a href="#">revogado</a> o anterior.<br>Parágrafo único.</p>
        <script>x()</script>
      </body></html>`;
    const antigo = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const novo = extractHtmlText(html);
    expect(novo).toContain('\n');
    expect(antigo).not.toContain('\n');
    expect(normalizeForComparison(novo)).toBe(normalizeForComparison(antigo));
  });

  it('(i) desempenho: ~3,5 MB extrai em menos de 1 s', () => {
    const p = '<p class="x">Art. <b>1º</b> Texto de exemplo da norma com algum conteúdo&nbsp;razoável.</p>\n';
    const html = '<html><body>' + p.repeat(30000) + '</body></html>';
    expect(html.length).toBeGreaterThan(2_500_000);
    const t0 = Date.now();
    const text = extractHtmlText(html);
    const ms = Date.now() - t0;
    console.log(`extractHtmlText: ${html.length} bytes em ${ms} ms`);
    expect(text.split('\n')).toHaveLength(30000);
    expect(ms).toBeLessThan(1000);
  });
  it('comentários HTML com tag de bloco não mudam o texto normalizado vs. a regra antiga', () => {
    const antiga = (h: string) =>
      h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const casos = [
      '<p>A</p><!-- <li>x</li> --><p>B</p>',
      '<p>A</p><!-- <header class="a"> --><p>B</p>',
      '<p>A</p><!--\n<li class="y">item</li>\n--><p>B</p>',
    ];
    for (const h of casos) {
      expect(normalizeForComparison(extractHtmlText(h))).toBe(normalizeForComparison(antiga(h)));
    }
  });
});
