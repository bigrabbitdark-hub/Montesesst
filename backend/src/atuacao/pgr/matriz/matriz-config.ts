import { createHash } from 'crypto';

/**
 * Matriz de risco do PGR (B1): validação, cálculo e hash canônico.
 * Funções puras, sem I/O. Nenhum valor padrão: a matriz nasce vazia e é
 * preenchida pela equipe técnica.
 *
 * Decisão de cobertura das faixas: todo inteiro de `min(sev)*min(prob)` a
 * `max(sev)*max(prob)` deve pertencer a exatamente uma faixa (sem lacuna e sem
 * sobreposição), inclusive escores que não são produto alcançável (ex.: 7 numa
 * escala 3x3), para que as faixas sejam contíguas e legíveis. Faixa que
 * ultrapassa esse intervalo é erro.
 */

export const FORMULAS_CONHECIDAS = ['severidade*probabilidade'] as const;
export type MatrizFormula = (typeof FORMULAS_CONHECIDAS)[number];

export interface MatrizEscalaItem { valor: number; rotulo: string; descricao: string }
export interface MatrizNivel { id: string; rotulo: string; aceitabilidade: string; decisao: string; bloqueia_emissao: boolean }
export interface MatrizFaixa { min: number; max: number; nivel_id: string }
export interface MatrizMetodologia { formula: MatrizFormula; validada_por: string; registro?: string; data: string; observacoes?: string }
export interface MatrizConfig {
  severidade: MatrizEscalaItem[];
  probabilidade: MatrizEscalaItem[];
  niveis: MatrizNivel[];
  faixas: MatrizFaixa[];
  metodologia: MatrizMetodologia;
}

export interface ValidacaoMatriz { ok: boolean; erros: string[]; pendencias: string[] }
export interface CelulaMatriz { severidade: number; probabilidade: number; score: number; nivel_id: string }
export interface ResultadoCalculo { score: number; nivel_id: string; nivel: MatrizNivel; faixa: MatrizFaixa }

export class MatrizForaDaEscalaError extends Error {
  constructor(message: string) { super(message); this.name = 'MatrizForaDaEscalaError'; }
}
export class MatrizSemFaixaError extends Error {
  constructor(message: string) { super(message); this.name = 'MatrizSemFaixaError'; }
}

const isObj = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);

export const LIMITES = { escala: 20, niveis: 100, faixas: 100, valorMax: 1000, faixaMax: 1_000_000 } as const;
const isStr = (x: unknown): x is string => typeof x === 'string';

