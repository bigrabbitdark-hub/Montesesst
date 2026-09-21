// Ajuda de autoria do dataset golden (eval:nr): quebra o texto vigente de uma
// NR em blocos por item, para quem redige as perguntas copiar uma citação
// literal. Módulo puro: sem I/O.
import { normalizeForQuote } from './quote';

export interface ItemBlock {
  item: string;
  // Texto do bloco normalizado com a MESMA função que o lint usa; uma
  // citação copiada daqui bate por construção.
  text: string;
}

const ITEM_HEADING = /^(\d+(?:\.\d+)+)\s/;

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

export function blocksWithPrefix(blocks: ItemBlock[], prefix: string): ItemBlock[] {
  return blocks.filter((block) => block.item === prefix || block.item.startsWith(`${prefix}.`));
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Busca por termo, sem acentos e sem diferenciar maiúsculas — serve tanto para
// achar o item que sustenta uma pergunta quanto para CONFIRMAR que a base não
// cobre um assunto (perguntas sem_evidencia).
export function blocksContaining(blocks: ItemBlock[], term: string): ItemBlock[] {
  const wanted = fold(term);
  return blocks.filter((block) => fold(block.text).includes(wanted));
}
