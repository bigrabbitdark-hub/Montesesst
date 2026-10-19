// Tipos espelhando as respostas REAIS do backend (epis, epi-ficha, epi-signature). Fonte: controllers/serviços em backend/src.
// CPF nunca é tipado aqui: a ficha traz só `cpf_masked`; listas de funcionários expõem apenas campos não sensíveis.
// Colunas DATE podem chegar como 'AAAA-MM-DD' ou ISO à meia-noite: use formatDate().

export interface Page<T> { items: T[]; total: number; page: number; page_size: number }

export type StockBand = 'sem_estoque' | 'abaixo' | 'otimo' | 'acima';
export type CaAlert = 'vencido' | 'a_vencer' | 'ok' | 'sem_validade';
export type EpiStatus = 'ativo' | 'inativo';
export type EpiCategory = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';
export type SignatureStatus = 'legado' | 'pendente' | 'assinada' | 'recusada' | 'expirada' | 'presencial' | 'estornada';
export type LedgerType = 'abertura' | 'entrada' | 'entrega' | 'devolucao' | 'troca' | 'baixa';
export type MovementType = LedgerType | 'ajuste' | 'estorno';

export interface EpiCatalogItem {
  id: string; category: string; code: string; equipment_group: string; description: string;
  risk_protected: string; related_nr: string | null; legal_basis: string;
}

// Resposta de POST/PATCH /epis e base da listagem.
export interface Epi {
  id: string; tenant_id: string; epi_catalog_item_id: string; ca_number: string; ca_valid_until: string | null;
  created_by_user_id: string; created_at: string; updated_at: string;
  category: string; code: string; equipment_group: string; description: string;
  manufacturer: string | null; model: string | null; unit: string;
  min_stock: number | null; max_stock: number | null; unit_cost: string | null;
  controls_lot: boolean; replacement_days: number | null; status: string; stock_balance: number;
}

// Item de GET /epis/search.
export interface EpiRow extends Epi {
  stock_band: StockBand; ca_alert: CaAlert; lots_expired: number; lots_expiring: number; stock_value: string;
}

export interface EpiLot {
  id: string; tenant_id: string; tenant_epi_id: string; lot_code: string; valid_until: string | null; balance: number; created_at: string;
}

export interface Movement {
  id: string; tenant_id: string; tenant_epi_id: string; type: MovementType; direction: 1 | -1; quantity: number;
  balance_after: number; employee_id: string | null; supplier: string | null; lot_id: string | null; reason: string | null;
  occurred_at: string; delivery_id: string | null; reverses_movement_id: string | null; idempotency_key: string;
  created_by_user_id: string; created_at: string;
  // Só em GET /epis/movements: o servidor diz se a movimentação já foi estornada (vale em qualquer página).
  reversed?: boolean;
}

export interface EpiDashboard {
  alert_days: number;
  period: { from: string; to: string };
  kpis: {
    epis_total: number; stock_total: number; stock_value: string; low_stock: number; zero_stock: number;
    ca_expired: number; ca_expiring: number; lots_expired: number; lots_expiring: number; pending_signatures: number;
  };
  alerts: Array<{
    epi_id: string; description: string; ca_number: string; stock_balance: number; min_stock: number | null;
    stock_band: StockBand; ca_alert: CaAlert; ca_valid_until: string | null; lots_expired: number; lots_expiring: number;
  }>;
  recent_movements: Array<{
    id: string; type: MovementType; quantity: number; occurred_at: string; epi_id: string; epi_description: string;
    employee_name: string | null; reason: string | null; reversed: boolean;
  }>;
  pending: Array<{
    delivery_id: string; delivered_at: string; employee_id: string; employee_name: string; epi_id: string;
    epi_description: string; quantity: number | null; signature_status: SignatureStatus; active_request_expires_at: string | null;
  }>;
}

// Item de GET /epi-signatures/pending (sem token, código nem hash).
export interface PendingDelivery {
  delivery_id: string; employee_id: string; employee_name: string; tenant_epi_id: string; epi_description: string;
  ca_number: string; quantity: number; delivered_at: string; signature_status: SignatureStatus;
  active_request_id: string | null; active_request_status: string | null; active_request_expires_at: string | null;
}

export interface CaepiRecord {
  numero_ca: string; data_validade: string | null; situacao: string | null; numero_processo: string | null;
  cnpj: string | null; razao_social: string | null; natureza: string | null; equipamento: string | null;
  descricao_equipamento: string | null; marca_ca: string | null; referencia: string | null; cor: string | null;
  aprovado_laudo: string | null; restricao_laudo: string | null; observacao_laudo: string | null;
  cnpj_laboratorio: string | null; razao_social_laboratorio: string | null; numero_laudo: string | null; norma: string | null;
}

