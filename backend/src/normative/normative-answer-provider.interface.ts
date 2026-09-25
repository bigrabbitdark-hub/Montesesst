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

// Categoria do conteúdo da claim (Fase A — Etapa 2). O modelo escolhe
// uma das quatro para que o frontend possa separar visualmente a parte
// normativa (obrigação) da orientação técnica, da recomendação operacional
// e da análise (juízo do assistente). Default aplicado no parser se
// ausente: 'obrigacao' para claims com chunk_ids, 'orientacao' caso
// contrário.
export type ClaimKind = 'obrigacao' | 'orientacao' | 'recomendacao' | 'analise';

// Nível de confiança declarado pelo próprio modelo (Fase A — Etapa 2).
// ALTA: claim literalmente presente na evidência citada. MÉDIA: claim
// inferida por combinação de trechos (ex.: juntar NR-10 + NR-12 para
// concluir sobre procedimento de manutenção eletromecânica). INSUFICIENTE:
// claim baseada em conhecimento geral sem cobertura completa na
// evidência — nesse caso a UI mostra o claim com aviso explícito.
export type ClaimConfidence = 'alta' | 'media' | 'insuficiente';

// Escopo geográfico/normativo da claim (Fase A — Etapa 2). 'interno' é
// usado para claims sobre a própria empresa (operacional/chunks da
// empresa). Default 'federal' para claims com chunk_ids, 'interno' para
// claims só com operational_ref_ids/company_chunk_ids.
export type ClaimScope = 'federal' | 'estadual' | 'municipal' | 'interno';

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
  // Categoria da afirmação (obrigação normativa, orientação técnica,
  // recomendação operacional, análise do assistente). Opcional: o
  // parser aplica default se ausente (ver ClaimKind acima).
  kind?: ClaimKind;
  // Nível de confiança declarado pelo modelo. Opcional: default 'media'
  // quando ausente. Crítico: 'insuficiente' deve ser exibido com aviso
  // pela UI.
  confidence?: ClaimConfidence;
  // Escopo geográfico da afirmação. Opcional: default por heurística
  // no parser.
  scope?: ClaimScope;
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
    // Fase A — Etapa 2: SYSTEM_PROMPT opcional. Default do provedor =
    // SYSTEM_PROMPT base. O serviço que detecta pergunta sobre EPI passa
    // SYSTEM_PROMPT_WITH_EPI_GUIDE; outros tipos de perguntas passam
    // SYSTEM_PROMPT puro.
    systemPrompt?: string,
  ): Promise<NormativeClaim[]>;
}

export const NORMATIVE_ANSWER_PROVIDER = Symbol('NORMATIVE_ANSWER_PROVIDER');
