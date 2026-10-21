// Formatos reais da API admin de documentos (backend/src/atuacao/documentos/documentos-admin.*).
export const BASE_DOCUMENTOS = '/api/atuacao/admin/documentos';

export const DOC_ACOES = ['elaborar', 'revisar', 'aprovar', 'assinar', 'publicar'] as const;
export type DocAcao = (typeof DOC_ACOES)[number];

export const ACAO_LABEL: Record<DocAcao, string> = {
  elaborar: 'Elaborar', revisar: 'Revisar', aprovar: 'Aprovar', assinar: 'Assinar', publicar: 'Publicar',
};

export interface Socio { id: string; nome: string }

export type StatusViabilidade = 'viavel' | 'inviavel' | 'nao_configurada';
export interface Habilitados {
  acao: DocAcao;
  pessoas: { id: string; nome: string; registro_confirmado?: boolean }[];
}
export interface Viabilidade {
  category: string;
  status: StatusViabilidade;
  faltas: string[];
  avisos: string[];
  habilitados: Habilitados[];
}

export interface LinhaMatriz { category: string; user_id: string; nome: string | null; acoes: DocAcao[] }

export type StatusRegistro = 'pendente' | 'confirmado' | 'revogado';
export interface Registro {
  id: string; user_id: string; nome: string | null; council: string; registration_number: string; uf: string;
  status: StatusRegistro; confirmed_at: string | null; revoked_at: string | null;
}

export const TEXTO_MATRIZ =
  'Habilitar uma ação autoriza esta pessoa a executá-la neste tipo de documento. Isto não comprova competência profissional; confirme com o responsável técnico.';
export const TEXTO_CONFIRMAR =
  'Confirme que o conselho, o número e a UF foram conferidos em fonte oficial do conselho profissional.';
export const TEXTO_REVOGAR =
  'A revogação impede novas assinaturas com este registro. Assinaturas já registradas permanecem no histórico.';
export const AVISO_COMPETENCIA = 'A habilitação não comprova competência profissional.';
