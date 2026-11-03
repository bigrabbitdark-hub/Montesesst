// Lista FECHADA de permissões do papel `socio`. Não existem (e não devem ser
// criadas) permissões de escrita financeira, cobrança, usuários ou configurações.
export const PERMISSIONS = [
  'clients.read',
  'clients.update_operational',
  'tasks.read',
  'tasks.write',
  'appointments.manage',
  'documents.create_draft',
  'documents.review',
  'documents.sign',
  'documents.read',
  'documents.approve',
  'documents.publish',
  'documents.cancel',
  'documents.view_registration',
  'finance.read',
  'empresas.read',
  'empresas.documentos',
  'pgr.read',
  'pgr.write',
  'checklists.read',
  'checklists.write',
  'checklists.approve',
  'alertas.read',
  'alertas.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
