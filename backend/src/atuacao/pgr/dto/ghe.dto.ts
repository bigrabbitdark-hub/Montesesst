import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export const MAX_CARGOS_GHE = 200;

// Descrição do GHE: texto livre da inspeção (ambiente, processo, atividades). Nunca vai para a auditoria.
export class CriarGheDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsOptional() @IsUUID() company_unit_id?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) environment_description?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) process_description?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) activities?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) machines_products?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}

// Todos opcionais; o serviço recusa corpo vazio e `name` nulo. company_unit_id null remove a unidade.
export class AtualizarGheDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsUUID() company_unit_id?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) environment_description?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) process_description?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) activities?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) machines_products?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}

export class DefinirCargosDto {
  @IsArray() @ArrayMaxSize(MAX_CARGOS_GHE) @IsUUID('all', { each: true })
  position_ids!: string[];
}
