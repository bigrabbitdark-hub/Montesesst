export const USER_ROLES = ['empresa', 'tecnico', 'parceiro', 'admin', 'socio'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  tenantId: string | null;
  role: UserRole;
  // Presente só no token de atuação da sócia (claim `act`); o ActingTenantGuard o revalida a cada requisição.
  actingTenantId?: string;
  // Definido SOMENTE pelo ActingTenantGuard depois da revalidação: a requisição roda como `empresa` do tenant X.
  actingAs?: boolean;
  // Claim `mcp`: senha temporária ainda não trocada.
  mustChangePassword?: boolean;
}
