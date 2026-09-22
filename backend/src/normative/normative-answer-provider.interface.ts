export interface OperationalItem {
  id: string;
  titulo: string;
}

export interface CompanyChunk {
  id: string;
  content: string;
}

// Item do catálogo de referência sst_checklist_items (checklist interno
// de documentação SST da Montese) relevante pra esta pergunta — NUNCA o
// texto oficial da norma. `content` já vem pronto pro prompt, no formato
// "NR-13 — Prontuário de caldeira: <descrição> — <requisito legal>".
export interface ChecklistItem {
  id: string;
  content: string;
}

// Anexo de uma pergunta específica do Assistente (Fase 20) — nunca
// persistido, existe só durante o processamento desta chamada.
export interface AttachmentInput {
  kind: 'pdf_text' | 'docx_text' | 'xlsx_text' | 'image';
  content: string; // texto extraído (pdf_text/docx_text/xlsx_text) ou dado base64 (image)
  mimeType?: string; // obrigatório quando kind === 'image'
}

export interface NormativeClaim {
  claim: string;
  chunk_ids: string[];
  operational_ref_ids: string[];
  // ids dos trechos de documento da própria empresa (PGR/PCMSO/LTCAT/LIP,
  // Fase 24) que sustentam esta afirmação.
  company_chunk_ids: string[];
  // ids de itens do checklist interno de documentação SST (Montese) que
  // sustentam esta afirmação — NUNCA usado como se fosse o texto oficial
  // da norma (ver ChecklistItem acima).
  checklist_ref_ids: string[];
  // true se esta afirmação usa o documento/imagem anexado nesta
  // pergunta como evidência — obrigatório no schema (o modelo sempre
  // preenche), não opcional, pra o Verificador poder confiar no valor
  // sem tratar ausência como falso implícito.
  uses_attachment: boolean;
}

export interface NormativeAnswerProvider {
  // Rótulo do modelo em uso — só para o trace/log de uso; opcional para não
  // quebrar provedores de teste.
  readonly modelName?: string;
  answer(
    question: string,
    chunks: { id: string; content: string }[],
    operationalItems: OperationalItem[],
    companyChunks: CompanyChunk[],
    checklistItems: ChecklistItem[],
    attachment?: AttachmentInput,
  ): Promise<NormativeClaim[]>;
}

export const NORMATIVE_ANSWER_PROVIDER = Symbol('NORMATIVE_ANSWER_PROVIDER');
