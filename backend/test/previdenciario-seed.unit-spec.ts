import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isRevokedLiteral, parseProvisions } from '../src/normative/provision-parser';
import { categoriaValidaParaArea } from '../src/normative/normative-rule-areas';
import {
  DEFAULT_SEED_PATH,
  normalizeWs,
  parseArgs,
  planImport,
  ResolvedProvision,
  Seed,
  validateSeed,
} from '../db/import-normative-rules';

// Valida o seed previdenciário contra TRECHOS REAIS (pipeline do monitor: decodeHtmlBuffer ISO-8859-1 +
// extractHtmlText com PLANALTO_EXTRACT_OPTIONS) da CLT, da Lei 8.213 e do Decreto 3.048, páginas do Planalto
// baixadas em 2026-10-09. Origem, sha256 das páginas e dos trechos: test/fixtures/normative/previdenciario/README.md.
// O parse de cada trecho foi conferido igual (endereço + literal) ao parse da página inteira para esses artigos.
const SEED_PATH = join(__dirname, '..', 'db', 'seed-data', 'normative-rules', 'previdenciario.json');
const FIX = join(__dirname, 'fixtures', 'normative', 'previdenciario');
const GRO_SEED_PATH = join(__dirname, '..', 'db', 'seed-data', 'normative-rules', 'gro-pgr.json');
const NR01_TEXT = readFileSync(join(__dirname, 'fixtures', 'normative', 'NR-01-vigente-2026-05-26.txt'), 'utf8');

// Um ou mais trechos por norma; cada trecho começa num artigo e termina antes do cabeçalho/artigo seguinte.
const FIXTURES: Record<string, { label: string; files: { file: string; sha256: string }[] }> = {
  CLT: { label: 'CLT', files: [{ file: 'clt-arts-189-192.txt', sha256: 'c5074d850cd6c1a35ddf77696d00df9cb1ff4f8fe0314426b3a2ffa6ea2605fc' }] },
  'LEI-8213': { label: 'Lei 8.213', files: [{ file: 'lei-8213-arts-57-58.txt', sha256: '31c8bdefb813154deb565670e1e889e790f096d9676c70cd43eda8b49f91e371' }] },
  'DEC-3048': {
    label: 'Decreto 3.048',
    files: [
      { file: 'dec-3048-arts-64-70.txt', sha256: '17bb82d8addcba2621b769fce7ab69fb51abdeb20c0990a4d9c0d88feae307cd' },
      { file: 'dec-3048-art-188-p.txt', sha256: '70290fd82c6cb0d8a6a19723b586de3d038629a77105590b026a90dedb6b727a' },
    ],
  },
};
const NORMAS = Object.keys(FIXTURES);

const read = (file: string) => readFileSync(join(FIX, file), 'utf8');
const raw = (norma: string) => FIXTURES[norma].files.map((f) => read(f.file)).join('');
const parsed = Object.fromEntries(NORMAS.map((n) => [n, FIXTURES[n].files.flatMap((f) => parseProvisions(read(f.file), 'lei').provisions)]));
const literal = (norma: string, item: string) => parsed[norma].find((p) => p.item_path === item)?.literal_text;

const loadSeed = (): Seed => JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Seed;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function resolved(): ResolvedProvision[] {
  return NORMAS.flatMap((n) =>
    parsed[n].map((p, i) => ({ id: `${n}-${i}`, norma: n, anexo: p.anexo, item_path: p.item_path, literal_text: p.literal_text })),
  );
}

function ocorrencias(texto: string, fragmento: string): number {
  const t = normalizeWs(texto);
  const f = normalizeWs(fragmento);
  let n = 0;
  for (let i = t.indexOf(f); i >= 0; i = t.indexOf(f, i + 1)) n++;
  return n;
}

const errosComTexto = (seed: unknown) => NORMAS.flatMap((n) => validateSeed(seed, { norma: n, provisions: parsed[n] }));

