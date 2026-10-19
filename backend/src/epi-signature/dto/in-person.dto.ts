import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { NO_NUL } from '../../epi/dto/epi-dto-rules';

export class InPersonDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique() @IsUUID('all', { each: true }) delivery_ids: string[];
  @IsString() @MinLength(3) @MaxLength(120) @Matches(NO_NUL) @Matches(/\S/) witness_name: string;
  @IsString() @MinLength(5) @MaxLength(300) @Matches(NO_NUL) @Matches(/\S/) reason: string;
}