function dataValida(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Lista branca de chaves em cada nível: chave desconhecida é erro (evita lixo/typo congelado numa versão imutável).
const CHAVES = {
  raiz: ['severidade', 'probabilidade', 'niveis', 'faixas', 'metodologia'],
  escala: ['valor', 'rotulo', 'descricao'],
  nivel: ['id', 'rotulo', 'aceitabilidade', 'decisao', 'bloqueia_emissao'],
  faixa: ['min', 'max', 'nivel_id'],
  metodologia: ['formula', 'validada_por', 'registro', 'data', 'observacoes'],
} as const;
function chavesDesconhecidas(onde: string, obj: Record<string, any>, permitidas: readonly string[], erros: string[]) {
  for (const k of Object.keys(obj)) {
    if (!permitidas.includes(k)) erros.push(`${onde}: campo desconhecido "${k.length > 60 ? `${k.slice(0, 60)}…` : k}" (permitidos: ${permitidas.join(', ')}).`);
  }
}

/** Valida a escala; devolve os valores se estrutura utilizável. */
function validarEscala(nome: string, esc: unknown, erros: string[]): number[] | null {
  if (!Array.isArray(esc)) { erros.push(`A escala de ${nome} deve ser uma lista.`); return null; }
  if (esc.length === 0) { erros.push(`A escala de ${nome} está vazia: informe ao menos um nível.`); return null; }
  if (esc.length > LIMITES.escala) { erros.push(`A escala de ${nome} tem itens demais (máximo ${LIMITES.escala}).`); return null; }
  let ok = true;
  const valores: number[] = [];
  esc.forEach((it, i) => {
    const pos = `${nome}[${i + 1}]`;
    if (!isObj(it)) { erros.push(`Escala ${pos}: item inválido.`); ok = false; return; }
    chavesDesconhecidas(`Escala ${pos}`, it, CHAVES.escala, erros);
    if (!isInt(it.valor) || it.valor < 1 || it.valor > LIMITES.valorMax) { erros.push(`Escala ${pos}: "valor" deve ser inteiro entre 1 e ${LIMITES.valorMax}.`); ok = false; }
    else valores.push(it.valor);
    if (!isStr(it.rotulo) || it.rotulo.trim() === '') { erros.push(`Escala ${pos}: "rotulo" é obrigatório e não pode ser vazio.`); ok = false; }
    if (!isStr(it.descricao)) { erros.push(`Escala ${pos}: "descricao" deve ser texto.`); ok = false; }
  });
  if (valores.length === esc.length) {
    const vistos = new Set<number>([valores[0]]);
    for (let i = 1; i < valores.length; i++) {
      const dup = vistos.has(valores[i]);
      vistos.add(valores[i]);
      if (dup) {
        erros.push(`Escala de ${nome}: valor ${valores[i]} duplicado (posição ${i + 1}); os valores devem ser únicos e estritamente crescentes.`);
        ok = false;
      } else if (valores[i] < valores[i - 1]) {
        erros.push(`Escala de ${nome}: valor ${valores[i]} (posição ${i + 1}) não é maior que o anterior (${valores[i - 1]}); os valores devem ser estritamente crescentes.`);
        ok = false;
      }
    }
  }
  return ok ? valores : null;
}

export function validarConfig(config: unknown, opts: { publicar: boolean }): ValidacaoMatriz {
  const erros: string[] = [];
  const pendencias: string[] = [];
  const fim = (): ValidacaoMatriz => ({
    ok: erros.length === 0 && (!opts.publicar || pendencias.length === 0),
    erros,
    pendencias,
  });
  if (!isObj(config)) {
    erros.push('A configuração da matriz deve ser um objeto JSON.');
    return fim();
  }
  chavesDesconhecidas('Configuração', config, CHAVES.raiz, erros);

  const sev = validarEscala('severidade', config.severidade, erros);
  const prob = validarEscala('probabilidade', config.probabilidade, erros);

  // níveis
  const ids = new Set<string>();
  let niveisOk = true;
  if (!Array.isArray(config.niveis)) { erros.push('"niveis" deve ser uma lista.'); niveisOk = false; }
  else if (config.niveis.length > LIMITES.niveis) { erros.push(`"niveis" tem itens demais (máximo ${LIMITES.niveis}).`); niveisOk = false; }
  else {
    config.niveis.forEach((n: unknown, i: number) => {
      const pos = `niveis[${i + 1}]`;
      if (!isObj(n)) { erros.push(`Nível ${pos}: item inválido.`); return; }
      chavesDesconhecidas(`Nível ${pos}`, n, CHAVES.nivel, erros);
      if (!isStr(n.id) || n.id.trim() === '') erros.push(`Nível ${pos}: "id" é obrigatório e não pode ser vazio.`);
      else if (ids.has(n.id)) erros.push(`Nível ${pos}: id "${n.id}" duplicado.`);
      else ids.add(n.id);
      if (!isStr(n.rotulo) || n.rotulo.trim() === '') erros.push(`Nível ${pos}: "rotulo" é obrigatório e não pode ser vazio.`);
      if (!isStr(n.aceitabilidade)) erros.push(`Nível ${pos}: "aceitabilidade" deve ser texto.`);
      if (!isStr(n.decisao)) erros.push(`Nível ${pos}: "decisao" deve ser texto.`);
      if (typeof n.bloqueia_emissao !== 'boolean') erros.push(`Nível ${pos}: "bloqueia_emissao" deve ser verdadeiro ou falso.`);
    });
  }

  // faixas
  const usados = new Set<string>();
  if (!Array.isArray(config.faixas)) erros.push('"faixas" deve ser uma lista.');
  else if (config.faixas.length > LIMITES.faixas) erros.push(`"faixas" tem itens demais (máximo ${LIMITES.faixas}).`);
  else {
    const validas: MatrizFaixa[] = [];
    config.faixas.forEach((f: unknown, i: number) => {
      const pos = `faixas[${i + 1}]`;
      if (!isObj(f)) { erros.push(`Faixa ${pos}: item inválido.`); return; }
      chavesDesconhecidas(`Faixa ${pos}`, f, CHAVES.faixa, erros);
      let ok = true;
      if (!isInt(f.min) || !isInt(f.max) || Math.abs(f.min) > LIMITES.faixaMax || Math.abs(f.max) > LIMITES.faixaMax) { erros.push(`Faixa ${pos}: "min" e "max" devem ser inteiros com módulo até ${LIMITES.faixaMax}.`); ok = false; }
      else if (f.min > f.max) { erros.push(`Faixa ${pos}: min (${f.min}) maior que max (${f.max}).`); ok = false; }
      if (!isStr(f.nivel_id) || f.nivel_id === '') { erros.push(`Faixa ${pos}: "nivel_id" é obrigatório.`); ok = false; }
      else if (niveisOk && !ids.has(f.nivel_id)) { erros.push(`Faixa ${pos}: nível "${f.nivel_id}" não existe em "niveis".`); }
      else usados.add(f.nivel_id);
      if (ok) validas.push({ min: f.min, max: f.max, nivel_id: f.nivel_id });
    });

    if (sev && prob && validas.length === config.faixas.length) {
      const lo = sev[0] * prob[0];
      const hi = sev[sev.length - 1] * prob[prob.length - 1];
      let dentro = true;
      for (const f of validas) {
        if (f.min < lo || f.max > hi) {
          erros.push(`Faixa ${f.min}–${f.max} ultrapassa o intervalo possível de escores (${lo} a ${hi}).`);
          dentro = false;
        }
      }
      if (dentro) {
        const ord = [...validas].sort((a, b) => a.min - b.min || a.max - b.max);
        if (ord.length === 0) erros.push(`Lacuna nas faixas: nenhuma faixa definida; os escores ${lo} a ${hi} não estão cobertos.`);
        else {
          if (ord[0].min > lo) erros.push(`Lacuna nas faixas: escores ${lo} a ${ord[0].min - 1} não estão cobertos (a primeira faixa começa em ${ord[0].min}).`);
          for (let i = 1; i < ord.length; i++) {
            const a = ord[i - 1], b = ord[i];
            if (b.min <= a.max) erros.push(`Sobreposição entre as faixas ${a.min}–${a.max} e ${b.min}–${b.max}.`);
            else if (b.min > a.max + 1) {
              const g0 = a.max + 1, g1 = b.min - 1;
              erros.push(`Lacuna nas faixas: ${g0 === g1 ? `escore ${g0} não está coberto` : `escores ${g0} a ${g1} não estão cobertos`} (entre ${a.min}–${a.max} e ${b.min}–${b.max}).`);
            }
          }
          const ult = ord[ord.length - 1];
          if (ult.max < hi) erros.push(`Lacuna nas faixas: escores ${ult.max + 1} a ${hi} não estão cobertos (a última faixa termina em ${ult.max}).`);
        }
      }
    }
  }

  if (niveisOk) {
    for (const id of ids) if (!usados.has(id)) pendencias.push(`O nível "${id}" não é usado por nenhuma faixa.`);
  }

  // metodologia
  const m = config.metodologia;
  if (m === undefined || m === null) pendencias.push('Metodologia não informada (fórmula, validada_por e data).');
  else if (!isObj(m)) erros.push('"metodologia" deve ser um objeto.');
  else {
    chavesDesconhecidas('Metodologia', m, CHAVES.metodologia, erros);
    if (m.formula === undefined || m.formula === null || m.formula === '') pendencias.push('Metodologia: fórmula não informada.');
    else if (!isStr(m.formula) || !(FORMULAS_CONHECIDAS as readonly string[]).includes(m.formula))
      erros.push(`Metodologia: fórmula desconhecida (${isStr(m.formula) ? `"${m.formula}"` : 'valor inválido'}); conhecidas: ${FORMULAS_CONHECIDAS.join(', ')}.`);
    if (m.validada_por === undefined || m.validada_por === null || (isStr(m.validada_por) && m.validada_por.trim() === '')) pendencias.push('Metodologia: "validada_por" não informado.');
    else if (!isStr(m.validada_por)) erros.push('Metodologia: "validada_por" deve ser texto.');
    if (m.data === undefined || m.data === null || m.data === '') pendencias.push('Metodologia: "data" da validação não informada.');
    else if (!isStr(m.data) || !dataValida(m.data)) erros.push('Metodologia: "data" deve ser uma data válida no formato AAAA-MM-DD.');
    for (const k of ['registro', 'observacoes']) {
      if (m[k] !== undefined && !isStr(m[k])) erros.push(`Metodologia: "${k}" deve ser texto.`);
    }
  }
  return fim();
}

export function calcular(config: MatrizConfig, severidade: number, probabilidade: number): ResultadoCalculo {
  if (!config.severidade.some((e) => e.valor === severidade))
    throw new MatrizForaDaEscalaError(`Severidade ${String(severidade)} fora da escala da matriz (valores: ${config.severidade.map((e) => e.valor).join(', ')}).`);
  if (!config.probabilidade.some((e) => e.valor === probabilidade))
    throw new MatrizForaDaEscalaError(`Probabilidade ${String(probabilidade)} fora da escala da matriz (valores: ${config.probabilidade.map((e) => e.valor).join(', ')}).`);
  const score = severidade * probabilidade;
  const faixa = config.faixas.find((f) => score >= f.min && score <= f.max);
  if (!faixa) throw new MatrizSemFaixaError(`Nenhuma faixa da matriz cobre o escore ${score}.`);
  const nivel = config.niveis.find((n) => n.id === faixa.nivel_id);
  if (!nivel) throw new MatrizSemFaixaError(`A faixa ${faixa.min}–${faixa.max} aponta para o nível inexistente "${faixa.nivel_id}".`);
  return { score, nivel_id: nivel.id, nivel, faixa };
}

export function celulas(config: MatrizConfig): CelulaMatriz[] {
  const out: CelulaMatriz[] = [];
  for (const s of config.severidade)
    for (const p of config.probabilidade) {
      const r = calcular(config, s.valor, p.valor);
      out.push({ severidade: s.valor, probabilidade: p.valor, score: r.score, nivel_id: r.nivel_id });
    }
  return out;
}

export class MatrizHashInvalidoError extends Error {
  constructor(message: string) { super(message); this.name = 'MatrizHashInvalidoError'; }
}

const PROFUNDIDADE_MAX = 20;

function ehObjetoPuro(x: object): boolean {
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function canonico(x: unknown, nivel: number, pilha: object[]): string {
  if (nivel > PROFUNDIDADE_MAX) throw new MatrizHashInvalidoError('Estrutura profunda demais para o hash canônico.');
  if (x === null) return 'null';
  switch (typeof x) {
    case 'string': case 'boolean': return JSON.stringify(x);
    case 'number':
      if (!Number.isFinite(x)) throw new MatrizHashInvalidoError('Número não finito não pode ser serializado no hash canônico.');
      return JSON.stringify(x); // -0 => "0"
    case 'object': break;
    default: throw new MatrizHashInvalidoError(`Tipo ${typeof x} não pode ser serializado no hash canônico.`);
  }
  const o = x as object;
  if (pilha.includes(o)) throw new MatrizHashInvalidoError('Estrutura circular não pode ser serializada no hash canônico.');
  pilha.push(o);
  try {
    if (Array.isArray(o)) return `[${o.map((i) => (i === undefined ? 'null' : canonico(i, nivel + 1, pilha))).join(',')}]`;
    if (!ehObjetoPuro(o)) throw new MatrizHashInvalidoError('Objeto não simples não pode ser serializado no hash canônico.');
    const r = o as Record<string, unknown>;
    const ks = Object.keys(r).filter((k) => r[k] !== undefined).sort();
    return `{${ks.map((k) => `${JSON.stringify(k)}:${canonico(r[k], nivel + 1, pilha)}`).join(',')}}`;
  } finally {
    pilha.pop();
  }
}

/** JSON canônico (chaves ordenadas recursivamente). Pré-condição: chamar só após validarConfig ok. */
export function jsonCanonico(config: unknown): string { return canonico(config, 0, []); }

/** SHA-256 hex do JSON canônico. Lança MatrizHashInvalidoError para entradas não serializáveis. */
export function sha256Canonico(config: unknown): string {
  return createHash('sha256').update(jsonCanonico(config), 'utf8').digest('hex');
}
