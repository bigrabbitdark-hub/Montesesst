export const USER_ROLES = ['empresa', 'tecnico', 'parceiro', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  tenantId: string | null;
  role: UserRole;
}
