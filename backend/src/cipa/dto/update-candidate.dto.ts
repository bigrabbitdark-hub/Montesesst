import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCandidateDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  votos?: number;

  @IsOptional()
  @IsBoolean()
  eleito?: boolean;

  @IsOptional()
  @IsIn(['titular', 'suplente'])
  titular_suplente?: string;
}
