import { clearSession, getToken } from '@/lib/auth';

export type Situacao = 'ativa' | 'trial' | 'pendente' | 'inativa';

export interface ClienteResumo {
  id: string; name: string; trade_name: string | null; cnpj: string; sector: string | null;
  contact_name: string | null; contact_phone: string | null; status: string; situacao: Situacao;
}
export interface Responsavel { id: string; full_name: string }
export interface ClienteFicha extends ClienteResumo {
  responsaveis?: Responsavel[];
  contact_role: string | null; notes: string | null; plan: string; created_at: string;
  units: { id: string; name: string; address_city: string; address_state: string; status: string }[];
}

export interface CriarEmpresaInput { company_name: string; cnpj: string; full_name: string; email: string; password: string }
export interface CriarEmpresaResultado { tenant_id: string; user_id: string; email: string }

export const SITUACAO_LABEL: Record<Situacao, string> = {
  ativa: 'Ativa', trial: 'Em teste', pendente: 'Pendente', inativa: 'Inativa',
};
export const SITUACAO_TONE: Record<Situacao, 'ok' | 'info' | 'warn' | 'crit'> = {
  ativa: 'ok', trial: 'info', pendente: 'warn', inativa: 'crit',
};

export const MSG_MATRIZ_AGUARDANDO = 'Aguardando matriz publicada pela equipe técnica.';
export const MSG_403 = 'Você não tem permissão para esta ação.';

export function formatCnpj(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : v;
}

