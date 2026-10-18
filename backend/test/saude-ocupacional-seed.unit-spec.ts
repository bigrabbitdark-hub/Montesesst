import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isRevokedLiteral, parseProvisions, ParserKind } from '../src/normative/provision-parser';
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

// Valida os DOIS seeds de saúde ocupacional contra TRECHOS REAIS:
// - saude-ocupacional-nr07.json: regras cujas ligações são SÓ da NR-07 (importáveis sem aprovar nada novo);
// - saude-ocupacional.json: regras que ligam a CLT, a NR-01 vigente ou a LGPD (podendo ligar também a NR-07).
// Textos:
// - NR-07: recorte do texto vigente (db/seed-data/normative-sources/NR-07.txt, idêntico ao PDF oficial), itens 7.5–7.6.6
//   e 7.7.1–7.7.4 do corpo; o parse do recorte foi conferido igual (endereço + literal) ao do texto inteiro, e este teste
//   repete a conferência contra o texto inteiro do repositório;
// - NR-01: texto vigente inteiro (fixture do GRO/PGR, NR-01-vigente-2026-05-26.txt) — só os subitens 1.8.x que citam
//   literalmente o PCMSO; e a NR-01 ANTERIOR (db/seed-data/normative-sources/NR-01.txt) para o teste negativo do 1.8.7.1;
// - CLT arts. 168–169 e LGPD (Lei 13.709) arts. 5, 11, 46 e 48: pipeline do monitor para o Planalto (decodeHtmlBuffer
//   ISO-8859-1 + extractHtmlText com PLANALTO_EXTRACT_OPTIONS), páginas baixadas em 2026-10-10.
// Origem, data e sha256: test/fixtures/normative/saude-ocupacional/README.md.
const RULES_DIR = join(__dirname, '..', 'db', 'seed-data', 'normative-rules');
const SEED_PATH = join(RULES_DIR, 'saude-ocupacional.json');
const SEED_NR07_PATH = join(RULES_DIR, 'saude-ocupacional-nr07.json');
const FIX = join(__dirname, 'fixtures', 'normative', 'saude-ocupacional');
const NR07_FULL_PATH = join(__dirname, '..', 'db', 'seed-data', 'normative-sources', 'NR-07.txt');
const NR01_ANTIGA_PATH = join(__dirname, '..', 'db', 'seed-data', 'normative-sources', 'NR-01.txt');
const GRO_SEED_PATH = join(RULES_DIR, 'gro-pgr.json');
const PREV_SEED_PATH = join(RULES_DIR, 'previdenciario.json');

const FIXTURES: Record<string, { label: string; kind: ParserKind; file: string; sha256: string }> = {
  'NR-07': { label: 'NR-07', kind: 'nr', file: 'nr-07-itens.txt', sha256: 'ecbe2b8e0480a9197a041218a553b7f395c1a0d5294a2b0d1b5ba247dc8f1f02' },
  'NR-01': { label: 'NR-01', kind: 'nr', file: '../NR-01-vigente-2026-05-26.txt', sha256: 'afaf953765022672dd058ba385ace393be6b88f5612cbb03a8e5219a2d662fb0' },
  CLT: { label: 'CLT', kind: 'lei', file: 'clt-arts-168-169.txt', sha256: 'a1e74386b97d29a440365f71c7624e3b713ee23325dcd5332adb28db31a61060' },
  'LEI-13709': { label: 'LGPD', kind: 'lei', file: 'lgpd-arts-5-11-46-48.txt', sha256: '52a2d3551bf1cfe7946f707393632f4146f579b7521631b7da78eaa1cc312684' },
};
const NORMAS = Object.keys(FIXTURES);

const read = (file: string) => readFileSync(join(FIX, file), 'utf8');
const raw = (norma: string) => read(FIXTURES[norma].file);
const parsed = Object.fromEntries(NORMAS.map((n) => [n, parseProvisions(raw(n), FIXTURES[n].kind).provisions]));
const literal = (norma: string, item: string) => parsed[norma].find((p) => p.anexo === '' && p.item_path === item)?.literal_text;
const NR07_FULL = readFileSync(NR07_FULL_PATH, 'utf8');
// "Documento inteiro" de cada norma: NR-07 = texto vigente inteiro; NR-01 = texto vigente inteiro. CLT e LGPD = SÓ O
// TRECHO versionado: as páginas inteiras do Planalto NÃO estão no repositório, então para essas duas normas este teste
// confere a unicidade apenas no trecho. A unicidade de cada `contem` da CLT/LGPD na página inteira extraída foi conferida
// FORA do teste (relatórios da Task 3 e da rodada de correções). O importador, em produção, só confere o dispositivo do
// endereço (não o documento inteiro).
const DOC_INTEIRO: Record<string, string> = { 'NR-07': NR07_FULL, 'NR-01': raw('NR-01'), CLT: raw('CLT'), 'LEI-13709': raw('LEI-13709') };

const loadSeedAt = (path: string): Seed => JSON.parse(readFileSync(path, 'utf8')) as Seed;
const loadSeed = (): Seed => loadSeedAt(SEED_PATH);
const loadSeedNr07 = (): Seed => loadSeedAt(SEED_NR07_PATH);
// União dos dois seeds (para as checagens por regra que não dependem do arquivo).
const loadUniao = (): Seed => {
  const a = loadSeedNr07();
  const b = loadSeed();
  return { ...b, rules: [...a.rules, ...b.rules] };
};
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
const textoDaRegra = (r: Seed['rules'][number]) => `${r.agente_ou_atividade} ${r.criterio} ${r.interpretacao} ${r.excecoes ?? ''}`;
const literaisDaRegra = (r: Seed['rules'][number]) => r.provisions.map((l) => literal(l.norma, l.item_path) ?? '').join('\n');

