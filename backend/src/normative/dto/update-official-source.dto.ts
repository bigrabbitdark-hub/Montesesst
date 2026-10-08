import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// Todos os campos são opcionais; o que vier é validado como no cadastro.
export class UpdateOfficialSourceDto {
  @IsOptional()
  @IsString({ message: 'Informe a entidade' })
  @Transform(trim)
  @IsNotEmpty({ message: 'Informe a entidade' })
  entity?: string;

  // Vazio limpa o código (o service grava NULL).
  @IsOptional()
  @IsString({ message: 'O código deve ser um texto' })
  @Transform(trim)
  code?: string;

  @IsOptional()
  @IsString({ message: 'Informe o título' })
  @Transform(trim)
  @IsNotEmpty({ message: 'Informe o título' })
  title?: string;

  @IsOptional()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'Informe uma URL válida começando com http:// ou https://' },
  )
  official_url?: string;

  @IsOptional()
  @IsBoolean({ message: 'O campo ativa deve ser verdadeiro ou falso' })
  active?: boolean;
}
