-- Fase 18 — Documentos Técnicos (LTCAT/LIP): segunda metade do item
-- original do roadmap ("Consulta de CA, Documentos Técnicos
-- (LTCAT/LIP)"), separada em frente própria pela spec da Fase 17.
-- Duas categorias novas em `documents`, reaproveitando o módulo já
-- existente — mesmo padrão da 0023 (categorias `cipa_*`), sem tabela
-- nova, sem regra de validade especial (score/pendências já tratam
-- `expires_at` igual pra qualquer categoria).
ALTER TABLE documents DROP CONSTRAINT documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check CHECK (
  category IN ('pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento',
               'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo',
               'ltcat', 'lip')
);
