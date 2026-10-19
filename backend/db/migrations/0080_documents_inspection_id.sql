-- Etapa 1 do Relatório de Visita Técnica — vínculo opcional entre
-- documents (categoria 'relatorio_visita') e a inspeção de origem.
-- Aditiva, sem mudança destrutiva: nullable + ON DELETE SET NULL
-- garante que apagar uma inspeção não apaga o PDF já gerado/
-- armazenado (preserva histórico e integridade do R2).
--
-- Contexto: InspectionsService.conclude() já gera o PDF e o envia
-- para DocumentsService.upload(), mas sem nenhum FK — o PDF ficava
-- órfão. Esta migration + o ajuste de 1 linha em conclude() (passando
-- inspectionId) ligam o laço sem alterar contrato nem comportamento
-- existente. PDFs auto-gerados antes desta migration ficam com
-- inspection_id = NULL (preserva histórico; sem backfill especulativo,
-- ver Etapa 1 / item 5 do plano — não há associação confiável).
--
-- Validação de mesmo tenant: a FK no banco só garante que o id existe
-- em inspections (em qualquer tenant). A checagem "documents.tenant_id
-- == inspections.tenant_id" fica no DocumentsService.upload (mesmo
-- padrão do companyUnitId, ver documents.service.ts) — defense in
-- depth, independente da RLS.
--
-- RLS: a policy de `documents` (0008) já isola por tenant_id e cobre
-- admin e técnicos vinculados via EXISTS contra tenant_technicians.
-- Nenhuma alteração de policy é necessária para esta coluna nova.
ALTER TABLE documents
  ADD COLUMN inspection_id UUID
  REFERENCES inspections(id) ON DELETE SET NULL;

-- Índice parcial: a esmagadora maioria dos documentos NÃO é de
-- visita (PGR/PCMSO/LTCAT/LIP/Laudo/etc.) e não tem inspection_id.
-- Indexar só os preenchidos mantém o índice pequeno e útil pra
-- "listar anexos desta inspeção" e "contar anexos desta inspeção".
CREATE INDEX documents_inspection_id_idx
  ON documents (inspection_id)
  WHERE inspection_id IS NOT NULL;
