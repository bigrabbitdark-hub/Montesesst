import { maskCpf } from '../../epi-ficha/cpf-mask.util';

// Sequência com cara de CPF (11 dígitos, com ou sem máscara) isolada por bordas NÃO alfanuméricas: dentro de
// UUID ("...-a12345678901") ou hash hex ("...f12345678901a...") ela não casa.
const CPF_LIKE = /(?<![0-9A-Za-z])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![0-9A-Za-z])/g;
// Strings que são identificadores inteiros nunca são alteradas (proteção em profundidade).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]{16,}$/i;
// Chaves de identificador: id, *_id, *_ids (o valor nunca é CPF; mascarar corromperia o id).
const ID_KEY_RE = /(^id$|_id$|_ids$)/;
const MAX_DEPTH = 20;

function maskString(s: string): string {
  if (UUID_RE.test(s) || HEX_RE.test(s)) return s;
  return s.replace(CPF_LIKE, (m) => maskCpf(m));
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return maskString(value);
  if (!value || typeof value !== 'object') return value;
  // Profundidade excessiva ou ciclo: não desce mais e não lança (devolve um marcador sem dados).
  if (depth >= MAX_DEPTH || seen.has(value)) return '[omitido]';
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return value; // Date, Buffer etc.
  seen.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((v) => walk(v, depth + 1, seen));
  } else {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      obj[k] = ID_KEY_RE.test(k) && (typeof v === 'string' || Array.isArray(v)) ? v : walk(v, depth + 1, seen);
    }
    out = obj;
  }
  seen.delete(value);
  return out;
}

// Mascara (maskCpf) todo CPF que aparecer em QUALQUER texto de um valor JSON (objetos, listas, strings).
// Usado para devolver dados a papéis que não devem ver CPF completo (técnico/parceiro), inclusive em textos
// livres vindos de terceiros (ex.: ocorrências do eSocial em retorno_json/erro_mensagem/histórico).
// Valores de chaves id/*_id/*_ids e strings que são UUID ou hex puros ficam intactos. Ciclo ou profundidade
// acima de 20 viram '[omitido]' (sem lançar). Não altera o valor original (devolve cópia).
export function maskCpfDeep<T>(value: T): T {
  return walk(value, 0, new WeakSet()) as T;
}
