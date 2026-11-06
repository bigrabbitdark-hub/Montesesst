import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { IsValidCnpj } from '../../common/validators/is-valid-cnpj.decorator';
import { normalizeCnpj } from '../../common/validators/cnpj.util';
import { MaxBytes, MSG_SENHA_72_BYTES } from '../../common/validators/max-bytes.decorator';

// Cadastro de empresa pela sócia. A senha é TEMPORÁRIA: o RH troca no primeiro acesso.
export class CriarEmpresaDto {
  @IsString() @MinLength(2) @MaxLength(200) company_name: string;

  @Transform(({ value }) => (typeof value === 'string' ? normalizeCnpj(value) : value))
  @IsValidCnpj()
  cnpj: string;

  @IsString() @MinLength(2) @MaxLength(200) full_name: string;

  @IsEmail() email: string;

  // bcrypt trunca acima de 72 BYTES (não caracteres): @MaxBytes mede em UTF-8.
  @IsString() @MinLength(8) @MaxLength(72) @MaxBytes(72, { message: MSG_SENHA_72_BYTES }) password: string;
}
