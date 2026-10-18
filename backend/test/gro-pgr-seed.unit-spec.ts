import { readFileSync } from 'fs';
import { join } from 'path';
import { parseProvisions } from '../src/normative/provision-parser';
import { categoriaValidaParaArea } from '../src/normative/normative-rule-areas';
import { normalizeWs, planImport, Seed, validateSeed } from '../db/import-normative-rules';

// Valida o seed GRO/PGR contra o texto REAL da NR-01 vigente a partir de 26/05/2026:
// backend/test/fixtures/normative/NR-01-vigente-2026-05-26.txt — extraído com pdf-parse do PDF oficial
// …/normas-regulamentadoras-vigentes/nr-01-atualizada-2025-i-3.pdf (sha256 do texto afaf9537…, baixado em 2026-10-09).
// Texto ANTIGO (o que produção usa hoje): db/seed-data/normative-sources/NR-01.txt.
const SEED_PATH = join(__dirname, '..', 'db', 'seed-data', 'normative-rules', 'gro-pgr.json');
const NEW_TEXT = readFileSync(join(__dirname, 'fixtures', 'normative', 'NR-01-vigente-2026-05-26.txt'), 'utf8');
const OLD_TEXT = readFileSync(join(__dirname, '..', 'db', 'seed-data', 'normative-sources', 'NR-01.txt'), 'utf8');

const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Seed;

function index(raw: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const p of parseProvisions(raw, 'nr').provisions) {
    const k = `${p.anexo}|${p.item_path}`;
    m.set(k, [...(m.get(k) ?? []), p.literal_text]);
  }
  return m;
}

