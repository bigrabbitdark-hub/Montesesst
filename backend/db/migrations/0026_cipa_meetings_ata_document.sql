-- Fase 12a (revisão final): approveAta gera um `documents` novo
-- (category='cipa_ata') mas não guardava nenhum link de volta pra
-- reunião — a única forma de achar a ata de uma reunião era casar por
-- texto de `title`, e reabrir+reaprovar produzia dois documentos
-- cipa_ata indistinguíveis pra mesma reunião. ON DELETE SET NULL (não
-- CASCADE): apagar o documents não deveria arrastar a reunião junto —
-- mesmo raciocínio de outras FKs opcionais deste módulo
-- (cipa_pendencias.meeting_id, cipa_meeting_participants.cipa_member_id).
ALTER TABLE cipa_meetings ADD COLUMN ata_document_id UUID REFERENCES documents(id) ON DELETE SET NULL;
