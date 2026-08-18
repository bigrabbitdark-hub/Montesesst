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
  // O construtor do SDK do Resend lança síncrono se a API key estiver vazia
  // — inaceitável aqui porque EmailModule é @Global() e é instanciado no
  // boot da aplicação inteira, mesmo em ambientes (dev, teste, produção
  // antes da credencial existir) onde RESEND_API_KEY ainda não foi
  // configurada (pendência conhecida, ver docs/specs/fase-2-site-institucional.md
  // seção 9). Um placeholder deixa o app subir normalmente; a falha real
  // acontece em .send() quando a chamada à API do Resend for rejeitada, e
  // já é tratada (log + rethrow) logo abaixo.
  private readonly resend = new Resend(process.env.RESEND_API_KEY || 'missing-api-key');

  async send(input: SendEmailInput): Promise<void> {
    try {
      // O SDK do Resend NÃO lança em erro de API (chave inválida, domínio
      // não verificado, etc.) — devolve { data: null, error: {...} } com a
      // promise resolvida normalmente. Sem checar `error` aqui, uma falha
      // de envio passaria despercebida e o chamador (cadastro, contato)
      // seguiria como se o e-mail tivesse saído.
      const result = await this.resend.emails.send({
        from: process.env.EMAIL_FROM as string,
        to: input.to,
        subject: input.subject,
        html: input.html,
      });
      if (result.error) {
        throw new Error(`Resend: ${result.error.name} — ${result.error.message}`);
      }
    } catch (err) {
      // Nunca deixa passar em silêncio — quem chama decide se um e-mail que
      // falhou deve derrubar a requisição (cadastro, Task 2) ou só logar
      // (não há um terceiro caso nesta fase).
      this.logger.error(`Falha ao enviar e-mail para ${input.to}`, (err as Error).stack);
      throw err;
    }
  }
}
