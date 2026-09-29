import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateReferenceDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  category: string;

  // Única rastreabilidade de proveniência deste tipo de documento (não tem
  // official_url nem fonte oficial pra apontar) — por isso obrigatório.
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  origin_note: string;
}
