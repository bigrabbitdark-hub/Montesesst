import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { IsValidCnpj } from '../../common/validators/is-valid-cnpj.decorator';
import { onlyDigits } from '../../common/validators/cnpj.util';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  company_name: string;

  // Aceita CNPJ com ou sem máscara — normaliza pra só dígitos antes de
  // validar o dígito verificador e antes de gravar (coluna VARCHAR(14)).
  @Transform(({ value }) => (typeof value === 'string' ? onlyDigits(value) : value))
  @IsValidCnpj()
  cnpj: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  full_name: string;

  @IsEmail()
  email: string;

  // bcrypt trunca senha acima de 72 bytes — 72 como teto evita truncamento
  // silencioso que faria a senha "guardada" ser mais curta que a digitada.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
