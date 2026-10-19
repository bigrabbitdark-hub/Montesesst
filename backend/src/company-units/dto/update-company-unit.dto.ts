import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsValidCnpj } from '../../common/validators/is-valid-cnpj.decorator';
import { onlyDigits } from '../../common/validators/cnpj.util';

export class UpdateCompanyUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  // Para completar filiais antigas. Se enviado, tem que ser um CNPJ válido —
  // string vazia NÃO limpa o campo (falha na validação).
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? onlyDigits(value) : value))
  @IsValidCnpj()
  cnpj?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address_street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  address_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address_city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  address_state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  address_zip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legal_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  address_neighborhood?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address_complement?: string;

  @IsOptional()
  @Matches(/^(\d{7})?$/, { message: 'cnae_code deve ter 7 dígitos' })
  cnae_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  cnae_description?: string;

  @IsOptional()
  @IsIn(['ativo', 'inativo', 'pendente'])
  status?: string;
}
