# Fase 6 (sub-projeto C — Catálogo de EPI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à empresa e ao seu técnico (responsável ou parceiro) um
catálogo real dos EPIs que a empresa possui — referenciando os 93 itens
oficiais do Anexo I da NR-06 — e o vínculo de entrega desse EPI a um
funcionário específico, com assinatura eletrônica simples.

**Architecture:** Três tabelas novas: `epi_catalog_items` (referência
global fixa, 93 itens semeados via migration, sem RLS), `tenant_epis`
(EPI real que a empresa possui, referenciando o catálogo + CA real) e
`employee_epi_deliveries` (vínculo funcionário↔EPI). RLS das duas
últimas usa `assigned_tenant_ids_for_current_user()` — função helper
que já existe desde `0001_init.sql` e já unifica `tenant_technicians`+
`tenant_partners` numa `SETOF UUID`, a mesma que `employees_isolation`
já usa — mais simples que repetir dois `EXISTS` como fases anteriores
fizeram. Zero rota de frontend nova além de duas páginas — reaproveita
o padrão de componente compartilhado (`EpisPanel`, no espírito de
`DocumentsPanel`) e estende a agenda de vencimentos já existente pra
também considerar `ca_valid_until`.

**Tech Stack:** NestJS + `pg` (PoolClient), Postgres com RLS, Next.js 14
App Router + Tailwind v4, tudo em containers Docker reais desta VPS.
Nenhuma dependência nova.

**Spec:** [`docs/specs/fase-6-catalogo-epi.md`](../specs/fase-6-catalogo-epi.md)

## Global Constraints

- `epi_catalog_items`: sem `tenant_id`, sem RLS — dado de referência
  público, semeado uma vez via `INSERT` na própria migration, 93 itens
  exatos do Anexo I. `code` **não é único por linha** (ex. `A.1`
  aparece 3 vezes) — a unicidade real é `id`; a tabela usa
  `UNIQUE (code, description)` só pra impedir duplicar a mesma linha
  exata na semeadura.
- `tenant_epis`/`employee_epi_deliveries`: RLS usa
  `tenant_id IN (SELECT assigned_tenant_ids_for_current_user())` — não
  repetir o padrão de dois `EXISTS` (`tenant_technicians`/`tenant_partners`)
  usado em fases anteriores; a função já existe e já faz essa união.
- Papéis: `empresa`, `tecnico`, `parceiro` podem criar/listar/apagar EPI
  e registrar entrega — mesma regra de acesso já estabelecida em
  `documents`/`inspections` (Fase 6 sub-projetos A/B).
- `DELETE /epis/:id` não exige ser quem cadastrou — diferente de
  `documents`, é dado de catálogo compartilhado da empresa.
- `GET /epis` — `tenant_id` **opcional pra todo mundo** (igual a `GET
  /documents`, não igual a `GET /inspections`) — necessário pra agenda
  agregada da carteira do técnico funcionar numa chamada só.
- Assinatura de entrega: nome digitado + confirmação (mesmo padrão de
  `inspections.technician_signature_name`), sem canvas.
- Fora de escopo: verificação automática de CA, inspeção de desgaste
  separada da validade, EPI no score de conformidade (Fase 4B).
- Testes: e2e reais contra o Postgres real do Docker desta VPS (sem
  mock), mesmo padrão de todas as fases anteriores. Comando de teste
  completo (roda uma suíte específica; adapte o caminho no final):
  ```bash
  set -a; source /opt/Montese/.env; set +a
  docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
    -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
    -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
    -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
    -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
    -e PUBLIC_APP_URL="https://example.com" \
    -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
    -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
    -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
    -e CONTACT_EMAIL_TO="comercial@teste.montese.local" \
    -e CONTACT_RATE_LIMIT_MAX=10 -e CONTACT_RATE_LIMIT_WINDOW_SECONDS=3600 \
    -e MERCADOPAGO_ACCESS_TOKEN="${MERCADOPAGO_ACCESS_TOKEN}" \
    -e MERCADOPAGO_PUBLIC_KEY="${MERCADOPAGO_PUBLIC_KEY}" \
    -e MERCADOPAGO_WEBHOOK_SECRET="${MERCADOPAGO_WEBHOOK_SECRET}" \
    -e R2_ACCOUNT_ID="${R2_ACCOUNT_ID}" -e R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
    -e R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" -e R2_BUCKET="${R2_BUCKET}" \
    -e R2_ENDPOINT="${R2_ENDPOINT}" \
    -e RESEND_API_KEY="${RESEND_API_KEY}" -e EMAIL_FROM="${EMAIL_FROM}" \
    node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/<arquivo>.e2e-spec.ts"
  ```
- Frontend: build isolado antes de considerar uma task de frontend
  pronta (nunca reconstruir o container `montese_frontend` de produção):
  ```bash
  cd /opt/Montese/frontend && docker build --target builder -t montese-frontend-test-build . \
    && docker rmi montese-frontend-test-build
  ```

---

### Task 1: Migration — `epi_catalog_items` (semeada), `tenant_epis`, `employee_epi_deliveries` + RLS

**Files:**
- Create: `backend/db/migrations/0013_epi_catalog.sql`
- Test: `backend/test/epi-catalog-rls.e2e-spec.ts`

**Interfaces:**
- Consumes: `tenants`, `assigned_tenant_ids_for_current_user()` (função
  já existente desde `0001_init.sql`).
- Produces: tabelas `epi_catalog_items` (93 linhas semeadas),
  `tenant_epis`, `employee_epi_deliveries` com RLS — todas as tasks
  seguintes dependem deste schema.

- [ ] **Step 1: Escrever a migration**

`backend/db/migrations/0013_epi_catalog.sql`:

```sql
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
```

