import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { NO_NUL } from '../../epi/dto/epi-dto-rules';

// O tenant nunca vem do corpo: é lido da linha do funcionário sob RLS.
export class CreateSignatureRequestDto {
  @IsUUID() employee_id: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID('all', { each: true }) delivery_ids?: string[];
  @IsString() @MinLength(8) @MaxLength(100) @Matches(NO_NUL) @Matches(/\S/) idempotency_key: string;
}
