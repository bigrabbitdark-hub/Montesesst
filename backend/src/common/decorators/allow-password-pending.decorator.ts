import { SetMetadata } from '@nestjs/common';

// Rotas liberadas mesmo enquanto a senha é temporária (trocar a senha e "quem sou eu").
export const ALLOW_PASSWORD_PENDING_KEY = 'allow_password_pending';
export const AllowWhilePasswordPending = () => SetMetadata(ALLOW_PASSWORD_PENDING_KEY, true);