- [ ] **Step 2: Rodar a migração contra o Postgres real do Docker**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate
```

Esperado: `0013_epi_catalog.sql` aplicada (não `[skip]`, primeira vez).

- [ ] **Step 3: Confirmar a semeadura direto no banco**

```bash
docker exec montese_postgres psql -U postgres -d montese -c \
  "SELECT count(*) AS total, count(DISTINCT category) AS categorias FROM epi_catalog_items;"
```

Esperado: `total = 93`, `categorias = 9`.

- [ ] **Step 4: Escrever o teste de RLS**

`backend/test/epi-catalog-rls.e2e-spec.ts`:

```typescript
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('epi_catalog_items semeado + RLS de tenant_epis/employee_epi_deliveries (e2e)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let catalogItemId: string;
  let tenantEpiAId: string;
  let deliveryAId: string;
  let technicianLinkedUserId: string;
  let technicianLinkedId: string;
  let partnerLinkedUserId: string;
  let partnerLinkedId: string;
  let unlinkedUserId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();

    const catalogResult = await (db as any).client.query(
      "SELECT id FROM epi_catalog_items WHERE code = 'A.1' LIMIT 1",
    );
    catalogItemId = catalogResult.rows[0].id;

    const tenantA = await db.createTenantWithUser('Empresa EpiCatalog RLS A');
    const tenantB = await db.createTenantWithUser('Empresa EpiCatalog RLS B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const linkedTech = await db.createUserWithRole('tecnico', 'Tecnico EpiCatalog RLS');
    const linkedPartner = await db.createUserWithRole('parceiro', 'Parceiro EpiCatalog RLS');
    const unlinked = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado EpiCatalog RLS');
    technicianLinkedUserId = linkedTech.userId;
    partnerLinkedUserId = linkedPartner.userId;
    unlinkedUserId = unlinked.userId;

    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [technicianLinkedUserId],
    );
    technicianLinkedId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantAId, technicianLinkedId],
    );

    const partnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partnerLinkedUserId],
    );
    partnerLinkedId = partnerResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantAId, partnerLinkedId],
    );

    const insertEpiA = await (db as any).client.query(
      `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, created_by_user_id)
       VALUES ($1, $2, 'CA-TESTE-001', $3) RETURNING id`,
      [tenantAId, catalogItemId, tenantA.userId],
    );
    tenantEpiAId = insertEpiA.rows[0].id;

    const insertDeliveryA = await (db as any).client.query(
      `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, signed_by_name, created_by_user_id)
       VALUES ($1, $2, $3, '2026-08-25', 'Fulano de Tal', $4) RETURNING id`,
      [tenantAId, tenantEpiAId, tenantA.employeeId, tenantA.userId],
    );
    deliveryAId = insertDeliveryA.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM employee_epi_deliveries WHERE id = $1', [deliveryAId]);
    await (db as any).client.query('DELETE FROM tenant_epis WHERE id = $1', [tenantEpiAId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianLinkedId]);
    await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerLinkedId]);
    await db.cleanup();
    await db.disconnect();
  });

  async function queryAsContext(
    role: string,
    tenantId: string | null,
    userId: string,
    table: 'tenant_epis' | 'employee_epi_deliveries',
  ): Promise<string[]> {
    const appClient = new Client({ connectionString: process.env.DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query('BEGIN');
      await appClient.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId ?? '']);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.role', role]);
      const result = await appClient.query(`SELECT id FROM ${table}`);
      await appClient.query('ROLLBACK');
      return result.rows.map((r) => r.id);
    } finally {
      await appClient.end();
    }
  }

  it('empresa A vê o próprio tenant_epis/employee_epi_deliveries; empresa B não', async () => {
    expect(await queryAsContext('empresa', tenantAId, randomUUID(), 'tenant_epis')).toContain(tenantEpiAId);
    expect(await queryAsContext('empresa', tenantBId, randomUUID(), 'tenant_epis')).not.toContain(
      tenantEpiAId,
    );
    expect(await queryAsContext('empresa', tenantAId, randomUUID(), 'employee_epi_deliveries')).toContain(
      deliveryAId,
    );
  });

  it('técnico vinculado à empresa A vê; parceiro vinculado à empresa A também vê', async () => {
    expect(await queryAsContext('tecnico', null, technicianLinkedUserId, 'tenant_epis')).toContain(
      tenantEpiAId,
    );
    expect(await queryAsContext('parceiro', null, partnerLinkedUserId, 'tenant_epis')).toContain(
      tenantEpiAId,
    );
  });

  it('técnico NÃO vinculado a nenhuma empresa não vê nada', async () => {
    expect(await queryAsContext('tecnico', null, unlinkedUserId, 'tenant_epis')).not.toContain(
      tenantEpiAId,
    );
    expect(await queryAsContext('tecnico', null, unlinkedUserId, 'employee_epi_deliveries')).not.toContain(
      deliveryAId,
    );
  });
});
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/epi-catalog-rls.e2e-spec.ts"
```

Esperado: PASS, 3/3.

- [ ] **Step 6: Commit**

```bash
git add backend/db/migrations/0013_epi_catalog.sql backend/test/epi-catalog-rls.e2e-spec.ts
git commit -m "feat: migration do catalogo de EPI (93 itens semeados) + RLS de tenant_epis/employee_epi_deliveries"
```

---

### Task 2: `EpiModule` — catálogo, criação, listagem e exclusão de EPI

**Files:**
- Create: `backend/src/epi/epi.service.ts`
- Create: `backend/src/epi/epi-catalog.controller.ts`
- Create: `backend/src/epi/epis.controller.ts`
- Create: `backend/src/epi/epi.module.ts`
- Create: `backend/src/epi/dto/create-epi.dto.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/epis-crud.e2e-spec.ts`

**Interfaces:**
- Consumes: tabelas da Task 1.
- Produces: `EpiService.findCatalogItems/create/findAll/findOne/remove`,
  interfaces `EpiCatalogItem`/`Epi` — Task 3 adiciona métodos ao mesmo
  service reaproveitando esses tipos; `GET /epi-catalog-items` →
  `EpiCatalogItem[]`; `POST /epis` → `Epi`; `GET /epis` → `Epi[]` —
  Task 5 (frontend) consome os três shapes exatamente assim.

- [ ] **Step 1: Escrever o DTO**

`backend/src/epi/dto/create-epi.dto.ts`:

```typescript
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateEpiDto {
  @IsUUID()
  epi_catalog_item_id: string;

  @IsString()
  @MaxLength(100)
  ca_number: string;

  @IsOptional()
  @IsISO8601()
  ca_valid_until?: string;

  // Só é lido quando quem envia é role 'tecnico' ou 'parceiro' (empresa
  // sempre usa o próprio tenant_id do token).
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
```

- [ ] **Step 2: Escrever o service**

`backend/src/epi/epi.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';

export interface EpiCatalogItem {
  id: string;
  category: string;
  code: string;
  equipment_group: string;
  description: string;
  risk_protected: string;
  related_nr: string | null;
  legal_basis: string;
}

export interface Epi {
  id: string;
  tenant_id: string;
  epi_catalog_item_id: string;
  ca_number: string;
  ca_valid_until: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  category: string;
  code: string;
  equipment_group: string;
  description: string;
}

interface CreateEpiData {
  tenantId: string;
  epiCatalogItemId: string;
  caNumber: string;
  caValidUntil?: string;
  createdByUserId: string;
}

const EPI_SELECT = `
  SELECT te.id, te.tenant_id, te.epi_catalog_item_id, te.ca_number, te.ca_valid_until,
         te.created_by_user_id, te.created_at, te.updated_at,
         eci.category, eci.code, eci.equipment_group, eci.description
  FROM tenant_epis te
  JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
`;

@Injectable()
export class EpiService {
  async findCatalogItems(client: PoolClient): Promise<EpiCatalogItem[]> {
    const result = await client.query<EpiCatalogItem>(
      'SELECT * FROM epi_catalog_items ORDER BY category, code, description',
    );
    return result.rows;
  }

  async create(client: PoolClient, data: CreateEpiData): Promise<Epi> {
    try {
      const result = await client.query<{ id: string }>(
        `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, ca_valid_until, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [data.tenantId, data.epiCatalogItemId, data.caNumber, data.caValidUntil ?? null, data.createdByUserId],
      );
      return this.findOne(client, result.rows[0].id);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<Epi[]> {
    if (tenantId) {
      const result = await client.query<Epi>(
        `${EPI_SELECT} WHERE te.tenant_id = $1 ORDER BY te.created_at DESC`,
        [tenantId],
      );
      return result.rows;
    }
    // Sem filtro: RLS já restringe (admin vê tudo, empresa vê o próprio
    // tenant, técnico/parceiro vê tenants vinculados via
    // assigned_tenant_ids_for_current_user()) — usado pela agenda
    // agregada da carteira.
    const result = await client.query<Epi>(`${EPI_SELECT} ORDER BY te.created_at DESC`);
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<Epi> {
    const result = await client.query<Epi>(`${EPI_SELECT} WHERE te.id = $1`, [id]);
    const epi = result.rows[0];
    if (!epi) throw new NotFoundException('EPI não encontrado');
    return epi;
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const result = await client.query('DELETE FROM tenant_epis WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('EPI não encontrado');
  }
}
```

- [ ] **Step 3: Escrever o controller do catálogo**

`backend/src/epi/epi-catalog.controller.ts`:

```typescript
import { Controller, Get, Req } from '@nestjs/common';
import { EpiService } from './epi.service';

@Controller('epi-catalog-items')
export class EpiCatalogController {
  constructor(private readonly epi: EpiService) {}

  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.findCatalogItems(client));
  }
}
```

- [ ] **Step 4: Escrever o controller de EPI (criação, listagem, exclusão)**

`backend/src/epi/epis.controller.ts`:

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { EpiService } from './epi.service';
import { CreateEpiDto } from './dto/create-epi.dto';

@Controller('epis')
export class EpisController {
  constructor(private readonly epi: EpiService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateEpiDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.epi.create(client, {
        tenantId,
        epiCatalogItemId: dto.epi_catalog_item_id,
        caNumber: dto.ca_number,
        caValidUntil: dto.ca_valid_until,
        createdByUserId: user.id,
      }),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.findAll(client, tenantId));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.remove(client, id));
  }
}
```

- [ ] **Step 5: Registrar o módulo**

`backend/src/epi/epi.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { EpiCatalogController } from './epi-catalog.controller';
import { EpisController } from './epis.controller';
import { EpiService } from './epi.service';

@Module({
  controllers: [EpiCatalogController, EpisController],
  providers: [EpiService],
})
export class EpiModule {}
```

Em `backend/src/app.module.ts`: adicionar
`import { EpiModule } from './epi/epi.module';` e `EpiModule` no array
`imports` (depois de `InspectionsModule`).

- [ ] **Step 6: Escrever o teste**

`backend/test/epis-crud.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET/DELETE /epis + GET /epi-catalog-items (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let empresaToken: string;
  let catalogItemId: string;
  let createdEpiId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Epi Crud Teste');
    tenantId = tenant.tenantId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginRes.body.access_token;

    const catalogRes = await request(app.getHttpServer())
      .get('/epi-catalog-items')
      .set('Authorization', `Bearer ${empresaToken}`);
    catalogItemId = catalogRes.body[0].id;
  });

  afterAll(async () => {
    if (createdEpiId) {
      await (db as any).client.query('DELETE FROM tenant_epis WHERE id = $1', [createdEpiId]);
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /epi-catalog-items retorna os 93 itens fixos', async () => {
    const res = await request(app.getHttpServer())
      .get('/epi-catalog-items')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(93);
  });

  it('empresa cadastra um EPI, aparece em GET /epis com os dados do catálogo juntos', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/epis')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ epi_catalog_item_id: catalogItemId, ca_number: 'CA-12345', ca_valid_until: '2027-01-01' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.ca_number).toBe('CA-12345');
    expect(createRes.body.category).toBeDefined();
    expect(createRes.body.code).toBeDefined();
    createdEpiId = createRes.body.id;

    const listRes = await request(app.getHttpServer())
      .get('/epis')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.find((e: { id: string }) => e.id === createdEpiId)).toBeDefined();
  });

  it('empresa apaga o EPI cadastrado', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/epis/${createdEpiId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    createdEpiId = undefined;
  });
});
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/epis-crud.e2e-spec.ts"
```

Esperado: PASS, 3/3.

- [ ] **Step 8: Commit**

```bash
git add backend/src/epi backend/src/app.module.ts backend/test/epis-crud.e2e-spec.ts
git commit -m "feat: adiciona catalogo, criacao, listagem e exclusao de EPI"
```

---

### Task 3: Vínculo funcionário↔EPI (entrega com assinatura)

**Files:**
- Create: `backend/src/epi/dto/create-epi-delivery.dto.ts`
- Modify: `backend/src/epi/epi.service.ts`
- Modify: `backend/src/epi/epis.controller.ts`
- Test: `backend/test/epi-deliveries.e2e-spec.ts`

**Interfaces:**
- Consumes: `EpiService.findOne` (Task 2, usado pra descobrir o
  `tenant_id` do EPI antes de gravar a entrega).
- Produces: `EpiService.createDelivery/findDeliveries`, interface
  `EmployeeEpiDelivery` — `POST /epis/:id/deliveries` →
  `EmployeeEpiDelivery`; `GET /epis/:id/deliveries` →
  `EmployeeEpiDelivery[]` — Task 5 (frontend) consome os dois shapes
  exatamente assim.

- [ ] **Step 1: Escrever o DTO**

`backend/src/epi/dto/create-epi-delivery.dto.ts`:

```typescript
import { IsISO8601, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateEpiDeliveryDto {
  @IsUUID()
  employee_id: string;

  @IsISO8601()
  delivered_at: string;

  @IsString()
  @MaxLength(200)
  signed_by_name: string;
}
```

- [ ] **Step 2: Adicionar os métodos ao service**

Em `backend/src/epi/epi.service.ts`, adicionar as interfaces e métodos
abaixo, depois de `remove` (mantém `findCatalogItems`/`create`/`findAll`/
`findOne`/`remove` do Task 2 intactos):

```typescript
export interface EmployeeEpiDelivery {
  id: string;
  tenant_id: string;
  tenant_epi_id: string;
  employee_id: string;
  delivered_at: string;
  signed_by_name: string;
  signed_at: string;
  created_by_user_id: string;
  created_at: string;
}

interface CreateDeliveryData {
  employeeId: string;
  deliveredAt: string;
  signedByName: string;
  createdByUserId: string;
}
```

(essas duas interfaces vão junto das outras `interface`/`export interface`
já existentes no topo do arquivo, antes de `const EPI_SELECT`)

```typescript
  async createDelivery(
    client: PoolClient,
    tenantEpiId: string,
    data: CreateDeliveryData,
  ): Promise<EmployeeEpiDelivery> {
    const epi = await this.findOne(client, tenantEpiId);
    try {
      const result = await client.query<EmployeeEpiDelivery>(
        `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, signed_by_name, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [epi.tenant_id, tenantEpiId, data.employeeId, data.deliveredAt, data.signedByName, data.createdByUserId],
      );
      return result.rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async findDeliveries(client: PoolClient, tenantEpiId: string): Promise<EmployeeEpiDelivery[]> {
    const result = await client.query<EmployeeEpiDelivery>(
      'SELECT * FROM employee_epi_deliveries WHERE tenant_epi_id = $1 ORDER BY delivered_at DESC',
      [tenantEpiId],
    );
    return result.rows;
  }
```

(esses dois métodos vão dentro da classe `EpiService`, depois de `remove`)

- [ ] **Step 3: Adicionar os endpoints ao controller**

Em `backend/src/epi/epis.controller.ts`, importar o novo DTO e adicionar
os dois métodos abaixo, depois de `remove` (mantém `create`/`findAll`/
`remove` do Task 2 intactos):

```typescript
import { CreateEpiDeliveryDto } from './dto/create-epi-delivery.dto';
```

```typescript
  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/deliveries')
  createDelivery(@Param('id') id: string, @Body() dto: CreateEpiDeliveryDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.epi.createDelivery(client, id, {
        employeeId: dto.employee_id,
        deliveredAt: dto.delivered_at,
        signedByName: dto.signed_by_name,
        createdByUserId: req.user.id,
      }),
    );
  }

  @Get(':id/deliveries')
  findDeliveries(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.findDeliveries(client, id));
  }
```

- [ ] **Step 4: Escrever o teste**

`backend/test/epi-deliveries.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET /epis/:id/deliveries (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let employeeId: string;
  let empresaToken: string;
  let tenantEpiId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Epi Delivery Teste');
    tenantId = tenant.tenantId;
    employeeId = tenant.employeeId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginRes.body.access_token;

    const catalogRes = await request(app.getHttpServer())
      .get('/epi-catalog-items')
      .set('Authorization', `Bearer ${empresaToken}`);
    const catalogItemId = catalogRes.body[0].id;

    const epiRes = await request(app.getHttpServer())
      .post('/epis')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ epi_catalog_item_id: catalogItemId, ca_number: 'CA-DELIVERY-001' });
    tenantEpiId = epiRes.body.id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM tenant_epis WHERE id = $1', [tenantEpiId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('registra uma entrega com assinatura e ela aparece na listagem', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/epis/${tenantEpiId}/deliveries`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ employee_id: employeeId, delivered_at: '2026-08-25', signed_by_name: 'Maria Responsável' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.signed_by_name).toBe('Maria Responsável');
    expect(createRes.body.signed_at).not.toBeNull();
    expect(createRes.body.tenant_id).toBe(tenantId);

    const listRes = await request(app.getHttpServer())
      .get(`/epis/${tenantEpiId}/deliveries`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].employee_id).toBe(employeeId);
  });
});
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/epi-deliveries.e2e-spec.ts"
```

Esperado: PASS, 1/1.

- [ ] **Step 6: Commit**

```bash
git add backend/src/epi backend/test/epi-deliveries.e2e-spec.ts
git commit -m "feat: adiciona registro de entrega de EPI a funcionario"
```

---

### Task 4: `GET /employees` aceita `tenant_id`

**Files:**
- Modify: `backend/src/employees/employees.service.ts`
- Modify: `backend/src/employees/employees.controller.ts`
- Test: `backend/test/employees-tenant-id.e2e-spec.ts`

**Interfaces:**
- Consumes: nenhuma desta plano — extensão de código pré-existente da
  Fase 3.
- Produces: `EmployeesService.findAll(client, tenantId?)` — assinatura
  muda (novo segundo parâmetro opcional); Task 5 (frontend) chama `GET
  /employees?tenant_id=` no formulário de entrega quando `tenantId` é
  passado ao componente.

- [ ] **Step 1: Atualizar o service**

Em `backend/src/employees/employees.service.ts`, trocar o método
`findAll` (linhas 104-109, o resto do arquivo não muda):

```typescript
  async findAll(client: PoolClient, tenantId?: string): Promise<Employee[]> {
    if (tenantId) {
      const result = await client.query<Employee>(
        'SELECT * FROM employees WHERE tenant_id = $1 ORDER BY full_name',
        [tenantId],
      );
      return result.rows;
    }
    // Sem filtro: RLS já restringe pelo contexto (app.tenant_id / app.role).
    const result = await client.query<Employee>('SELECT * FROM employees ORDER BY full_name');
    return result.rows;
  }
