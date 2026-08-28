import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class NormativeQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question: string;
}
