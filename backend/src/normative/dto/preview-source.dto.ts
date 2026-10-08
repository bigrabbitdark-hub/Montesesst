import { IsUrl } from 'class-validator';

export class PreviewSourceDto {
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'Informe uma URL válida começando com http:// ou https://' },
  )
  official_url: string;
}