// Chama a API do Painel de Atuação. Lança Error com mensagem pronta para o usuário.
// A autoridade é o backend; aqui só se traduz a resposta.
export async function atuacaoFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/atuacao${path}`, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${getToken()}`,
      },
    });
  } catch {
    throw new Error('Não foi possível conectar. Verifique sua conexão e tente novamente.');
  }
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  if (res.status === 403) {
    // Em /documentos o servidor distingue negações (ex.: matriz de responsabilidades): exibe a mensagem dele, sem reinterpretar.
    if (path.startsWith('/documentos') || path.startsWith('/checklists')) {
      let msg = '';
      try {
        const body = await res.json();
        if (typeof body?.message === 'string') msg = body.message.trim();
      } catch { /* corpo ilegível: usa a mensagem padrão */ }
      if (msg) throw new Error(msg);
    }
    throw new Error(MSG_403);
  }
  // Cadastro de empresa: o 23505 do servidor chega como "Registro duplicado"; a mensagem amigável tem prioridade.
  if (res.status === 409 && path === '/clientes' && init.method === 'POST') throw new Error('CNPJ ou e-mail já cadastrado.');
  if (res.status === 409 && (path.startsWith('/documentos') || path.startsWith('/pgr') || path.startsWith('/tarefas') || path.startsWith('/checklists') || path.startsWith('/alertas'))) {
    // Conflito de estado/separação de funções: mensagem do servidor, sem reinterpretar.
    let msg = '';
    try {
      const body = await res.json();
      if (typeof body?.message === 'string') msg = body.message.trim();
    } catch { /* corpo ilegível: usa a mensagem padrão */ }
    throw new Error(msg || (path.startsWith('/pgr') ? 'Conflito: já existe um registro igual. Revise os dados.' : path.startsWith('/tarefas') ? 'Ação não permitida no estado atual da tarefa.' : path.startsWith('/checklists') ? 'Ação não permitida no estado atual do modelo.' : path.startsWith('/alertas') ? 'Ação não permitida para este registro.' : 'Ação não permitida no estado atual do documento.'));
  }
  if (res.status === 413) throw new Error(`O arquivo excede o limite de ${DOC_MAX_MB} MB.`);
  if (res.status === 401) {
    // Mesmo efeito do logout() de lib/auth: limpa a sessão e volta ao login (UX; a autoridade é o backend).
    // Fica clearSession (e não sessionExpired) de propósito: estas chamadas usam o token da PRÓPRIA sócia —
    // durante a atuação o RoleGuard de /atuacao manda o papel 'empresa' para /dashboard-v2, então a sócia
    // não chega aqui atuando; um 401 aqui é a sessão dela que venceu (Ruling 16).
    clearSession();
    window.location.href = '/login';
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  if (res.status === 404) {
    if (path.startsWith('/pgr/perigos')) throw new Error('Perigo não encontrado.');
    if (path === '/pgr/matriz/vigente') throw new Error(MSG_MATRIZ_AGUARDANDO);
    if (path.startsWith('/pgr/empresas')) {
      // O servidor distingue Empresa/GHE/Risco não encontrado; sem mensagem (ou no /resumo) vale o texto de empresa.
      let msg = '';
      try {
        const body = await res.json();
        if (typeof body?.message === 'string') msg = body.message.trim();
      } catch { /* corpo ilegível */ }
      throw new Error(path.endsWith('/resumo') || !msg ? 'Empresa não encontrada.' : msg);
    }
    if (path.startsWith('/checklists')) throw new Error('Modelo de checklist não encontrado.');
    if (path.startsWith('/notificacoes')) throw new Error('Notificação não encontrada.');
    if (path.startsWith('/alertas/mudancas')) throw new Error('Empresa ou registro não encontrado.');
    if (path.startsWith('/vencimentos')) throw new Error('Empresa não encontrada.');
    if (path.startsWith('/tarefas')) throw new Error('Tarefa não encontrada.');
    if (path.startsWith('/agenda')) throw new Error('Compromisso não encontrado.');
    if (/^\/documentos\/empresa\//.test(path)) throw new Error('Empresa não encontrada.');
    if (path.startsWith('/documentos/')) throw new Error('Documento não encontrado.');
    if (path.startsWith('/interacoes?')) throw new Error('Empresa não encontrada.');
    if (path.startsWith('/interacoes')) throw new Error('Registro não encontrado.');
    if (path.startsWith('/empresas/')) {
      throw new Error(/\/documentos\/[^/]+/.test(path) ? 'Documento não encontrado.' : 'Empresa não encontrada.');
    }
    throw new Error('Cliente não encontrado.');
  }
  const criaEmpresa = path === '/clientes' && init.method === 'POST';
  if (criaEmpresa && res.status === 429) throw new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  // class-validator devolve mensagens em inglês: no cadastro de empresa, mensagem genérica em português.
  if (criaEmpresa && res.status === 400) throw new Error('Confira os dados informados e tente novamente.');
  let detalhe = '';
  if (res.status === 400) {
    try {
      const body = await res.json();
      detalhe = Array.isArray(body?.message) ? body.message.join(' ') : String(body?.message ?? '');
    } catch { /* corpo ilegível: usa a mensagem padrão */ }
    throw new Error(detalhe || 'Dados inválidos. Revise os campos e tente novamente.');
  }
  throw new Error('Algo deu errado. Tente novamente.');
}

// ---- Tarefas (Fase 3A) ----
export const TAREFA_STATUS = [
  'pending', 'in_progress', 'blocked', 'awaiting_review', 'awaiting_client', 'awaiting_execution', 'awaiting_efficacy',
  'completed', 'cancelled',
] as const;
export type TarefaStatus = (typeof TAREFA_STATUS)[number];
export type Prioridade = 'baixa' | 'media' | 'alta' | 'urgente';

export interface TarefaResumo {
  id: string; tenant_id: string; tenant_name: string; title: string; priority: Prioridade; status: TarefaStatus;
  due_date: string | null; assignee_user_id: string; assignee_name: string | null; created_by_name: string | null;
  vencida: boolean;
}
export interface TarefaEvento {
  id: string; type: 'created' | 'updated' | 'assigned' | 'status_changed'; actor_name: string | null;
  from_value: string | null; to_value: string | null; note: string | null; created_at: string;
}
export type TarefaDetalhe = TarefaResumo & {
  description: string | null; category: string | null; completed_at: string | null; created_at: string;
  eventos: TarefaEvento[];
};

export const STATUS_LABEL: Record<TarefaStatus, string> = {
  pending: 'Pendente', in_progress: 'Em andamento', blocked: 'Bloqueada',
  awaiting_review: 'Aguardando avaliação técnica', awaiting_client: 'Aguardando cliente',
  awaiting_execution: 'Aguardando execução', awaiting_efficacy: 'Aguardando comprovação de eficácia',
  completed: 'Concluída', cancelled: 'Cancelada',
};
export const STATUS_TONE: Record<TarefaStatus, 'ok' | 'info' | 'warn' | 'crit' | 'high'> = {
  pending: 'info', in_progress: 'info', blocked: 'crit', awaiting_review: 'warn', awaiting_client: 'warn',
  awaiting_execution: 'warn', awaiting_efficacy: 'warn', completed: 'ok', cancelled: 'high',
};
export const PRIORIDADE_LABEL: Record<Prioridade, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente' };

// Espelho de backend/src/atuacao/tarefa-status.ts, só para UX (mostrar os botões possíveis). Quem decide é o servidor.
// Entre estados ABERTOS a troca é livre; concluir só de in_progress ou de uma espera; cancelar de qualquer aberto;
// completed -> in_progress e cancelled -> pending (reabertura).
export const STATUS_ABERTOS: readonly TarefaStatus[] = [
  'pending', 'in_progress', 'blocked', 'awaiting_review', 'awaiting_client', 'awaiting_execution', 'awaiting_efficacy',
];
export const STATUS_ESPERA: readonly TarefaStatus[] = ['awaiting_review', 'awaiting_client', 'awaiting_execution', 'awaiting_efficacy'];
const PODE_CONCLUIR: readonly TarefaStatus[] = ['in_progress', ...STATUS_ESPERA];
function transicoesDeAberto(de: TarefaStatus): readonly TarefaStatus[] {
  return [
    ...STATUS_ABERTOS.filter((p) => p !== de),
    ...(PODE_CONCLUIR.includes(de) ? (['completed'] as const) : []),
    'cancelled',
  ];
}
export const TRANSICOES: Record<TarefaStatus, readonly TarefaStatus[]> = {
  pending: transicoesDeAberto('pending'),
  in_progress: transicoesDeAberto('in_progress'),
  blocked: transicoesDeAberto('blocked'),
  awaiting_review: transicoesDeAberto('awaiting_review'),
  awaiting_client: transicoesDeAberto('awaiting_client'),
  awaiting_execution: transicoesDeAberto('awaiting_execution'),
  awaiting_efficacy: transicoesDeAberto('awaiting_efficacy'),
  completed: ['in_progress'],
  cancelled: ['pending'],
};
export function exigeMotivo(para: TarefaStatus): boolean {
  return para === 'blocked' || para === 'cancelled';
}

// due_date é DATE (YYYY-MM-DD): formata pelo texto, sem passar por Date (evita deslocar o dia por fuso).
export function formatDataCurta(v: string | null): string {
  if (!v) return 'Sem prazo';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}
// Instante (timestamptz) no fuso de São Paulo.
export function formatDataHora(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export interface TarefasKpi {
  abertas: number; vencidas: number; hoje: number; bloqueadas: number;
  // D2 (aditivos): contagens por espera; podem faltar em respostas de backend antigo.
  aguardando_cliente?: number; aguardando_avaliacao?: number; aguardando_execucao?: number; aguardando_eficacia?: number;
}

// ---- Agenda e interações (Fase 3B) ----
export type AgendaStatus = 'agendado' | 'concluido' | 'cancelado';
export type AgendaTipo = 'reuniao' | 'visita' | 'ligacao' | 'outro';

export interface EventoResumo {
  id: string; tenant_id: string; tenant_name: string; owner_user_id: string; owner_name: string | null;
  type: AgendaTipo; title: string; event_date: string; start_time: string | null; end_time: string | null;
  status: AgendaStatus;
}
export type EventoDetalhe = EventoResumo & {
  location: string | null; meeting_link: string | null; company_unit_id: string | null; notes: string | null;
  outcome_note: string | null; created_by_name: string | null; created_at: string;
};

export const AGENDA_TIPO_LABEL: Record<AgendaTipo, string> = {
  reuniao: 'Reunião', visita: 'Visita', ligacao: 'Ligação', outro: 'Outro',
};
export const AGENDA_STATUS_LABEL: Record<AgendaStatus, string> = {
  agendado: 'Agendado', concluido: 'Concluído', cancelado: 'Cancelado',
};
export const AGENDA_STATUS_TONE: Record<AgendaStatus, 'ok' | 'info' | 'warn' | 'crit' | 'high'> = {
  agendado: 'info', concluido: 'ok', cancelado: 'high',
};

export type InteracaoTipo = 'reuniao' | 'ligacao' | 'email' | 'visita' | 'outro';
export const INTERACAO_TIPO_LABEL: Record<InteracaoTipo, string> = {
  reuniao: 'Reunião', ligacao: 'Ligação', email: 'E-mail', visita: 'Visita', outro: 'Outro',
};
// Histórico global (GET /atuacao/interacoes): summary vem cortado em 200 (summary_truncado) e sem dados extras.
export interface InteracaoGlobal {
  id: string; tenant_id: string; empresa: string; type: InteracaoTipo; occurred_on: string; summary: string;
  summary_truncado: boolean; created_by_name: string | null; href: string;
}
export interface InteracoesGlobalResposta { itens: InteracaoGlobal[]; total: number; page: number; page_size: number }
export const INTERACOES_POR_PAGINA = 100;

export interface Interacao {
  id: string; tenant_id: string; type: InteracaoTipo; occurred_on: string; participants: string | null; summary: string;
  decisions: string | null; next_steps: string | null; agenda_event_id: string | null; created_by: string;
  created_by_name: string | null; created_at: string; updated_at: string; editavel: boolean;
}

// Data de hoje (YYYY-MM-DD) no fuso de São Paulo, sem depender do fuso do navegador.
export function hojeIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
// Soma dias a uma data YYYY-MM-DD (aritmética em UTC: sem efeito de fuso/horário de verão).
export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}
export function formatIntervalo(inicio: string | null, fim: string | null): string {
  if (!inicio) return 'Dia inteiro';
  return fim ? `${inicio} – ${fim}` : inicio;
}

// ---- Financeiro (Fase 4) — SOMENTE CONSULTA. Valores chegam em CENTAVOS. ----
export interface UltimoPagamento { data: string; status: string; valor_cents: number }
export interface ClienteFinanceiro {
  id: string; name: string; trade_name: string | null; situacao: Situacao;
  plano: string | null; valor_mensal_cents: number | null;
  ultimo_pagamento: UltimoPagamento | null; pendencia: boolean; dias_em_atraso: number | null;
}
export interface ClienteFinanceiroFicha extends ClienteFinanceiro {
  assinaturas: { plano: string; status: string; valor_mensal_cents: number; desde: string }[];
  pagamentos: UltimoPagamento[];
}
export interface ResumoFinanceiro {
  periodo_dias: number;
  clientes: { total: number; ativos: number; trial: number; pendentes: number; inativos: number; com_pendencia: number };
  mrr_cents: number;
  hoje: { cobrado_cents: number; aprovado_cents: number; pendente_cents: number };
  mes: { cobrado_cents: number; aprovado_cents: number; pendente_cents: number; recusado_cents: number };
  serie: { data: string; cobrado_cents: number; aprovado_cents: number }[];
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
// Centavos -> "R$ 299,00" (somente na tela; a API nunca recebe valor formatado).
export function formatBRL(cents: number | null | undefined): string {
  return typeof cents === 'number' && Number.isFinite(cents) ? BRL.format(cents / 100).replace(/ /g, ' ') : '—';
}
export function textoAtraso(dias: number | null): string | null {
  if (dias === null || dias === undefined) return null;
  return dias === 1 ? 'Em atraso há 1 dia' : `Em atraso há ${dias} dias`;
}
// Status bruto do Mercado Pago -> rótulo; desconhecido aparece como veio.
export const PAGAMENTO_STATUS_LABEL: Record<string, string> = {
  approved: 'Aprovado', pending: 'Pendente', in_process: 'Em processamento', authorized: 'Autorizado',
  rejected: 'Recusado', cancelled: 'Cancelado', refunded: 'Estornado', charged_back: 'Contestado',
};
export const PAGAMENTO_STATUS_TONE: Record<string, 'ok' | 'info' | 'warn' | 'crit' | 'high'> = {
  approved: 'ok', pending: 'warn', in_process: 'warn', authorized: 'info', rejected: 'crit', cancelled: 'crit',
};
export function pagamentoLabel(s: string): string { return PAGAMENTO_STATUS_LABEL[s] ?? s; }
export function pagamentoTone(s: string): 'ok' | 'info' | 'warn' | 'crit' | 'high' { return PAGAMENTO_STATUS_TONE[s] ?? 'high'; }

// ---- Documentos (Fase 5B) ----
// Espelho de DOC_STATUS e CATEGORIAS_DOCUMENTO do backend (atuacao/documentos). Quem decide é o servidor.
export const DOC_STATUS = ['em_elaboracao', 'em_revisao', 'aprovado', 'assinado', 'publicado', 'cancelado'] as const;
export type DocStatus = (typeof DOC_STATUS)[number];
export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  em_elaboracao: 'Em elaboração', em_revisao: 'Em revisão', aprovado: 'Aprovado',
  assinado: 'Assinado (registro interno)', publicado: 'Publicado', cancelado: 'Cancelado',
};
export const DOC_STATUS_TONE: Record<DocStatus, 'ok' | 'info' | 'warn' | 'crit' | 'high'> = {
  em_elaboracao: 'info', em_revisao: 'warn', aprovado: 'ok', assinado: 'ok', publicado: 'ok', cancelado: 'high',
};
export const DOC_STATUS_AGUARDANDO: readonly DocStatus[] = ['em_revisao', 'aprovado', 'assinado'];
export const DOC_CATEGORIA_LABEL: Record<string, string> = {
  pgr: 'PGR', pcmso: 'PCMSO', laudo: 'Laudo', ficha_epi: 'Ficha de EPI', treinamento: 'Treinamento',
  cipa_ata: 'CIPA — ata', cipa_comunicado: 'CIPA — comunicado', cipa_documento_eleitoral: 'CIPA — documento eleitoral',
  cipa_anexo: 'CIPA — anexo', ltcat: 'LTCAT', lip: 'LIP', relatorio_visita: 'Relatório de visita',
};
export const DOC_CATEGORIAS = Object.keys(DOC_CATEGORIA_LABEL);
export function docStatusLabel(s: string): string { return DOC_STATUS_LABEL[s as DocStatus] ?? s; }
export function docStatusTone(s: string): 'ok' | 'info' | 'warn' | 'crit' | 'high' { return DOC_STATUS_TONE[s as DocStatus] ?? 'high'; }
export function docCategoriaLabel(c: string): string { return DOC_CATEGORIA_LABEL[c] ?? c; }

export interface DocumentoResumo {
  id: string; tenant_id: string; tenant_name: string; category: string; title: string; status: DocStatus;
  current_version_id: string | null; versao_atual: number | null; published_document_id: string | null;
  created_by: string; created_by_name: string | null; created_at: string; updated_at: string;
}

// ---- Detalhe do documento (Fase 5B, Task 2) ----
export const DOC_MAX_MB = 10;
export const DOC_MAX_BYTES = DOC_MAX_MB * 1024 * 1024;
// Mesmos tipos de `documents` (PDF, JPEG, PNG, DOCX, XLSX). Validação de UX; o servidor decide.
export const DOC_TIPOS_ACEITOS = [
  'application/pdf', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
export const DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,.docx,.xlsx';
export const AVISO_LGPD_NOTA = 'Não inclua dados pessoais sensíveis ou de saúde.';

export type DocAcaoNome = 'nova_versao' | 'enviar_revisao' | 'devolver' | 'aprovar' | 'assinar' | 'publicar' | 'cancelar';
export type DocEventoTipo = 'created' | 'version_added' | 'submitted' | 'returned' | 'approved' | 'signed' | 'published' | 'cancelled';
export const DOC_EVENTO_LABEL: Record<DocEventoTipo, string> = {
  created: 'Rascunho criado', version_added: 'Nova versão enviada', submitted: 'Enviado para revisão',
  returned: 'Devolvido para elaboração', approved: 'Aprovado', signed: 'Assinatura interna registrada',
  published: 'Publicado', cancelled: 'Cancelado',
};
export function docEventoLabel(t: string): string { return DOC_EVENTO_LABEL[t as DocEventoTipo] ?? t; }

export interface DocVersao {
  id: string; version_number: number; file_name: string; mime_type: string; size_bytes: number; sha256: string;
  note: string | null; created_by: string; created_by_name: string | null; created_at: string;
}
export type CorrecaoStatus = 'aberta' | 'corrigida' | 'verificada' | 'cancelada';
export type CorrecaoOrigem = 'revisao' | 'cliente' | 'interna';
export interface DocCorrecao {
  id: string; version_number: number | null; description: string; origin: CorrecaoOrigem; requester_label: string | null;
  requested_by_name: string | null; responsible_user_id: string; responsible_name: string | null; due_date: string | null;
  status: CorrecaoStatus; corrected_at: string | null; verified_at: string | null; resolution_note: string | null; created_at: string;
}
export const CORRECAO_STATUS_LABEL: Record<CorrecaoStatus, string> = {
  aberta: 'Aberta', corrigida: 'Corrigida, aguardando verificação', verificada: 'Verificada', cancelada: 'Cancelada',
};
export const CORRECAO_ORIGEM_LABEL: Record<CorrecaoOrigem, string> = {
  revisao: 'Revisão interna', cliente: 'Pedido do cliente', interna: 'Identificada internamente',
};
export function correcaoStatusTone(s: CorrecaoStatus): 'ok' | 'info' | 'warn' | 'crit' | 'high' {
  return s === 'verificada' ? 'ok' : s === 'aberta' ? 'crit' : s === 'corrigida' ? 'warn' : 'high';
}
export interface DocEvento {
  id: string; type: string; version_id: string | null; actor_user_id: string | null; actor_name: string | null;
  note: string | null; created_at: string;
}
export interface DocAssinatura {
  id: string; version_id: string; version_number: number; signer_user_id: string; signer_name: string | null;
  version_sha256: string; signed_at: string; registro_confirmado: boolean; vigente: boolean;
  council?: string; registration_number?: string; uf?: string;
}
// Vínculo opcional LTCAT/LIP/laudo -> PGR-base (E5). Os avisos são informativos; o texto vem pronto do servidor.
export const CATEGORIAS_COM_BASE = ['ltcat', 'lip', 'laudo'] as const;
export interface DocBase { id: string; title: string; category: string; status: DocStatus; versao: number | null }
export interface DocAvisoBase { codigo: 'base_mais_nova' | 'base_nao_publicada' | 'base_cancelada'; mensagem: string }
export interface DocDerivado { id: string; category: string; title: string; status: DocStatus; versao: number | null }
export interface DocTecnico {
  id: string; category: string; title: string; status: DocStatus; versao: number | null; base_draft_id: string | null;
  correcoes_pendentes: number; updated_at: string; avisos_base: DocAvisoBase[];
}
export type DocumentoDetalhe = DocumentoResumo & {
  versao_atual_sha256: string | null; versoes: DocVersao[]; eventos: DocEvento[]; assinaturas: DocAssinatura[];
  correcoes: DocCorrecao[]; correcoes_pendentes: number;
  base_draft_id?: string | null; base?: DocBase | null; avisos_base?: DocAvisoBase[]; derivados?: DocDerivado[];
  aviso_assinatura: string; acoes_permitidas: DocAcaoNome[];
};

// SHA-256 abreviado: 8 primeiros + 8 últimos caracteres.
export function hashAbreviado(h: string): string {
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-8)}` : h;
}
export function formatTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const n = (v: number) => v.toFixed(1).replace('.', ',');
  return bytes < 1024 * 1024 ? `${n(bytes / 1024)} KB` : `${n(bytes / (1024 * 1024))} MB`;
}

// ---- Atuação por empresa (sub-projeto Z) ----
export const CHAVE_ULTIMA_EMPRESA = 'montese_atuacao_ultima_empresa';
export interface EmpresaVisaoGeral {
  empresa: { id: string; name: string; trade_name: string | null; cnpj: string; situacao?: Situacao };
  funcionarios_ativos: number;
  documentos: { total: number; vencidos: number; a_vencer_30d: number };
  epis_cadastrados: number;
}
export interface EmpresaDocumento {
  id: string; category: string; title: string; file_name: string;
  valid_from: string | null; expires_at: string | null; situacao: string;
}
export interface EmpresaVencimento {
  id: string; category: string; title: string; expires_at: string; dias_para_vencer: number;
}
export interface EmpresaFuncionario {
  id: string; full_name: string; cargo: string | null; department: string | null; company_unit_id: string | null;
  admission_date: string | null; status: string;
}
export interface EmpresaEpi { id: string; code: string; equipment_group: string; description: string }

// ---- PGR: biblioteca de perigos (sub-projeto A) ----
export const PERIGO_CATEGORIAS = ['fisico', 'quimico', 'biologico', 'ergonomico', 'acidente', 'psicossocial'] as const;
export type PerigoCategoria = (typeof PERIGO_CATEGORIAS)[number];
export const PERIGO_CATEGORIA_LABEL: Record<PerigoCategoria, string> = {
  fisico: 'Físico', quimico: 'Químico', biologico: 'Biológico', ergonomico: 'Ergonômico',
  acidente: 'Acidente', psicossocial: 'Psicossocial',
};
export function perigoCategoriaLabel(c: string): string { return PERIGO_CATEGORIA_LABEL[c as PerigoCategoria] ?? c; }
export type PerigoAvaliacao = 'qualitativa' | 'quantitativa';
export const PERIGO_AVALIACAO_LABEL: Record<PerigoAvaliacao, string> = { qualitativa: 'Qualitativa', quantitativa: 'Quantitativa' };

// Chaves do JSON `psychosocial` (o servidor aceita qualquer objeto; estas são as que a tela edita).
export const PSICO_CAMPOS = [
  ['organizacao_trabalho', 'Organização do trabalho'],
  ['metas', 'Metas'],
  ['jornada', 'Jornada'],
  ['relacoes_interpessoais', 'Relações interpessoais'],
  ['violencia_assedio', 'Violência e assédio'],
] as const;

export interface PerigoResumo {
  id: string; scope: 'global' | 'tenant'; tenant_id: string | null; category: string; name: string;
  description: string | null; esocial_code: string | null; default_assessment: string | null; active: boolean;
}
export type PerigoDetalhe = PerigoResumo & {
  sources: string | null; health_effects: string | null; exposure_routes: string[] | null; default_unit: string | null;
  tolerance_limit: string | null; tolerance_reference: string | null; suggested_controls: string | null;
  psychosocial: Record<string, unknown> | null;
};
export interface PgrImportados {
  cnpj: boolean; cnae: boolean; endereco: boolean; grau_risco: boolean | null;
  unidades: number; cargos: number; funcionarios: number;
}
export interface PgrResumo {
  empresa: { id: string; name: string; trade_name: string | null; cnpj: string };
  importados?: Partial<PgrImportados>;
  pendencias: string[]; ghes: number; riscos: number; completude: number;
}
export const PGR_PENDENCIA_LABEL: Record<string, string> = {
  cnpj: 'CNPJ', cnae: 'CNAE', endereco: 'Endereço completo', unidades: 'Unidades', cargos: 'Cargos',
  funcionarios: 'Funcionários', ghes: 'GHEs', riscos: 'Riscos',
};

export const MSG_PGR_LEITURA =
  "Você não tem a permissão 'Consultar o PGR' (pgr.read). Peça ao administrador para liberá-la.";
export const MSG_PGR_ESCRITA =
  "Você não tem a permissão 'Elaborar o PGR' (pgr.write) para alterar a biblioteca. Peça ao administrador.";

export const MSG_PGR_BIBLIOTECA_VAZIA = 'A biblioteca ainda não tem perigos. A carga inicial é fornecida pela equipe técnica.';
export const NAO_INFORMADO = 'não informado';

// ---- PGR: GHEs e inventário de riscos (sub-projeto A) ----
export interface GheCargo { id: string; name: string }
// `expostos` é só uma contagem de funcionários ativos; o servidor nunca envia nome nem CPF.
export interface Ghe {
  id: string; name: string; company_unit_id: string | null; positions: GheCargo[]; expostos: number; riscos: number;
  environment_description?: string | null; process_description?: string | null; activities?: string | null;
  machines_products?: string | null; notes?: string | null;
}
export const EXPOSICOES = ['habitual_permanente', 'intermitente', 'eventual'] as const;
export const EXPOSICAO_LABEL: Record<string, string> = {
  habitual_permanente: 'Habitual e permanente', intermitente: 'Intermitente', eventual: 'Eventual',
};
export function exposicaoLabel(v: string | null | undefined): string { return v ? (EXPOSICAO_LABEL[v] ?? v) : NAO_INFORMADO; }
export function avaliacaoLabel(v: string | null | undefined): string {
  return v ? (PERIGO_AVALIACAO_LABEL[v as PerigoAvaliacao] ?? v) : NAO_INFORMADO;
}
export const RISCO_STATUS_LABEL: Record<string, string> = { rascunho: 'Rascunho', completo: 'Completo' };
export const CONTROLE_TIPOS = ['epc', 'epi', 'administrativa', 'treinamento'] as const;
export const CONTROLE_TIPO_LABEL: Record<string, string> = {
  epc: 'EPC (proteção coletiva)', epi: 'EPI (proteção individual)', administrativa: 'Administrativa', treinamento: 'Treinamento',
};
export const CONTROLE_STATUS = ['existente', 'planejado', 'nao_implementado'] as const;
export const CONTROLE_STATUS_LABEL: Record<string, string> = {
  existente: 'Existente', planejado: 'Planejado', nao_implementado: 'Não implementado',
};
export const EFICACIAS = ['eficaz', 'ineficaz', 'nao_avaliada'] as const;
export const EFICACIA_LABEL: Record<string, string> = { eficaz: 'Eficaz', ineficaz: 'Ineficaz', nao_avaliada: 'Não avaliada' };
// Espelho de TRAINING_TYPES do backend (cipa/trainings.service); o servidor valida.
export const TREINAMENTO_LABEL: Record<string, string> = {
  'nr-05': 'NR-05 — Membro da CIPA', 'nr-06': 'NR-06 — Uso de EPI', 'nr-10': 'NR-10 — Segurança em eletricidade',
  'nr-11': 'NR-11 — Transporte/movimentação de materiais', 'nr-12': 'NR-12 — Segurança em máquinas e equipamentos',
  'nr-18': 'NR-18 — Condições de segurança na construção civil', 'nr-20': 'NR-20 — Inflamáveis e combustíveis',
  'nr-33': 'NR-33 — Espaço confinado', 'nr-35': 'NR-35 — Trabalho em altura', outro: 'Outro',
};
export interface RiscoControle {
  id: string; kind: string; description: string; status: string; effectiveness: string | null;
  epi_catalog_item_id: string | null; training_tipo: string | null;
}
export interface RiscoMedicao {
  id: string; agent: string; value: string | null; unit: string | null; tolerance_limit: string | null;
  reference: string | null; methodology: string | null; equipment: string | null; evaluated_on: string | null;
}
export interface Risco {
  id: string; ghe_id: string; hazard_id: string | null; category: string; name: string; description: string | null;
  sources: string | null; health_effects: string | null; tolerance_limit: string | null; tolerance_reference: string | null;
  activity: string | null; exposure_type: string | null; esocial_code: string | null; assessment_type: string | null;
  assessment_notes: string | null; status: string; controles: RiscoControle[]; medicoes: RiscoMedicao[];
}
export interface RiscosCriados { riscos: Risco[]; ignorados: string[] }
export interface CargoEmpresa { id: string; name: string }
export interface EpiCatalogoItem {
  id: string; category: string; code: string; equipment_group: string; description: string;
  risk_protected: string | null; related_nr: string | null;
}
export const MSG_REGISTRO_INDISPONIVEL = 'Registro profissional não cadastrado ou indisponível para consulta';
export const MSG_PGR_ESCRITA_INVENTARIO =
  "Você não tem a permissão 'Elaborar o PGR' (pgr.write) para alterar o inventário. Peça ao administrador.";
// Traduz erro de escrita no inventário: 403 vira a mensagem de permissão; o resto já vem pronto do atuacaoFetch.
export function erroEscritaPgr(e: unknown): string {
  const m = e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.';
  return m === MSG_403 ? MSG_PGR_ESCRITA_INVENTARIO : m;
}
export function erroLeituraPgr(e: unknown): string {
  const m = e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.';
  return m === MSG_403 ? MSG_PGR_LEITURA : m;
}

// ---- PGR: matriz de risco e classificação (B1). O servidor calcula escore e nível; o cliente só envia as escolhas. ----
export interface MatrizEscalaItem { valor: number; rotulo: string; descricao: string }
export interface MatrizNivel { id: string; rotulo: string; aceitabilidade: string; decisao: string; bloqueia_emissao: boolean }
export interface MatrizVigente {
  id: string; version_number: number; status: string;
  config: { severidade: MatrizEscalaItem[]; probabilidade: MatrizEscalaItem[]; niveis: MatrizNivel[] };
}
export type AvaliacaoKind = 'inerente' | 'residual_previsto';
export const AVALIACAO_KINDS: AvaliacaoKind[] = ['inerente', 'residual_previsto'];
export const AVALIACAO_KIND_LABEL: Record<AvaliacaoKind, string> = { inerente: 'Risco inerente', residual_previsto: 'Risco residual previsto' };
export interface AvaliacaoRisco {
  id: string; risk_id: string; kind: AvaliacaoKind; matrix_version_id: string; matrix_version_number: number;
  severity_value: number; probability_value: number; score: number; level_id: string; nivel: MatrizNivel | null;
  justification: string; assessed_at: string;
}
export interface AvaliacoesResposta { historico: AvaliacaoRisco[]; vigente: Record<AvaliacaoKind, AvaliacaoRisco | null> }
export interface MapaCalorResposta {
  kind: AvaliacaoKind; matrix_version: { id: string; version_number: number; status: string };
  cells: Array<{ severidade: number; probabilidade: number; score: number; nivel_id: string; quantidade: number }>;
  total_riscos: number; classificados: number; em_outra_versao: number; sem_avaliacao: number;
  por_versao: Array<{ version_number: number; n: number }>;
}
export const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);

// ---- Painel do sócio (GET /atuacao/painel) e vencimentos da carteira (GET /atuacao/vencimentos) ----
export interface PainelEvento {
  id: string; titulo: string; tipo: string; data: string; hora: string | null; tenant_id: string; empresa: string; status: string;
}
export type PendenciaTipo = 'tarefa_atrasada' | 'tarefa_aguardando' | 'documento_vencido' | 'documento_vencendo' | 'documento_aguardando';
export interface PainelPendencia {
  tipo: PendenciaTipo; tenant_id: string; empresa: string; descricao: string; prazo: string | null;
  prioridade: string | null; href: string;
}
// Cada bloco é null quando o sócio não tem a permissão OU o bloco falhou (nesse caso vem listado em `indisponiveis`).
// vence_7 ⊂ vence_15 ⊂ vence_30 são CUMULATIVOS ("vencem em até N dias"); `vencidos` é separado. Nunca somar.
// Cada campo de `documentos` pode ser null isoladamente (só empresas.read ou só documents.read).
export interface PainelResposta {
  gerado_em: string;
  empresas: { acessiveis: number | null } | null;
  tarefas: TarefasKpi | null;
  agenda: { hoje: PainelEvento[]; hoje_total: number; proximos_7_dias: number } | null;
  documentos: {
    vencidos: number | null; vence_7: number | null; vence_15: number | null; vence_30: number | null; aguardando_acao: number | null;
    etapas: { em_revisao: number; para_assinar: number; para_entregar: number } | null;
  } | null;
  pendencias: PainelPendencia[];
  indisponiveis: string[];
}
export type FaixaVencimento = 'vencidos' | '7' | '15' | '30';
export const FAIXAS_VENCIMENTO: readonly FaixaVencimento[] = ['vencidos', '7', '15', '30'];
export const FAIXA_LABEL: Record<FaixaVencimento, string> = {
  vencidos: 'Vencidos', '7': 'Vencem em até 7 dias', '15': 'Vencem em até 15 dias', '30': 'Vencem em até 30 dias',
};
export interface VencimentoCarteiraItem {
  documento_id: string; tenant_id: string; empresa: string; titulo: string; categoria: string;
  expires_at: string; dias: number; href: string;
}
export interface VencimentosResposta { itens: VencimentoCarteiraItem[]; total: number }
export const VENCIMENTOS_POR_PAGINA = 100;

// Só caminhos internos do Painel de Atuação viram link (o servidor já garante; aqui é defesa em profundidade).
export function hrefAtuacaoSeguro(href: unknown): string | null {
  return typeof href === 'string' && href.startsWith('/atuacao/') && !href.includes('..') && !/[\\\s]/.test(href) ? href : null;
}


// ---- Checklists por serviço (E3) ----
export type ChecklistServico = 'pgr' | 'ltcat' | 'laudo_insalubridade' | 'laudo_periculosidade' | 'relatorio_inspecao' | 'apr' | 'ordem_servico' | 'outro';
export const CHECKLIST_SERVICOS: readonly ChecklistServico[] = ['pgr', 'ltcat', 'laudo_insalubridade', 'laudo_periculosidade', 'relatorio_inspecao', 'apr', 'ordem_servico', 'outro'];
const CHECKLIST_SERVICO_LABEL: Record<ChecklistServico, string> = {
  pgr: 'PGR', ltcat: 'LTCAT', laudo_insalubridade: 'Laudo de insalubridade', laudo_periculosidade: 'Laudo de periculosidade',
  relatorio_inspecao: 'Relatório de inspeção', apr: 'APR', ordem_servico: 'Ordem de serviço', outro: 'Outro',
};
export function checklistServicoLabel(s: string): string { return CHECKLIST_SERVICO_LABEL[s as ChecklistServico] ?? s; }
export type ChecklistTipo = 'sim_nao_na' | 'texto' | 'numero' | 'data';
export const CHECKLIST_TIPO_LABEL: Record<ChecklistTipo, string> = { sim_nao_na: 'Sim / Não / N.A.', texto: 'Texto', numero: 'Número', data: 'Data' };
export type ChecklistVersaoStatus = 'rascunho' | 'aprovado' | 'substituido';
export const CHECKLIST_STATUS_LABEL: Record<ChecklistVersaoStatus, string> = { rascunho: 'Rascunho', aprovado: 'Aprovado', substituido: 'Substituído' };
export function checklistStatusTone(s: ChecklistVersaoStatus): 'ok' | 'warn' | 'high' { return s === 'aprovado' ? 'ok' : s === 'rascunho' ? 'warn' : 'high'; }
export interface ChecklistModeloResumo {
  id: string; service: ChecklistServico; name: string; versao_aprovada_id: string | null; versao_aprovada: number | null;
  rascunho_id: string | null; ultima_versao: number | null;
}
export interface ChecklistItemModelo {
  id?: string; position?: number; label: string; instruction: string | null; kind: ChecklistTipo; required: boolean; blocks_review: boolean;
}
export interface ChecklistVersao {
  id: string; template_id: string; service: ChecklistServico; name: string; version_number: number; status: ChecklistVersaoStatus;
  change_note: string | null; created_by_name: string | null; approved_by_name: string | null; approved_at: string | null; itens: ChecklistItemModelo[];
}
export interface ChecklistItemResposta extends ChecklistItemModelo {
  id: string; resposta: string | null; resposta_nota: string | null; answered_at: string | null; respondido_por: string | null;
}
export interface ChecklistDoDocumento {
  id: string; template_version_id: string; service: ChecklistServico; name: string; version_number: number; versao_status: ChecklistVersaoStatus;
  itens: ChecklistItemResposta[];
  completude: { total: number; respondidos: number; obrigatorios_pendentes: number; bloqueiam_revisao: number };
}


// ---- Alertas e notificações (E4) ----
export type NotificacaoPrioridade = 'baixa' | 'media' | 'alta';
export interface Notificacao {
  id: string; type: string; priority: NotificacaoPrioridade; title: string; tenant_id: string | null; href: string | null;
  created_at: string; read_at: string | null;
}
export interface ResumoNotificacoes { nao_lidas: number; alta: number }
export function notificacaoTone(p: NotificacaoPrioridade): 'crit' | 'warn' | 'high' { return p === 'alta' ? 'crit' : p === 'media' ? 'warn' : 'high'; }
export const NOTIFICACAO_PRIORIDADE_LABEL: Record<NotificacaoPrioridade, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
export interface RegraAlerta {
  category: string; validity_months: number | null; alert_days: number; notice_days: number[] | null; notice_days_efetivo: number[];
  usa_padrao: boolean; source: string | null; updated_at: string;
}
export type MotivoMudanca = 'funcao' | 'processo' | 'equipamento' | 'risco' | 'estabelecimento' | 'outro';
export const MOTIVO_MUDANCA_LABEL: Record<MotivoMudanca, string> = {
  funcao: 'Mudança de função', processo: 'Mudança de processo', equipamento: 'Novo equipamento', risco: 'Mudança de risco',
  estabelecimento: 'Mudança de estabelecimento', outro: 'Outro motivo',
};
export interface MudancaCondicoes {
  id: string; tenant_id: string; empresa: string; document_id: string | null; category: string | null; reason: MotivoMudanca;
  note: string | null; created_at: string; created_by_name: string | null; resolved_at: string | null; resolved_by_name: string | null;
  resolution_note: string | null;
}
// "60, 30, 15" -> [60, 30, 15]; null quando inválido (0 a 365, sem repetição, de 1 a 8 valores).
export function parseAntecedencias(txt: string): number[] | null {
  const partes = txt.split(/[,\s;]+/).filter(Boolean);
  if (partes.length < 1 || partes.length > 8) return null;
  const nums = partes.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => Number.isNaN(n) || n > 365) || new Set(nums).size !== nums.length) return null;
  return nums.sort((a, b) => b - a);
}
