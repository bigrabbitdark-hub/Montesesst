import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// 900 + "Retirada: " cabe nos 1000 caracteres do motivo de rejeição.
export class RetireDocumentDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o motivo da retirada' })
  @MaxLength(900, { message: 'O motivo pode ter no máximo 900 caracteres' })
  reason: string;
}
