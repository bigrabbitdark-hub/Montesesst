// Regras puras do fluxo de documentos (spec Fase 5, §4). Sem I/O.
// A tabela de transições deve ser idêntica ao trigger guard_document_drafts_update (migration 0096).

export const DOC_STATUS = ['em_elaboracao', 'em_revisao', 'aprovado', 'assinado', 'publicado', 'cancelado'] as const;
export type DocStatus = (typeof DOC_STATUS)[number];

export const DOC_ACOES = ['elaborar', 'revisar', 'aprovar', 'assinar', 'publicar'] as const;
export type DocAcao = (typeof DOC_ACOES)[number];

export const AVISO_ASSINATURA_INTERNA =
  'Registro de assinatura interna do sistema. Não é certificado digital ICP-Brasil e não garante, por si só, validade jurídica em todos os casos.';

export const MSG_ACAO_NAO_HABILITADA =
  'Ação não habilitada para este tipo de documento. Peça ao administrador para configurar as responsabilidades.';

const MSG_REGISTRO = 'Registro profissional não confirmado.';
const MSG_SEPARACAO = 'Quem elaborou o documento não pode revisá-lo nem aprová-lo.';
const MSG_ESTADO = 'Ação não permitida no estado atual do documento.';
const MSG_NOVA_VERSAO = 'Documento publicado ou cancelado não aceita nova versão.';

const TRANSICOES: Record<DocStatus, readonly DocStatus[]> = {
  em_elaboracao: ['em_revisao', 'cancelado'],
  em_revisao: ['aprovado', 'em_elaboracao', 'cancelado'],
  aprovado: ['assinado', 'em_elaboracao', 'cancelado'],
  assinado: ['publicado', 'em_elaboracao', 'cancelado'],
  publicado: [],
  cancelado: [],
};

export function transicaoDocPermitida(de: DocStatus, para: DocStatus): boolean {
  return (TRANSICOES[de] ?? []).includes(para);
}

const ESTADOS_DA_ACAO: Record<DocAcao, readonly DocStatus[]> = {
  elaborar: ['em_elaboracao', 'em_revisao', 'aprovado', 'assinado'],
  revisar: ['em_revisao'],
  aprovar: ['em_revisao'],
  assinar: ['aprovado'],
  publicar: ['assinado'],
};

// Separação de funções. DECIDIDO pelo proprietário em 2026-11-01: a engenheira sócia (Évelyn) é a profissional
// responsável e elabora, revisa, aprova, assina e executa; com a equipe de uma pessoa a separação ficaria inviável.
// Os bloqueios continuam implementados (basta voltar a true); a rastreabilidade segue nos eventos e versões.
// Elaboradores = criador do rascunho + autores de QUALQUER versão + quem enviou à revisão (evento 'submitted').
// NÃO há (por decisão pendente) aprovador≠signatário nem signatário≠publicador.
export const SEPARACAO_PADRAO = { revisorDiferenteDoElaborador: false, aprovadorDiferenteDoElaborador: false } as const;

export const SEPARACAO_ESTRITA = { revisorDiferenteDoElaborador: true, aprovadorDiferenteDoElaborador: true } as const;

export type AvaliacaoAcao =
  | { ok: true }
  | { ok: false; codigo: 'MATRIZ' | 'ESTADO' | 'SEPARACAO' | 'REGISTRO'; mensagem: string };

export function avaliarAcao(input: {
  acao: DocAcao;
  draftStatus: DocStatus;
  elaboradoresIds: readonly string[];
  usuarioId: string;
  temPermissaoMatriz: boolean;
  registroConfirmado?: boolean;
  separacao?: { revisorDiferenteDoElaborador: boolean; aprovadorDiferenteDoElaborador: boolean };
}): AvaliacaoAcao {
  const { acao, draftStatus, elaboradoresIds, usuarioId, temPermissaoMatriz, registroConfirmado } = input;
  const sep = input.separacao ?? SEPARACAO_PADRAO;
  if (!ESTADOS_DA_ACAO[acao]?.includes(draftStatus)) return { ok: false, codigo: 'ESTADO', mensagem: MSG_ESTADO };
  if (!temPermissaoMatriz) return { ok: false, codigo: 'MATRIZ', mensagem: MSG_ACAO_NAO_HABILITADA };
  const elaborador = elaboradoresIds.includes(usuarioId);
  if (
    (acao === 'revisar' && sep.revisorDiferenteDoElaborador && elaborador) ||
    (acao === 'aprovar' && sep.aprovadorDiferenteDoElaborador && elaborador)
  ) {
    return { ok: false, codigo: 'SEPARACAO', mensagem: MSG_SEPARACAO };
  }
  if (acao === 'assinar' && registroConfirmado !== true) {
    return { ok: false, codigo: 'REGISTRO', mensagem: MSG_REGISTRO };
  }
  return { ok: true };
}

