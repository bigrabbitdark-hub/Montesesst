export interface DocumentChecklistExtraction {
  elaboration_date: string;
  elaboration_date_excerpt: string;
  professional_name: string;
  professional_registro: string;
  professional_papel: string;
  professional_excerpt: string;
}

export interface DocumentChecklistExtractionProvider {
  extract(fullText: string): Promise<DocumentChecklistExtraction>;
}

export const DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER = Symbol('DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER');
