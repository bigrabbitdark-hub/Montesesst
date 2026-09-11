export interface ExtractedFunctionItem {
  function_text: string;
  description: string;
  source_excerpt: string;
}

export interface FunctionExtractionProvider {
  extract(fullText: string, kind: 'risco' | 'exame'): Promise<ExtractedFunctionItem[]>;
}

export const FUNCTION_EXTRACTION_PROVIDER = Symbol('FUNCTION_EXTRACTION_PROVIDER');
