import { IsOptional, IsString, MaxLength } from 'class-validator';

// Lista FECHADA de campos que o sócio pode editar. O ValidationPipe global
// (whitelist + forbidNonWhitelisted) devolve 400 para qualquer outra propriedade
// (cnpj, name, plan, status...).
export class UpdateClienteOperacionalDto {
  @IsOptional() @IsString() @MaxLength(200) trade_name?: string;
  @IsOptional() @IsString() @MaxLength(200) sector?: string;
  @IsOptional() @IsString() @MaxLength(200) contact_name?: string;
  @IsOptional() @IsString() @MaxLength(100) contact_role?: string;
  @IsOptional() @IsString() @MaxLength(30) contact_phone?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