describe('fixtures previdenciários (trechos reais do Planalto)', () => {
  it('sha256 de cada trecho confere com o README (fixture não foi editado à mão)', () => {
    for (const n of NORMAS) for (const f of FIXTURES[n].files) expect([f.file, createHash('sha256').update(readFileSync(join(FIX, f.file))).digest('hex')]).toEqual([f.file, f.sha256]);
  });

  it('o parser recupera os artigos esperados, sem anomalias, e não cria dispositivo para o art. 70 do Decreto 3.048 (revogado)', () => {
    const paths = (n: string) => parsed[n].map((p) => p.item_path);
    expect(paths('CLT')).toEqual(expect.arrayContaining(['art. 189', 'art. 190', 'art. 191', 'art. 192']));
    expect(paths('LEI-8213')).toEqual(expect.arrayContaining(['art. 57', 'art. 58', 'art. 58 §1', 'art. 58 §2', 'art. 58 §3', 'art. 58 §4']));
    expect(paths('DEC-3048')).toEqual(expect.arrayContaining(['art. 64', 'art. 65', 'art. 66', 'art. 67', 'art. 68', 'art. 69']));
    expect(paths('DEC-3048').filter((p) => /^art\. 70( |$)/.test(p))).toEqual([]);
    expect(raw('DEC-3048')).toContain('Art. 70. (Revogado pelo Decreto nº 10.410, de 2020).');
    expect(paths('DEC-3048').filter((p) => p.startsWith('art. 188-P'))).toEqual([
      'art. 188-P', 'art. 188-P inc. I', 'art. 188-P inc. II', 'art. 188-P inc. III', 'art. 188-P §1', 'art. 188-P §2', 'art. 188-P §3',
      'art. 188-P §4', 'art. 188-P §4 inc. I', 'art. 188-P §4 inc. II', 'art. 188-P §5', 'art. 188-P §6',
    ]);
    for (const n of NORMAS) for (const f of FIXTURES[n].files) expect([f.file, parseProvisions(read(f.file), 'lei').anomalies]).toEqual([f.file, []]);
  });

  it('entidades HTML decodificadas no modo Planalto: nenhum "&…;" sobra nos trechos (Lei 8.213 art. 57 § 3º tinha "&#150;")', () => {
    for (const n of NORMAS) expect(raw(n)).not.toMatch(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i);
    expect(literal('LEI-8213', 'art. 57 §3')).toContain('Instituto Nacional do Seguro Social–INSS');
  });
});

