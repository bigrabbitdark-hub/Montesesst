import { IsISO8601, IsOptional, Matches } from 'class-validator';

export class ConfirmVisitDto {
  @IsISO8601()
  confirmed_date: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'confirmed_time deve estar no formato HH:MM' })
  confirmed_time?: string;
}
