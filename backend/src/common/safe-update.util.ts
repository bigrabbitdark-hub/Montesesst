// Monta um SET clause seguro a partir de um objeto de atualização — só
// aceita chaves de uma allowlist explícita, nunca interpola nome de coluna
// vindo direto do corpo da requisição. Sem isso, uma chave inesperada no
// body vira injeção de SQL no NOME da coluna (não só no valor) — é
// diferente de um parâmetro de valor, que já é protegido pela
// parametrização normal do node-pg.
export function buildSafeSetClause<T extends object>(
  data: T,
  allowedFields: readonly string[],
  startParamIndex: number,
): { setClauses: string[]; values: unknown[] } {
  const entries = Object.entries(data as Record<string, unknown>).filter(
    ([field, value]) => value !== undefined && allowedFields.includes(field),
  );
  const setClauses = entries.map(([field], idx) => `${field} = $${idx + startParamIndex}`);
  const values = entries.map(([, value]) => value);
  return { setClauses, values };
}
