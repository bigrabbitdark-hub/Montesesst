export interface AtaDraftFields {
  pauta: string;
  discussoes: string;
  deliberacoes: string;
}

export interface AtaExtractor {
  extract(transcript: string): Promise<AtaDraftFields>;
}

export const ATA_EXTRACTOR = Symbol('ATA_EXTRACTOR');