// Subconjunto não sensível de GET /employees (o backend também devolve cpf: o cliente nunca o tipa nem usa).
export interface EmployeeLite {
  id: string; full_name: string; registration_number: string | null; department: string | null; position: string | null; status: string;
}

export interface FichaLine {
  source: 'livro' | 'legado'; movement_id: string | null; delivery_id: string | null; date: string;
  type: 'entrega' | 'troca' | 'devolucao' | 'estorno' | 'entrega_legada';
  epi_description: string; manufacturer: string | null; model: string | null; ca_number: string;
  quantity: number | null; reason: string | null; signature_status: SignatureStatus | null; reversed: boolean;
  receipt_code: string | null; signed_at: string | null;
  // Id da assinatura (epi_signatures) para baixar o comprovante. O backend ainda não envia este campo (NÃO VERIFICADO);
  // sem ele a tela mostra só o código do comprovante.
  signature_id?: string | null;
}

export interface Ficha {
  company: { name: string; trade_name: string | null; cnpj: string; address: string };
  employee: {
    id: string; full_name: string; cpf_masked: string; registration_number: string | null; department: string | null;
    position: string | null; admission_date: string | null; company_unit_name: string | null; status: string;
  };
  filters: { from?: string; to?: string; signature_status?: SignatureStatus };
  lines: FichaLine[];
  signatures: Array<{ receipt_code: string; signed_at: string; evidence_sha256: string; signature_sha256: string }>;
  term: { version: string; draft: boolean; title: string; paragraphs: string[] };
}

export interface FichaDocument {
  id: string; employee_id: string; version: number; document_code: string; file_sha256: string; snapshot_sha256: string;
  term_version: string; issued_by_user_id: string; issued_at: string;
}

export interface FichaVerify {
  status: 'integro' | 'divergente' | 'arquivo_ausente'; document_code: string; version: number;
  expected_sha256: string; actual_sha256: string | null;
}

// POST /epi-signatures/requests: url/qr_payload/code só existem nesta resposta (Cache-Control: no-store). Nunca persistir.
export interface CreateRequestResult {
  id: string; url: string; qr_payload: string; code: string; expires_at: string; delivery_ids: string[];
}

export type SignatureRequestStatus = 'ativa' | 'assinada' | 'recusada' | 'expirada' | 'revogada' | 'bloqueada';
export interface SignatureRequest {
  id: string; employee_id: string; status: SignatureRequestStatus; attempts: number; expires_at: string;
  created_at: string; used_at: string | null; refusal_reason: string | null; delivery_ids: string[];
}

export interface InPersonResult {
  in_person_id: string; registered_at: string;
  deliveries: Array<{ id: string; employee_id: string; signature_status: SignatureStatus; signed_at: string; signed_by_name: string }>;
}

// ---- Entradas (corpos/consultas), nomes de campo iguais aos DTOs do backend ----
export interface SearchQuery {
  tenantId?: string; q?: string; status?: EpiStatus; category?: EpiCategory; stockBand?: StockBand; caAlert?: CaAlert;
  page?: number; pageSize?: number;
}
export interface MovementsQuery {
  tenantId?: string; tenantEpiId?: string; employeeId?: string; type?: MovementType; from?: string; to?: string;
  page?: number; pageSize?: number;
}
export interface DashboardQuery { tenantId?: string; from?: string; to?: string; epiId?: string; employeeId?: string }
export interface CreateEpiInput {
  epi_catalog_item_id: string; ca_number: string; ca_valid_until?: string; manufacturer?: string; model?: string; unit?: string;
  min_stock?: number; max_stock?: number; unit_cost?: number; controls_lot?: boolean; replacement_days?: number;
  tenant_id?: string; // só técnico/parceiro (empresa usa o tenant do token)
}
export interface UpdateEpiInput {
  ca_number?: string; ca_valid_until?: string | null; manufacturer?: string | null; model?: string | null; unit?: string;
  min_stock?: number | null; max_stock?: number | null; unit_cost?: number | null; replacement_days?: number | null;
  controls_lot?: boolean; status?: EpiStatus;
}
export interface RegisterMovementInput {
  type: LedgerType; quantity: number; employee_id?: string; supplier?: string; lot_id?: string; lot_code?: string;
  lot_valid_until?: string; reason?: string; occurred_at?: string; idempotency_key: string;
}
export interface AdjustInput { direction: 'mais' | 'menos'; quantity: number; reason: string; lot_id?: string; idempotency_key: string }
export interface ReverseInput { reason: string; idempotency_key: string }
export interface FichaQuery { from?: string; to?: string; signature_status?: SignatureStatus }
export interface IssueFichaInput extends FichaQuery { idempotency_key: string }
export interface CreateSignatureRequestInput { employee_id: string; delivery_ids?: string[]; idempotency_key: string }
export interface InPersonInput { delivery_ids: string[]; witness_name: string; reason: string }
export interface PendingQuery { tenantId?: string; employeeId?: string; page?: number; pageSize?: number }
