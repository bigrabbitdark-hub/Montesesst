import { IsString, Length } from 'class-validator';

export class CreatePcmsoPhysicianDto {
  @Length(11, 11)
  cpf!: string;

  @IsString()
  name!: string;

  @IsString()
  crm!: string;

  @Length(2, 2)
  crmUf!: string;
}
