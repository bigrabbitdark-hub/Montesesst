import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class RejectBatchDto {
  @IsArray({ message: 'Informe os documentos a rejeitar' })
  @ArrayMinSize(1, { message: 'Selecione ao menos um documento' })
  @ArrayMaxSize(50, { message: 'Selecione no máximo 50 documentos por vez' })
  @ArrayUnique({ message: 'Há documentos repetidos na seleção' })
  @IsUUID('all', { each: true, message: 'Identificador de documento inválido' })
  ids: string[];

  @IsString()
  @IsNotEmpty({ message: 'Informe o motivo da rejeição' })
  @MaxLength(1000)
  reason: string;
}
