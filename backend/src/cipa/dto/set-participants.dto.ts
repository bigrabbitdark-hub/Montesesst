import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

class ParticipantDto {
  @IsOptional()
  @IsUUID()
  cipa_member_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nome_livre?: string;

  @IsBoolean()
  presente: boolean;
}

export class SetParticipantsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  participants: ParticipantDto[];
}
