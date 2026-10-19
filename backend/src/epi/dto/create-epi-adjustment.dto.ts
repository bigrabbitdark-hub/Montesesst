import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { NO_NUL } from './epi-dto-rules';

// Ajuste manual de estoque (contagem física etc.). O motivo é obrigatório e fica no histórico.
export class CreateEpiAdjustmentDto {
  @IsIn(['mais', 'menos'])
  direction: 'mais' | 'menos';

  @IsInt()
  @Min(1)
  @Max(100000)
  quantity: number;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  @Matches(NO_NUL)
  reason: string;

  // Só vale para EPI que controla lote (o serviço recusa em EPI sem lote).
  @IsOptional()
  @IsUUID()
  lot_id?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(NO_NUL)
  idempotency_key: string;
}
