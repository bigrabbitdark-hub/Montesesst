export interface DocumentClassification {
  category: string | null;
  title: string | null;
  expires_at: string | null;
  confidence: 'alta' | 'baixa';
}

export interface DocumentClassifierProvider {
  classify(text: string): Promise<DocumentClassification>;
}

export const DOCUMENT_CLASSIFIER_PROVIDER = Symbol('DOCUMENT_CLASSIFIER_PROVIDER');
