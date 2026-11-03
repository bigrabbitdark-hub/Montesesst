import { SetMetadata } from '@nestjs/common';
import { Permission } from '../permissions';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';
// A rota exige TODAS as permissões listadas (papel `socio`).
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
