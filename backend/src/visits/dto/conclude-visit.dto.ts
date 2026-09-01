import { IsOptional, IsUUID } from 'class-validator';

export class ConcludeVisitDto {
  @IsOptional()
  @IsUUID()
  inspection_id?: string;
}
