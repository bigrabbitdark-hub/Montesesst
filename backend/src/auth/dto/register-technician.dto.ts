import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterTechnicianDto {
  @IsEmail()
  email: string;

  // bcrypt trunca senha acima de 72 bytes — mesmo teto já usado no
  // RegisterDto de empresa (auth/dto/register.dto.ts).
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  full_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  registration_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  specialization?: string;
}
