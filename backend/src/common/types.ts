export const USER_ROLES = ['empresa', 'tecnico', 'parceiro', 'admin', 'socio'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  tenantId: string | null;
  role: UserRole;
}
