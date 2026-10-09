// Diff por parágrafos, sem dependência. Unidade = linha de texto (a extração separa parágrafos por \n).

export type DiffKind = 'added' | 'removed' | 'context';

export interface DiffHunk {
  kind: DiffKind;
  text: string;
}

export interface ParagraphDiff {
  summary: { added: number; removed: number; unchanged: number };
  truncated: boolean;
  hunks: DiffHunk[];
}

type Op = { kind: 'same' | 'added' | 'removed'; text: string };

const MAX_CELLS = 4_000_000;
const MAX_CHANGED = 500;
const CONTEXT = 2;

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

// Maior subsequência comum por programação dinâmica; o miolo tem no máximo MAX_CELLS células,
// então a menor dimensão é ≤ 2000 e Uint16Array comporta o comprimento da subsequência.
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const t = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[i] === b[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) {
      ops.push({ kind: 'removed', text: a[i++] });
    } else {
      ops.push({ kind: 'added', text: b[j++] });
    }
  }
  while (i < n) ops.push({ kind: 'removed', text: a[i++] });
  while (j < m) ops.push({ kind: 'added', text: b[j++] });
  return ops;
}

// Fallback para miolos enormes: diferença por multiconjunto (sem ordem).
function multisetOps(a: string[], b: string[]): Op[] {
  const contagem = new Map<string, number>();
  for (const p of b) contagem.set(p, (contagem.get(p) ?? 0) + 1);
  const ops: Op[] = [];
  const usados = new Map<string, number>();
  for (const p of a) {
    const restante = contagem.get(p) ?? 0;
    if (restante > 0) {
      contagem.set(p, restante - 1);
      usados.set(p, (usados.get(p) ?? 0) + 1);
      ops.push({ kind: 'same', text: p });
    } else {
      ops.push({ kind: 'removed', text: p });
    }
  }
  const sobras = new Map(contagem);
  for (const p of b) {
    const restante = sobras.get(p) ?? 0;
    if (restante > 0) {
      sobras.set(p, restante - 1);
      ops.push({ kind: 'added', text: p });
    }
  }
  return ops;
}

// Diferença do miolo (já sem prefixo/sufixo comuns). Parágrafos que aparecem uma única vez em cada lado e na
// mesma ordem servem de âncora (estilo "patience"); só os trechos entre âncoras passam pela DP, limitada a
// MAX_CELLS por trecho. Sem âncoras e acima do limite, cai para a diferença sem ordem.
function diffMiolo(ma: string[], mb: string[]): { ops: Op[]; truncated: boolean } {
  const ops: Op[] = [];
  let truncated = false;
  let ia = 0;
  let ib = 0;
  const trecho = (fa: number, fb: number) => {
    const sa = ma.slice(ia, fa);
    const sb = mb.slice(ib, fb);
    if (sa.length === 0 && sb.length === 0) return;
    if (sa.length * sb.length <= MAX_CELLS) {
      for (const op of lcsOps(sa, sb)) ops.push(op);
    } else {
      for (const op of multisetOps(sa, sb)) ops.push(op);
      truncated = true;
    }
  };
  for (const [pa, pb] of ancorasUnicas(ma, mb)) {
    trecho(pa, pb);
    ops.push({ kind: 'same', text: ma[pa] });
    ia = pa + 1;
    ib = pb + 1;
  }
  trecho(ma.length, mb.length);
  return { ops, truncated };
}

