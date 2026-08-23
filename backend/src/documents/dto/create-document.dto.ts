import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateDocumentDto {
  @IsIn(['pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento'])
  category: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsISO8601()
  expires_at?: string;

  // Só é lido quando quem envia é role 'tecnico' (empresa sempre usa o
  // próprio tenant_id do token).
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
