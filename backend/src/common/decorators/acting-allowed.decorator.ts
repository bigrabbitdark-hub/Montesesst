import { SetMetadata } from '@nestjs/common';

// Lista FECHADA de rotas em que a sócia pode atuar como empresa (token com claim `act`). Sem esta marca,
// o ActingTenantGuard nega. Nunca aplicar em pagamentos, vínculos de técnico/parceiro, auth, IA ou dados cadastrais.
export const ACTING_ALLOWED_KEY = 'acting_allowed';
export const ActingAllowed = () => SetMetadata(ACTING_ALLOWED_KEY, true);
