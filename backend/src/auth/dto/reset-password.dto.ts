import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  token: string;

  // Mesmas regras do cadastro (register.dto.ts): 72 bytes é o teto do bcrypt —
  // acima disso a senha guardada seria silenciosamente mais curta que a digitada.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
