import { IsNotEmpty, IsString } from 'class-validator';

export class AiDraftDto {
  @IsString()
  @IsNotEmpty()
  report_text: string;
}
