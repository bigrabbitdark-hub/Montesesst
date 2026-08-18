import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

// Único ponto de envio de e-mail da aplicação (confirmação de cadastro,
// Task 2/3; formulário de Contato, Task 4). Decisão confirmada com o
// fundador (docs/specs/fase-2-site-institucional.md seção 8): API
// transacional externa (Resend), mesma filosofia já usada pro R2 —
// infra gerenciada em vez de SMTP frágil rodando na própria VPS.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);

  async send(input: SendEmailInput): Promise<void> {
    try {
      await this.resend.emails.send({
        from: process.env.EMAIL_FROM as string,
        to: input.to,
        subject: input.subject,
        html: input.html,
      });
    } catch (err) {
      // Nunca deixa passar em silêncio — quem chama decide se um e-mail que
      // falhou deve derrubar a requisição (cadastro, Task 2) ou só logar
      // (não há um terceiro caso nesta fase).
      this.logger.error(`Falha ao enviar e-mail para ${input.to}`, (err as Error).stack);
      throw err;
    }
  }
}
