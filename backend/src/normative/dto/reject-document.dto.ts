import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
