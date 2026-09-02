export interface CompanyUnit {
  id: string;
  tenant_id: string;
  name: string;
  address_street: string;
  address_number: string | null;
  address_city: string;
  address_state: string;
  address_zip: string;
}

export interface CipaCommittee {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  ano: number;
  data_inicio: string;
  data_termino: string;
  responsavel_user_id: string;
  status: 'ativa' | 'encerrada';
  created_at: string;
  updated_at: string;
}

export interface CipaMeeting {
  id: string;
  tenant_id: string;
  committee_id: string;
  company_unit_id: string;
  tipo: 'ordinaria' | 'extraordinaria';
  numero: number | null;
  titulo: string | null;
  data: string | null;
  hora: string | null;
  local: string | null;
  modalidade: 'presencial' | 'online' | 'hibrida' | null;
  motivo: string | null;
  responsavel_user_id: string | null;
  status: 'planejada' | 'agendada' | 'realizada' | 'cancelada' | 'reagendada';
  chk_pauta_definida: boolean;
  chk_participantes_convocados: boolean;
  chk_local_confirmado: boolean;
  chk_presenca_registrada: boolean;
  chk_assuntos_discutidos: boolean;
  chk_decisoes_registradas: boolean;
  chk_ata_criada: boolean;
  chk_acoes_distribuidas: boolean;
  chk_pendencias_registradas: boolean;
  pauta: string | null;
  discussoes: string | null;
  deliberacoes: string | null;
  proxima_reuniao_data: string | null;
  status_ata: 'rascunho' | 'aprovada';
  aprovado_por_user_id: string | null;
  aprovado_em: string | null;
  ata_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CipaMeetingParticipant {
  id: string;
  meeting_id: string;
  cipa_member_id: string | null;
  nome_livre: string | null;
  presente: boolean;
}

export interface CipaMeetingAtaDraft {
  id: string;
  meeting_id: string;
  status: 'processando' | 'concluido' | 'falhou';
  transcript: string | null;
  draft_pauta: string | null;
  draft_discussoes: string | null;
  draft_deliberacoes: string | null;
  error_message: string | null;
}

export interface CipaMember {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  nome: string;
  funcao_empresa: string | null;
  setor: string | null;
  funcao_cipa: 'presidente' | 'vice_presidente' | 'secretario' | 'membro';
  titular_suplente: 'titular' | 'suplente';
  representacao: 'empregador' | 'empregados';
  inicio_mandato: string;
  fim_mandato: string;
  status: 'ativo' | 'inativo';
  created_at: string;
  updated_at: string;
}

export interface CipaPendencia {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  meeting_id: string | null;
  descricao: string;
  responsavel_user_id: string | null;
  prazo: string | null;
  prioridade: 'alta' | 'media' | 'baixa';
  status: 'aberta' | 'andamento' | 'concluida' | 'atrasada';
  created_at: string;
  updated_at: string;
}

export function formatDateBR(iso: string | null): string {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

// Chave de sessionStorage compartilhada pelo layout da Central da CIPA
// (seletor de estabelecimento) e por todas as páginas filhas. Vive aqui —
// não em layout.tsx — porque o App Router do Next.js só permite exports
// especiais (default, metadata, ...) em arquivos layout.tsx/page.tsx.
export const CIPA_COMPANY_UNIT_STORAGE_KEY = 'montese_cipa_company_unit_id';

// Helper reaproveitado pelas páginas filhas — lê a unidade selecionada
// sem precisar buscar /company-units de novo em cada uma.
export function getSelectedCompanyUnitId(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(CIPA_COMPANY_UNIT_STORAGE_KEY);
}

export const FUNCAO_CIPA_LABEL: Record<CipaMember['funcao_cipa'], string> = {
  presidente: 'Presidente',
  vice_presidente: 'Vice-presidente',
  secretario: 'Secretário(a)',
  membro: 'Membro',
};

export const PRIORIDADE_LABEL: Record<CipaPendencia['prioridade'], string> = {
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
};

export const STATUS_PENDENCIA_LABEL: Record<CipaPendencia['status'], string> = {
  aberta: 'Aberta',
  andamento: 'Em andamento',
  concluida: 'Concluída',
  atrasada: 'Atrasada',
};
