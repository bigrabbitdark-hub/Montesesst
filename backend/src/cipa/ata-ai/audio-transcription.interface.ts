export interface AudioTranscriptionService {
  transcribe(audio: Buffer, mimetype: string, filename: string): Promise<string>;
}

export const AUDIO_TRANSCRIPTION_SERVICE = Symbol('AUDIO_TRANSCRIPTION_SERVICE');
