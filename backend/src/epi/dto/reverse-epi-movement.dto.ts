import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { NO_NUL } from './epi-dto-rules';

// Estorno de uma movimentação: cria uma movimentação inversa, sem apagar a original.
export class ReverseEpiMovementDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  @Matches(NO_NUL)
  reason: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(NO_NUL)
  idempotency_key: string;
}
