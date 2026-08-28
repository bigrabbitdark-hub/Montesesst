// Aproximação de ~4 caracteres por token (heurística comum, não é
// tokenização real) — suficiente pra controlar o tamanho de cada pedaço
// indexado, não pra cobrança/billing (isso é medido no lado do provedor
// de embedding). 2000 caracteres ~= 500 tokens, 200 caracteres ~= 50
// tokens de sobreposição (ver docs/specs/fase-9-rag-normativo.md §4.3).
const CHUNK_CHAR_SIZE = 2000;
const CHUNK_CHAR_OVERLAP = 200;

export function splitIntoChunks(text: string): string[] {
  const normalized = text.trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= CHUNK_CHAR_SIZE) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_CHAR_SIZE, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end === normalized.length) break;
    start = end - CHUNK_CHAR_OVERLAP;
  }
  return chunks;
}
