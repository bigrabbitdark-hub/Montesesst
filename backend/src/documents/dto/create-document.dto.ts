import { IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class CreateDocumentDto {
  @IsIn(['pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento', 'ltcat', 'lip'])
  category: string;

  @IsString()
  @MaxLength(200)
  title: string;

  // Data de início da vigência (opcional). Validamos com isDateOnly no
  // controller antes de chamar o service — o IsISO8601 aceitava timestamp
  // com hora/fuso, e o contrato é estritamente 'AAAA-MM-DD'.
  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  valid_from?: string | null;

  // Vencimento manual (opcional). Mesma regra: 'AAAA-MM-DD' ou null.
  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  expires_at?: string | null;

  // Só é lido quando quem envia é role 'tecnico' ou 'parceiro' (empresa
  // sempre usa o próprio tenant_id do token).
  @IsOptional()
  @IsUUID()
  tenant_id?: string;

  // Opcional — documento sem isso é considerado "não especificado" (não
  // é obrigatório escolher matriz/filial pra continuar enviando).
  @IsOptional()
  @IsUUID()
  company_unit_id?: string;
}