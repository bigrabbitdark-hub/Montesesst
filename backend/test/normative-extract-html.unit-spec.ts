import { extractHtmlText, PLANALTO_EXTRACT_OPTIONS } from '../src/normative/normative-monitor.service';
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

// Modo Planalto (dropStruck + espaço em branco do HTML). Todos os casos abaixo são SINTÉTICOS, montados com a mesma
// marcação encontrada nas páginas reais do planalto.gov.br (trechos reais em planalto-extract.unit-spec.ts).
describe('extractHtmlText — modo Planalto (texto riscado descartado)', () => {
  const pl = (html: string) => extractHtmlText(html, PLANALTO_EXTRACT_OPTIONS);

  it('sem opções a saída é a de sempre (texto riscado mantido e quebras de linha da fonte preservadas)', () => {
    const html = '<p><strike>Art. 1º Velho.</strike></p><p>Art. 1º Novo\ncontinua.</p>';
    expect(extractHtmlText(html)).toBe('Art. 1º Velho.\nArt. 1º Novo\ncontinua.');
    expect(extractHtmlText(html, {})).toBe(extractHtmlText(html));
  });

  it('descarta <strike>, <s> e elementos com text-decoration: line-through (inclusive aninhados)', () => {
    expect(pl('<p><strike>Art. 1º Velho.</strike></p><p>Art. 1º Novo.</p>')).toBe('Art. 1º Novo.');
    expect(pl('<p>Fica <s>revogado</s> mantido.</p>')).toBe('Fica mantido.');
    const span = '<p><span style="color:black; text-decoration:line-through">Art. 2º <span>Velho</span> <b>texto</b>.</span> Art. 2º Novo.</p>';
    expect(pl(span)).toBe('Art. 2º Novo.');
    expect(pl('<p><SPAN STYLE="TEXT-DECORATION: LINE-THROUGH">x</SPAN>y</p>')).toBe('y');
  });

  it('quebra de linha da fonte vira espaço; só elemento de bloco quebra linha', () => {
    expect(pl('<p>Art.\r\n191 - A eliminação\nocorrerá:</p><p>I -\ncom a adoção</p>')).toBe('Art. 191 - A eliminação ocorrerá:\nI - com a adoção');
    expect(pl('linha 1<br>linha 2')).toBe('linha 1\nlinha 2');
  });

  it('<strike> não fechado termina no fim do bloco: não engole o documento', () => {
    expect(pl('<p><strike>Art. 3º Velho.</p><p>Art. 3º Novo.</p><p>Art. 4º Outro.</p>')).toBe('Art. 3º Novo.\nArt. 4º Outro.');
    expect(pl('<div><span style="text-decoration:line-through">velho</div><p>novo</p>')).toBe('novo');
    expect(pl('<p>a</strike> b</p>')).toBe('a b');
  });

  it('ordinal riscado sozinho (<s>º</s>, <strike><sup>o</sup></strike>) herda o estado do texto anterior do bloco', () => {
    // Mantido no texto vigente (tags viram espaço, como em "§ 1<sup>o</sup>" → "§ 1 o"), descartado no riscado.
    expect(pl('<p>§ 1<s>º</s> Para os fins.</p>')).toBe('§ 1 º Para os fins.');
    expect(pl('<p>Lei n<s><span style="color: black">º</span></s> 11.959</p>')).toBe('Lei n º 11.959');
    expect(pl('<p>da Lei\nn<strike><sup><u>o</u></sup></strike> 8.212, de 1991</p>')).toBe('da Lei n o 8.212, de 1991');
    expect(pl('<p>Novo.</p><p><strike>§ 2</strike><s>º</s><strike> do art. 68.</strike></p>')).toBe('Novo.');
    expect(pl('<p>Novo.</p><p><strike>Lei n</strike><strike><sup>o</sup></strike><strike> 1.</strike></p>')).toBe('Novo.');
  });

  it('dispositivo revogado inteiro: fica o endereço com a nota de revogação (sem a redação riscada)', () => {
    const html =
      '<p><strike><a name="art70"></a>Art.&nbsp;70.&nbsp;&nbsp;A conversão de tempo.<br>Parágrafo único. Velho.</strike>' +
      '<font><a href="x">(Revogado pelo Decreto nº 10.410, de 2020).</a></font></p>' +
      '<p><strike>§&nbsp;1<sup><u>o</u></sup>&nbsp;&nbsp;A caracterização.</strike> (Revogado pelo Decreto nº 10.410, de 2020).</p>' +
      '<p><strike>Art. 17 - Velho.</strike>) (Revogado pela Lei nº 13.874, de 2019)</p>' +
      '<p><strike>f) o diretor.</strike>(Revogado pelo Decreto nº 10.410, de 2020).</p>';
    expect(pl(html).split('\n')).toEqual([
      'Art. 70. (Revogado pelo Decreto nº 10.410, de 2020).',
      '§ 1 o (Revogado pelo Decreto nº 10.410, de 2020).',
      'Art. 17 - (Revogado pela Lei nº 13.874, de 2019)',
      'f) (Revogado pelo Decreto nº 10.410, de 2020).',
    ]);
  });

  it('nota solta de redação riscada sem revogação ("Vigência encerrada", "Redação dada…", "Vide…") é descartada', () => {
    const html =
      '<p>Art. 11. Vigente.</p>' +
      '<p><strike>Art. 12-A. Texto de MP.</strike> (Vigência encerrada)</p>' +
      '<p><strike>§ 3º Texto de MP.</strike> Vigência encerrada</p>' +
      '<p><strike>Art. 81. Velho.</strike> (Vide Lei nº 8.213, de 1991)</p>' +
      '<p><strike>Art. 82. Velho.</strike> (Revogado pela Medida Provisória n. 955, de 2020) Vigência encerrada</p>';
    expect(pl(html)).toBe('Art. 11. Vigente.');
  });

  it('pedaços sem risco DENTRO de um parágrafo riscado (links, letra solta) são da redação revogada e saem', () => {
    const html =
      '<p><strike>§ 11. O magistrado nomeado na forma do </strike><a href="x">inciso II do art. 111</a>' +
      '<strike> ou do </strike><a href="y">art. 116</a><strike>, mantêm o enquadramento.</strike></p>' +
      '<p><a name="art28"></a>A<strike>rt. 28. Serão arquivadas.</strike></p>' +
      '<p>Art. 29. Vigente.</p>';
    expect(pl(html)).toBe('Art. 29. Vigente.');
  });

  it('SINTÉTICO (caso do revisor): <br> separa dispositivos — artigo VIGENTE entre trechos riscados não vira revogação falsa', () => {
    const html =
      '<p><strike>Art. 5º Redação antiga.</strike><br>Art. 5º Redação vigente que importa.<br>' +
      '<strike>§ 1º antigo</strike> (Revogado pela Lei nº 1, de 2000)</p><p>Art. 6º Seguinte.</p>';
    expect(pl(html)).toBe('Art. 5º Redação vigente que importa.\n§ 1º (Revogado pela Lei nº 1, de 2000)\nArt. 6º Seguinte.');
    // Forma mínima do relato: "Art. 5º antigo" riscado, "Art. 5º vigente", "§1º" riscado + nota.
    expect(pl('<p><strike>Art. 5º antigo</strike><br>Art. 5º vigente<br><strike>§1º</strike> (Revogado…)</p>')).toBe(
      'Art. 5º vigente\n§1º (Revogado…)',
    );
  });

  it('SINTÉTICO: <strike> não fechado termina na primeira quebra de linha (<br>) — não engole os artigos seguintes do bloco', () => {
    expect(
      pl('<font>Art. 1º Vigente. <strike>riscado sem fechar<br>Art. 2º Vigente.<br>Art. 3º Vigente.</font><p>Art. 4º Depois.</p>'),
    ).toBe('Art. 1º Vigente.\nArt. 2º Vigente.\nArt. 3º Vigente.\nArt. 4º Depois.');
    expect(pl('<table><tr><td>Art. 1º Texto <strike>antigo<br>Art. 2º Vigente na mesma célula.</td></tr></table>')).toBe(
      'Art. 1º Texto\nArt. 2º Vigente na mesma célula.',
    );
    expect(pl('<p><span style="text-decoration:line-through">Art. 7º Velho.<br>Art. 7º Novo.</p>')).toBe('Art. 7º Novo.');
    // Risco FECHADO que atravessa <br> continua riscado inteiro (art. 70 revogado com o parágrafo único dentro do <strike>).
    expect(pl('<p><strike>Art. 70. Velho.<br>Parágrafo único. Velho.</strike> (Revogado pelo Decreto nº 10.410, de 2020).</p>')).toBe(
      'Art. 70. (Revogado pelo Decreto nº 10.410, de 2020).',
    );
  });

  it('SINTÉTICO: entidades HTML são decodificadas no modo Planalto (nomeadas, decimais, hexadecimais; 128–159 pela tabela windows-1252)', () => {
    expect(pl('<p>alíneas &quot;i&quot; e &quot;l&quot; &amp; &lt;b&gt; Social&#150;INSS a&#768; obrigatoriedade &#8212; &#x2013; &apos;x&apos;</p>')).toBe(
      'alíneas "i" e "l" & <b> Social–INSS à obrigatoriedade — – \'x\'',
    );
    // Uma passada só: "&amp;lt;" é o texto "&lt;", não "<". Entidade desconhecida fica como está; &#0; vira U+FFFD.
    expect(pl('<p>&amp;lt; &foo; &#0;</p>')).toBe('&lt; &foo; �');
    // Espaço/quebra vindos de entidade são espaço comum (não criam linha nem dispositivo).
    expect(pl('<p>Art. 1º a&#10;Art. 2º b&#160;c</p>')).toBe('Art. 1º a Art. 2º b c');
    // Sem o modo Planalto a saída é a de sempre (hash das demais fontes inalterado).
    expect(extractHtmlText('<p>&quot;x&quot; &#150;</p>')).toBe('&quot;x&quot; &#150;');
  });

  it('parágrafo vigente com trecho riscado no meio: só o trecho riscado sai', () => {
    expect(pl('<p>II - atividades insalubres em grau médio, <strike>quando apresentar atestado,</strike> durante a lactação.</p>')).toBe(
      'II - atividades insalubres em grau médio, durante a lactação.',
    );
  });
});
