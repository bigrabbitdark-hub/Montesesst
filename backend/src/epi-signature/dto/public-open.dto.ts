import { IsString, Matches } from 'class-validator';
import { PublicTokenDto } from './public-token.dto';

export class PublicOpenDto extends PublicTokenDto {
  @IsString() @Matches(/^\d{6}$/) code: string;
}