// Pares [índice em a, índice em b] de parágrafos únicos nos dois lados, na maior sequência crescente (LIS).
function ancorasUnicas(a: string[], b: string[]): Array<[number, number]> {
  const contA = new Map<string, number>();
  for (const p of a) contA.set(p, (contA.get(p) ?? 0) + 1);
  const contB = new Map<string, number>();
  for (const p of b) contB.set(p, (contB.get(p) ?? 0) + 1);
  const posA = new Map<string, number>();
  a.forEach((p, i) => {
    if (contA.get(p) === 1 && contB.get(p) === 1) posA.set(p, i);
  });
  const pares: Array<[number, number]> = [];
  b.forEach((p, j) => {
    const i = posA.get(p);
    if (i !== undefined) pares.push([i, j]);
  });
  const caudas: number[] = []; // índice em `pares` do menor final para cada tamanho
  const anterior = new Array<number>(pares.length).fill(-1);
  for (let k = 0; k < pares.length; k++) {
    let lo = 0;
    let hi = caudas.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pares[caudas[mid]][0] < pares[k][0]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) anterior[k] = caudas[lo - 1];
    caudas[lo] = k;
  }
  const lis: Array<[number, number]> = [];
  for (let k = caudas.length ? caudas[caudas.length - 1] : -1; k >= 0; k = anterior[k]) lis.push(pares[k]);
  return lis.reverse();
}

export function diffParagraphs(oldText: string, newText: string): ParagraphDiff {
  const a = splitParagraphs(oldText);
  const b = splitParagraphs(newText);

  let prefixo = 0;
  while (prefixo < a.length && prefixo < b.length && a[prefixo] === b[prefixo]) prefixo++;
  let sufixo = 0;
  while (
    sufixo < a.length - prefixo &&
    sufixo < b.length - prefixo &&
    a[a.length - 1 - sufixo] === b[b.length - 1 - sufixo]
  ) {
    sufixo++;
  }
  const miolo_a = a.slice(prefixo, a.length - sufixo);
  const miolo_b = b.slice(prefixo, b.length - sufixo);

  const centro = diffMiolo(miolo_a, miolo_b);
  let truncated = centro.truncated;
  const meio = centro.ops;

  const ops: Op[] = [
    ...a.slice(0, prefixo).map((text): Op => ({ kind: 'same', text })),
    ...meio,
    ...a.slice(a.length - sufixo).map((text): Op => ({ kind: 'same', text })),
  ];

  const summary = { added: 0, removed: 0, unchanged: 0 };
  for (const op of ops) {
    if (op.kind === 'added') summary.added++;
    else if (op.kind === 'removed') summary.removed++;
    else summary.unchanged++;
  }

  // Marca o que entra na saída: alterações (até MAX_CHANGED) e CONTEXT parágrafos ao redor de cada uma.
  const mostrar = new Array<boolean>(ops.length).fill(false);
  let alteradosMostrados = 0;
  let corte = ops.length; // a partir daqui, nenhuma alteração é exibida (limite)
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].kind === 'same') continue;
    if (alteradosMostrados >= MAX_CHANGED) {
      truncated = true;
      corte = i;
      break;
    }
    alteradosMostrados++;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(ops.length - 1, i + CONTEXT); k++) mostrar[k] = true;
  }

  const hunks: DiffHunk[] = [];
  let omitidos = 0;
  let omitidosPorLimite = false;
  const fecharOmitidos = () => {
    if (omitidos > 0) {
      const um = omitidos === 1;
      const motivo = omitidosPorLimite ? (um ? 'não exibido' : 'não exibidos') : 'sem mudança';
      hunks.push({ kind: 'context', text: `… ${omitidos} ${um ? 'parágrafo' : 'parágrafos'} ${motivo} …` });
      omitidos = 0;
      omitidosPorLimite = false;
    }
  };
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!mostrar[i] || (i >= corte && op.kind !== 'same')) {
      if (i >= corte && !omitidosPorLimite) {
        fecharOmitidos(); // fecha o bloco "sem mudança" antes de abrir o "não exibidos"
        omitidosPorLimite = true;
      }
      omitidos++;
      continue;
    }
    fecharOmitidos();
    hunks.push({ kind: op.kind === 'same' ? 'context' : op.kind, text: op.text });
  }
  fecharOmitidos();

  return { summary, truncated, hunks };
}
