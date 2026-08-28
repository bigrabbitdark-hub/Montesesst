import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AiDraftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  report_text: string;
}
