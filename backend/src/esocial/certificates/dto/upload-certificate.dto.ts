import { IsString, MinLength } from 'class-validator';

export class UploadCertificateDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
