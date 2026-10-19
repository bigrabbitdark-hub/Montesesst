import { IsString, Matches } from 'class-validator';

// Token do link: 32 bytes em base64url, sem padding (43 caracteres). Entrada fora disso é 400 antes de tocar o banco.
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export class PublicTokenDto {
  @IsString() @Matches(TOKEN_RE) token: string;
}
