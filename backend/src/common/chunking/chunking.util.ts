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

// Estratégia de chunking para conteúdo JÁ estruturado em linhas
// independentes — hoje, as frases de planilha de extractXlsxRows
// ("Aba: Ruído | Função: Soldador | Medição: 92 dB(A)"). Agrupa linhas
// inteiras até CHUNK_CHAR_SIZE e NUNCA parte uma linha ao meio: cada
// linha já é uma unidade de sentido completa (nome da aba + rótulos de
// coluna + valores), e cortá-la no meio de uma janela de caracteres
// destruiria exatamente a formatação que a torna pesquisável (spec
// §2). Por isso também não há sobreposição entre chunks como em
// splitIntoChunks — sobreposição existe pra não perder o contexto de
// uma frase cortada, e aqui nenhuma frase é cortada.
//
// Consequência aceita: uma única linha maior que CHUNK_CHAR_SIZE vira
// sozinha um chunk acima do limite — manter a linha íntegra vale mais
// que respeitar o teto de caracteres, que é uma heurística de custo,
// não um limite rígido do provedor.
export function groupLinesIntoChunks(lines: string[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    // +1 pelo '\n' que vai unir esta linha à anterior dentro do chunk.
    const separator = current.length === 0 ? 0 : 1;
    if (current.length > 0 && currentLength + separator + line.length > CHUNK_CHAR_SIZE) {
      chunks.push(current.join('\n'));
      current = [];
      currentLength = 0;
    }

    currentLength += (current.length === 0 ? 0 : 1) + line.length;
    current.push(line);
  }

  if (current.length > 0) chunks.push(current.join('\n'));
  return chunks;
}
