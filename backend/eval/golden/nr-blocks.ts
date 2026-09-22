// Ajuda de autoria do dataset golden (eval:nr): quebra o texto vigente de uma
// NR em blocos por item, para quem redige as perguntas copiar uma citação
// literal. Módulo puro: sem I/O.
import { normalizeForQuote } from './quote';

export interface ItemBlock {
  // Número do item como o lint o escreve: "35.4.1", ou "35.4.1." quando o
  // cabeçalho traz ponto final (item de texto "15.1. São…" é o item literal
  // "15.1.").
  item: string;
  // Texto do bloco normalizado com a MESMA função que o lint usa
  // (normalizeForQuote). Uma citação copiada daqui passa em checkEvidence só
  // quando o bloco NÃO cruza marcador de página ("-- 2 of 12 --", cabeçalho do
  // DOU) e tem pelo menos 30 caracteres depois do número do item. Bloco que
  // cruza página, ou que é curto (linha do sumário), o lint reprova: quem redige
  // deve cortar a citação antes da quebra de página.
  text: string;
}

// Cabeçalho de item: número com pontos ("35.4.1", "35.4.1.") ou de 1 nível SÓ
// com ponto ("1."), seguido de espaço, com indentação à esquerda permitida.
// Número de 1 nível sem ponto ("35 Título") NÃO é item.
const ITEM_HEADING = /^\s*(\d+(?:\.\d+)+\.?|\d+\.)\s/;

// Um bloco começa numa linha que abre com número de item ("35.4.1 Todo…") e
// vai até a próxima linha assim. Alíneas ("a) …") e continuações de frase
// ficam no bloco anterior. As linhas do sumário viram blocos de uma linha só
// (curtos) — quem consulta vê o tamanho e distingue.
export function splitIntoItemBlocks(rawText: string): ItemBlock[] {
  const blocks: { item: string; lines: string[] }[] = [];
  for (const line of rawText.split('\n')) {
    const heading = ITEM_HEADING.exec(line);
    if (heading) {
      blocks.push({ item: heading[1], lines: [line] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].lines.push(line);
    }
  }
  return blocks.map((block) => ({ item: block.item, text: normalizeForQuote(block.lines.join('\n')) }));
}

// "35.4.1." e "35.4.1" são o mesmo item para efeito de prefixo.
function withoutTrailingDot(item: string): string {
  return item.replace(/\.$/, '');
}

// O item e seus descendentes: "35.4" casa "35.4", "35.4.1" e "35.4.1.", mas
// não "35.40". Prefixo vazio não casa nada.
export function blocksWithPrefix(blocks: ItemBlock[], prefix: string): ItemBlock[] {
  const wanted = withoutTrailingDot(prefix.trim());
  if (wanted === '') return [];
  return blocks.filter((block) => {
    const item = withoutTrailingDot(block.item);
    return item === wanted || item.startsWith(`${wanted}.`);
  });
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function withoutHyphens(text: string): string {
  return text.replace(/-/g, '');
}

// Busca por termo, sem acentos e sem diferenciar maiúsculas — serve tanto para
// achar o item que sustenta uma pergunta quanto para CONFIRMAR que a base não
// cobre um assunto (perguntas sem_evidencia). Por isso o erro a evitar é o
// falso "não achei": normalizeForQuote MANTÉM o hífen de fim de linha
// ("trabalha-\ndor" vira "trabalha-dor", fiel ao PDF), então a busca também
// tenta sem hífens; o custo é, no máximo, um achado a mais, que quem redige
// confere. Termo vazio (ou só espaços) não acha nada.
export function blocksContaining(blocks: ItemBlock[], term: string): ItemBlock[] {
  const wanted = fold(normalizeForQuote(term));
  if (wanted === '') return [];
  const wantedPlain = withoutHyphens(wanted);
  return blocks.filter((block) => {
    const text = fold(block.text);
    return text.includes(wanted) || (wantedPlain !== '' && withoutHyphens(text).includes(wantedPlain));
  });
}