describe('seed previdenciário (db/seed-data/normative-rules/previdenciario.json)', () => {
  const seed = loadSeed();

  it('passa em validateSeed e, com o texto de cada norma, toda ligação existe, é única e contém o fragmento', () => {
    expect(validateSeed(seed)).toEqual([]);
    expect(errosComTexto(seed)).toEqual([]);
  });

  it('tem regras, todas da área previdenciario, em rascunho, com prefixo PREV- e categoria da área', () => {
    expect(seed.rules.length).toBeGreaterThan(0);
    for (const r of seed.rules) {
      expect(r.area).toBe('previdenciario');
      expect(r.status).toBe('rascunho');
      expect(r.rule_key).toMatch(/^PREV-/);
      expect(categoriaValidaParaArea(r.area, r.categoria)).toBe(true);
      expect(r.exige_revisao_profissional).toBe(true);
    }
  });

  it('rule_key únicos', () => {
    const keys = seed.rules.map((r) => r.rule_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('toda ligação: norma CLT/LEI-8213/DEC-3048, corpo da norma, 1 dispositivo no trecho e `contem` UMA vez no literal', () => {
    const problemas: string[] = [];
    for (const r of seed.rules) {
      for (const l of r.provisions) {
        expect(NORMAS).toContain(l.norma);
        expect(l.anexo).toBe('');
        const hits = parsed[l.norma].filter((p) => p.anexo === l.anexo && p.item_path === l.item_path);
        if (hits.length !== 1) problemas.push(`${r.rule_key} → ${l.norma} ${l.item_path}: ${hits.length} dispositivos`);
        else if (ocorrencias(hits[0].literal_text, l.contem) !== 1) problemas.push(`${r.rule_key} → ${l.norma} ${l.item_path}: "${l.contem}" ${ocorrencias(hits[0].literal_text, l.contem)}x`);
      }
    }
    expect(problemas).toEqual([]);
  });

  it('nenhuma ligação aponta para dispositivo revogado (isRevokedLiteral sobre o literal inteiro) nem para o art. 70 do Decreto 3.048', () => {
    const revogadas: string[] = [];
    for (const r of seed.rules) {
      for (const l of r.provisions) {
        expect(l.item_path).not.toMatch(/^art\. 70( |$)/);
        if (isRevokedLiteral(literal(l.norma, l.item_path)!)) revogadas.push(`${r.rule_key} → ${l.norma} ${l.item_path}`);
      }
    }
    expect(revogadas).toEqual([]);
    // O helper reconhece o revogado REAL do trecho (art. 70 e §§ do Decreto 3.048, linhas do fixture).
    const linhas70 = read('dec-3048-arts-64-70.txt').split('\n').filter((x) => /^(?:Art\. 70\.|§ [12] o \(Revogado)/.test(x));
    expect(linhas70).toHaveLength(3);
    for (const x of linhas70) expect(isRevokedLiteral(x)).toBe(true);
  });

  // Termos que NÃO podem aparecer no texto da regra se nenhum literal ligado a ela os usa (conclusão sem literal).
  const SEM_LITERAL: [string, RegExp][] = [
    ['direito adquirido', /direito adquirido/i],
    ['EC 103', /\bEC\s*(?:n[º°o]\s*)?103\b|Emenda Constitucional/i],
    ['STF', /\bSTF\b|Supremo Tribunal/],
    ['Tema', /\bTema\b/],
    // (o rule_key PREV-APOSENTADORIA-ESPECIAL-TRANSICAO citado no texto não conta: precedido de "-")
    ['transição', /(?<![-\w])transi[çc][ãa]o/i],
    ['EPI não é prova', /não é prova|não afasta|afasta a efetiva exposição/i],
  ];
  it('sem conclusão sem literal: "direito adquirido", "EC 103", "STF", "Tema", "transição"… só se um literal ligado à regra usa o termo', () => {
    const problemas: string[] = [];
    for (const r of seed.rules) {
      const txt = `${r.agente_ou_atividade} ${r.criterio} ${r.interpretacao} ${r.excecoes ?? ''}`;
      const literais = r.provisions.map((l) => literal(l.norma, l.item_path) ?? '').join('\n');
      for (const [nome, re] of SEM_LITERAL) if (re.test(txt) && !re.test(literais)) problemas.push(`${r.rule_key}: "${nome}"`);
    }
    expect(problemas).toEqual([]);
  });

  it('conversão de tempo especial em comum: quem liga a Lei 8.213 art. 57 §5 liga também o Decreto 3.048 art. 188-P §5 (limite de 13/11/2019)', () => {
    const comLei = seed.rules.filter((r) => r.provisions.some((l) => l.norma === 'LEI-8213' && l.item_path === 'art. 57 §5'));
    expect(comLei.map((r) => r.rule_key)).toEqual(['PREV-CONVERSAO-ESPECIAL-COMUM']);
    for (const r of comLei) {
      const dec = r.provisions.find((l) => l.norma === 'DEC-3048' && l.item_path === 'art. 188-P §5');
      expect(dec?.contem).toContain('aplica-se somente ao trabalho prestado até 13 de novembro de 2019');
      // Não mistura a soma de atividades especiais (Decreto art. 66) e não reintroduz a frase falsa.
      expect(r.provisions.some((l) => l.norma === 'DEC-3048' && /^art\. 66( |$)/.test(l.item_path))).toBe(false);
      expect(`${r.interpretacao} ${r.excecoes ?? ''}`).not.toMatch(/fora desta base podem limitar/i);
    }
    expect(seed.rules.some((r) => r.rule_key === 'PREV-CONVERSAO-TEMPO-ESPECIAL')).toBe(false);
    const soma = seed.rules.find((r) => r.rule_key === 'PREV-SOMA-ATIVIDADES-ESPECIAIS')!;
    expect(soma.provisions.map((l) => `${l.norma} ${l.item_path}`)).toEqual([
      'DEC-3048 art. 66', 'DEC-3048 art. 66 §1', 'DEC-3048 art. 66 §2', 'DEC-3048 art. 66 §3',
    ]);
  });

  it('art. 188-P do Decreto 3.048: caput e incisos I–III ligados a PREV-APOSENTADORIA-ESPECIAL-TRANSICAO; § 6º (legislação da época) em regra própria', () => {
    const t = seed.rules.find((r) => r.rule_key === 'PREV-APOSENTADORIA-ESPECIAL-TRANSICAO')!;
    expect(t.provisions.map((l) => l.item_path)).toEqual(
      expect.arrayContaining(['art. 188-P', 'art. 188-P inc. I', 'art. 188-P inc. II', 'art. 188-P inc. III']),
    );
    const epoca = seed.rules.filter((r) => r.provisions.some((l) => l.norma === 'DEC-3048' && l.item_path === 'art. 188-P §6'));
    expect(epoca.map((r) => r.rule_key)).toEqual(['PREV-CARACTERIZACAO-LEGISLACAO-EPOCA']);
    expect(epoca[0].provisions[0].contem).toContain('legislação em vigor à época da prestação do serviço');
  });

  it('as duas regras de idade mencionam a ressalva do art. 188-P sem concluir quem se enquadra; sem "não fixa idade mínima"', () => {
    for (const k of ['PREV-APOSENTADORIA-ESPECIAL-LEI', 'PREV-APOSENTADORIA-ESPECIAL-DECRETO']) {
      const r = seed.rules.find((x) => x.rule_key === k)!;
      expect(r.interpretacao).toContain('art. 188-P');
      expect(r.interpretacao).toContain('PREV-APOSENTADORIA-ESPECIAL-TRANSICAO');
      expect(r.interpretacao).not.toMatch(/não fixa idade mínima/i);
    }
  });

  it('PREV-LTCAT-TECNOLOGIA-PROTECAO fiel ao literal ("recomendação sobre a sua adoção") e remete ao Decreto 3.048 art. 64 §1 e §1-A', () => {
    const r = seed.rules.find((x) => x.rule_key === 'PREV-LTCAT-TECNOLOGIA-PROTECAO')!;
    expect(r.interpretacao).toContain('recomendação sobre a sua adoção');
    expect(r.interpretacao).not.toMatch(/recomenda sua adoção/);
    expect(r.provisions.map((l) => `${l.norma} ${l.item_path}`)).toEqual(
      expect.arrayContaining(['DEC-3048 art. 64 §1', 'DEC-3048 art. 64 §1-A inc. I', 'DEC-3048 art. 64 §1-A inc. II']),
    );
  });

  it('o critério de cada regra cita cada dispositivo ligado ("<norma> <item_path>")', () => {
    const naoCitados: string[] = [];
    for (const r of seed.rules) {
      for (const l of r.provisions) {
        const cit = `${FIXTURES[l.norma].label} ${l.item_path}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`${cit}(?![0-9A-Za-z-])`).test(r.criterio)) naoCitados.push(`${r.rule_key} → ${FIXTURES[l.norma].label} ${l.item_path}`);
      }
    }
    expect(naoCitados).toEqual([]);
  });

  it('sem conteúdo sem literal nestes textos (PPP eletrônico datado, eSocial, IN 128, multiplicação) nem atribuição ao material do proprietário', () => {
    for (const r of seed.rules) {
      const txt = `${r.agente_ou_atividade} ${r.criterio} ${r.interpretacao} ${r.excecoes ?? ''}`;
      expect(txt).not.toMatch(/01\/01\/2023|S-2240|Tabela 24|IN PRES|128\/2022|×|multiplica/i);
      expect(txt).not.toMatch(/material do propriet|segundo o material/i);
    }
  });

  it('a distinção insalubridade (CLT) × aposentadoria especial liga CLT arts. 189 e 192, Lei 8.213 arts. 57 e 58 e a ponte literal do Decreto 3.048 art. 64 §1/§1-A', () => {
    const r = seed.rules.find((x) => x.rule_key === 'PREV-DISTINCAO-INSALUBRIDADE-APOSENTADORIA-ESPECIAL')!;
    const ligs = r.provisions.map((l) => `${l.norma} ${l.item_path}`).sort();
    expect(ligs).toEqual(
      ['CLT art. 189', 'CLT art. 192', 'LEI-8213 art. 57', 'LEI-8213 art. 58', 'DEC-3048 art. 64 §1', 'DEC-3048 art. 64 §1-A inc. II'].sort(),
    );
    expect(r.interpretacao).toContain('legislação trabalhista');
  });

  it('planImport aceita o seed contra os dispositivos dos trechos: só criações, todas as ligações resolvidas', () => {
    const plan = planImport(seed, [], resolved());
    expect(plan.errors).toEqual([]);
    expect(plan.items.map((i) => i.action)).toEqual(seed.rules.map(() => 'criar'));
    expect(plan.items.reduce((s, i) => s + i.links.length, 0)).toBe(seed.rules.reduce((s, r) => s + r.provisions.length, 0));
  });
});

describe('seed previdenciário: mutações são barradas', () => {
  const base = loadSeed();

  it('fragmento `contem` errado (texto que o dispositivo não contém) é rejeitado por validateSeed e por planImport', () => {
    const s = clone(base);
    s.rules[0].provisions[0].contem = 'trecho que não está no dispositivo';
    expect(errosComTexto(s).some((e) => /endereço resolve, mas o texto não contém/.test(e))).toBe(true);
    expect(planImport(s, [], resolved()).errors.some((e) => /endereço resolve, mas o texto não contém/.test(e))).toBe(true);
  });

  it('fragmento de OUTRO dispositivo da mesma norma é rejeitado', () => {
    const s = clone(base);
    const art58 = s.rules.flatMap((r) => r.provisions).find((l) => l.norma === 'LEI-8213' && l.item_path === 'art. 58 §1')!;
    art58.contem = 'elaborar e manter atualizado perfil profissiográfico'; // está no § 4º, não no § 1º
    expect(errosComTexto(s).some((e) => /art\. 58 §1: endereço resolve, mas o texto não contém/.test(e))).toBe(true);
  });

  it('ligação a dispositivo inexistente (art. 70 do Decreto 3.048, revogado) é "ligação não encontrada"', () => {
    const s = clone(base);
    const l = s.rules.flatMap((r) => r.provisions).find((x) => x.norma === 'DEC-3048')!;
    l.item_path = 'art. 70';
    expect(errosComTexto(s).some((e) => /item art\. 70: ligação não encontrada/.test(e))).toBe(true);
    expect(planImport(s, [], resolved()).errors.some((e) => /art\. 70: ligação não encontrada/.test(e))).toBe(true);
  });

  it('dispositivo ausente da base (norma não ingerida) aborta o plano inteiro', () => {
    const plan = planImport(base, [], resolved().filter((p) => p.norma !== 'CLT'));
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.errors.every((e) => /→ CLT .*ligação não encontrada/.test(e))).toBe(true);
  });

  it('ligação sem `contem` e regra sem ligação e sem a nota são rejeitadas', () => {
    const s = clone(base);
    delete (s.rules[0].provisions[0] as { contem?: string }).contem;
    s.rules[1].provisions = [];
    const errs = validateSeed(s);
    expect(errs.some((e) => /contem obrigatório/.test(e))).toBe(true);
    expect(errs.some((e) => /sem fundamento literal verificado/.test(e))).toBe(true);
  });

  it('status diferente de rascunho e categoria de outra área são rejeitados', () => {
    const s = clone(base);
    (s.rules[0] as { status: string }).status = 'revisada';
    (s.rules[1] as { categoria: string }).categoria = 'insalubridade';
    const errs = validateSeed(s);
    expect(errs.some((e) => /status deve ser 'rascunho'/.test(e))).toBe(true);
    expect(errs.some((e) => /categoria 'insalubridade' não pertence à área 'previdenciario'/.test(e))).toBe(true);
  });
});

describe('importador continua agnóstico de norma/área e o seed GRO/PGR não é afetado', () => {
  it('padrão do CLI segue o seed GRO/PGR; o seed previdenciário é passado por caminho', () => {
    expect(DEFAULT_SEED_PATH).toBe(GRO_SEED_PATH);
    expect(parseArgs([SEED_PATH])).toEqual({ seedPath: SEED_PATH, apply: false });
  });

  it('plano do seed GRO/PGR contra a NR-01 vigente: sem erros, só criações', () => {
    const gro = JSON.parse(readFileSync(GRO_SEED_PATH, 'utf8')) as Seed;
    const nr01 = parseProvisions(NR01_TEXT, 'nr').provisions.map((p, i) => ({ id: `nr01-${i}`, norma: 'NR-01', anexo: p.anexo, item_path: p.item_path, literal_text: p.literal_text }));
    // Dispositivos previdenciários na mesma base não interferem (resolução por norma+anexo+item).
    const plan = planImport(gro, [], [...nr01, ...resolved()]);
    expect(plan.errors).toEqual([]);
    expect(plan.items.length).toBe(gro.rules.length);
    expect(plan.items.every((i) => i.action === 'criar')).toBe(true);
  });
});