```

- [ ] **Step 2: Atualizar o controller**

Em `backend/src/employees/employees.controller.ts`, trocar o método
`findAll` (linhas 61-64, `Query` já está importado, o resto do arquivo
não muda):

```typescript
  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if ((req.user.role === 'tecnico' || req.user.role === 'parceiro') && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.employees.findAll(client, tenantId));
  }
```

- [ ] **Step 3: Escrever o teste**

`backend/test/employees-tenant-id.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /employees com tenant_id (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Employees TenantId Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Employees TenantId Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('técnico com tenant_id vê os funcionários da empresa vinculada', async () => {
    const res = await request(app.getHttpServer())
      .get(`/employees?tenant_id=${tenantId}`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((e: { tenant_id: string }) => e.tenant_id === tenantId)).toBe(true);
  });

  it('técnico sem tenant_id recebe 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(400);
  });

  it('empresa continua funcionando sem tenant_id (RLS decide)', async () => {
    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/employees-tenant-id.e2e-spec.ts"
```

Esperado: PASS, 3/3. Rode também a suíte já existente de `employees`
(qualquer arquivo `test/employees*.e2e-spec.ts`) pra confirmar que o
caminho de empresa sem `tenant_id` continua igual.

- [ ] **Step 5: Commit**

```bash
git add backend/src/employees backend/test/employees-tenant-id.e2e-spec.ts
git commit -m "feat: GET /employees aceita tenant_id opcional (necessario pro formulario de entrega de EPI)"
```

---

### Task 5: Frontend — `EpisPanel` (componente compartilhado) + página da empresa

**Files:**
- Create: `frontend/src/components/EpisPanel.tsx`
- Create: `frontend/src/app/empresa/epis/page.tsx`

**Interfaces:**
- Consumes: `GET /api/epi-catalog-items`, `GET/POST/DELETE
  /api/epis`, `GET/POST /api/epis/:id/deliveries`, `GET
  /api/employees?tenant_id=` (Tasks 2-4).
- Produces: componente `EpisPanel({ tenantId?: string })` — Task 6
  (frontend do técnico) importa e usa o mesmo componente passando
  `tenantId`, sem duplicar a UI.

- [ ] **Step 1: Criar o componente compartilhado**

`frontend/src/components/EpisPanel.tsx`:

```tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';

interface EpiCatalogItem {
  id: string;
  category: string;
  code: string;
  equipment_group: string;
  description: string;
}

interface EpiRow {
  id: string;
  ca_number: string;
  ca_valid_until: string | null;
  category: string;
  code: string;
  equipment_group: string;
  description: string;
}

interface Employee {
  id: string;
  full_name: string;
}

interface Delivery {
  id: string;
  employee_id: string;
  delivered_at: string;
  signed_by_name: string;
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function EpisPanel({ tenantId }: { tenantId?: string }) {
  const [catalogItems, setCatalogItems] = useState<EpiCatalogItem[]>([]);
  const [epis, setEpis] = useState<EpiRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [selectedItemId, setSelectedItemId] = useState('');
  const [caNumber, setCaNumber] = useState('');
  const [caValidUntil, setCaValidUntil] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const [deliveriesByEpi, setDeliveriesByEpi] = useState<Record<string, Delivery[]>>({});
  const [deliveryFormEpiId, setDeliveryFormEpiId] = useState<string | null>(null);
  const [deliveryEmployeeId, setDeliveryEmployeeId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliverySignedBy, setDeliverySignedBy] = useState('');

  function episUrl(): string {
    return tenantId ? `/api/epis?tenant_id=${tenantId}` : '/api/epis';
  }

  function employeesUrl(): string {
    return tenantId ? `/api/employees?tenant_id=${tenantId}` : '/api/employees';
  }

  async function loadCatalogItems() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/epi-catalog-items', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const items: EpiCatalogItem[] = await res.json();
        setCatalogItems(items);
        if (items.length > 0) setSelectedItemId(items[0].id);
      }
    } catch {
      // catálogo é dado fixo; falha aqui só deixa o seletor vazio, sem
      // bloquear o resto do painel.
    }
  }

  async function loadEpis() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(episUrl(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setEpis(await res.json());
        setListError('');
      } else {
        setListError('Não foi possível carregar os EPIs.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  async function loadEmployees() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(employeesUrl(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setEmployees(await res.json());
    } catch {
      // seletor de funcionário fica vazio; erro de conexão já reportado
      // pelo loadEpis, não duplica estado de erro aqui.
    }
  }

  useEffect(() => {
    Promise.all([loadCatalogItems(), loadEpis(), loadEmployees()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setErrorMessage('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/epis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          epi_catalog_item_id: selectedItemId,
          ca_number: caNumber,
          ca_valid_until: caValidUntil || undefined,
          tenant_id: tenantId,
        }),
      });
      if (res.ok) {
        setCaNumber('');
        setCaValidUntil('');
        setStatus('idle');
        loadEpis();
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(body?.message ?? 'Não foi possível cadastrar o EPI.');
      setStatus('erro');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  async function handleDelete(id: string) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/epis/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        loadEpis();
      } else {
        setListError('Não foi possível apagar o EPI.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  async function loadDeliveries(epiId: string) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/epis/${epiId}/deliveries`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const deliveries: Delivery[] = await res.json();
        setDeliveriesByEpi((prev) => ({ ...prev, [epiId]: deliveries }));
      }
    } catch {
      // lista de entregas fica vazia pra esse EPI; sem estado de erro
      // dedicado, mesmo espírito de loadEmployees.
    }
  }

  async function handleRegisterDelivery(event: FormEvent, epiId: string) {
    event.preventDefault();
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/epis/${epiId}/deliveries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          employee_id: deliveryEmployeeId,
          delivered_at: deliveryDate,
          signed_by_name: deliverySignedBy,
        }),
      });
      if (res.ok) {
        setDeliveryFormEpiId(null);
        setDeliveryEmployeeId('');
        setDeliveryDate('');
        setDeliverySignedBy('');
        loadDeliveries(epiId);
      } else {
        setListError('Não foi possível registrar a entrega.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  if (loading) {
    return <p className="text-brand-700">Carregando EPIs...</p>;
  }

  const itemsByCategory: Record<string, EpiCatalogItem[]> = {};
  for (const item of catalogItems) {
    if (!itemsByCategory[item.category]) itemsByCategory[item.category] = [];
    itemsByCategory[item.category].push(item);
  }

  function employeeName(id: string): string {
    return employees.find((e) => e.id === id)?.full_name ?? 'Funcionário';
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Cadastrar EPI</h2>
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Item do Anexo I (NR-06)
            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              {Object.entries(itemsByCategory).map(([category, items]) => (
                <optgroup key={category} label={`Categoria ${category}`}>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.description}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Número do CA
            <input
              required
              value={caNumber}
              onChange={(e) => setCaNumber(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Validade do CA (opcional)
            <input
              type="date"
              value={caValidUntil}
              onChange={(e) => setCaValidUntil(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={status === 'loading' || !selectedItemId}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {status === 'loading' ? 'Cadastrando...' : 'Cadastrar EPI'}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">EPIs cadastrados</h2>
        {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        {epis.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum EPI cadastrado ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {epis.map((epi) => (
              <li key={epi.id} className="rounded-md border border-brand-100 px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="text-brand-900">
                      {epi.code} — {epi.description}
                    </strong>
                    <span className="ml-2 text-brand-700">CA {epi.ca_number}</span>
                    {epi.ca_valid_until && (
                      <span className="ml-2 text-brand-700">(validade {formatDate(epi.ca_valid_until)})</span>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setDeliveryFormEpiId(epi.id);
                        loadDeliveries(epi.id);
                      }}
                      className="text-brand-500 hover:underline"
                    >
                      Registrar entrega
                    </button>
                    <button onClick={() => handleDelete(epi.id)} className="text-red-600 hover:underline">
                      Apagar
                    </button>
                  </div>
                </div>

                {deliveriesByEpi[epi.id] && deliveriesByEpi[epi.id].length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1 text-xs text-brand-700">
                    {deliveriesByEpi[epi.id].map((delivery) => (
                      <li key={delivery.id}>
                        {employeeName(delivery.employee_id)} — entregue em{' '}
                        {formatDate(delivery.delivered_at)} — confirmado por {delivery.signed_by_name}
                      </li>
                    ))}
                  </ul>
                )}

                {deliveryFormEpiId === epi.id && (
                  <form
                    onSubmit={(e) => handleRegisterDelivery(e, epi.id)}
                    className="mt-3 flex flex-col gap-2 border-t border-brand-100 pt-3"
                  >
                    <label className="flex flex-col gap-1 text-xs text-brand-900">
                      Funcionário
                      <select
                        required
                        value={deliveryEmployeeId}
                        onChange={(e) => setDeliveryEmployeeId(e.target.value)}
                        className="rounded-md border border-brand-100 px-3 py-2"
                      >
                        <option value="">Selecione</option>
                        {employees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.full_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-brand-900">
                      Data da entrega
                      <input
                        required
                        type="date"
                        value={deliveryDate}
                        onChange={(e) => setDeliveryDate(e.target.value)}
                        className="rounded-md border border-brand-100 px-3 py-2"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-brand-900">
                      Nome de quem confere a entrega
                      <input
                        required
                        value={deliverySignedBy}
                        onChange={(e) => setDeliverySignedBy(e.target.value)}
                        className="rounded-md border border-brand-100 px-3 py-2"
                      />
                    </label>
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        className="self-start rounded-md bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        Confirmar entrega
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeliveryFormEpiId(null)}
                        className="self-start rounded-md border border-brand-100 px-4 py-2 text-xs font-medium text-brand-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Criar a página da empresa**

`frontend/src/app/empresa/epis/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EpisPanel } from '@/components/EpisPanel';

export default function EmpresaEpisPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Catálogo de EPI</h1>
      <div className="mt-8">
        <EpisPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build isolado**

```bash
cd /opt/Montese/frontend && docker build --target builder -t montese-frontend-test-build . \
  && docker rmi montese-frontend-test-build
```

Esperado: `Compiled successfully`, sem erro de tipo, `/empresa/epis`
aparece na listagem de rotas.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/EpisPanel.tsx frontend/src/app/empresa/epis
git commit -m "feat: adiciona catalogo de EPI e registro de entrega (painel da empresa)"
```

---

### Task 6: Frontend — seção de EPI no painel do técnico

**Files:**
- Modify: `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`

**Interfaces:**
- Consumes: componente `EpisPanel({ tenantId?: string })` (Task 5).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Importar o componente e adicionar a seção**

Em `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`, adicionar o
import (junto dos outros já existentes no topo):

```typescript
import { EpisPanel } from '@/components/EpisPanel';
```

E adicionar a seção nova depois da seção "Inspeções" (a última
`</section>` antes do `</div>` de fechamento), sem alterar mais nada no
arquivo:

```tsx
      <section className="mt-10 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Catálogo de EPI</h2>
        <div className="mt-4">
          <EpisPanel tenantId={params.tenantId} />
        </div>
      </section>
```

- [ ] **Step 2: Build isolado**

```bash
cd /opt/Montese/frontend && docker build --target builder -t montese-frontend-test-build . \
  && docker rmi montese-frontend-test-build
```

Esperado: `Compiled successfully`, sem erro de tipo.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/tecnico/empresas/[tenantId]/page.tsx"
git commit -m "feat: adiciona secao de catalogo de EPI ao painel do tecnico"
```

---

### Task 7: Frontend — agenda de vencimentos considera validade de CA

**Files:**
- Modify: `frontend/src/components/DocumentsPanel.tsx`
- Modify: `frontend/src/app/tecnico/agenda/page.tsx`

**Interfaces:**
- Consumes: `GET /api/epis` (Task 2), reaproveitado sem `tenant_id`
  pelo `/tecnico/agenda` (agregado da carteira) e com `tenant_id` pelo
  `DocumentsPanel` (visão de uma empresa só).
- Produces: nenhuma interface nova — última task do plano.

**Nota:** esta task também corrige, nos dois arquivos, o mesmo tipo de
bug de fuso horário já encontrado e corrigido na revisão final da Fase
6 sub-projeto A (`docs/plans/fase-6-inspecoes.md`) — `new
Date(isoDate).toLocaleDateString(...)` desloca a data um dia pra trás
em qualquer fuso do Brasil, porque uma coluna `DATE` vira meia-noite UTC
no JSON. Como esta task já reescreve `groupAgendaByMonth` nos dois
arquivos pra aceitar EPI junto de documento, o mesmo ajuste seguro de
data entra nessa reescrita (não é um refactor separado, é a mesma
função sendo tocada).

- [ ] **Step 1: Reescrever a lógica de agenda em `DocumentsPanel.tsx`**

Em `frontend/src/components/DocumentsPanel.tsx`:

Trocar a constante `CATEGORY_LABELS` (adiciona `epi`):

```typescript
const CATEGORY_LABELS: Record<string, string> = {
  pgr: 'PGR',
  pcmso: 'PCMSO',
  laudo: 'Laudo',
  ficha_epi: 'Ficha de EPI',
  treinamento: 'Treinamento',
  epi: 'EPI',
};
```

Trocar o bloco inteiro de `interface AgendaItem` até o fim de
`groupAgendaByMonth` pelo bloco abaixo (o bloco já inclui `capitalize`
de novo, com o mesmo corpo de sempre — é só pra facilitar copiar o
trecho inteiro de uma vez, não é uma mudança nela):

```typescript
interface AgendaItem {
  id: string;
  category: string;
  title: string;
  expires_at: string;
}

interface AgendaGroup {
  label: string;
  items: AgendaItem[];
}

interface EpiRow {
  id: string;
  ca_number: string;
  ca_valid_until: string | null;
  equipment_group: string;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function formatMonthLabel(isoDate: string): string {
  const [year, month] = isoDate.slice(0, 10).split('-').map(Number);
  return capitalize(
    new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  );
}

function documentsToAgendaItems(documents: DocumentRow[]): AgendaItem[] {
  return documents
    .filter((doc): doc is DocumentRow & { expires_at: string } => doc.expires_at !== null)
    .map((doc) => ({ id: doc.id, category: doc.category, title: doc.title, expires_at: doc.expires_at }));
}

function episToAgendaItems(epis: EpiRow[]): AgendaItem[] {
  return epis
    .filter((epi): epi is EpiRow & { ca_valid_until: string } => epi.ca_valid_until !== null)
    .map((epi) => ({
      id: epi.id,
      category: 'epi',
      title: `CA ${epi.ca_number} — ${epi.equipment_group}`,
      expires_at: epi.ca_valid_until,
    }));
}

function groupAgendaByMonth(items: AgendaItem[]): AgendaGroup[] {
  const sorted = [...items].sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  const groups: AgendaGroup[] = [];
  for (const item of sorted) {
    const label = formatMonthLabel(item.expires_at);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}
```

Dentro do componente `DocumentsPanel`, adicionar o estado de `epis`
(junto dos outros `useState` já existentes, depois de `compliance`):

```typescript
  const [epis, setEpis] = useState<EpiRow[]>([]);
```

Adicionar a função `episUrl`/`loadEpis` (depois de `complianceUrl`,
antes de `loadCompliance` — mesmo padrão de `loadCompliance`/
`loadDocuments` já existentes):

```typescript
  function episUrl(): string {
    return tenantId ? `/api/epis?tenant_id=${tenantId}` : '/api/epis';
  }

  async function loadEpis() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(episUrl(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setEpis(await res.json());
      }
    } catch {
      // agenda mescla documentos+EPI; falha aqui só deixa a parte de EPI
      // de fora, sem sobrescrever o listError já usado por loadDocuments.
    }
  }
```

Trocar a linha do `useEffect` inicial (era só `loadDocuments();
loadCompliance();`):

```typescript
  useEffect(() => {
    loadDocuments();
    loadCompliance();
    loadEpis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Trocar a linha que calcula `agendaGroups` (era `const agendaGroups =
groupAgendaByMonth(documents);`):

```typescript
  const agendaGroups = groupAgendaByMonth([...documentsToAgendaItems(documents), ...episToAgendaItems(epis)]);
```

Trocar, dentro do JSX da seção "Agenda de vencimentos", a linha que
mostra a data do item (era `{new Date(item.expires_at).toLocaleDateString('pt-BR')}`):

```tsx
                      {formatDate(item.expires_at)}
```

- [ ] **Step 2: Reescrever a lógica de agenda em `/tecnico/agenda/page.tsx`**

Em `frontend/src/app/tecnico/agenda/page.tsx`, trocar o arquivo inteiro
por:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface LinkedTenant {
  tenant_id: string;
  tenant_name: string;
  tenant_cnpj: string;
}

interface DocumentRow {
  id: string;
  tenant_id: string;
  category: string;
  title: string;
  expires_at: string | null;
}

interface EpiRow {
  id: string;
  tenant_id: string;
  ca_number: string;
  ca_valid_until: string | null;
  equipment_group: string;
}

interface AgendaItem {
  id: string;
  tenant_name: string;
  category: string;
  title: string;
  expires_at: string;
}

interface AgendaGroup {
  label: string;
  items: AgendaItem[];
}

const CATEGORY_LABELS: Record<string, string> = {
  pgr: 'PGR',
  pcmso: 'PCMSO',
  laudo: 'Laudo',
  ficha_epi: 'Ficha de EPI',
  treinamento: 'Treinamento',
  epi: 'EPI',
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function formatMonthLabel(isoDate: string): string {
  const [year, month] = isoDate.slice(0, 10).split('-').map(Number);
  return capitalize(
    new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  );
}

function documentsToAgendaItems(documents: DocumentRow[], tenantNames: Record<string, string>): AgendaItem[] {
  return documents
    .filter((doc): doc is DocumentRow & { expires_at: string } => doc.expires_at !== null)
    .map((doc) => ({
      id: doc.id,
      tenant_name: tenantNames[doc.tenant_id] ?? 'Empresa',
      category: doc.category,
      title: doc.title,
      expires_at: doc.expires_at,
    }));
}

function episToAgendaItems(epis: EpiRow[], tenantNames: Record<string, string>): AgendaItem[] {
  return epis
    .filter((epi): epi is EpiRow & { ca_valid_until: string } => epi.ca_valid_until !== null)
    .map((epi) => ({
      id: epi.id,
      tenant_name: tenantNames[epi.tenant_id] ?? 'Empresa',
      category: 'epi',
      title: `CA ${epi.ca_number} — ${epi.equipment_group}`,
      expires_at: epi.ca_valid_until,
    }));
}

function groupAgendaByMonth(items: AgendaItem[]): AgendaGroup[] {
  const sorted = [...items].sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  const groups: AgendaGroup[] = [];
  for (const item of sorted) {
    const label = formatMonthLabel(item.expires_at);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

export default function TecnicoAgendaPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [epis, setEpis] = useState<EpiRow[]>([]);
  const [tenantNames, setTenantNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }

    Promise.all([
      fetch('/api/tenant-technicians/me', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/documents', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/epis', { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([tenantsRes, documentsRes, episRes]) => {
        if (!tenantsRes.ok || !documentsRes.ok || !episRes.ok) {
          setError('Não foi possível carregar a agenda.');
          setLoading(false);
          return;
        }
        const tenants: LinkedTenant[] = await tenantsRes.json();
        const docs: DocumentRow[] = await documentsRes.json();
        const epiRows: EpiRow[] = await episRes.json();
        setTenantNames(Object.fromEntries(tenants.map((t) => [t.tenant_id, t.tenant_name])));
        setDocuments(docs);
        setEpis(epiRows);
        setLoading(false);
      })
      .catch(() => {
        setError('Não foi possível conectar ao servidor.');
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  const agendaGroups = groupAgendaByMonth([
    ...documentsToAgendaItems(documents, tenantNames),
    ...episToAgendaItems(epis, tenantNames),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-900">Agenda da carteira</h1>
        <Link href="/tecnico/empresas" className="text-sm font-medium text-brand-500 hover:underline">
          Ver empresas
        </Link>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {agendaGroups.length === 0 ? (
        <p className="mt-4 text-brand-700">Nenhum vencimento cadastrado nas empresas da sua carteira.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {agendaGroups.map((group) => (
            <div key={group.label}>
              <h2 className="text-sm font-bold text-brand-900">{group.label}</h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-brand-700">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <span className="font-medium text-brand-900">{item.tenant_name}</span> —{' '}
                    {CATEGORY_LABELS[item.category]} — {item.title} ({formatDate(item.expires_at)})
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build isolado**

```bash
cd /opt/Montese/frontend && docker build --target builder -t montese-frontend-test-build . \
  && docker rmi montese-frontend-test-build
```

Esperado: `Compiled successfully`, sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/DocumentsPanel.tsx frontend/src/app/tecnico/agenda/page.tsx
git commit -m "feat: agenda de vencimentos considera validade de CA de EPI"
```

---

## Depois de todas as tasks

Rodar a suíte e2e completa (comando do Global Constraints, sem
`--testPathPattern`) e confirmar 0 regressões. Atualizar
`docs/roadmap.md` fechando a Fase 6 sub-projeto C — com isso a Fase 6
inteira fica completa (fluxo de inspeção, acesso do parceiro, catálogo
de EPI). Próximo item do roadmap original é a Fase 7 (Dashboard Admin).
