// O driver `pg` não tem tipo nativo pra `vector` — todo INSERT/SELECT
// que toca a coluna `embedding` passa o array serializado como este
// literal de texto e faz cast explícito `$N::vector` na query SQL.
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
