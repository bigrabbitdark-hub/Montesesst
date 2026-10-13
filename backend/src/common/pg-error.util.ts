import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

export function mapPgError(err: unknown): never {
  const pgErr = err as PgError;
  if (pgErr.code === '23505') throw new ConflictException('Registro duplicado');
  if (pgErr.code === '23503') throw new BadRequestException('Referência inválida');
  // check_violation (23514) genérico: re-lança o erro original pra ser
  // tratado pelos filtros/pipes do Nest (mesmo caminho de antes da nossa
  // intervenção em documents_validity_order_check). Nunca devolve
  // pgErr.message crua ao cliente — ela expõe nome de tabela/constraint.
  if (pgErr.code === '23514') {
    if (pgErr.constraint === 'documents_validity_order_check') {
      throw new BadRequestException('A data de vencimento não pode ser anterior à data de início.');
    }
    throw err;
  }
  if (pgErr.code === '42501') throw new ForbiddenException('Operação não permitida para este recurso');
  throw err;
}