// Prefixo obrigatório desta área (imposto também pelo importador desde a rodada de correções).
const semPrefixoSau = (seed: Seed) => seed.rules.filter((r) => !/^SAU-/.test(r.rule_key)).map((r) => r.rule_key);

// Conteúdo do material do proprietário SEM base literal nestes textos (eSocial S-2220 e seu prazo, MOS, notas
// orientativas, Tabela 24, listas "ilustrativas", princípios de IA do Assistente): nunca no texto das regras.
const PROIBIDOS: [string, RegExp][] = [
  ['S-2220', /S-?2220/i],
  ['eSocial', /e-?social/i],
  ['dia 15', /dia\s+15\b|dia\s+quinze/i],
  ['Tabela 24', /Tabela\s*24/i],
  ['MOS', /\bMOS\b/],
  ['Nota Orientativa', /Nota\s+Orientativa/i],
  ['lista ilustrativa', /ilustrativ/i],
  ['IA/modelo', /\bIA\b|intelig[êe]ncia artificial|modelo externo|modelo de linguagem/i],
  ['material do proprietário', /material do propriet|segundo o material/i],
];
function termosProibidos(seed: Seed): string[] {
  const problemas: string[] = [];
  for (const r of seed.rules) for (const [nome, re] of PROIBIDOS) if (re.test(textoDaRegra(r))) problemas.push(`${r.rule_key}: "${nome}"`);
  return problemas;
}

// Termos que só podem aparecer no texto da regra se um literal ligado a ela os usa.
const SEM_LITERAL: [string, RegExp][] = [
  ['ANPD', /\bANPD\b|Agência Nacional de Proteção de Dados/i],
  ['multa/penalidade', /\bmulta|penalidade|sanç/i],
  [
    'aptidão decidida',
    /\bdecide\b|\bdecidid[ao]s?\b|\bdetermina(?:r|m|da|do)?\s+(?:a\s+)?(?:in)?aptid|\bconclu\w*\s+(?:(?:pela|que\s+(?:é|está))\s+)?(?:in)?apt[oa]s?\b|\bconclu\w*\s+(?:a\s+|pela\s+)?(?:in)?aptid/i,
  ],
  ['CRM', /\bCRM\b/],
  ['assinatura digital', /assinatura\s+(digital|eletr[ôo]nica)/i],
  ['carimbo', /carimb/i],
];
function semLiteral(seed: Seed): string[] {
  const problemas: string[] = [];
  for (const r of seed.rules) for (const [nome, re] of SEM_LITERAL) if (re.test(textoDaRegra(r)) && !re.test(literaisDaRegra(r))) problemas.push(`${r.rule_key}: "${nome}"`);
  return problemas;
}

// Todo prazo/período citado no texto da regra tem de estar num literal LIGADO a ela:
// - número (com extenso opcional entre parênteses) + dia(s)/dias úteis/hora(s)/mês/meses/ano(s);
// - extenso + dia(s)/dias úteis/hora(s)/mês/meses/ano(s);
// - adjetivo de periodicidade (anual, semestral, bienal, trimestral, mensal…): o radical tem de estar no literal ligado.
const UNIDADE = String.raw`(dias?\s+úteis|horas?|dias?|mês|meses|anos?)(?![\p{L}])`;
const EXTENSO_NUM = String.raw`um|uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|doze|quinze|vinte(?:\s+e\s+\p{L}+)?|trinta|quarenta(?:\s+e\s+\p{L}+)?|sessenta|setenta(?:\s+e\s+\p{L}+)?|noventa`;
const unidadeRe = (u: string) => (/úteis/i.test(u) ? String.raw`dias?\s+úteis` : /^hora/i.test(u) ? 'horas?' : u.slice(0, 3));
function prazosSemLiteral(seed: Seed): string[] {
  const problemas: string[] = [];
  const DIGITOS = new RegExp(String.raw`(\d+)\s*(?:\([^)]*\)\s*)?${UNIDADE}`, 'giu');
  const EXTENSO = new RegExp(String.raw`(?<![\p{L}])(${EXTENSO_NUM})\s+${UNIDADE}`, 'giu');
  const PERIODICIDADE = /(?<![\p{L}])(anual|semestral|bienal|bianual|trimestral|bimestral|mensal|quinzenal|semanal)/giu;
  for (const r of seed.rules) {
    const txt = normalizeWs(textoDaRegra(r));
    const lit = normalizeWs(literaisDaRegra(r));
    for (const m of txt.matchAll(DIGITOS)) {
      const re = new RegExp(String.raw`\b${m[1]}\b\s*(?:\([^)]*\)\s*)?${unidadeRe(m[2])}`, 'iu');
      if (!re.test(lit)) problemas.push(`${r.rule_key}: "${m[0]}"`);
    }
    for (const m of txt.matchAll(EXTENSO)) {
      const re = new RegExp(String.raw`(?<![\p{L}])${m[1].replace(/\s+/g, String.raw`\s+`)}\s+${unidadeRe(m[2])}`, 'iu');
      if (!re.test(lit)) problemas.push(`${r.rule_key}: "${m[0]}"`);
    }
    for (const m of txt.matchAll(PERIODICIDADE)) if (!new RegExp(`(?<![\\p{L}])${m[1]}`, 'iu').test(lit)) problemas.push(`${r.rule_key}: "${m[0]}"`);
  }
  return problemas;
}

