import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdatePlanDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  price_cents?: number;
}
