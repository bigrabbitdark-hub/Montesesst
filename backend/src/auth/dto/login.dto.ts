import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'e-mail inválido' })
  @MaxLength(254, { message: 'e-mail muito longo' })
  email: string;

  @IsString({ message: 'senha precisa ser string' })
  @MinLength(1, { message: 'senha é obrigatória' })
  @MaxLength(128, { message: 'senha muito longa' })
  password: string;
}
