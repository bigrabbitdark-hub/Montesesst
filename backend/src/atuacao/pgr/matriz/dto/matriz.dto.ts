import { Transform } from 'class-transformer';
import { IsBoolean, IsISO8601, IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export const KINDS_AVALIACAO = ['inerente', 'residual_previsto'] as const;
export const MAX_CONFIG_BYTES = 200000;

const em = (l: readonly string[]) => l as unknown as string[];
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// Cria um rascunho: vazio (config {}), cópia de outra versão (`copiar_de`) ou com config informada. Nunca os dois.
export class CriarMatrizDto {
  @IsOptional() @IsUUID() copiar_de?: string;
  @IsOptional() @IsObject({ message: 'config deve ser um objeto JSON' }) config?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

// Só rascunho. Todos opcionais; o serviço exige ao menos um e recusa config nulo.
export class AtualizarMatrizDto {
  @IsOptional() @IsObject({ message: 'config deve ser um objeto JSON' }) config?: Record<string, unknown> | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}

// Publicar: `updated_at` (opcional) é o updated_at do rascunho que o cliente leu; se o rascunho mudou desde então ⇒ 409.
export class PublicarMatrizDto {
  @IsOptional() @IsISO8601({ strict: true }, { message: 'updated_at deve ser uma data ISO 8601' }) updated_at?: string;
}

// Validação sem persistência: devolve erros/pendências de um config enviado.
export class ValidarMatrizDto {
  @IsDefined({ message: 'config é obrigatório' }) @IsObject({ message: 'config deve ser um objeto JSON' }) config!: Record<string, unknown>;
  @IsOptional() @IsBoolean() publicar?: boolean;
}

// O cliente NUNCA envia score nem nível: o servidor calcula com a matriz (campos extras ⇒ 400 pelo ValidationPipe).
export class CriarAvaliacaoDto {
  @IsIn(em(KINDS_AVALIACAO), { message: 'kind deve ser inerente ou residual_previsto' }) kind!: string;
  @IsOptional() @IsUUID() matrix_version_id?: string;
  @IsInt({ message: 'severity_value deve ser inteiro' }) @Min(1) @Max(1000) severity_value!: number;
  @IsInt({ message: 'probability_value deve ser inteiro' }) @Min(1) @Max(1000) probability_value!: number;
  @Transform(trim)
  @IsString() @MinLength(1, { message: 'A justificativa é obrigatória' }) @MaxLength(4000) justification!: string;
}

export class MapaCalorQueryDto {
  @IsIn(em(KINDS_AVALIACAO), { message: 'kind deve ser inerente ou residual_previsto' }) kind!: string;
  @IsOptional() @IsUUID() matrix_version_id?: string;
}
