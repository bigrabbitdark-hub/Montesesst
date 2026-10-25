import type { Permission } from '../../common/permissions';

export type ItemCatalogo = { permissao: Permission; rotulo: string; descricao: string; sensivel: boolean };
export type GrupoCatalogo = { id: string; titulo: string; itens: ItemCatalogo[] };

const i = (permissao: Permission, rotulo: string, descricao: string, sensivel = false): ItemCatalogo => ({ permissao, rotulo, descricao, sensivel });

// Catálogo de exibição das permissões RBAC dos sócios. Deve cobrir EXATAMENTE `PERMISSIONS`
// (garantido por teste unit). Nenhuma permissão nova nasce aqui.
export const CATALOGO_PERMISSOES: GrupoCatalogo[] = [
  { id: 'clientes', titulo: 'Clientes', itens: [
    i('clients.read', 'Ver clientes', 'Consulta a carteira de empresas clientes e seus dados operacionais.'),
    i('clients.update_operational', 'Atualizar dados operacionais do cliente', 'Altera dados operacionais do cliente (setor, contato, observações) e registra reuniões e contatos no histórico. Não altera cadastro, plano ou cobrança.'),
  ] },
  { id: 'tarefas-agenda', titulo: 'Tarefas e agenda', itens: [
    i('tasks.read', 'Ver tarefas', 'Consulta tarefas e o resumo de tarefas.'),
    i('tasks.write', 'Criar e editar tarefas', 'Cria, edita e muda o andamento de tarefas.'),
    i('appointments.manage', 'Gerenciar agenda', 'Consulta e gerencia a agenda interna: criar, remarcar, concluir e cancelar compromissos (reuniões, visitas, ligações).'),
  ] },
  { id: 'financeiro', titulo: 'Financeiro', itens: [
    i('finance.read', 'Ver financeiro (somente leitura)', 'Consulta indicadores financeiros; não permite alterar valores, planos ou cobrança.'),
  ] },
  { id: 'documentos', titulo: 'Documentos', itens: [
    i('documents.read', 'Ver documentos', 'Consulta documentos e rascunhos e baixa as versões do arquivo.'),
    i('documents.create_draft', 'Elaborar rascunhos', 'Cria rascunhos, envia novas versões do arquivo e envia o rascunho para revisão.'),
    i('documents.review', 'Revisar documentos', 'Devolve o rascunho para correção, com justificativa (revisão técnica).', true),
    i('documents.approve', 'Aprovar documentos', 'Aprova o documento que está em revisão.', true),
    i('documents.sign', 'Assinar documentos (interno)', 'Registra a assinatura interna do documento na plataforma.', true),
    i('documents.publish', 'Publicar documentos', 'Publica o documento para a empresa cliente.', true),
    i('documents.cancel', 'Cancelar documentos', 'Cancela documentos em andamento.', true),
    i('documents.view_registration', 'Ver registro profissional', 'Acessa o registro em conselho profissional de outros usuários.', true),
  ] },
];

export const PERMISSOES_SENSIVEIS: readonly string[] = CATALOGO_PERMISSOES.flatMap((g) => g.itens).filter((x) => x.sensivel).map((x) => x.permissao);
export const ORDEM_PERMISSOES: readonly string[] = CATALOGO_PERMISSOES.flatMap((g) => g.itens).map((x) => x.permissao);
