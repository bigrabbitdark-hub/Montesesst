-- Onboarding guiado (2026-08-28): upload de documento passa a pedir se é
-- da matriz ou de uma filial específica. Nullable e ON DELETE SET NULL
-- de propósito: documentos enviados antes desta migration continuam
-- válidos sem essa informação (aparecem como "não especificado"), e
-- apagar uma filial nunca apaga documento nenhum, só desvincula.
ALTER TABLE documents
  ADD COLUMN company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL;
