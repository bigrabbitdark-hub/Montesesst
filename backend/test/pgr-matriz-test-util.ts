import type { Client } from 'pg';

// Versões da matriz de TESTE são marcadas com notes 'TESTE-<sufixo>...'. Publicadas/arquivadas são imutáveis, então só o
// superuser de teste, com triggers desligados na sessão, as remove — e SOMENTE as marcadas e criadas pela própria suíte.
export const MARCA_TESTE = 'TESTE-';

// Aborta se uma execução anterior interrompida deixou versões de teste publicadas/arquivadas (elas virariam a "vigente").
export async function exigirSemResiduosDeTeste(client: Client): Promise<void> {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM pgr_matrix_versions WHERE status IN ('publicada','arquivada') AND notes LIKE $1`,
    [`${MARCA_TESTE}%`],
  );
  if (r.rows[0].n > 0) {
    throw new Error(`${r.rows[0].n} versão(ões) de matriz de TESTE sobraram de uma execução anterior; remova-as manualmente (notes LIKE 'TESTE-%') antes de rodar.`);
  }
}

// Chamar SÓ depois de a limpeza de tenants/avaliações ter dado certo. A role é sempre restaurada.
export async function removerVersoesDeTeste(client: Client, ids: string[]): Promise<void> {
  try {
    await client.query("SET session_replication_role = 'replica'");
    await client.query('DELETE FROM pgr_matrix_versions WHERE id = ANY($1::uuid[]) AND notes LIKE $2', [ids, `${MARCA_TESTE}%`]);
  } finally {
    await client.query("SET session_replication_role = 'origin'");
  }
}
