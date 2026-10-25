import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PERMISSIONS } from '../../../common/permissions';

// Substitui o conjunto de permissões do sócio. Vazio remove todas.
export class SetPermissoesDto {
  @IsArray() @ArrayMaxSize(PERMISSIONS.length) @ArrayUnique() @IsIn(PERMISSIONS as unknown as string[], { each: true })
  permissoes!: string[];

  @IsOptional() @IsBoolean()
  confirmar_sensiveis?: boolean;
}
