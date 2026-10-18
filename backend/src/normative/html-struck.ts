// Texto riscado = redação revogada. As páginas do planalto.gov.br mantêm a redação antiga de cada dispositivo ao lado
// da vigente, marcada com <strike>, <s> ou <span style="text-decoration:line-through">. Mantê-la no texto extraído
// gera artigo duplicado (o parser não sabe qual é o vigente) ou, pior, o artigo com a redação revogada.
// Medição nas páginas reais de 2026-10-09 (CLT del5452.htm, Lei 8.213 l8213cons.htm, Decreto 3.048 d3048.htm):
// <strike> 4036/704/2318 (todos fechados, nunca aninhados, nunca atravessam um elemento de bloco); line-through só
// em <span> (151/79/46, idem); <s> só em "º" solto (às vezes no texto VIGENTE: "§ 1<s>º</s> Para…", "Lei n<s>º</s>
// 11.959") ou como continuação de um trecho riscado. Relatório: .superpowers/sdd/2026-10-09-base-normativa-lip/
// prev-task1-report.md.
//
// Regras (determinísticas; a unidade é o BLOCO, o trecho entre duas tags de bloco):
// 1. Riscado não fechado termina no fim do bloco (nunca engole o resto do documento) e, se o bloco tem quebra de linha
//    (<br>) depois do ponto em que o risco abriu, já na primeira delas (não engole os dispositivos seguintes do bloco).
// 2. `<s>`/`<strike>` cujo texto é só um indicador ordinal (º ° ª o) herda o estado do texto anterior do mesmo bloco
//    (no texto vigente o Planalto às vezes risca o "º": "§ 1<s>º</s> Para…", "Lei n<strike><sup>o</sup></strike> 8.212").
// 3. Bloco "riscado na frente" (o primeiro texto visível é riscado, ou só 1 caractere solto antes dele, como em
//    "A<strike>rt. 28.…"): o que não está riscado ANTES do último trecho riscado é sobra da redação revogada (links
//    fora do <strike>, letra solta) e sai. O que vem DEPOIS:
//    - só notas "(Revogado…)", "(Revogada…)", "(Suprimido…)", "(Vetado…)", "(Fica sem efeito…)", "(Declarado
//      inconstitucional…)": o endereço do dispositivo (ex.: "Art. 70.", "§ 1º", "III -", "f)") é mantido com a nota
//      → "Art. 70. (Revogado pelo Decreto nº 10.410, de 2020)." — sem a redação revogada, sem nota órfã grudada no
//      dispositivo anterior. Sem endereço reconhecível, a nota sai;
//    - só outras notas ("Vigência encerrada", "(Redação dada…)", "(Vide…)", ou revogação por MP com "Vigência
//      encerrada"): referem-se à redação riscada e saem;
//    - texto de verdade: fica (na dúvida não se descarta texto sem risco).
//    3a. Exceção: se uma linha (depois de <br>) que COMEÇA com texto sem risco e endereço de dispositivo vem antes do
//        último trecho riscado, o bloco é partido nas linhas que começam com endereço e cada parte segue 3/4 sozinha
//        (ver renderBlock) — nunca se descarta um dispositivo vigente sem risco.
// 4. Nos demais blocos (vigentes com trecho riscado no meio) só o trecho riscado sai.
// A saída é texto: tags de bloco viram '\n', as demais viram ' ' (mesma regra de extractHtmlText).

const BLOCK_BOUNDARY_RE = /^<\/?(?:p|div|li|tr|td|th|h[1-6]|table|ul|ol|blockquote|section|article|pre)\b/i;
const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'wbr', 'area', 'col', 'embed', 'source', 'track', 'base', 'param']);
const LINE_THROUGH_RE = /text-decoration\s*:[^;"'>]*line-through/i;
// <s> ou <strike> cujo único texto é um indicador ordinal, com tags inline dentro: "<s>º</s>",
// "<s><span style=…>º</span></s>", "n<strike><sup><u>o</u></sup></strike> 8.212" (Lei 8.213 art. 57 § 6º, vigente).
const LONE_ORDINAL_RE = /^<(s|strike)\b[^>]*>(?:\s*<(?:span|sup|u|font|b|i)\b[^>]*>)*\s*([º°ªo])\s*(?:<\/(?:span|sup|u|font|b|i)\s*>\s*)*<\/\1\s*>/i;
const ADDRESS_RE =
  /^(?:Art\s*\.\s*(?:\.\s*)?\d+(?:\s*[º°o])?(?:-[A-Z])?\s*[.:\-–]?|§\s*\d+(?:\s*[º°o])?(?:-[A-Z])?\s*[.:\-–]?|Parágrafo\s+único\s*[.:\-–]?|[IVXLC]+\s*[-–—]|[a-z]\))(?=\s|$)/;
