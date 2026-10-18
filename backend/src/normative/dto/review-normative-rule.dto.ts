import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReviewNormativeRuleDto {
  // Identificação do profissional habilitado (ex.: "CREA-SP 000000" / "MTE 0000"). Texto livre revisado por humano.
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  registro: string;
}
