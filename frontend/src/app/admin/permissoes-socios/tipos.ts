// Formatos reais da API admin de permissões (backend/src/atuacao/permissoes/*).
export const BASE_PERMISSOES = '/api/atuacao/admin/permissoes';

export interface ItemCatalogo { permissao: string; rotulo: string; descricao: string; sensivel: boolean }
export interface GrupoCatalogo { id: string; titulo: string; itens: ItemCatalogo[] }
export interface SocioPermissoes { id: string; nome: string; permissoes: string[]; ativo: boolean }
export interface RespostaPermissoes { catalogo: { grupos: GrupoCatalogo[] }; socios: SocioPermissoes[] }

export const TEXTO_SENSIVEL = 'Sensível — depende de competência profissional';
export const TEXTO_OBRIGATORIO =
  'Estas permissões autorizam ações técnicas sobre documentos. Isto não comprova competência profissional; a matriz de responsabilidades por tipo de documento continua obrigatória e vale por si só.';