// Números em CONTEXTO: cada "N <unidade> … graus de risco X e Y" (sem outro número no meio) do texto da regra
// (criterio, interpretacao E excecoes, cada um separadamente) tem de existir com o MESMO par no literal ligado.
// Pega a troca de 135/90 entre graus de risco (o número existe no literal, mas no contexto errado).
const PAR_GRAU_RE = /\b(\d+)\s*(?:\([^)]*\)\s*)?(?:dias|empregados)\b([^0-9]{0,80}?)\bgraus? de riscos? (\d+(?: e \d+)?)/giu;
const paresGrau = (texto: string) => [...normalizeWs(texto).matchAll(PAR_GRAU_RE)].map((m) => `${m[1]} → graus de risco ${m[3]}`);
function numerosForaDeContexto(seed: Seed): string[] {
  const problemas: string[] = [];
  for (const r of seed.rules) {
    const doLiteral = new Set(paresGrau(literaisDaRegra(r)));
    for (const campo of ['criterio', 'interpretacao', 'excecoes'] as const) {
      for (const par of paresGrau(r[campo] ?? '')) if (!doLiteral.has(par)) problemas.push(`${r.rule_key}.${campo}: "${par}"`);
    }
  }
  return problemas;
}

// rule_key citado no texto (criterio, interpretacao, excecoes) que NÃO está no mesmo seed: os seeds são importados
// separadamente, então a citação apontaria para uma regra que pode ainda não existir.
function citacoesForaDoSeed(seed: Seed): string[] {
  const keys = new Set(seed.rules.map((r) => r.rule_key));
  const problemas: string[] = [];
  for (const r of seed.rules) {
    for (const campo of ['criterio', 'interpretacao', 'excecoes'] as const) {
      for (const m of (r[campo] ?? '').matchAll(/\b(?:SAU|GRO|PGR|PREV)-[A-Z0-9]+(?:-[A-Z0-9]+)*/g)) if (!keys.has(m[0])) problemas.push(`${r.rule_key}.${campo}: ${m[0]}`);
    }
  }
  return problemas;
}