const NOTES_ONLY_RE = /^(?:\([^()]*\)\.?\s*|Vigência encerrada\.?\s*)+$/i;
const REVOCATION_NOTE_RE = /\(\s*(?:Revogad[oa]|Suprimid[oa]|Vetad[oa]|Fica sem efeito|Declarad[oa] inconstitucional)/i;

interface Piece {
  text: string;
  struck: boolean;
  sep: boolean;
}

const visible = (p: Piece) => !p.sep && /\S/.test(p.text.replace(/&nbsp;/g, ' '));
const collapse = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const join = (pieces: Piece[]) => pieces.map((p) => p.text).join('');
// Texto do bloco inteiro (riscado ou não), com as tags como espaço — onde se procura o endereço do dispositivo.
const fullText = (pieces: Piece[]) => collapse(pieces.map((p) => (p.sep ? ' ' : p.text)).join(''));

const isBr = (p: Piece) => p.sep && p.text === '\n';
// Texto de um trecho começa com endereço de dispositivo ("Art. 5º", "§ 1º", "Parágrafo único", "III -", "f)").
const startsWithAddress = (pieces: Piece[]) => ADDRESS_RE.test(fullText(pieces));

// Linhas do bloco (separadas por <br>, que no extrator é a única tag que vira '\n' sem fechar o bloco).
function splitLines(pieces: Piece[]): Piece[][] {
  const lines: Piece[][] = [[]];
  for (const p of pieces) {
    if (isBr(p)) lines.push([]);
    else lines[lines.length - 1].push(p);
  }
  return lines;
}

// Regra 3a (bloco riscado na frente que contém, ANTES do último trecho riscado, uma linha que COMEÇA com texto sem risco
// e endereço de dispositivo — "<strike>Art. 5º antigo</strike><br>Art. 5º vigente<br><strike>§ 1º</strike> (Revogado…)"):
// o <br> separa dispositivos. O bloco é partido em toda linha que começa com endereço (riscado ou não) e cada parte
// segue as regras 3/4 sozinha. Sem isso, a regra 3 descartava o artigo vigente e devolvia "Art. 5º (Revogado…)".
// Nas páginas reais medidas não ocorre (a lista de dispositivos das 3 páginas não mudou); é proteção.
function renderBlock(pieces: Piece[]): string {
  const lines = splitLines(pieces);
  if (lines.length > 1) {
    const firstVisible = (line: Piece[]) => line.find(visible);
    let lastStruck = -1;
    lines.forEach((line, i) => line.some((p) => visible(p) && p.struck) && (lastStruck = i));
    const liveAddressBeforeLastStruck = lines.some(
      (line, i) => i > 0 && i <= lastStruck && firstVisible(line)?.struck === false && startsWithAddress(line),
    );
    if (isFrontStruck(pieces) && liveAddressBeforeLastStruck) {
      const groups: Piece[][] = [];
      lines.forEach((line, i) => {
        if (i === 0 || startsWithAddress(line)) groups.push([...line]);
        else groups[groups.length - 1].push({ text: '\n', struck: false, sep: true }, ...line);
      });
      return groups.map(renderGroup).join('\n');
    }
  }
  return renderGroup(pieces);
}

// Regra 3: o primeiro texto visível é riscado, ou só 1 caractere solto vem antes dele ("A<strike>rt. 28.…").
function isFrontStruck(pieces: Piece[]): boolean {
  const first = pieces.findIndex((p) => visible(p) && p.struck);
  if (first < 0) return false;
  return collapse(pieces.slice(0, first).filter((p) => !p.sep).map((p) => p.text).join('')).length <= 1;
}

function renderGroup(pieces: Piece[]): string {
  const struckIdx: number[] = [];
  pieces.forEach((p, i) => visible(p) && p.struck && struckIdx.push(i));
  if (struckIdx.length === 0) return join(pieces);
  if (!isFrontStruck(pieces)) return join(pieces.filter((p) => p.sep || !p.struck));

  const last = struckIdx[struckIdx.length - 1];
  const tailPieces = pieces.slice(last + 1).filter((p) => p.sep || !p.struck);
  const tail = collapse(join(tailPieces.filter((p) => !p.sep)));
  if (!/[\p{L}\p{N}]/u.test(tail)) return '';
  const notes = tail.replace(/^[\s.,;:)\-–]+(?=\()/, '');
  if (!NOTES_ONLY_RE.test(notes)) return join(tailPieces);
  if (!REVOCATION_NOTE_RE.test(notes) || /Vigência encerrada/i.test(notes)) return '';
  const address = ADDRESS_RE.exec(fullText(pieces));
  return address ? `${address[0].trim()} ${notes}` : '';
}

export function htmlToTextDroppingStruck(html: string, blockTagRe: RegExp): string {
  const out: string[] = [];
  let pieces: Piece[] = [];
  let strikeDepth = 0;
  // Elementos abertos com line-through; `nest` conta aberturas do mesmo nome dentro dele.
  let lineThrough: { name: string; nest: number }[] = [];
  let lastVisibleStruck = false;
  // Índice (em `pieces`) onde o risco atual começou; null quando não há risco aberto.
  let struckSince: number | null = null;
  const isStruck = () => strikeDepth > 0 || lineThrough.length > 0;
  const flush = () => {
    // Regra 1: risco NÃO fechado até o fim do bloco termina na primeira quebra de linha (<br>) depois de aberto; o
    // que vem depois dela no bloco não é riscado. Risco fechado que atravessa <br> continua inteiro.
    if (isStruck() && struckSince !== null) {
      const br = pieces.findIndex((p, i) => i >= struckSince! && isBr(p));
      if (br >= 0) for (let i = br + 1; i < pieces.length; i++) pieces[i].struck = false;
    }
    out.push(renderBlock(pieces));
    pieces = [];
    strikeDepth = 0;
    lineThrough = [];
    lastVisibleStruck = false;
    struckSince = null;
  };
  const tokenRe = /<[^>]+>|[^<]+|</g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html)) !== null) {
    const tok = m[0];
    if (tok.length > 1 && tok[0] === '<') {
      const sep = blockTagRe.test(tok) ? '\n' : ' ';
      if (BLOCK_BOUNDARY_RE.test(tok)) {
        flush();
        out.push(sep);
        continue;
      }
      const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(tok);
      const wasStruck = isStruck();
      if (tag) {
        const closing = tag[1] === '/';
        const name = tag[2].toLowerCase();
        if (name === 'strike' || name === 's') {
          const ordinal = !closing && strikeDepth === 0 && lineThrough.length === 0 && !lastVisibleStruck
            ? LONE_ORDINAL_RE.exec(html.slice(m.index, m.index + 300))
            : null;
          if (ordinal) {
            // Como se não houvesse risco: as tags viram espaço (mesma regra do resto do texto, ex.: "§ 1 o" de <sup>).
            pieces.push({ text: ' ', struck: false, sep: true }, { text: ordinal[2], struck: false, sep: false }, { text: ' ', struck: false, sep: true });
            tokenRe.lastIndex = m.index + ordinal[0].length;
            continue;
          }
          strikeDepth = closing ? Math.max(0, strikeDepth - 1) : strikeDepth + 1;
        } else if (closing) {
          for (let i = lineThrough.length - 1; i >= 0; i--) {
            if (lineThrough[i].name !== name) continue;
            if (lineThrough[i].nest > 0) lineThrough[i].nest--;
            else lineThrough = lineThrough.slice(0, i);
            break;
          }
        } else if (!VOID_TAGS.has(name) && !tok.endsWith('/>')) {
          for (const open of lineThrough) if (open.name === name) open.nest++;
          if (LINE_THROUGH_RE.test(tok)) lineThrough.push({ name, nest: 0 });
        }
      }
      if (!wasStruck && isStruck()) struckSince = pieces.length;
      else if (!isStruck()) struckSince = null;
      pieces.push({ text: sep, struck: false, sep: true });
      continue;
    }
    const piece = { text: tok, struck: strikeDepth > 0 || lineThrough.length > 0, sep: false };
    if (visible(piece)) lastVisibleStruck = piece.struck;
    pieces.push(piece);
  }
  flush();
  return out.join('');
}
