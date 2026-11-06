import { IsString, MaxLength, MinLength } from 'class-validator';
import { MaxBytes, MSG_SENHA_72_BYTES } from '../../common/validators/max-bytes.decorator';

export class ChangePasswordDto {
  // Também limitada em bytes: senha atual > 72 bytes seria comparada truncada pelo bcrypt.
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  @MaxBytes(72, { message: MSG_SENHA_72_BYTES })
  current_password: string;

  // Mesmas regras do cadastro: 72 BYTES é o teto do bcrypt (acentos ocupam 2+ bytes).
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @MaxBytes(72, { message: MSG_SENHA_72_BYTES })
  new_password: string;
}
