import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const FAIXAS_VENCIMENTO = ['vencidos', '7', '15', '30'] as const;
export type FaixaVencimento = (typeof FAIXAS_VENCIMENTO)[number];

// GET /atuacao/vencimentos. Propriedades desconhecidas são rejeitadas pelo ValidationPipe global.
export class ListVencimentosQuery {
  @IsOptional() @IsIn(FAIXAS_VENCIMENTO as unknown as string[]) faixa?: FaixaVencimento;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
}