describe('seed GRO/PGR (db/seed-data/normative-rules/gro-pgr.json)', () => {
  const novo = index(NEW_TEXT);

  it('passa em validateSeed', () => {
    expect(validateSeed(seed)).toEqual([]);
  });

  it('toda ligação tem `contem` e o fragmento está no literal do dispositivo no texto vigente (validateSeed com o texto)', () => {
    for (const r of seed.rules) for (const l of r.provisions) expect(typeof l.contem === 'string' && l.contem.trim() !== '').toBe(true);
    expect(validateSeed(seed, { norma: 'NR-01', provisions: parseProvisions(NEW_TEXT, 'nr').provisions })).toEqual([]);
  });

  it('cada `contem` é cópia EXATA do texto do fixture (só espaços normalizados)', () => {
    const fixture = normalizeWs(NEW_TEXT);
    for (const r of seed.rules) for (const l of r.provisions) expect(fixture.includes(normalizeWs(l.contem))).toBe(true);
  });

  it('tem regras, todas da área gro_pgr, em rascunho, com prefixo GRO-/PGR- e categoria da área', () => {
    expect(seed.rules.length).toBeGreaterThan(0);
    for (const r of seed.rules) {
      expect(r.area).toBe('gro_pgr');
      expect(r.status).toBe('rascunho');
      expect(r.rule_key).toMatch(/^(GRO|PGR)-/);
      expect(categoriaValidaParaArea(r.area, r.categoria)).toBe(true);
      expect(r.exige_revisao_profissional).toBe(true);
    }
  });

  it('rule_key únicos', () => {
    const keys = seed.rules.map((r) => r.rule_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('toda ligação aponta para a NR-01 e existe, sem ambiguidade, no texto vigente (parser em memória)', () => {
    const faltando: string[] = [];
    for (const r of seed.rules) {
      for (const l of r.provisions) {
        expect(l.norma).toBe('NR-01');
        const hits = novo.get(`${l.anexo}|${l.item_path}`) ?? [];
        if (hits.length !== 1) faltando.push(`${r.rule_key} → ${l.anexo}|${l.item_path} (${hits.length})`);
      }
    }
    expect(faltando).toEqual([]);
  });

  it('o critério de cada regra cita CADA item ligado (aponta ao item)', () => {
    const naoCitados: string[] = [];
    for (const r of seed.rules) {
      for (const l of r.provisions) {
        // Fronteira: "1.5.4.4.2" não pode ser satisfeito por "1.5.4.4.2.1".
        const citado = new RegExp(`(^|[^\\d.])${l.item_path.replace(/\./g, '\\.')}(?![\\d]|\\.\\d)`).test(r.criterio);
        if (!citado) naoCitados.push(`${r.rule_key} → ${l.item_path}`);
      }
    }
    expect(naoCitados).toEqual([]);
  });

  it('a composição do PGR usa a categoria estrutura_pgr', () => {
    expect(seed.rules.find((r) => r.rule_key === 'PGR-DOCUMENTOS-MINIMOS')?.categoria).toBe('estrutura_pgr');
  });

  it('nível de risco: sem multiplicação/matriz numérica (a norma fala em combinação de severidade com probabilidade)', () => {
    for (const r of seed.rules) expect(`${r.criterio} ${r.interpretacao}`).not.toMatch(/×|\bx probabilidade|multiplica/i);
  });

  it('GRO-HIERARQUIA-MEDIDAS liga o 1.5.3.2 pela alínea e (a usada no critério), não pela alínea a', () => {
    const l = seed.rules.find((r) => r.rule_key === 'GRO-HIERARQUIA-MEDIDAS')!.provisions.find((x) => x.item_path === '1.5.3.2')!;
    expect(l.contem).toBe('de acordo com a classificação de risco e na ordem de');
  });

  it('PGR-ME-EPP-FERRAMENTA-OFICIAL mantém "a serem disponibilizada(s)" do 1.8.3 (a ferramenta não é dada como existente)', () => {
    const r = seed.rules.find((x) => x.rule_key === 'PGR-ME-EPP-FERRAMENTA-OFICIAL')!;
    expect(r.agente_ou_atividade).toMatch(/a serem disponibilizada/);
    expect(r.criterio).toMatch(/a serem disponibilizada\(s\)/);
  });

  it('textos de regra não atribuem conteúdo ao material do proprietário (procedência fica nos docs)', () => {
    for (const r of seed.rules) expect(`${r.criterio} ${r.interpretacao} ${r.excecoes ?? ''}`).not.toMatch(/material do propriet|segundo o material/i);
  });

  it('as regras de fatores psicossociais ligam exatamente os itens onde "psicossocia" ocorre no texto vigente', () => {
    const comPsico = [...novo.entries()].filter(([, lits]) => lits.some((t) => /psicossocia/i.test(t))).map(([k]) => k).sort();
    expect(comPsico.length).toBeGreaterThan(0);
    const ligados = new Set(
      seed.rules.filter((r) => r.categoria === 'psicossocial').flatMap((r) => r.provisions.map((l) => `${l.anexo}|${l.item_path}`)),
    );
    expect([...ligados].sort()).toEqual(comPsico);
  });
});

// Cenário de item renumerado com o texto REAL antigo (produção ainda tem a NR-01 anterior): resolvido só pelo
// endereço, parte das ligações cairia em dispositivo de texto DIFERENTE. Com `contem`, nenhuma pode cair em silêncio.
describe('seed GRO/PGR contra a NR-01 ANTIGA (renumeração)', () => {
  // Texto "igual" = igual depois de normalizar espaços e tirar rodapé de página e a nota "(numeração retificada …)".
  const comparavel = (s: string) =>
    normalizeWs(s)
      .replace(/ ?-- \d+ of \d+ -- Este texto não substitui o publicado no DOU \d+ ?/g, ' ')
      .replace(/ ?\(numeração retificada - DOU de [^)]*\)/g, '')
      .trim();

  it('nenhuma ligação resolve em silêncio para texto diferente; descasamentos e não encontradas são reportados', () => {
    const antigo = parseProvisions(OLD_TEXT, 'nr').provisions;
    const novo = index(NEW_TEXT);
    const resolved = antigo.map((p, i) => ({ id: `old-${i}`, norma: 'NR-01', anexo: p.anexo, item_path: p.item_path, literal_text: p.literal_text }));
    const plan = planImport(seed, [], resolved);
    const naoEncontradas = plan.errors.filter((e) => /ligação não encontrada/.test(e));
    const descasadas = plan.errors.filter((e) => /endereço resolve, mas o texto não contém/.test(e));
    expect(naoEncontradas.length + descasadas.length).toBe(plan.errors.length);

    const comErro = (rk: string, item: string) => plan.errors.some((e) => e.startsWith(`${rk} → NR-01 anexo '' item ${item}:`));
    // Exceções explícitas: o item mudou entre os textos, mas a parte que a regra usa (o trecho do `contem`) é idêntica
    // nos dois. GRO-HIERARQUIA-MEDIDAS → 1.5.3.2: a regra usa a alínea e (igual nos dois textos); só a alínea a mudou.
    const aceitas = new Map([['GRO-HIERARQUIA-MEDIDAS → 1.5.3.2', 'de acordo com a classificação de risco e na ordem de']]);
    const silenciosas: string[] = [];
    let mesmoTexto = 0;
    for (const r of seed.rules) {
      for (const l of r.provisions) {
        const old = antigo.filter((p) => p.anexo === l.anexo && p.item_path === l.item_path);
        if (old.length !== 1 || comErro(r.rule_key, l.item_path)) continue;
        const chave = `${r.rule_key} → ${l.item_path}`;
        const literalNovo = (novo.get(`${l.anexo}|${l.item_path}`) ?? [''])[0];
        if (comparavel(old[0].literal_text) === comparavel(literalNovo)) mesmoTexto++;
        else if (aceitas.get(chave) === l.contem) {
          // A exceção só vale se o trecho usado existe, igual, nos dois textos.
          expect(normalizeWs(old[0].literal_text).includes(normalizeWs(l.contem))).toBe(true);
          expect(normalizeWs(literalNovo).includes(normalizeWs(l.contem))).toBe(true);
        } else silenciosas.push(chave);
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      [
        `NR-01 ANTIGA: ${plan.errors.length} ligações barradas = ${naoEncontradas.length} não encontradas + ${descasadas.length} com texto diferente (fragmento ausente); ${mesmoTexto} resolvem com o mesmo texto`,
        ...plan.errors.map((e) => `  ${e}`),
      ].join('\n'),
    );
    expect(silenciosas).toEqual([]);
    expect(plan.errors.length).toBeGreaterThan(0);
  });
});
