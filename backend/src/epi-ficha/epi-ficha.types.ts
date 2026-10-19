// Tipos da ficha de controle de EPI (dados em JSON; o PDF é gerado a partir deles).
export const SIGNATURE_STATUSES = ['legado', 'pendente', 'assinada', 'recusada', 'expirada', 'presencial', 'estornada'] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

export interface FichaFilters {
  from?: string; // AAAA-MM-DD
  to?: string; // AAAA-MM-DD
  signature_status?: SignatureStatus;
}

export interface FichaLine {
  source: 'livro' | 'legado';
  movement_id: string | null;
  delivery_id: string | null;
  date: string; // AAAA-MM-DD (America/Sao_Paulo)
  type: 'entrega' | 'troca' | 'devolucao' | 'estorno' | 'entrega_legada';
  epi_description: string;
  manufacturer: string | null;
  model: string | null;
  ca_number: string;
  quantity: number | null; // null no legado: nunca inventar quantidade
  reason: string | null;
  signature_status: SignatureStatus | null;
  reversed: boolean;
  // Só preenchidos nas linhas 'assinada' que têm evidência eletrônica (subsistema 3); nunca a chave do arquivo.
  receipt_code: string | null;
  signed_at: string | null; // ISO em UTC (ex.: 2026-10-14T12:00:00Z); o PDF formata em America/Sao_Paulo
}

// Assinatura eletrônica referenciada pela ficha. NÃO contém a chave do arquivo da imagem (vive só em FichaSignatureImageRef).
export interface FichaSignature {
  receipt_code: string;
  signed_at: string; // ISO em UTC
  evidence_sha256: string;
  signature_sha256: string;
}

// Uso INTERNO do emissor: de onde ler a imagem e o hash esperado. Fica fora do instantâneo e de qualquer resposta.
export interface FichaSignatureImageRef {
  receipt_code: string;
  file_key: string;
  signature_sha256: string;
}

export interface Ficha {
  company: {
    name: string; trade_name: string | null; cnpj: string;
    address: string; // linha única montada dos campos de endereço; 'não informado' se vazio
  };
  employee: {
    id: string; full_name: string; cpf_masked: string; registration_number: string | null;
    department: string | null; position: string | null; admission_date: string | null;
    company_unit_name: string | null; status: string;
  };
  filters: FichaFilters;
  lines: FichaLine[];
  signatures: FichaSignature[];
  term: { version: string; draft: boolean; title: string; paragraphs: string[] };
}

// Campos públicos de um documento emitido: nunca inclui file_key (chave do R2), snapshot nem idempotency_key.
export interface FichaDocumentRow {
  id: string;
  employee_id: string;
  version: number;
  document_code: string;
  file_sha256: string;
  snapshot_sha256: string;
  term_version: string;
  issued_by_user_id: string;
  issued_at: Date | string;
}

export type VerifyStatus = 'integro' | 'divergente' | 'arquivo_ausente';

// Dados mínimos para ler/conferir o arquivo no R2 depois que a transação do banco já fechou (uso interno).
export interface DocumentRef {
  document_code: string;
  version: number;
  file_key: string;
  file_sha256: string;
}
