import type { PoolClient } from 'pg';

// Itens OBRIGATÓRIOS que bloqueiam o envio à revisão e ainda não têm resposta, em todos os checklists do rascunho.
export async function itensBloqueantesPendentes(client: PoolClient, draftId: string): Promise<number> {
  const r = await client.query<{ n: number }>(
    `/* checklists:bloqueantes */
     SELECT count(*)::int AS n
       FROM document_checklists dc
       JOIN checklist_template_items i ON i.version_id = dc.template_version_id AND i.required AND i.blocks_review
       LEFT JOIN document_checklist_answers a ON a.checklist_id = dc.id AND a.item_id = i.id
      WHERE dc.draft_id = $1 AND a.id IS NULL`,
    [draftId],
  );
  return r.rows[0]?.n ?? 0;
}
