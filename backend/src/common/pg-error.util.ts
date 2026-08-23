import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

interface PgError extends Error {
  code?: string;
}

export function mapPgError(err: unknown): never {
  const pgErr = err as PgError;
  if (pgErr.code === '23505') throw new ConflictException('Registro duplicado');
  if (pgErr.code === '23503') throw new BadRequestException('Referência inválida');
  if (pgErr.code === '42501') throw new ForbiddenException('Operação não permitida para este recurso');
  throw err;
}
