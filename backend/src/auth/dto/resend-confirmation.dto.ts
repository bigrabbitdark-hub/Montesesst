import { IsEmail, MaxLength } from 'class-validator';

export class ResendConfirmationDto {
  @IsEmail()
  @MaxLength(254)
  email: string;
}
