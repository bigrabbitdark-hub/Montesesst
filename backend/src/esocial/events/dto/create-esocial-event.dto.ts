import { IsOptional, IsUUID } from 'class-validator';

// Informe EXATAMENTE um: asoRecordId (gera S-2220) ou accidentId (gera S-2210).
export class CreateEsocialEventDto {
  @IsOptional()
  @IsUUID()
  asoRecordId?: string;

  @IsOptional()
  @IsUUID()
  accidentId?: string;

  @IsUUID()
  certificateId!: string;
}
