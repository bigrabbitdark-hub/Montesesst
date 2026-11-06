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
  { id: 'empresas', titulo: 'Atuação por empresa', itens: [
    i('empresas.read', 'Atender empresas clientes', 'Escolher uma empresa cliente e consultar visão geral, documentos, vencimentos, funcionários (sem CPF) e EPI. Requer também \'Ver clientes\' (clients.read) para escolher a empresa.'),
    i('empresas.documentos', 'Ajustar vigência de documentos', 'Corrigir início e vencimento dos documentos de uma empresa cliente. Não envia nem apaga arquivos. Só tem efeito junto com \'Atender empresas clientes\' (empresas.read).'),
    i('empresas.criar', 'Cadastrar empresas clientes', 'Cadastrar uma nova empresa cliente em nome do cliente, com a senha temporária de primeiro acesso.', true),
    i('empresas.atuar', 'Atuar como a empresa', 'Entrar no painel de uma empresa cliente e operar como ela, com registro de auditoria.', true),
  ] },
  { id: 'pgr', titulo: 'PGR — Programa de Gerenciamento de Riscos', itens: [
    i('pgr.read', 'Consultar o PGR', 'Biblioteca, GHEs e inventário de riscos das empresas clientes. Requer também \'Ver clientes\' (clients.read) e \'Atender empresas clientes\' (empresas.read).'),
    i('pgr.write', 'Elaborar o PGR', 'Criar e editar GHEs, riscos, controles e medições, e perigos personalizados. Só tem efeito junto com \'Consultar o PGR\' (pgr.read).'),
  ] },
  { id: 'checklists', titulo: 'Checklists por serviço', itens: [
    i('checklists.read', 'Consultar checklists', 'Ver os modelos de checklist e os checklists dos documentos. Requer também \'Ver documentos\' (documents.read).'),
    i('checklists.write', 'Preencher checklists', 'Aplicar um modelo aprovado a um documento e registrar as respostas. Só tem efeito junto com \'Consultar checklists\' (checklists.read).'),
    i('checklists.approve', 'Criar e aprovar modelos de checklist', 'Cria e edita modelos em rascunho e os aprova para uso. Modelo aprovado não pode ser alterado; só substituído por nova versão.', true),
  ] },
  { id: 'alertas', titulo: 'Alertas e notificações', itens: [
    i('alertas.read', 'Receber e consultar alertas', 'Recebe as notificações internas (vencimentos, atrasos, revisões por mudança) e consulta as regras de antecedência.'),
    i('alertas.manage', 'Gerenciar alertas', 'Ajusta as antecedências de alerta por tipo de documento e registra revisões por mudança nas condições de trabalho. Não altera os meses de validade.', true),
  ] },
];

export const PERMISSOES_SENSIVEIS: readonly string[] = CATALOGO_PERMISSOES.flatMap((g) => g.itens).filter((x) => x.sensivel).map((x) => x.permissao);
export const ORDEM_PERMISSOES: readonly string[] = CATALOGO_PERMISSOES.flatMap((g) => g.itens).map((x) => x.permissao);
