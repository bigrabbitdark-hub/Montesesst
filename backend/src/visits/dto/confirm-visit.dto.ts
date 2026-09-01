import { IsISO8601 } from 'class-validator';

export class ConfirmVisitDto {
  @IsISO8601()
  confirmed_date: string;
}
