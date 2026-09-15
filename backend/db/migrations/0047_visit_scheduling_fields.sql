-- Agendamento de Reunião/Visita (Google Calendar + Meet): visit_requests
-- já existe desde a Fase 11 (empresa solicita, técnico confirma), mas
-- nunca teve tipo, horário do dia nem filial. Todas as colunas são
-- nullable/com default — não quebra as visitas já existentes em
-- produção, que continuam implicitamente "visita" sem horário.
ALTER TABLE visit_requests ADD COLUMN type TEXT NOT NULL DEFAULT 'visita'
  CHECK (type IN ('reuniao', 'visita'));
ALTER TABLE visit_requests ADD COLUMN preferred_time TIME;
ALTER TABLE visit_requests ADD COLUMN confirmed_time TIME;
ALTER TABLE visit_requests ADD COLUMN company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL;
ALTER TABLE visit_requests ADD COLUMN google_event_id TEXT;
ALTER TABLE visit_requests ADD COLUMN google_meet_link TEXT;

-- DIVERGÊNCIA do brief da Task 1: TenantTechniciansService.findMyTechnicians
-- (endpoint novo GET /tenant-technicians/minha-empresa) precisa devolver o
-- full_name de cada técnico/parceiro vinculado à empresa chamadora. A versão
-- do brief fazia isso com um JOIN direto em `users`, mas `users_isolation`
-- (0001_init.sql) só libera uma linha de `users` pra um caller 'empresa'
-- quando `tenant_id` da linha bate com o tenant do caller — e a linha de
-- `users` de um técnico/parceiro tem `tenant_id` NULL (é entidade global).
-- Resultado real (confirmado rodando o teste e2e): 200 com array vazio, não
-- 404 nem erro — silencioso. Mesma armadilha já documentada em
-- technicians.service.ts (findAll/findOne), onde o remédio (LEFT JOIN) só
-- evita a linha de technicians sumir inteira, mas não repõe o full_name
-- (que continua NULL pra um caller 'empresa' ali também — gap pré-existente,
-- fora do escopo desta task).
--
-- Resolvido aqui com uma função SECURITY DEFINER, mesma técnica já usada em
-- 0001_init.sql (technician_ids_for_tenant, current_technician_id etc.) pra
-- quebrar exatamente este tipo de RLS cruzada entre tabelas. O único
-- parâmetro é p_tenant_id, e quem chama (TenantTechniciansController) nunca
-- passa um tenant arbitrário — sempre `req.user.tenantId`, o tenant do
-- próprio caller autenticado.
CREATE FUNCTION linked_technicians_for_tenant(p_tenant_id UUID)
RETURNS TABLE(user_id UUID, full_name TEXT, role TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.full_name, 'tecnico'
  FROM tenant_technicians tt
  JOIN technicians t ON t.id = tt.technician_id
  JOIN users u ON u.id = t.user_id
  WHERE tt.tenant_id = p_tenant_id AND tt.status = 'ativo'
  UNION ALL
  SELECT u.id, u.full_name, 'parceiro'
  FROM tenant_partners tp
  JOIN partners p ON p.id = tp.partner_id
  JOIN users u ON u.id = p.user_id
  WHERE tp.tenant_id = p_tenant_id AND tp.status = 'ativo'
  ORDER BY full_name;
$$;

ALTER FUNCTION linked_technicians_for_tenant(uuid) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION linked_technicians_for_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION linked_technicians_for_tenant(uuid) TO montese_app;
