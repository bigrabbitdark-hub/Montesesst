-- Fase 6 (sub-projeto C — Catálogo de EPI): catálogo de referência fixo
-- (93 itens do Anexo I da NR-06, semeados aqui), cadastro real de EPI
-- por empresa (CA + validade), e vínculo funcionário↔EPI. RLS de
-- tenant_epis/employee_epi_deliveries usa a função helper que já
-- unifica tenant_technicians+tenant_partners desde a Fase 1. Ver
-- docs/specs/fase-6-catalogo-epi.md.

CREATE TABLE epi_catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I')),
  code TEXT NOT NULL,
  equipment_group TEXT NOT NULL,
  description TEXT NOT NULL,
  risk_protected TEXT NOT NULL,
  related_nr TEXT,
  legal_basis TEXT NOT NULL DEFAULT 'NR-06, Anexo I',
  UNIQUE (code, description)
);

INSERT INTO epi_catalog_items (category, code, equipment_group, description, risk_protected, related_nr) VALUES
  ('A', 'A.1', 'Capacete', 'Capacete para proteção contra impactos de objetos sobre o crânio', 'Impacto de objetos sobre o crânio', 'NR-18, NR-12'),
  ('A', 'A.1', 'Capacete', 'Capacete para proteção do crânio e face contra agentes térmicos', 'Agentes térmicos (calor/frio)', 'NR-18'),
  ('A', 'A.1', 'Capacete', 'Capacete para proteção contra choques elétricos', 'Choque elétrico', 'NR-10'),
  ('A', 'A.2', 'Capuz ou balaclava', 'Capuz para proteção do crânio e pescoço contra agentes térmicos', 'Agentes térmicos', 'NR-18'),
  ('A', 'A.2', 'Capuz ou balaclava', 'Capuz para proteção do crânio, face e pescoço contra agentes químicos', 'Agentes químicos', 'NR-20, NR-25'),
  ('A', 'A.2', 'Capuz ou balaclava', 'Capuz para proteção do crânio e pescoço contra agentes abrasivos e escoriantes', 'Agentes abrasivos e escoriantes', 'NR-18'),
  ('A', 'A.2', 'Capuz ou balaclava', 'Capuz para proteção do crânio e pescoço contra umidade (operações com água)', 'Umidade por operações com água', 'NR-18'),
  ('B', 'B.1', 'Óculos', 'Óculos para proteção dos olhos contra impactos de partículas volantes', 'Impacto de partículas volantes', 'NR-18, NR-12'),
  ('B', 'B.1', 'Óculos', 'Óculos para proteção dos olhos contra luminosidade intensa', 'Luminosidade intensa', 'NR-18'),
  ('B', 'B.1', 'Óculos', 'Óculos para proteção dos olhos contra radiação ultravioleta', 'Radiação ultravioleta', 'NR-18'),
  ('B', 'B.1', 'Óculos', 'Óculos para proteção dos olhos contra radiação infravermelha', 'Radiação infravermelha', 'NR-18'),
  ('B', 'B.1', 'Óculos', 'Óculos de tela para proteção limitada contra impactos de partículas volantes', 'Impacto de partículas volantes (proteção limitada)', 'NR-18'),
  ('B', 'B.2', 'Protetor facial', 'Protetor facial contra impactos de partículas volantes', 'Impacto de partículas volantes', 'NR-18, NR-12'),
  ('B', 'B.2', 'Protetor facial', 'Protetor facial contra luminosidade intensa', 'Luminosidade intensa', 'NR-18'),
  ('B', 'B.2', 'Protetor facial', 'Protetor facial contra radiação infravermelha', 'Radiação infravermelha', 'NR-18'),
  ('B', 'B.2', 'Protetor facial', 'Protetor facial contra radiação ultravioleta', 'Radiação ultravioleta', 'NR-18'),
  ('B', 'B.2', 'Protetor facial', 'Protetor facial contra agentes térmicos', 'Agentes térmicos', 'NR-18'),
  ('B', 'B.3', 'Máscara de solda', 'Máscara de solda contra impactos, radiação UV, radiação IV e luminosidade intensa', 'Impacto, radiação UV/IV e luminosidade intensa (solda)', 'NR-18'),
  ('C', 'C.1', 'Protetor auditivo', 'Protetor auditivo circum-auricular', 'Pressão sonora acima do limite (NR-15, Anexos 1 e 2)', 'NR-15'),
  ('C', 'C.1', 'Protetor auditivo', 'Protetor auditivo de inserção', 'Pressão sonora acima do limite (NR-15, Anexos 1 e 2)', 'NR-15'),
  ('C', 'C.1', 'Protetor auditivo', 'Protetor auditivo semiauricular', 'Pressão sonora acima do limite (NR-15, Anexos 1 e 2)', 'NR-15'),
  ('D', 'D.1', 'Respirador purificador de ar não motorizado', 'Peça semifacial filtrante PFF1', 'Poeiras e névoas', 'NR-15, NR-18'),
  ('D', 'D.1', 'Respirador purificador de ar não motorizado', 'Peça semifacial filtrante PFF2', 'Poeiras, névoas e fumos', 'NR-15, NR-18'),
  ('D', 'D.1', 'Respirador purificador de ar não motorizado', 'Peça semifacial filtrante PFF3', 'Poeiras, névoas, fumos e radionuclídeos', 'NR-15, NR-18'),
  ('D', 'D.1', 'Respirador purificador de ar não motorizado', 'Peça 1/4 facial, semifacial ou facial inteira com filtros para partículas (P1/P2/P3)', 'Poeiras / névoas e fumos / poeiras, fumos e radionuclídeos (conforme classe)', 'NR-15, NR-18'),
  ('D', 'D.1', 'Respirador purificador de ar não motorizado', 'Peça 1/4 facial, semifacial ou facial inteira com filtros químicos ou combinados', 'Gases e vapores e/ou material particulado', 'NR-15, NR-20'),
  ('D', 'D.2', 'Respirador purificador de ar motorizado', 'Sem vedação facial (touca, protetor facial, capuz ou capacete) com filtros para partículas, químicos ou combinados', 'Material particulado e/ou gases e vapores', 'NR-15, NR-33'),
  ('D', 'D.2', 'Respirador purificador de ar motorizado', 'Com vedação facial (semifacial ou facial inteira) com filtros para partículas, químicos ou combinados', 'Material particulado e/ou gases e vapores', 'NR-15, NR-33'),
  ('D', 'D.3', 'Respirador de adução de ar (linha de ar comprimido)', 'Sem vedação facial, fluxo contínuo (capuz, protetor facial ou capacete) — O2 > 12,5% ao nível do mar', 'Atmosferas com O2 acima de 12,5%', 'NR-33'),
  ('D', 'D.3', 'Respirador de adução de ar (linha de ar comprimido)', 'Sem vedação facial, fluxo contínuo (capuz ou capacete), para jateamento — O2 > 12,5%', 'Operações de jateamento em atmosferas com O2 acima de 12,5%', 'NR-33, NR-34'),
  ('D', 'D.3', 'Respirador de adução de ar (linha de ar comprimido)', 'Com vedação facial, fluxo contínuo (semifacial ou facial inteira) — O2 > 12,5%', 'Atmosferas com O2 acima de 12,5%', 'NR-33'),
  ('D', 'D.3', 'Respirador de adução de ar (linha de ar comprimido)', 'De demanda, com ou sem pressão positiva (semifacial ou facial inteira) — O2 > 12,5%', 'Atmosferas com O2 acima de 12,5%', 'NR-33'),
  ('D', 'D.3', 'Respirador de adução de ar (linha de ar comprimido)', 'De demanda com pressão positiva, facial inteira + cilindro auxiliar de fuga', 'Atmosferas Imediatamente Perigosas à Vida e à Saúde (IPVS)', 'NR-33'),
  ('D', 'D.4', 'Respirador de adução de ar (máscara autônoma)', 'Circuito aberto, demanda com pressão positiva, facial inteira', 'Atmosferas IPVS', 'NR-33'),
  ('D', 'D.4', 'Respirador de adução de ar (máscara autônoma)', 'Circuito fechado, demanda com pressão positiva, facial inteira', 'Atmosferas IPVS', 'NR-33'),
  ('D', 'D.5', 'Respirador de fuga', 'Tipo purificador de ar por fuga (bocal e pinça nasal, capuz ou peça facial)', 'Gases/vapores ou material particulado — escape com O2 acima de 18%', 'NR-33'),
  ('D', 'D.5', 'Respirador de fuga', 'Tipo máscara autônoma para fuga (bocal e pinça nasal, capuz ou facial inteira)', 'Escape de atmosferas IPVS', 'NR-33'),
  ('E', 'E.1', 'Vestimentas', 'Vestimenta para proteção do tronco contra agentes térmicos', 'Agentes térmicos', 'NR-18'),
  ('E', 'E.1', 'Vestimentas', 'Vestimenta para proteção do tronco contra agentes mecânicos', 'Agentes mecânicos', 'NR-18'),
  ('E', 'E.1', 'Vestimentas', 'Vestimenta para proteção do tronco contra agentes químicos', 'Agentes químicos', 'NR-20, NR-25'),
  ('E', 'E.1', 'Vestimentas', 'Vestimenta para proteção do tronco contra radiação ionizante', 'Radiação ionizante', 'NR-32'),
  ('E', 'E.1', 'Vestimentas', 'Vestimenta para proteção do tronco contra umidade (precipitação pluviométrica)', 'Umidade por chuva', NULL),
  ('E', 'E.1', 'Vestimentas', 'Vestimenta para proteção do tronco contra umidade (operações com água)', 'Umidade por operações com água', NULL),
  ('E', 'E.2', 'Colete à prova de balas', 'Colete à prova de balas (uso permitido para vigilantes armados)', 'Agentes mecânicos (arma de fogo)', NULL),
  ('F', 'F.1', 'Luvas', 'Luvas contra agentes abrasivos e escoriantes', 'Agentes abrasivos e escoriantes', 'NR-18'),
  ('F', 'F.1', 'Luvas', 'Luvas contra agentes cortantes e perfurantes', 'Agentes cortantes e perfurantes', 'NR-18'),
  ('F', 'F.1', 'Luvas', 'Luvas contra choques elétricos', 'Choque elétrico', 'NR-10'),
  ('F', 'F.1', 'Luvas', 'Luvas contra agentes térmicos', 'Agentes térmicos', 'NR-18'),
  ('F', 'F.1', 'Luvas', 'Luvas contra agentes biológicos', 'Agentes biológicos', 'NR-32'),
  ('F', 'F.1', 'Luvas', 'Luvas contra agentes químicos', 'Agentes químicos', 'NR-20, NR-25'),
  ('F', 'F.1', 'Luvas', 'Luvas contra vibrações', 'Vibrações', 'NR-15, NR-09'),
  ('F', 'F.1', 'Luvas', 'Luvas contra umidade (operações com água)', 'Umidade por operações com água', NULL),
  ('F', 'F.1', 'Luvas', 'Luvas contra radiação ionizante', 'Radiação ionizante', 'NR-32'),
  ('F', 'F.2', 'Creme protetor', 'Creme protetor de segurança para membros superiores', 'Agentes químicos', 'NR-20, NR-25'),
  ('F', 'F.3', 'Manga', 'Manga contra choques elétricos (braço/antebraço)', 'Choque elétrico', 'NR-10'),
  ('F', 'F.3', 'Manga', 'Manga contra agentes abrasivos e escoriantes (braço/antebraço)', 'Agentes abrasivos e escoriantes', 'NR-18'),
  ('F', 'F.3', 'Manga', 'Manga contra agentes cortantes e perfurantes (braço/antebraço)', 'Agentes cortantes e perfurantes', 'NR-18'),
  ('F', 'F.3', 'Manga', 'Manga contra umidade — operações com água (braço/antebraço)', 'Umidade por operações com água', NULL),
  ('F', 'F.3', 'Manga', 'Manga contra agentes térmicos (braço/antebraço)', 'Agentes térmicos', 'NR-18'),
  ('F', 'F.3', 'Manga', 'Manga contra agentes químicos (braço/antebraço)', 'Agentes químicos', 'NR-20, NR-25'),
  ('F', 'F.4', 'Braçadeira', 'Braçadeira contra agentes cortantes (antebraço)', 'Agentes cortantes', 'NR-18'),
  ('F', 'F.4', 'Braçadeira', 'Braçadeira contra agentes escoriantes (antebraço)', 'Agentes escoriantes', 'NR-18'),
  ('F', 'F.5', 'Dedeira', 'Dedeira contra agentes abrasivos e escoriantes', 'Agentes abrasivos e escoriantes', 'NR-18'),
  ('G', 'G.1', 'Calçado', 'Calçado contra impacto de queda de objetos sobre os artelhos', 'Impacto de objetos sobre os pés', 'NR-18, NR-12'),
  ('G', 'G.1', 'Calçado', 'Calçado contra choques elétricos', 'Choque elétrico', 'NR-10'),
  ('G', 'G.1', 'Calçado', 'Calçado contra agentes térmicos', 'Agentes térmicos', 'NR-18'),
  ('G', 'G.1', 'Calçado', 'Calçado contra agentes abrasivos e escoriantes', 'Agentes abrasivos e escoriantes', 'NR-18'),
  ('G', 'G.1', 'Calçado', 'Calçado contra agentes cortantes e perfurantes', 'Agentes cortantes e perfurantes', 'NR-18'),
  ('G', 'G.1', 'Calçado', 'Calçado contra umidade — operações com água (pés e pernas)', 'Umidade por operações com água', NULL),
  ('G', 'G.1', 'Calçado', 'Calçado contra agentes químicos (pés e pernas)', 'Agentes químicos', 'NR-20, NR-25'),
  ('G', 'G.2', 'Meia', 'Meia para proteção dos pés contra baixas temperaturas', 'Baixas temperaturas', NULL),
  ('G', 'G.3', 'Perneira', 'Perneira contra agentes abrasivos e escoriantes (perna)', 'Agentes abrasivos e escoriantes', 'NR-18'),
  ('G', 'G.3', 'Perneira', 'Perneira contra agentes cortantes e perfurantes (perna)', 'Agentes cortantes e perfurantes', 'NR-18'),
  ('G', 'G.3', 'Perneira', 'Perneira contra agentes térmicos (perna)', 'Agentes térmicos', 'NR-18'),
  ('G', 'G.3', 'Perneira', 'Perneira contra agentes químicos (perna)', 'Agentes químicos', 'NR-20, NR-25'),
  ('G', 'G.3', 'Perneira', 'Perneira contra umidade — operações com água (perna)', 'Umidade por operações com água', NULL),
  ('G', 'G.4', 'Calça', 'Calça contra agentes abrasivos e escoriantes (pernas)', 'Agentes abrasivos e escoriantes', 'NR-18'),
  ('G', 'G.4', 'Calça', 'Calça contra agentes cortantes e perfurantes (pernas)', 'Agentes cortantes e perfurantes', 'NR-18'),
  ('G', 'G.4', 'Calça', 'Calça contra agentes químicos (pernas)', 'Agentes químicos', 'NR-20, NR-25'),
  ('G', 'G.4', 'Calça', 'Calça contra agentes térmicos (pernas)', 'Agentes térmicos', 'NR-18'),
  ('G', 'G.4', 'Calça', 'Calça contra umidade — operações com água (pernas)', 'Umidade por operações com água', NULL),
  ('G', 'G.4', 'Calça', 'Calça contra umidade (precipitação pluviométrica) (pernas)', 'Umidade por chuva', NULL),
  ('H', 'H.1', 'Macacão', 'Macacão contra agentes térmicos (tronco e membros)', 'Agentes térmicos', 'NR-18'),
  ('H', 'H.1', 'Macacão', 'Macacão contra agentes químicos (tronco e membros)', 'Agentes químicos', 'NR-20, NR-25'),
  ('H', 'H.1', 'Macacão', 'Macacão contra umidade — operações com água (tronco e membros)', 'Umidade por operações com água', NULL),
  ('H', 'H.1', 'Macacão', 'Macacão contra umidade (precipitação pluviométrica) (tronco e membros)', 'Umidade por chuva', NULL),
  ('H', 'H.2', 'Vestimenta de corpo inteiro', 'Vestimenta de corpo inteiro contra agentes químicos', 'Agentes químicos', 'NR-20, NR-25'),
  ('H', 'H.2', 'Vestimenta de corpo inteiro', 'Vestimenta condutiva contra choques elétricos (corpo inteiro)', 'Choque elétrico', 'NR-10'),
  ('H', 'H.2', 'Vestimenta de corpo inteiro', 'Vestimenta de corpo inteiro contra umidade — operações com água', 'Umidade por operações com água', NULL),
  ('H', 'H.2', 'Vestimenta de corpo inteiro', 'Vestimenta de corpo inteiro contra umidade — precipitação pluviométrica', 'Umidade por chuva', NULL),
  ('I', 'I.1', 'Cinturão de segurança com trava-queda', 'Cinturão de segurança com dispositivo trava-queda', 'Queda em movimentação vertical ou horizontal', 'NR-35'),
  ('I', 'I.2', 'Cinturão de segurança com talabarte', 'Cinturão de segurança com talabarte para trabalhos em altura', 'Risco de queda em trabalhos em altura', 'NR-35'),
  ('I', 'I.2', 'Cinturão de segurança com talabarte', 'Cinturão de segurança com talabarte para posicionamento em trabalhos em altura', 'Risco de queda no posicionamento em trabalhos em altura', 'NR-35');

CREATE TABLE tenant_epis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  epi_catalog_item_id UUID NOT NULL REFERENCES epi_catalog_items(id),
  ca_number TEXT NOT NULL,
  ca_valid_until DATE,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_tenant_epis_updated_at BEFORE UPDATE ON tenant_epis
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenant_epis ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_epis FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_epis_isolation ON tenant_epis USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE TABLE employee_epi_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_epi_id UUID NOT NULL REFERENCES tenant_epis(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  delivered_at DATE NOT NULL,
  signed_by_name TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE employee_epi_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_epi_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_epi_deliveries_isolation ON employee_epi_deliveries USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