/**
 * Cancelamento (regra conservadora): quem só elabora não destrói aprovação/assinatura de outra pessoa.
 * em_elaboracao/em_revisao: elaborar; aprovado: elaborar E aprovar; assinado: elaborar E assinar.
 * publicado/cancelado são terminais (ESTADO). Sem separação de funções nem registro profissional.
 */
const CANCELAR_EXIGE: Partial<Record<DocStatus, readonly DocAcao[]>> = {
  em_elaboracao: ['elaborar'],
  em_revisao: ['elaborar'],
  aprovado: ['elaborar', 'aprovar'],
  assinado: ['elaborar', 'assinar'],
};

export function avaliarCancelamento(input: { draftStatus: DocStatus; matriz: ReadonlySet<string> }): AvaliacaoAcao {
  const exige = CANCELAR_EXIGE[input.draftStatus];
  if (!exige) return { ok: false, codigo: 'ESTADO', mensagem: MSG_ESTADO };
  if (!exige.every((a) => input.matriz.has(a))) return { ok: false, codigo: 'MATRIZ', mensagem: MSG_ACAO_NAO_HABILITADA };
  return { ok: true };
}

/** Nova versão invalida revisão/aprovação/assinatura e devolve a em_elaboracao; terminais rejeitam. */
export function estadoAposNovaVersao(status: DocStatus): DocStatus {
  if (status === 'publicado' || status === 'cancelado') throw new Error(MSG_NOVA_VERSAO);
  return 'em_elaboracao';
}

export type StatusViabilidade = 'viavel' | 'inviavel' | 'nao_configurada';

/**
 * Viabilidade informativa de uma categoria (espelha o servidor): existem pessoas para elaborar (E),
 * aprovar (A), assinar (S, com registro profissional confirmado) e publicar (P), e ao menos um par
 * e∈E, a∈A com a≠e quando o aprovador não pode ser o elaborador. Sem nenhuma ação na matriz =>
 * 'nao_configurada'. Aviso (não impede): sem revisor diferente de algum elaborador, "devolver" fica indisponível.
 */
export function avaliarViabilidade(input: {
  matriz: readonly { userId: string; acoes: readonly DocAcao[] }[];
  registrosConfirmados: ReadonlySet<string>;
  separacao: { revisorDiferenteDoElaborador: boolean; aprovadorDiferenteDoElaborador: boolean };
}): { status: StatusViabilidade; faltas: string[]; avisos: string[] } {
  const quem = (a: DocAcao) => input.matriz.filter((m) => m.acoes.includes(a)).map((m) => m.userId);
  if (!input.matriz.some((m) => m.acoes.length > 0)) return { status: 'nao_configurada', faltas: [], avisos: [] };
  const E = quem('elaborar'), R = quem('revisar'), A = quem('aprovar'), S = quem('assinar'), P = quem('publicar');
  const faltas: string[] = [];
  const avisos: string[] = [];
  if (!E.length) faltas.push('Ninguém habilitado a elaborar.');
  if (!A.length) faltas.push('Ninguém habilitado a aprovar.');
  if (!S.length) faltas.push('Ninguém habilitado a assinar.');
  else if (!S.some((u) => input.registrosConfirmados.has(u))) faltas.push('Ninguém habilitado a assinar com registro profissional confirmado.');
  if (!P.length) faltas.push('Ninguém habilitado a publicar.');
  if (E.length && A.length && input.separacao.aprovadorDiferenteDoElaborador && !A.some((a) => E.some((e) => e !== a))) {
    faltas.push('O único aprovador é também o único elaborador, e o aprovador não pode ser o elaborador.');
  }
  if (E.length && input.separacao.revisorDiferenteDoElaborador && !R.some((r) => E.some((e) => e !== r))) {
    avisos.push('Ninguém além do elaborador pode revisar: "devolver à elaboração" ficará indisponível.');
  }
  return { status: faltas.length ? 'inviavel' : 'viavel', faltas, avisos };
}
