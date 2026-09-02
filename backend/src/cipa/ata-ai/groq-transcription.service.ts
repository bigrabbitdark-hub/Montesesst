import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AudioTranscriptionService } from './audio-transcription.interface';

// Groq hospeda Whisper (large-v3-turbo) com API compatível com o formato
// OpenAI de /audio/transcriptions — inferência muito mais rápida que tempo
// real e historicamente a opção mais barata do mercado. Preço/modelo exato
// a confirmar contra a página atual do Groq antes de ativar em produção,
// mesmo processo que a Fase 8 seguiu com o OpenRouter (rodar exemplo real,
// medir custo real, documentar — ver Step 7 deste plano).
// GROQ_API_KEY fica vazia de propósito até o fundador decidir ativar,
// mesmo padrão do MINIMAX_API_KEY original da Fase 8.
@Injectable()
export class GroqTranscriptionService implements AudioTranscriptionService {
  private readonly logger = new Logger(GroqTranscriptionService.name);

  async transcribe(audio: Buffer, mimetype: string, filename: string): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Transcrição de áudio ainda não está disponível');
    }

    const model = process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimetype }), filename);
    form.append('model', model);
    form.append('language', 'pt');
    form.append('response_format', 'json');

    let response: Response;
    try {
      response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        // Áudios longos (até ~3h por enquanto) — Groq é rápido, mas dá
        // folga generosa; isso protege a função em segundo plano de travar
        // indefinidamente, não a requisição HTTP (que já respondeu antes
        // desta chamada rodar — ver AtaAiService.processDraft).
        signal: AbortSignal.timeout(300_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o Groq', (err as Error).stack);
      throw new BadGatewayException('Não foi possível transcrever o áudio agora');
    }

    if (!response.ok) {
      this.logger.error(`Groq retornou status ${response.status}`);
      throw new BadGatewayException('Não foi possível transcrever o áudio agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do Groq não é JSON válido', (err as Error).stack);
      throw new BadGatewayException('Não foi possível transcrever o áudio agora');
    }

    if (typeof body?.text !== 'string') {
      this.logger.error('Resposta do Groq sem campo "text"');
      throw new BadGatewayException('Não foi possível transcrever o áudio agora');
    }

    return body.text;
  }
}
