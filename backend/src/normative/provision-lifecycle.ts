import { PoolClient } from 'pg';

// Chamado quando um documento deixa de ser vigente (substituído por nova versão ou retirado).
// Ordem importa: a subquery das regras depende de os dispositivos ainda estarem 'ativo'.
// Regras 'rascunho' não mudam; 'revisada' volta a 'revisar' (precisa de nova revisão humana).
export async function markDocumentProvisionsObsolete(client: PoolClient, documentId: string): Promise<void> {
  await client.query(
    `UPDATE normative_rules SET status = 'revisar', updated_at = now()
     WHERE status = 'revisada' AND id IN (
       SELECT rp.rule_id FROM normative_rule_provisions rp
       JOIN normative_provisions p ON p.id = rp.provision_id
       WHERE p.document_id = $1 AND p.status = 'ativo'
     )`,
    [documentId],
  );
  await client.query(
    `UPDATE normative_provisions SET status = 'obsoleto' WHERE document_id = $1 AND status = 'ativo'`,
    [documentId],
  );
}
