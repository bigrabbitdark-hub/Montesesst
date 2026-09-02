import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { GroqTranscriptionService } from '../src/cipa/ata-ai/groq-transcription.service';

describe('GroqTranscriptionService (e2e via DI)', () => {
  let app: INestApplication;
  let transcriber: GroqTranscriptionService;
  let fetchSpy: jest.SpyInstance | undefined;
  const originalApiKey = process.env.GROQ_API_KEY;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    transcriber = moduleRef.get(GroqTranscriptionService);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    if (originalApiKey === undefined) {
      delete process.env.GROQ_API_KEY;
    } else {
      process.env.GROQ_API_KEY = originalApiKey;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem GROQ_API_KEY configurada, rejeita antes de qualquer chamada de rede', async () => {
    delete process.env.GROQ_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');

    await expect(transcriber.transcribe(Buffer.from('audio-fake'), 'audio/mpeg', 'reuniao.mp3')).rejects.toThrow(
      'Transcrição de áudio ainda não está disponível',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('transcreve com sucesso e envia multipart form com file/model/language', async () => {
    process.env.GROQ_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ text: 'Reunião discutiu uso de EPI.' }), { status: 200 }));

    const result = await transcriber.transcribe(Buffer.from('audio-fake'), 'audio/mpeg', 'reuniao.mp3');

    expect(result).toBe('Reunião discutiu uso de EPI.');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, requestInit] = fetchSpy.mock.calls[0];
    expect((requestInit as RequestInit).body).toBeInstanceOf(FormData);
    const sentForm = (requestInit as RequestInit).body as FormData;
    expect(sentForm.get('model')).toBe('whisper-large-v3-turbo');
    expect(sentForm.get('language')).toBe('pt');
    expect((requestInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer chave-de-teste-fake' });
  });

  it('propaga erro HTTP do Groq como 502', async () => {
    process.env.GROQ_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('erro interno', { status: 500 }));

    await expect(
      transcriber.transcribe(Buffer.from('audio-fake'), 'audio/mpeg', 'reuniao.mp3'),
    ).rejects.toThrow('Não foi possível transcrever o áudio agora');
  });

  it('propaga falha de rede como 502', async () => {
    process.env.GROQ_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      transcriber.transcribe(Buffer.from('audio-fake'), 'audio/mpeg', 'reuniao.mp3'),
    ).rejects.toThrow('Não foi possível transcrever o áudio agora');
  });
});
