import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { NO_NUL } from '../../epi/dto/epi-dto-rules';
import { PublicOpenDto } from './public-open.dto';

export class PublicRefuseDto extends PublicOpenDto {
  @IsOptional() @IsString() @MaxLength(300) @Matches(NO_NUL) reason?: string;
}
