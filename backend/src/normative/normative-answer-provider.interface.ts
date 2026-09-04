export interface OperationalItem {
  id: string;
  titulo: string;
}

// Anexo de uma pergunta específica do Assistente (Fase 20) — nunca
// persistido, existe só durante o processamento desta chamada.
export interface AttachmentInput {
  kind: 'pdf_text' | 'image';
  content: string; // texto extraído (pdf_text) ou dado base64 (image)
  mimeType?: string; // obrigatório quando kind === 'image'
}

export interface NormativeClaim {
  claim: string;
  chunk_ids: string[];
  operational_ref_ids: string[];
  // true se esta afirmação usa o documento/imagem anexado nesta
  // pergunta como evidência — obrigatório no schema (o modelo sempre
  // preenche), não opcional, pra o Verificador poder confiar no valor
  // sem tratar ausência como falso implícito.
  uses_attachment: boolean;
}

export interface NormativeAnswerProvider {
  answer(
    question: string,
    chunks: { id: string; content: string }[],
    operationalItems: OperationalItem[],
    attachment?: AttachmentInput,
  ): Promise<NormativeClaim[]>;
}

export const NORMATIVE_ANSWER_PROVIDER = Symbol('NORMATIVE_ANSWER_PROVIDER');
