-- Relatório de Visita Técnica (Task 3): `documents.category` tem um CHECK
-- constraint no banco além do array ALLOWED_CATEGORIES em
-- documents.service.ts (achado real rodando a suíte e2e desta task —
-- InspectionsService.conclude() tentava indexar o PDF com a categoria
-- 'relatorio_visita' e o INSERT falhava com
-- "violates check constraint documents_category_check", mesmo com a
-- categoria já liberada no código TypeScript). Mesmo padrão exato da
-- 0032 (extensão do CHECK pra LTCAT/LIP).
ALTER TABLE documents DROP CONSTRAINT documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check CHECK (
  category IN ('pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento',
               'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo',
               'ltcat', 'lip',
               'relatorio_visita')
);
