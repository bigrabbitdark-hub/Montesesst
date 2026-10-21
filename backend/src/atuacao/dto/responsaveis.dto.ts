import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class SetResponsaveisDto {
  @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all', { each: true })
  user_ids!: string[];
}
