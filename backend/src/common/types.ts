export type UserRole = 'empresa' | 'tecnico' | 'parceiro' | 'admin';

export interface AuthenticatedUser {
  id: string;
  tenantId: string | null;
  role: UserRole;
}
