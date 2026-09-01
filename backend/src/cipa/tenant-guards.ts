import { BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';

// Mesmo motivo de CommitteesService.create / MembersService.create /
// PendenciasService.create (achados de revisões anteriores desta fase):
// FK-only não garante que o usuário referenciado pertence ao tenant do
// caller — um responsavel_user_id de outro tenant (ou de um
// técnico/parceiro sem vínculo real) passa pelo FK e a linha fica com um
// responsável errado, sem a RLS pegar isso (RLS protege a linha em si,
// não o valor de uma coluna dela). Usado em todo campo
// responsavel_user_id do módulo CIPA — achado da revisão final da Fase
// 12a (Fix 6).
export async function assertUserInTenant(client: PoolClient, userId: string, tenantId: string): Promise<void> {
  const result = await client.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
  if (result.rowCount === 0) {
    throw new BadRequestException('Usuário responsável inválido para esta empresa');
  }
}
