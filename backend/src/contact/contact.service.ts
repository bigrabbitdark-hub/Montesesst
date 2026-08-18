import { Injectable } from '@nestjs/common';
import { EmailService } from '../common/email/email.service';
import { escapeHtml } from '../common/html-escape.util';

export interface ContactInput {
  name: string;
  email: string;
  message: string;
}

@Injectable()
export class ContactService {
  constructor(private readonly email: EmailService) {}

  async send(input: ContactInput): Promise<void> {
    const to = process.env.CONTACT_EMAIL_TO as string;
    await this.email.send({
      to,
      subject: `Novo contato pelo site — ${input.name}`,
      html: `<p><strong>Nome:</strong> ${escapeHtml(input.name)}</p>
<p><strong>E-mail:</strong> ${escapeHtml(input.email)}</p>
<p><strong>Mensagem:</strong></p>
<p>${escapeHtml(input.message).replace(/\n/g, '<br/>')}</p>`,
    });
  }
}
