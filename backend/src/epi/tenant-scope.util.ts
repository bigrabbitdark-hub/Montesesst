import { BadRequestException } from '@nestjs/common';

// Define em qual empresa uma rota agregada opera. Técnico/parceiro/admin enxergam várias empresas pela RLS:
// sem tenant_id explícito os números somariam empresas diferentes, então o parâmetro é obrigatório para eles.
// A empresa só pode operar sobre si mesma; o tenant_id enviado nunca amplia o escopo (a RLS segue valendo).
export function resolveTenantScope(user: { role: string; tenantId: string | null }, requested?: string): string {
  if (user.role === 'empresa') {
    if (!user.tenantId) throw new BadRequestException('Empresa não identificada');
    if (requested && requested !== user.tenantId) throw new BadRequestException('tenant_id inválido');
    return user.tenantId;
  }
  if (user.role === 'tecnico' || user.role === 'parceiro' || user.role === 'admin') {
    if (!requested) throw new BadRequestException('tenant_id é obrigatório');
    return requested;
  }
  throw new BadRequestException('Perfil sem acesso');
}
