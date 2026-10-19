import { extractBoundedText } from '../src/employees/employee-document-text';
import { extractLocalPeople } from '../src/employees/employee-text-extractor';
import { Cpf, DOCX_MIME, PDF_MIME, P, docxFrom, dtable, makeCpf, pdfFromLines } from './employee-docgen';

// CORPUS sintético de layouts + PRECISÃO/RECALL do extrator local, com os GERADORES e os EXTRATORES REAIS
// (pdfkit -> pdf-parse; docx -> mammoth, ambos via extractBoundedText, o caminho de produção).
// Piso afirmado: precisão de CPF e de NOME = 100% e nenhum valor atribuído à pessoa errada. Ausência é aceitável (recall).
jest.setTimeout(120_000);

type Gold = { name: string; cpf: Cpf; position?: string; adm?: string; birth?: string; sex?: 'F' | 'M' };
type Doc = { id: string; layout: string; mime: string; build: () => Promise<Buffer>; gold: Gold[] };
type Field = 'cpf' | 'full_name' | 'position' | 'admission_date' | 'birth_date' | 'sex';
const FIELDS: Field[] = ['cpf', 'full_name', 'position', 'admission_date', 'birth_date', 'sex'];

const FIRST = ['ALINE', 'BENTO', 'CELIA', 'DANILO', 'ELOISA', 'FABIANO', 'GISLENE', 'HERMES', 'IVONE', 'JOCELIO'];
const LAST = ['AGUIAR', 'BARROS', 'CAMPOS', 'DUARTE', 'ESTEVES', 'FARIAS', 'GOMES', 'HOLANDA', 'IBANEZ', 'JARDIM', 'KRUGER', 'LIMA', 'MOTA', 'NOVAIS', 'OLIVEIRA', 'PAIVA', 'QUEIROZ', 'RAMOS', 'SOUZA', 'TAVARES'];
const CARGOS = ['SOLDADOR', 'ELETRICISTA', 'PINTOR', 'AUXILIAR DE PRODUCAO', 'OPERADOR DE MAQUINAS', 'MOTORISTA', 'ALMOXARIFE', 'MECANICO'];
let seq = 0;
const mk = (opts: Partial<Pick<Gold, 'position' | 'adm' | 'birth' | 'sex'>> & { all?: boolean; name?: string } = {}): Gold => {
  const i = seq++;
  const g: Gold = { name: opts.name ?? `${FIRST[i % 10]} ${LAST[Math.floor(i / 10) % 20]} FICTICIO${i >= 200 ? String.fromCharCode(65 + (Math.floor(i / 200) % 26)) : ''}`, cpf: makeCpf(500 + i) };
  const all = opts.all !== false;
  if (all) { g.position = CARGOS[i % 8]; g.adm = `${String(1 + (i % 28)).padStart(2, '0')}/${String(1 + (i % 12)).padStart(2, '0')}/${2005 + (i % 18)}`; }
  Object.assign(g, Object.fromEntries(Object.entries(opts).filter(([k]) => k !== 'all' && k !== 'name')));
  return g;
};
const people = (n: number, o: Parameters<typeof mk>[0] = {}) => Array.from({ length: n }, () => mk(o));
const dash = (d?: string) => d?.replace(/\//g, '-');
const bd = (i: number) => `${String(2 + (i % 26)).padStart(2, '0')}/${String(1 + ((i * 5) % 12)).padStart(2, '0')}/${1960 + (i % 40)}`;

// ---- linhas por layout ----
const fichaN = (g: Gold, cpf = g.cpf.fmt) => [`Nome: ${g.name}`, `CPF: ${cpf}`, ...(g.position ? [`Função: ${g.position}`] : []), ...(g.adm ? [`Admissão: ${g.adm}`] : [])];
const fichaC = (g: Gold, cpf = g.cpf.fmt) => [`CPF: ${cpf}`, `Nome: ${g.name}`, ...(g.position ? [`Função: ${g.position}`] : []), ...(g.adm ? [`Admissão: ${g.adm}`] : [])];
const linhaLista = (g: Gold) => `${g.name} ${g.cpf.fmt} ${g.position ?? ''}`.trim();
const pipeRow = (g: Gold) => `${g.name} | ${g.cpf.fmt} | ${g.position ?? ''} | ${g.adm ?? ''}`;
const withBlank = (blocks: string[][]) => blocks.flatMap((b) => [...b, null]);

const docs: Doc[] = [];
const add = (id: string, layout: string, mime: string, gold: Gold[], build: () => Promise<Buffer>) => docs.push({ id, layout, mime, build, gold });
const pdfDoc = (id: string, layout: string, gold: Gold[], lines: () => (string | null)[]) => add(id, layout, PDF_MIME, gold, () => pdfFromLines(lines()));
const docxDoc = (id: string, layout: string, gold: Gold[], children: () => any[]) => add(id, layout, DOCX_MIME, gold, () => docxFrom(children()));

{ const g = people(4); pdfDoc('01', 'PDF ficha vertical nome-primeiro', g, () => g.flatMap((x) => fichaN(x))); }
{ const g = people(4); pdfDoc('02', 'PDF ficha vertical cpf-primeiro', g, () => g.flatMap((x) => fichaC(x))); }
{ const g = people(5); pdfDoc('03', 'PDF lista por linha (nome cpf cargo)', g, () => ['Lista de funcionarios FICTICIA', ...g.map(linhaLista)]); }
{ const g = people(4); docxDoc('04', 'DOCX ficha vertical nome-primeiro', g, () => g.flatMap((x) => fichaN(x).map(P))); }
{ const g = people(4); docxDoc('05', 'DOCX ficha vertical cpf-primeiro', g, () => g.flatMap((x) => [...fichaC(x).map(P), P('')])); }
{ const g = people(5); docxDoc('06', 'DOCX tabela com cabeçalho', g, () => [dtable([['Nome', 'CPF', 'Função', 'Admissão'], ...g.map((x) => [x.name, x.cpf.fmt, x.position!, x.adm!])])]); }
{ const g = people(5); pdfDoc('07', 'PDF tabela por linha com |', g, () => ['Nome | CPF | Função | Admissão', ...g.map(pipeRow)]); }
{ const g = people(4); pdfDoc('08', 'PDF ficha CPF sem pontuação', g, () => g.flatMap((x) => fichaN(x, x.cpf.raw))); }
{ const g = people(4).map((x) => ({ ...x, adm: undefined })); docxDoc('09', 'DOCX tabela CPF sem pontuação', g, () => [dtable([['Nome', 'CPF', 'Função'], ...g.map((x) => [x.name, x.cpf.raw, x.position!])])]); }
{ const g = [mk({ name: 'José da Conceição Ávila FICTICIO' }), mk({ name: 'Zélia Ñandú Pôrto FICTICIA' }), mk({ name: 'Maria das Dores Sant\'Anna FICTICIA' }), mk({ name: 'João d\'Ávila Júnior FICTICIO' })];
  pdfDoc('10', 'PDF ficha nome caixa mista/acentuado', g, () => g.flatMap((x) => fichaN(x))); }
{ const g = [mk({ name: 'Conceição Pôrto FICTICIA' }), mk({ name: 'Érico Lúcio FICTICIO' }), mk({ name: 'Tânia Müller FICTICIA' })];
  docxDoc('11', 'DOCX ficha nome acentuado', g, () => g.flatMap((x) => fichaN(x).map(P))); }
{ const g = people(4); pdfDoc('12', 'PDF datas dd-mm-aaaa', g, () => g.flatMap((x) => [`Nome: ${x.name}`, `CPF: ${x.cpf.fmt}`, `Função: ${x.position}`, `Admissão: ${dash(x.adm)}`])); }
{ const g = people(3, { birth: bd(1) }).map((x, i) => ({ ...x, birth: bd(i + 3) })); pdfDoc('13', 'PDF "Nasc." abreviado (rótulo não reconhecido)', g, () => g.flatMap((x) => [...fichaN(x), `Nasc.: ${x.birth}`])); }
{ const g = [mk({ sex: 'F' }), mk({ sex: 'M' }), mk({ sex: 'F' }), mk({ sex: 'M' })]; const lab = (s?: string) => (s === 'F' ? 'Fem' : 'Masc');
  pdfDoc('14', 'PDF Sexo Fem/Masc', g, () => g.flatMap((x) => [...fichaN(x), `Sexo: ${lab(x.sex)}`])); }
{ const g = people(4).map((x, i) => ({ ...x, birth: bd(i + 7), sex: (i % 2 ? 'F' : 'M') as 'F' | 'M' }));
  docxDoc('15', 'DOCX ficha com Nascimento e Sexo', g, () => g.flatMap((x) => [...fichaN(x), `Data de Nascimento: ${x.birth}`, `Sexo: ${x.sex === 'F' ? 'Feminino' : 'Masculino'}`].map(P))); }
{ const g = people(12); const hdr = ['RELACAO DE FUNCIONARIOS FICTICIA - Pagina', 'Nome | CPF | Função | Admissão'];
  pdfDoc('16', 'PDF cabeçalho repetido por página (3 págs)', g, () => [0, 1, 2].flatMap((pg) => ['\f', ...hdr, ...g.slice(pg * 4, pg * 4 + 4).map(pipeRow)]).slice(1)); }
{ const g = people(4); pdfDoc('17', 'PDF ficha + rodapé com telefone de 11 dígitos', g, () => [...g.flatMap((x) => fichaN(x)), 'Contato do RH: (48) 99123-4567', 'Telefone 48991234567 - WhatsApp']); }
{ const g = people(6); pdfDoc('18', 'PDF dois funcionários por linha', g, () => [0, 2, 4].map((i) => `${g[i].name} ${g[i].cpf.fmt}    ${g[i + 1].name} ${g[i + 1].cpf.fmt}`)); }
{ const g = people(9); pdfDoc('19', 'PDF 3 páginas de fichas', g, () => [0, 1, 2].flatMap((pg) => ['\f', ...g.slice(pg * 3, pg * 3 + 3).flatMap((x) => fichaN(x))]).slice(1)); }
{ const g = people(40); pdfDoc('20', 'PDF 40 pessoas ficha', g, () => g.flatMap((x) => fichaN(x))); }
{ const g = people(40); docxDoc('21', 'DOCX tabela 40 pessoas', g, () => [dtable([['Nome', 'CPF', 'Função', 'Admissão'], ...g.map((x) => [x.name, x.cpf.fmt, x.position!, x.adm!])])]); }
{ const g = people(200, { all: false }).map((x) => ({ ...x, position: 'AJUDANTE' })); pdfDoc('22', 'PDF 200 pessoas lista', g, () => g.map(linhaLista)); }
{ const g = [mk(), mk({ all: false }), mk()]; pdfDoc('23', 'PDF ficha com campos faltando (pessoa sem cargo/admissão)', g, () => g.flatMap((x) => fichaN(x))); }
{ const g = people(4); pdfDoc('24', 'PDF ficha + rodapé Responsável/Observações', g, () => [...g.flatMap((x) => fichaN(x)), 'Observações: conferir com o RH', 'Responsável: Carlos Responsavel FICTICIO', 'Cargo: DIRETOR', 'Data de Admissão: 01/01/2000']); }
{ const g = people(4); pdfDoc('25', 'PDF cabeçalho de empresa com CNPJ', g, () => ['EMPRESA EXEMPLO FICTICIA LTDA', 'CNPJ: 12.345.678/0001-95', 'CNPJ 12345678000195', 'Cadastro de funcionarios', ...g.flatMap((x) => fichaN(x))]); }
{ const g = [mk(), mk({ all: false }), mk(), mk({ all: false })]; docxDoc('26', 'DOCX tabela com campos vazios', g, () => [dtable([['Nome', 'CPF', 'Função', 'Admissão'], ...g.map((x) => [x.name, x.cpf.fmt, x.position ?? '', x.adm ?? ''])])]); }
{ const g = people(200); docxDoc('27', 'DOCX tabela 200 pessoas', g, () => [dtable([['Nome', 'CPF', 'Função', 'Admissão'], ...g.map((x) => [x.name, x.cpf.fmt, x.position!, x.adm!])])]); }
{ const g = people(4); pdfDoc('28', 'PDF cpf-primeiro com rodapé', g, () => [...g.flatMap((x) => fichaC(x)), 'Assinatura: ______', 'Responsável: Paulo Responsavel FICTICIO', 'Cargo: GERENTE']); }
{ const a = mk(); const b = mk(); const sem = mk({ name: 'SEM CPF VALIDO FICTICIO' });
  pdfDoc('29', 'PDF pessoa SEM CPF válido entre duas com CPF', [a, b], () => [...fichaN(a), 'Nome: SEM CPF VALIDO FICTICIO', 'CPF: 111.111.111-11', 'Função: PESSOA SEM CPF', 'Admissão: 09/09/2009', ...fichaN(b)]); void sem; }
{ const a = mk(); const b = mk(); pdfDoc('30', 'PDF ficha com linha em branco entre pessoas', [a, b], () => withBlank([fichaN(a), fichaN(b)]).flat()); }
{ const g = people(6); docxDoc('31', 'DOCX lista por linha', g, () => g.map((x) => P(linhaLista(x)))); }
{ const g = people(3).map((x) => ({ ...x, adm: undefined })); pdfDoc('32', 'PDF ficha com CPF rotulado "C.P.F." e "CPF/MF"', g, () => g.flatMap((x, i) => [`Nome: ${x.name}`, `${i % 2 ? 'CPF/MF' : 'C.P.F.'}: ${x.cpf.fmt}`, `Função: ${x.position}`])); }

{ const g = people(4); docxDoc('33', 'DOCX tabela colunas CPF|Nome|Função', g, () => [dtable([['CPF', 'Nome', 'Função'], ...g.map((x) => [x.cpf.fmt, x.name, x.position!])])]); }
{ const g = people(4); docxDoc('34', 'DOCX tabela Cargo|Nome|CPF|Admissão', g, () => [dtable([['Cargo', 'Nome', 'CPF', 'Admissão'], ...g.map((x) => [x.position!, x.name, x.cpf.fmt, x.adm!])])]); }
{ const g = people(5, { all: false }); pdfDoc('35', 'PDF lista numerada "1. NOME CPF"', g, () => g.map((x, i) => `${i + 1}. ${x.name} ${x.cpf.fmt}`)); }
{ const g = people(4); pdfDoc('36', 'PDF ficha com Função antes do Nome', g, () => g.flatMap((x) => [`Função: ${x.position}`, `Nome: ${x.name}`, `CPF: ${x.cpf.fmt}`, `Admissão: ${x.adm}`])); }
{ const g = people(4); pdfDoc('37', 'PDF campos na mesma linha, linha longa que quebra no PDF (valor de cargo contaminado: achado)', g, () => g.map((x) => `Nome: ${x.name}  CPF: ${x.cpf.fmt}  Função: ${x.position}  Admissão: ${x.adm}`)); }
{ const g = people(4); docxDoc('38', 'DOCX tabela com linha de total no fim', g, () => [dtable([['Nome', 'CPF', 'Função'], ...g.map((x) => [x.name, x.cpf.fmt, x.position!]), ['Total: 4 funcionarios', '', '']])]); }
{ const g = people(3); pdfDoc('39', 'PDF cabeçalho com Cargo/Função do responsável antes das fichas', g, () => ['Responsável pelo cadastro: Rui Responsavel FICTICIO', 'Cargo: DIRETOR', 'Admissão: 01/01/1999', '', ...withBlank(g.map((x) => fichaN(x))).flat()]); }
{ const g = people(3); pdfDoc('40', 'PDF fichas com rótulos em MAIÚSCULAS e sem acento', g, () => g.flatMap((x) => [`NOME: ${x.name}`, `CPF: ${x.cpf.fmt}`, `FUNCAO: ${x.position}`, `ADMISSAO: ${x.adm}`])); }

{ const g = people(4, { all: false }).map((x) => ({ ...x, position: 'AJUDANTE' })); pdfDoc('41', 'PDF campos na mesma linha curta (Nome/CPF/Função)', g, () => g.map((x) => `Nome: ${x.name}  CPF: ${x.cpf.fmt}  Função: ${x.position}`)); }

const norm = (s: string) => s.normalize('NFC').trim();
const canonDate = (v?: string) => { const m = v?.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v; };
const goldValue = (g: Gold, f: Field): string | undefined => {
  switch (f) {
    case 'cpf': return g.cpf.raw;
    case 'full_name': return norm(g.name);
    case 'position': return g.position;
    case 'admission_date': return canonDate(g.adm);
    case 'birth_date': return canonDate(g.birth);
    case 'sex': return g.sex;
  }
};
const gotValue = (v: string | undefined, f: Field) => (v === undefined ? undefined : f === 'admission_date' || f === 'birth_date' ? canonDate(v) : f === 'full_name' ? norm(v) : v);

type Tally = { expected: number; extracted: number; correct: number };
const empty = (): Record<Field, Tally> => Object.fromEntries(FIELDS.map((f) => [f, { expected: 0, extracted: 0, correct: 0 }])) as any;
const perDoc: { doc: Doc; tally: Record<Field, Tally>; wrong: string[]; cross: string[]; ms: number }[] = [];

describe('corpus de layouts com geradores e extratores reais', () => {
  it.each(docs.map((d) => [d.id + ' ' + d.layout, d] as const))('%s', async (_n, doc) => {
    const buf = await doc.build();
    const t0 = Date.now();
    const bounded = await extractBoundedText(doc.mime, buf);
    expect(bounded.status).toBe('ok');
    const text = (bounded as { text: string }).text;
    const got = extractLocalPeople(text);
    const ms = Date.now() - t0;

    const tally = empty();
    const wrong: string[] = [];
    const cross: string[] = [];
    const goldByCpf = new Map(doc.gold.map((g) => [g.cpf.raw, g]));
    // Cada pessoa esperada conta os campos que existem no gabarito.
    for (const g of doc.gold) for (const f of FIELDS) if (goldValue(g, f) !== undefined) tally[f].expected++;
    // Cada valor extraído é conferido contra o gabarito da MESMA pessoa; se bater com o de OUTRA pessoa, é cruzamento.
    const seen = new Set<string>();
    for (const p of got) {
      tally.cpf.extracted++;
      const g = goldByCpf.get(p.cpf);
      if (!g || seen.has(p.cpf)) { wrong.push(`cpf ${p.cpf.slice(0, 3)}***`); continue; }
      seen.add(p.cpf);
      tally.cpf.correct++;
      for (const f of FIELDS.filter((x) => x !== 'cpf')) {
        const v = gotValue(p.values[f as keyof typeof p.values], f);
        if (v === undefined) continue;
        tally[f].extracted++;
        if (v === goldValue(g, f)) tally[f].correct++;
        else {
          wrong.push(`${f} de ${g.name}: "${v}"`);
          if (doc.gold.some((o) => o !== g && goldValue(o, f) === v && f !== 'position' && f !== 'sex')) cross.push(`${f} de ${g.name} recebeu valor de outra pessoa: "${v}"`);
        }
      }
    }
    perDoc.push({ doc, tally, wrong, cross, ms });
    // Piso: nada de CPF inventado, nome errado ou valor cruzado. Ausente é aceitável.
    expect(tally.cpf.extracted).toBe(tally.cpf.correct);
    expect(tally.full_name.extracted).toBe(tally.full_name.correct);
    expect(cross).toEqual([]);
    // Nenhum valor errado em campo algum (cargo contaminado por rótulo quebrado pelo PDF foi corrigido no extrator).
    expect(wrong).toEqual([]);
    // Pessoa SEM CPF válido nunca vira registro.
    expect(got.every((p) => goldByCpf.has(p.cpf))).toBe(true);
  });

  afterAll(() => {
    const pct = (a: number, b: number) => (b === 0 ? '  -  ' : `${((100 * a) / b).toFixed(0)}%`.padStart(5));
    const rows = perDoc.map(({ doc, tally: t, wrong, ms }) => {
      const cells = FIELDS.map((f) => `${f.slice(0, 4)} ${t[f].correct}/${t[f].expected}${t[f].extracted - t[f].correct > 0 ? `(+${t[f].extracted - t[f].correct}err)` : ''}`).join('  ');
      return `${doc.id} ${doc.layout.padEnd(58)} ${cells}  ${ms}ms${wrong.length ? `  ERROS=${wrong.length}` : ''}`;
    });
    const total = empty();
    for (const { tally } of perDoc) for (const f of FIELDS) { total[f].expected += tally[f].expected; total[f].extracted += tally[f].extracted; total[f].correct += tally[f].correct; }
    const sum = FIELDS.map((f) => `${f.padEnd(15)} precisao=${pct(total[f].correct, total[f].extracted)} recall=${pct(total[f].correct, total[f].expected)} (corretos ${total[f].correct}, extraidos ${total[f].extracted}, esperados ${total[f].expected})`);
    // eslint-disable-next-line no-console
    console.log(`CORPUS ${perDoc.length} documentos\n${rows.join('\n')}\n--- TOTAL\n${sum.join('\n')}\nERROS:\n${perDoc.flatMap((d) => d.wrong.map((w) => `${d.doc.id}: ${w}`)).join('\n') || '(nenhum)'}`);
  });
});

describe('corpus: tamanho mínimo', () => {
  it('tem pelo menos 24 documentos de layouts distintos, PDF e DOCX', () => {
    expect(docs.length).toBeGreaterThanOrEqual(24);
    expect(new Set(docs.map((d) => d.layout)).size).toBe(docs.length);
    expect(docs.some((d) => d.mime === PDF_MIME) && docs.some((d) => d.mime === DOCX_MIME)).toBe(true);
  });
});