// Checagens de conteúdo comuns aos dois seeds.
function checagensDoSeed(nome: string, carregar: () => Seed) {
  describe(`seed ${nome}: conteúdo`, () => {
    const seed = carregar();

    it('passa em validateSeed e, com o texto de cada norma, toda ligação existe, é única e contém o fragmento', () => {
      expect(validateSeed(seed)).toEqual([]);
      expect(errosComTexto(seed)).toEqual([]);
    });

    it('tem regras, todas da área saude_ocupacional, em rascunho, com prefixo SAU- e categoria da área', () => {
      expect(seed.rules.length).toBeGreaterThan(0);
      expect(semPrefixoSau(seed)).toEqual([]);
      for (const r of seed.rules) {
        expect(r.area).toBe('saude_ocupacional');
        expect(r.status).toBe('rascunho');
        expect(categoriaValidaParaArea(r.area, r.categoria)).toBe(true);
        expect(r.exige_revisao_profissional).toBe(true);
      }
    });

    it('rule_key únicos', () => {
      const keys = seed.rules.map((r) => r.rule_key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('toda ligação: norma NR-07/NR-01/CLT/LEI-13709, corpo da norma, 1 dispositivo e `contem` UMA vez no literal e UMA vez no documento inteiro', () => {
      const problemas: string[] = [];
      for (const r of seed.rules) {
        for (const l of r.provisions) {
          expect(NORMAS).toContain(l.norma);
          expect(l.anexo).toBe('');
          const hits = parsed[l.norma].filter((p) => p.anexo === l.anexo && p.item_path === l.item_path);
          if (hits.length !== 1) problemas.push(`${r.rule_key} → ${l.norma} ${l.item_path}: ${hits.length} dispositivos`);
          else if (ocorrencias(hits[0].literal_text, l.contem) !== 1) problemas.push(`${r.rule_key} → ${l.norma} ${l.item_path}: "${l.contem}" ${ocorrencias(hits[0].literal_text, l.contem)}x no literal`);
          const noDoc = ocorrencias(DOC_INTEIRO[l.norma], l.contem);
          if (noDoc !== 1) problemas.push(`${r.rule_key} → ${l.norma} ${l.item_path}: "${l.contem}" ${noDoc}x no documento`);
        }
      }
      expect(problemas).toEqual([]);
    });

    it('nenhuma ligação aponta para dispositivo revogado (isRevokedLiteral sobre o literal inteiro)', () => {
      const revogadas: string[] = [];
      for (const r of seed.rules) for (const l of r.provisions) if (isRevokedLiteral(literal(l.norma, l.item_path)!)) revogadas.push(`${r.rule_key} → ${l.norma} ${l.item_path}`);
      expect(revogadas).toEqual([]);
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

    // Conteúdo do material do proprietário SEM base literal nestes textos: nunca no texto das regras.
    it('sem S-2220, eSocial, "dia 15", Tabela 24, MOS, Nota Orientativa, listas ilustrativas, IA/modelo externo nem atribuição ao material do proprietário', () => {
      expect(termosProibidos(seed)).toEqual([]);
    });

    it('sem conclusão sem literal: ANPD, multa/penalidade, aptidão decidida, CRM, assinatura digital, carimbo… só se um literal ligado à regra usa o termo', () => {
      expect(semLiteral(seed)).toEqual([]);
    });

    it('todo prazo/período citado (número/extenso + dia/dias úteis/hora/mês/ano; anual/semestral/bienal…) está num literal ligado à regra', () => {
      expect(prazosSemLiteral(seed)).toEqual([]);
    });

    it('números em contexto: cada "N dias/empregados … graus de risco X e Y" (criterio, interpretacao, excecoes) está no literal ligado', () => {
      expect(numerosForaDeContexto(seed)).toEqual([]);
    });

    it('nenhum criterio/interpretacao/excecoes cita rule_key que não esteja no MESMO seed', () => {
      expect(citacoesForaDoSeed(seed)).toEqual([]);
    });

    it('planImport aceita o seed contra os dispositivos dos trechos: só criações, todas as ligações resolvidas', () => {
      const plan = planImport(seed, [], resolved());
      expect(plan.errors).toEqual([]);
      expect(plan.items.map((i) => i.action)).toEqual(seed.rules.map(() => 'criar'));
      expect(plan.items.reduce((s, i) => s + i.links.length, 0)).toBe(seed.rules.reduce((s, r) => s + r.provisions.length, 0));
    });
  });
}

describe('fixtures de saúde ocupacional (trechos reais)', () => {
  it('sha256 de cada trecho confere com o README (fixture não foi editado à mão)', () => {
    for (const n of NORMAS) {
      const f = FIXTURES[n];
      expect([f.file, createHash('sha256').update(readFileSync(join(FIX, f.file))).digest('hex')]).toEqual([f.file, f.sha256]);
    }
    expect(createHash('sha256').update(readFileSync(NR07_FULL_PATH)).digest('hex')).toBe('682207e135ad01e3d29e607fb7bb56e704a9ee0c215ba05c0a60075d3f5dfda4');
  });

  it('recorte da NR-07: mesmos endereços e literais que o texto inteiro, para todos os dispositivos do recorte', () => {
    const inteiro = parseProvisions(NR07_FULL, 'nr').provisions.filter((p) => p.anexo === '');
    const doRecorte = parsed['NR-07'];
    expect(doRecorte.length).toBeGreaterThan(40);
    for (const p of doRecorte) {
      const hits = inteiro.filter((q) => q.item_path === p.item_path);
      expect([p.item_path, hits.length]).toEqual([p.item_path, 1]);
      expect([p.item_path, p.anexo, hits[0].literal_text]).toEqual([p.item_path, '', p.literal_text]);
    }
  });

  it('o parser recupera os itens esperados, sem anomalias nos trechos', () => {
    const paths = (n: string) => parsed[n].map((p) => p.item_path);
    expect(paths('NR-07')).toEqual(
      expect.arrayContaining([
        '7.5.1', '7.5.4', '7.5.5', '7.5.6', '7.5.7', '7.5.8', '7.5.9', '7.5.9.1', '7.5.10', '7.5.11', '7.5.16', '7.5.19',
        '7.5.19.1', '7.5.19.2', '7.5.19.3', '7.5.19.4', '7.5.19.5', '7.6.1', '7.6.1.1', '7.6.2', '7.6.3', '7.6.6', '7.7.1', '7.7.4',
      ]),
    );
    expect(paths('NR-01')).toEqual(expect.arrayContaining(['1.8.6', '1.8.7', '1.8.7.1', '1.8.8']));
    expect(paths('CLT')).toEqual([
      'art. 168', 'art. 168 inc. I', 'art. 168 inc. II', 'art. 168 inc. III', 'art. 168 §1', 'art. 168 §2', 'art. 168 §3',
      'art. 168 §4', 'art. 168 §5', 'art. 168 §6', 'art. 168 §7', 'art. 169',
    ]);
    expect(paths('LEI-13709')).toEqual(
      expect.arrayContaining(['art. 5', 'art. 5 inc. II', 'art. 11', 'art. 11 inc. II', 'art. 11 §4 inc. I', 'art. 11 §4 inc. II', 'art. 46', 'art. 48', 'art. 48 §1 inc. VI']),
    );
    for (const n of ['NR-07', 'CLT', 'LEI-13709']) expect([n, parseProvisions(raw(n), FIXTURES[n].kind).anomalies]).toEqual([n, []]);
    // Literais na forma da fonte (não corrigir): "centro e trinta e cinco" na NR-07 7.5.11; "§ 6 o" na CLT.
    expect(literal('NR-07', '7.5.11')).toContain('135 (centro e trinta e cinco) dias');
    expect(literal('LEI-13709', 'art. 5 inc. II')).toContain('dado referente à saúde ou à vida sexual');
  });
});

checagensDoSeed('saude-ocupacional-nr07.json (só NR-07)', loadSeedNr07);
checagensDoSeed('saude-ocupacional.json (CLT, NR-01, LGPD e mistas)', loadSeed);

describe('split dos seeds de saúde ocupacional', () => {
  const nr07 = loadSeedNr07();
  const outro = loadSeed();

  it('saude-ocupacional-nr07.json só liga a NR-07; saude-ocupacional.json só tem regras com ao menos uma ligação fora da NR-07', () => {
    expect(nr07.rules.flatMap((r) => r.provisions.filter((l) => l.norma !== 'NR-07').map((l) => `${r.rule_key} → ${l.norma}`))).toEqual([]);
    expect(outro.rules.filter((r) => r.provisions.every((l) => l.norma === 'NR-07')).map((r) => r.rule_key)).toEqual([]);
  });

  it('rule_key únicos na união dos dois seeds e sem colisão com os seeds GRO/PGR e previdenciário', () => {
    const uniao = [...nr07.rules, ...outro.rules].map((r) => r.rule_key);
    expect(new Set(uniao).size).toBe(uniao.length);
    const outrosSeeds = [GRO_SEED_PATH, PREV_SEED_PATH].flatMap((p) => loadSeedAt(p).rules.map((r) => r.rule_key));
    expect(uniao.filter((k) => outrosSeeds.includes(k))).toEqual([]);
  });

  it('o seed NR-07 resolve só com os dispositivos da NR-07 (não depende da CLT, da NR-01 nova nem da LGPD)', () => {
    const plan = planImport(nr07, [], resolved().filter((p) => p.norma === 'NR-07'));
    expect(plan.errors).toEqual([]);
    expect(plan.items.every((i) => i.action === 'criar')).toBe(true);
  });

  it('o outro seed, sem a CLT na base, aborta (só por ligações à CLT)', () => {
    const plan = planImport(outro, [], resolved().filter((p) => p.norma !== 'CLT'));
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.errors.every((e) => /→ CLT .*ligação não encontrada/.test(e))).toBe(true);
  });
});

describe('regras específicas (na união dos dois seeds)', () => {
  const seed = loadUniao();

  it('ASO: o critério lista exatamente as 7 alíneas do literal da NR-07 7.5.19.1 e a interpretação não usa termos fora do literal', () => {
    const r = seed.rules.find((x) => x.provisions.some((l) => l.norma === 'NR-07' && l.item_path === '7.5.19.1'))!;
    expect(r.categoria).toBe('aso');
    const lit = normalizeWs(literal('NR-07', '7.5.19.1')!);
    const alineas = [...lit.matchAll(/\b([a-g])\) ([^;.]+)[;.]/g)].map((m) => `${m[1]}) ${m[2]}`);
    expect(alineas).toHaveLength(7);
    for (const a of alineas) expect(normalizeWs(r.criterio)).toContain(a);
    expect(normalizeWs(r.criterio)).not.toMatch(/\bh\) /);
    for (const re of [/\bCRM\b/, /assinatura\s+(digital|eletr[ôo]nica)/i, /carimb/i, /e-?social/i]) {
      for (const aso of seed.rules.filter((x) => x.categoria === 'aso')) expect([aso.rule_key, re.test(aso.interpretacao)]).toEqual([aso.rule_key, false]);
    }
  });

  it('exame demissional: 10 dias e as dispensas 135/90 dias por grau de risco, como no literal da NR-07 7.5.11', () => {
    const r = seed.rules.find((x) => x.provisions.some((l) => l.norma === 'NR-07' && l.item_path === '7.5.11'))!;
    expect(r.criterio).toContain('10 (dez) dias contados do término do contrato');
    expect(r.criterio).toMatch(/135 .*graus de risco 1 e 2/);
    expect(r.criterio).toMatch(/90 \(noventa\) dias.*graus de risco 3 e 4/);
    expect(paresGrau(literal('NR-07', '7.5.11')!)).toEqual(['135 → graus de risco 1 e 2', '90 → graus de risco 3 e 4']);
  });

  it('dispensa do PCMSO (MEI/ME/EPP): liga NR-01 1.8.6 e 1.8.7.1 e as obrigações literais da NR-07 7.7.x; não duplica regras do GRO/PGR', () => {
    const dispensa = seed.rules.filter((r) => r.provisions.some((l) => l.norma === 'NR-01' && l.item_path === '1.8.6'));
    expect(dispensa).toHaveLength(1);
    expect(dispensa[0].categoria).toBe('excecao');
    expect(dispensa[0].interpretacao).toMatch(/NOTA AO REVISOR/);
    const dispensadas = seed.rules.find((r) => r.rule_key === 'SAU-DISPENSADAS-EXAMES-ASO')!;
    expect(dispensadas.categoria).toBe('exames_ocupacionais');
    const ligs = seed.rules.flatMap((r) => r.provisions.map((l) => `${l.norma} ${l.item_path}`));
    expect(ligs).toEqual(expect.arrayContaining(['NR-01 1.8.7.1', 'NR-07 7.7.1', 'NR-07 7.7.2', 'NR-07 7.7.3', 'NR-07 7.7.4']));
    // NR-01 só onde o literal cita o PCMSO (ou é a definição de grau de risco/responsável citada junto).
    for (const r of seed.rules) for (const l of r.provisions.filter((x) => x.norma === 'NR-01')) expect(['1.8.6', '1.8.7', '1.8.7.1', '1.8.8']).toContain(l.item_path);
    const gro = loadSeedAt(GRO_SEED_PATH);
    expect(gro.rules.some((r) => r.provisions.some((l) => l.item_path === '1.8.6' || l.item_path === '1.8.7.1'))).toBe(false);
  });

  it('NR-01 ANTERIOR (texto antigo): 1.8.6, 1.8.7 e 1.8.8 resolvem com o mesmo `contem`; só o 1.8.7.1 NÃO resolve (lá é 1.8.6.1)', () => {
    const antiga = parseProvisions(readFileSync(NR01_ANTIGA_PATH, 'utf8'), 'nr').provisions;
    const base = [
      ...resolved().filter((p) => p.norma !== 'NR-01'),
      ...antiga.map((p, i) => ({ id: `NR-01-antiga-${i}`, norma: 'NR-01', anexo: p.anexo, item_path: p.item_path, literal_text: p.literal_text })),
    ];
    const outro = loadSeed();
    const plan = planImport(outro, [], base);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toMatch(/^SAU-DISPENSA-PCMSO-MEI-ME-EPP → NR-01 anexo '' item 1\.8\.7\.1: ligação não encontrada/);
    const dispensa = plan.items.find((i) => i.rule_key === 'SAU-DISPENSA-PCMSO-MEI-ME-EPP')!;
    expect(dispensa.links.map((l) => l.item_path).sort()).toEqual(['1.8.6', '1.8.7', '1.8.8']);
    // O texto do 1.8.7.1 novo está, na redação anterior, no 1.8.6.1.
    const l1871 = outro.rules.flatMap((r) => r.provisions).find((l) => l.norma === 'NR-01' && l.item_path === '1.8.7.1')!;
    expect(antiga.filter((p) => p.anexo === '' && normalizeWs(p.literal_text).includes(normalizeWs(l1871.contem))).map((p) => p.item_path)).toEqual(['1.8.6.1']);
  });

  it('LGPD: liga art. 5 inc. II (dado sensível), art. 11 (com os incisos I/II do §4), art. 46 e art. 48; não liga o art. 5 inc. VIII (encarregado/ANPD)', () => {
    const ligs = seed.rules.flatMap((r) => r.provisions.filter((l) => l.norma === 'LEI-13709').map((l) => l.item_path));
    expect(ligs).toEqual(expect.arrayContaining(['art. 5 inc. II', 'art. 11', 'art. 11 §4', 'art. 11 §4 inc. I', 'art. 11 §4 inc. II', 'art. 46', 'art. 48']));
    expect(ligs).not.toContain('art. 5 inc. VIII');
    for (const r of seed.rules.filter((x) => x.provisions.some((l) => l.norma === 'LEI-13709'))) expect(r.categoria).toBe('privacidade_dados');
  });

  it('LGPD art. 11: as alíneas d e g do inciso II estão inteiras no critério (sem corte não marcado)', () => {
    const r = seed.rules.find((x) => x.rule_key === 'SAU-LGPD-HIPOTESES-TRATAMENTO-SENSIVEL')!;
    const crit = normalizeWs(r.criterio);
    expect(crit).toContain('este último nos termos da Lei nº 9.307, de 23 de setembro de 1996 (Lei de Arbitragem)');
    expect(crit).toContain('resguardados os direitos mencionados no art. 9º desta Lei');
  });
});

describe('seeds de saúde ocupacional: mutações são barradas', () => {
  const base = loadSeed();
  const uniao = loadUniao();

  it('fragmento `contem` errado (texto que o dispositivo não contém) é rejeitado por validateSeed e por planImport', () => {
    for (const s0 of [loadSeedNr07(), base]) {
      const s = clone(s0);
      s.rules[0].provisions[0].contem = 'trecho que não está no dispositivo';
      expect(errosComTexto(s).some((e) => /endereço resolve, mas o texto não contém/.test(e))).toBe(true);
      expect(planImport(s, [], resolved()).errors.some((e) => /endereço resolve, mas o texto não contém/.test(e))).toBe(true);
    }
  });

  it('fragmento de OUTRO dispositivo da mesma norma é rejeitado (7.5.11 com o texto do 7.5.9)', () => {
    const s = clone(loadSeedNr07());
    const l = s.rules.flatMap((r) => r.provisions).find((x) => x.norma === 'NR-07' && x.item_path === '7.5.11')!;
    l.contem = 'quando ausente por período igual ou superior a 30 (trinta) dias'; // está no 7.5.9
    expect(errosComTexto(s).some((e) => /item 7\.5\.11: endereço resolve, mas o texto não contém/.test(e))).toBe(true);
  });

  it('ligação a dispositivo inexistente é "ligação não encontrada"', () => {
    const s = clone(loadSeedNr07());
    const l = s.rules.flatMap((r) => r.provisions).find((x) => x.norma === 'NR-07')!;
    l.item_path = '7.5.99';
    expect(errosComTexto(s).some((e) => /item 7\.5\.99: ligação não encontrada/.test(e))).toBe(true);
    expect(planImport(s, [], resolved()).errors.some((e) => /7\.5\.99: ligação não encontrada/.test(e))).toBe(true);
  });

  it('norma ausente da base (LGPD não ingerida) aborta o plano inteiro', () => {
    const plan = planImport(base, [], resolved().filter((p) => p.norma !== 'LEI-13709'));
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.errors.every((e) => /→ LEI-13709 .*ligação não encontrada/.test(e))).toBe(true);
  });

  it('ligação sem `contem` e regra sem ligação e sem a nota são rejeitadas', () => {
    const s = clone(base);
    delete (s.rules[0].provisions[0] as { contem?: string }).contem;
    s.rules[1].provisions = [];
    const errs = validateSeed(s);
    expect(errs.some((e) => /contem obrigatório/.test(e))).toBe(true);
    expect(errs.some((e) => /sem fundamento literal verificado/.test(e))).toBe(true);
  });

  it('status diferente de rascunho, categoria de outra área e rule_key sem SAU- são rejeitados', () => {
    const s = clone(base);
    (s.rules[0] as { status: string }).status = 'revisada';
    (s.rules[1] as { categoria: string }).categoria = 'ltcat';
    s.rules[2].rule_key = 'PCMSO-SEM-PREFIXO';
    const errs = validateSeed(s);
    expect(errs.some((e) => /status deve ser 'rascunho'/.test(e))).toBe(true);
    expect(errs.some((e) => /categoria 'ltcat' não pertence à área 'saude_ocupacional'/.test(e))).toBe(true);
    expect(errs.some((e) => /rule_key da área saude_ocupacional deve começar com SAU-/.test(e))).toBe(true);
    expect(semPrefixoSau(s)).toEqual(['PCMSO-SEM-PREFIXO']);
  });

  it('prazo sem literal (ex.: "até o dia 15 do mês seguinte", "em 72 horas/3 dias úteis") e termos do material sem base são barrados', () => {
    const s = clone(uniao);
    const lgpd = s.rules.find((r) => r.rule_key === 'SAU-LGPD-COMUNICACAO-INCIDENTE')!;
    lgpd.interpretacao += ' Comunicar em 3 dias úteis.';
    const ret = s.rules.find((r) => r.rule_key === 'SAU-EXAME-RETORNO-TRABALHO')!;
    ret.interpretacao = ret.interpretacao.replace('30 (trinta) dias', '15 (quinze) dias');
    const aso = s.rules.find((r) => r.rule_key === 'SAU-ASO-EMISSAO')!;
    aso.interpretacao += ' Enviar o evento S-2220 ao eSocial até o dia 15 do mês seguinte.';
    expect(prazosSemLiteral(s)).toEqual(
      expect.arrayContaining(['SAU-LGPD-COMUNICACAO-INCIDENTE: "3 dias úteis"', 'SAU-EXAME-RETORNO-TRABALHO: "15 (quinze) dias"']),
    );
    expect(termosProibidos(s)).toEqual(['SAU-ASO-EMISSAO: "S-2220"', 'SAU-ASO-EMISSAO: "eSocial"', 'SAU-ASO-EMISSAO: "dia 15"']);
  });

  it('prazo em HORAS, "dias úteis" e por extenso sem literal são barrados; o mesmo número em dias corridos não basta para "dias úteis"', () => {
    const s = clone(uniao);
    const lgpd = s.rules.find((r) => r.rule_key === 'SAU-LGPD-COMUNICACAO-INCIDENTE')!;
    lgpd.interpretacao += ' Comunicar em 72 horas ou em setenta e duas horas.';
    const ret = s.rules.find((r) => r.rule_key === 'SAU-EXAME-RETORNO-TRABALHO')!;
    ret.criterio += ' Em 30 dias úteis.'; // o literal diz "30 (trinta) dias", não dias úteis
    expect(prazosSemLiteral(s)).toEqual(
      expect.arrayContaining(['SAU-LGPD-COMUNICACAO-INCIDENTE: "72 horas"', 'SAU-LGPD-COMUNICACAO-INCIDENTE: "setenta e duas horas"', 'SAU-EXAME-RETORNO-TRABALHO: "30 dias úteis"']),
    );
  });

  it('adjetivo de periodicidade sem literal ligado é barrado (anual, semestral, bienal, trimestral, mensal); com literal, aceito', () => {
    const s = clone(uniao);
    const periodico = s.rules.find((r) => r.rule_key === 'SAU-EXAME-CLINICO-ADMISSIONAL-PERIODICO')!; // literal: "a cada ano", "a cada dois anos"
    periodico.interpretacao += ' O periódico é anual; para os demais, bienal.';
    const ret = s.rules.find((r) => r.rule_key === 'SAU-EXAME-RETORNO-TRABALHO')!;
    ret.excecoes = 'Reavaliação semestral, trimestral ou mensal.';
    const rel = s.rules.find((r) => r.rule_key === 'SAU-RELATORIO-ANALITICO')!; // literal 7.6.2: "anualmente"
    rel.interpretacao += ' O relatório é anual.';
    const p = prazosSemLiteral(s);
    expect(p).toEqual(
      expect.arrayContaining([
        'SAU-EXAME-CLINICO-ADMISSIONAL-PERIODICO: "anual"',
        'SAU-EXAME-CLINICO-ADMISSIONAL-PERIODICO: "bienal"',
        'SAU-EXAME-RETORNO-TRABALHO: "semestral"',
        'SAU-EXAME-RETORNO-TRABALHO: "trimestral"',
        'SAU-EXAME-RETORNO-TRABALHO: "mensal"',
      ]),
    );
    expect(p.filter((x) => x.startsWith('SAU-RELATORIO-ANALITICO'))).toEqual([]);
  });

  it('trocar 135 e 90 entre os graus de risco é barrado — na interpretacao, no criterio e nas excecoes', () => {
    const trocar = (t: string) => t.replace(/135/g, '§§').replace(/90 \(noventa\)/g, '135').replace(/90/g, '135').replace(/§§/g, '90');
    for (const campo of ['interpretacao', 'criterio', 'excecoes'] as const) {
      const s = clone(uniao);
      const r = s.rules.find((x) => x.rule_key === 'SAU-EXAME-DEMISSIONAL')!;
      r[campo] = trocar(r[campo]!);
      expect([campo, numerosForaDeContexto(s)]).toEqual([
        campo,
        expect.arrayContaining([`SAU-EXAME-DEMISSIONAL.${campo}: "90 → graus de risco 1 e 2"`, `SAU-EXAME-DEMISSIONAL.${campo}: "135 → graus de risco 3 e 4"`]),
      ]);
    }
    // 25/10 empregados por grau de risco (NR-07 7.6.6) também.
    const s = clone(uniao);
    const rel = s.rules.find((x) => x.rule_key === 'SAU-RELATORIO-ANALITICO')!;
    rel.excecoes = rel.excecoes!.replace('até 25 (vinte e cinco) empregados', 'até §§').replace('até 10 (dez) empregados', 'até 25 (vinte e cinco) empregados').replace('até §§', 'até 10 (dez) empregados');
    expect(numerosForaDeContexto(s).filter((x) => x.startsWith('SAU-RELATORIO-ANALITICO.excecoes'))).not.toEqual([]);
  });

  it('"aptidão decidida" em qualquer forma é barrada (decide, decidida, determina a aptidão, conclui apto/inapto)', () => {
    for (const frase of ['O sistema decide a aptidão.', 'A aptidão é decidida pelo sistema.', 'O sistema determina a aptidão.', 'O sistema conclui apto.', 'O sistema conclui pela inaptidão.', 'O sistema conclui que é inapto.']) {
      const s = clone(uniao);
      const r = s.rules.find((x) => x.rule_key === 'SAU-ASO-CONTEUDO-MINIMO')!;
      r.interpretacao += ` ${frase}`;
      expect([frase, semLiteral(s)]).toEqual([frase, ['SAU-ASO-CONTEUDO-MINIMO: "aptidão decidida"']]);
    }
  });

  it('ASO: CRM, assinatura digital e carimbo na interpretação são barrados (o literal não os usa)', () => {
    const s = clone(uniao);
    const r = s.rules.find((x) => x.rule_key === 'SAU-ASO-CONTEUDO-MINIMO')!;
    r.interpretacao += ' Com CRM do médico, assinatura digital e carimbo.';
    expect(semLiteral(s)).toEqual(['SAU-ASO-CONTEUDO-MINIMO: "CRM"', 'SAU-ASO-CONTEUDO-MINIMO: "assinatura digital"', 'SAU-ASO-CONTEUDO-MINIMO: "carimbo"']);
  });

  it('citação de rule_key do OUTRO seed (ou inexistente) é barrada, em qualquer dos três campos', () => {
    const s = clone(loadSeedNr07());
    const r = s.rules.find((x) => x.rule_key === 'SAU-PRONTUARIO-MEDICO')!;
    r.interpretacao += ' Ver SAU-LGPD-DADO-SAUDE-SENSIVEL.';
    r.excecoes = 'Ver GRO-INEXISTENTE.';
    expect(citacoesForaDoSeed(s)).toEqual(['SAU-PRONTUARIO-MEDICO.interpretacao: SAU-LGPD-DADO-SAUDE-SENSIVEL', 'SAU-PRONTUARIO-MEDICO.excecoes: GRO-INEXISTENTE']);
    const o = clone(loadSeed());
    o.rules[0].criterio += ' (SAU-EXAMES-OBRIGATORIOS)';
    expect(citacoesForaDoSeed(o)).toEqual([`${o.rules[0].rule_key}.criterio: SAU-EXAMES-OBRIGATORIOS`]);
  });

  it('ligação a dispositivo revogado é barrada pelo importador (literal SINTÉTICO "<item> (Revogado …)")', () => {
    const nr07 = loadSeedNr07();
    const l = nr07.rules[0].provisions[0];
    const rev = resolved().map((p) =>
      p.norma === l.norma && p.item_path === l.item_path ? { ...p, literal_text: `${l.item_path} (Revogado pela Portaria sintética de teste)` } : p,
    );
    expect(isRevokedLiteral(`${l.item_path} (Revogado pela Portaria sintética de teste)`)).toBe(true);
    expect(planImport(nr07, [], rev).errors.some((e) => /dispositivo revogado/.test(e))).toBe(true);
  });
});

describe('importador continua agnóstico de norma; seeds GRO/PGR e previdenciário não são afetados', () => {
  it('padrão do CLI segue o seed GRO/PGR; os seeds de saúde ocupacional são passados por caminho', () => {
    expect(DEFAULT_SEED_PATH).toBe(GRO_SEED_PATH);
    expect(parseArgs([SEED_PATH])).toEqual({ seedPath: SEED_PATH, apply: false });
    expect(parseArgs([SEED_NR07_PATH, '--apply'])).toEqual({ seedPath: SEED_NR07_PATH, apply: true });
  });

  it('plano do seed GRO/PGR contra a NR-01 vigente, com os dispositivos de saúde na mesma base: sem erros, só criações', () => {
    const gro = loadSeedAt(GRO_SEED_PATH);
    const plan = planImport(gro, [], resolved());
    expect(plan.errors).toEqual([]);
    expect(plan.items.length).toBe(gro.rules.length);
    expect(plan.items.every((i) => i.action === 'criar')).toBe(true);
  });

  it('seed previdenciário continua estruturalmente válido', () => {
    expect(validateSeed(loadSeedAt(PREV_SEED_PATH))).toEqual([]);
  });
});
