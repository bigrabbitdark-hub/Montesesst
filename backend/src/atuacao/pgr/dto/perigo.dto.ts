import {
  registerDecorator, type ValidationOptions,
} from 'class-validator';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength,
} from 'class-validator';

export const CATEGORIAS_PERIGO = ['fisico', 'quimico', 'biologico', 'ergonomico', 'acidente', 'psicossocial'] as const;
export const AVALIACOES = ['qualitativa', 'quantitativa'] as const;
export const MAX_IMPORTACAO = 500;

// Chaves aceitas em `psychosocial` (as mesmas que a tela edita); cada valor é texto de até 2000 caracteres.
export const PSICO_CHAVES = ['organizacao_trabalho', 'metas', 'jornada', 'relacoes_interpessoais', 'violencia_assedio'] as const;

export function psicossocialValido(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v as Record<string, unknown>).every(
    ([k, x]) => (PSICO_CHAVES as readonly string[]).includes(k) && typeof x === 'string' && x.length <= 2000,
  );
}

export function IsPsicossocial(options?: ValidationOptions) {
  return (obj: object, propertyName: string) =>
    registerDecorator({
      name: 'isPsicossocial', target: obj.constructor, propertyName,
      options: { message: `psychosocial aceita apenas ${PSICO_CHAVES.join(', ')}, com texto de até 2000 caracteres`, ...options },
      validator: { validate: psicossocialValido },
    });
}

// Campos opcionais e anuláveis do perigo (null limpa a coluna). Mesma lista usada pelo serviço.
export const CAMPOS_OPCIONAIS = [
  'description', 'sources', 'health_effects', 'exposure_routes', 'default_assessment', 'default_unit',
  'tolerance_limit', 'tolerance_reference', 'suggested_controls', 'esocial_code', 'psychosocial',
] as const;

// Campos de conteúdo do perigo (sem tenant/escopo). Sem ids nem valores prontos: a biblioteca nasce vazia.
export class PerigoItemDto {
  @IsIn(CATEGORIAS_PERIGO as unknown as string[], { message: 'categoria inválida' })
  category!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) sources?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) health_effects?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(100, { each: true }) exposure_routes?: string[] | null;
  @IsOptional() @IsIn(AVALIACOES as unknown as string[]) default_assessment?: string | null;
  @IsOptional() @IsString() @MaxLength(100) default_unit?: string | null;
  @IsOptional() @IsString() @MaxLength(500) tolerance_limit?: string | null;
  @IsOptional() @IsString() @MaxLength(500) tolerance_reference?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) suggested_controls?: string | null;
  @IsOptional() @IsString() @MaxLength(20, { message: 'esocial_code deve ter no máximo 20 caracteres' }) esocial_code?: string | null;
  @IsOptional() @IsPsicossocial() psychosocial?: Record<string, unknown> | null;
}

export class CriarPerigoDto extends PerigoItemDto {
  @IsOptional() @IsUUID() tenant_id?: string;
  @IsOptional() @IsIn(['global', 'tenant']) scope?: 'global' | 'tenant';
}

// Todos opcionais; o serviço recusa corpo vazio e null em category/name/exposure_routes.
export class AtualizarPerigoDto {
  @IsOptional() @IsIn(CATEGORIAS_PERIGO as unknown as string[], { message: 'categoria inválida' }) category?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) sources?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) health_effects?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(100, { each: true }) exposure_routes?: string[] | null;
  @IsOptional() @IsIn(AVALIACOES as unknown as string[]) default_assessment?: string | null;
  @IsOptional() @IsString() @MaxLength(100) default_unit?: string | null;
  @IsOptional() @IsString() @MaxLength(500) tolerance_limit?: string | null;
  @IsOptional() @IsString() @MaxLength(500) tolerance_reference?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) suggested_controls?: string | null;
  @IsOptional() @IsString() @MaxLength(20, { message: 'esocial_code deve ter no máximo 20 caracteres' }) esocial_code?: string | null;
  @IsOptional() @IsPsicossocial() psychosocial?: Record<string, unknown> | null;
}

export class AtivoDto {
  @IsBoolean() active!: boolean;
}

export class DuplicarPerigoDto {
  @IsOptional() @IsUUID() tenant_id?: string;
  // Admin duplicando um perigo de empresa sem informar tenant_id precisa pedir a cópia global explicitamente.
  @IsOptional() @IsBoolean() para_global?: boolean;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
}

export class ListarPerigosQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(CATEGORIAS_PERIGO as unknown as string[], { message: 'categoria inválida' }) categoria?: string;
  @IsOptional() @IsIn(['true', 'false']) ativo?: string;
  @IsOptional() @IsUUID() tenantId?: string;
}

export class ObterPerigoQuery {
  @IsOptional() @IsUUID() tenantId?: string;
}

export class ExportarPerigosQuery {
  @IsOptional() @IsUUID() tenantId?: string;
}

// Itens ficam como objetos crus: a validação é linha a linha no serviço (relatório de erros por linha).
export class ImportarPerigosDto {
  @IsOptional() @IsUUID() tenant_id?: string;
  @IsArray() @ArrayMinSize(1, { message: 'Informe ao menos 1 item' })
  @ArrayMaxSize(MAX_IMPORTACAO, { message: `No máximo ${MAX_IMPORTACAO} itens por importação` })
  @IsObject({ each: true })
  itens!: Record<string, unknown>[];
}
