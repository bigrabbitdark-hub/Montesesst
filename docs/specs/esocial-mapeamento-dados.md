# Spec: Mapeamento de dados Montese → eSocial (Sub-projeto 1, evento S-2220)

Complementa `esocial-arquitetura.md`. Rótulos: **VERIFICADO** / **INFERIDO** /
**NÃO VERIFICADO**, conforme AGENTS.md.

## 1. Empresa (empregador)

| Informação eSocial | Tabela atual | Campo atual | Existe? | Precisa criar? |
|---|---|---|---|---|
| CNPJ do empregador | `tenants` | `cnpj VARCHAR(14) UNIQUE` | Sim | — |
| Razão social | `tenants` | `name` | Sim | — |
| Nome fantasia | `tenants` | `trade_name` | Sim | — |
| Endereço | `tenants` / `company_units` | `address_street/number/city/state/zip` | Sim | — |
| CNAE | — | — | **Não** | Sim — `tenants.cnae` (VARCHAR7) ou `company_units.cnae`, decisão na Task de implementação: CNAE é por estabelecimento no eSocial real, então `company_units` é o lugar correto (matriz também é uma `company_unit`, `is_matriz=true`) |
| Código de estabelecimento eSocial | — | — | **Não** | Sim — `company_units.esocial_establishment_code`, opcional até confirmado pelo cliente |
| Grau de risco (para fins de PCMSO/periodicidade) | — | — | **Não** | Fora de escopo do S-2220 diretamente; relevante para S-2240 (fase futura) |

## 2. Trabalhador

| Informação eSocial | Tabela atual | Campo atual | Existe? | Precisa criar? |
|---|---|---|---|---|
| CPF | `employees` | `cpf VARCHAR(11)` | Sim | — |
| Nome completo | `employees` | `full_name` | Sim | — |
| Matrícula | — | — | **Não** | Sim — `employees.registration_number` |
| Cargo (texto livre) | `employees` | `position` | Sim (legado) | — |
| Cargo (FK estruturado) | `employees` | `position_id` → `positions` | Sim (parcial, convive com o texto livre) | — |
| CBO (Classificação Brasileira de Ocupações) | — | — | **Não** | Sim — `positions.cbo_code`, obrigatório no eSocial para função, hoje `positions` só tem nome |
| Categoria do trabalhador (eSocial, ex. CLT/estagiário) | — | — | **Não** | Sim — `employees.esocial_category_code` (INFERIDO: campo obrigatório em `ideVinculo`, tabela de domínio do eSocial — confirmar valores exatos contra o MOS antes de implementar) |
| Estabelecimento/vínculo | `employees` | `company_unit_id` | Sim | — |
| Data de admissão | `employees` | `admission_date` | Sim | — |
| Confirmação de que o vínculo já existe no eSocial (S-2200/2300/2190) | — | — | **Não** | Sim — `employees.esocial_vinculo_confirmed_at` + `esocial_vinculo_confirmed_by_user_id` (confirmação manual explícita, não verificação automática — ver `esocial-arquitetura.md`, seção Pré-requisitos) |

## 3. Saúde / ASO (módulo novo `aso/`)

Nenhuma dessas colunas existe hoje — módulo 100% novo.

| Informação eSocial (`exMedOcup`/`aso`) | Campo novo proposto | Observação |
|---|---|---|
| Tipo de exame (admissional/periódico/retorno/mudança de função/monitoração pontual/demissional) | `aso_records.exam_type` | INFERIDO — enum exato de valores do domínio eSocial a confirmar contra MOS |
| Data do exame/emissão do ASO | `aso_records.exam_date` | — |
| Resultado (apto/inapto) | `aso_records.result` | — |
| Indicador de autorização de divulgação do resultado | `aso_records.result_disclosure_authorized` | Ponto de consentimento/minimização de dados — LGPD, ver `esocial-seguranca.md` |
| Médico emissor — nome | `aso_records.doctor_name` | — |
| Médico emissor — CRM | `aso_records.doctor_crm` | — |
| Médico emissor — UF do CRM | `aso_records.doctor_crm_uf` | — |
| Exames complementares (procedimento, data, resultado) | `aso_exam_details` (tabela filha de `aso_records`) | Um ASO pode ter múltiplos exames complementares |
| Médico coordenador do PCMSO (CPF, nome, CRM, UF) | `tenant_pcmso_physicians` (nova, por tenant, referenciada pelo `aso_record`) | Dado por empresa, não por exame — obrigatório quando há coordenador designado (INFERIDO) |
| Trabalhador do exame | `aso_records.employee_id` | FK para `employees` |
| Arquivo do ASO (PDF, se houver upload do documento físico) | `aso_records.file_key` | Segue o padrão R2 já usado em `documents` — opcional, não é o dado estruturado em si |

## 4. SST — PGR / riscos / agentes nocivos (S-2240, fora de escopo desta fase)

Documentado para referência futura — **nenhuma tabela nova é criada nesta fase**.

| Informação eSocial | Tabela atual | Existe? |
|---|---|---|
| Inventário de risco / GHE | — | Não — hoje só PDF genérico categorizado `pgr` em `documents` |
| Agente nocivo + intensidade/unidade | — | Não |
| Medida de controle / EPI de proteção | `tenant_epis`, `employee_epi_deliveries`, `epi_catalog_items` | Parcial — EPI existe bem estruturado (catálogo NR-06 + entrega), mas sem vínculo a agente/risco específico do S-2240 |
| CA do EPI | `tenant_epis.ca_number/ca_valid_until` + espelho `caepi_records` | Sim, já estruturado |

## 5. Acidentes / CAT (S-2210, fora de escopo desta fase)

| Informação eSocial | Tabela atual | Existe? |
|---|---|---|
| Registro de acidente (data, hora, local, descrição, natureza) | — | Não — zero vestígios no código hoje |
| Testemunhas, documentos, fotos | — | Não |

## 6. Novas tabelas — visão consolidada (Sub-projeto 1)

Todas com `tenant_id NOT NULL`, `FORCE ROW LEVEL SECURITY`, policy padrão de 3 ramos
(admin / dono do tenant / técnico vinculado), pegas automaticamente pelo
`tenant-isolation-sweep.e2e-spec.ts`.

- `esocial_certificates` — metadados do certificado (titular, CNPJ/CPF, validade,
  status, thumbprint), referência ao blob PFX cifrado em R2, data key cifrada
  (envelope encryption) — nunca a senha em texto puro
- `esocial_events` — evento eSocial genérico (tipo, payload completo versionado, estado,
  `nr_recibo`, ambiente, `idempotency_key`, referência à versão de leiaute usada)
- `esocial_event_history` — trilha append-only de transições de estado (mesmo padrão de
  proteção via `REVOKE UPDATE/DELETE` do `audit_log`)
- `esocial_layout_versions` — versão vigente do leiaute + endpoints por ambiente
- `aso_records` + `aso_exam_details` — módulo `aso/` novo
- `tenant_pcmso_physicians` — médico coordenador do PCMSO por tenant

Colunas exatas (tipos, constraints, índices) ficam para a Task de migration no plano de
implementação — este documento mapeia a necessidade, não o DDL final.

## 7. Alterações em tabelas existentes

| Tabela | Coluna nova | Motivo |
|---|---|---|
| `company_units` | `cnae`, `esocial_establishment_code` | Identificação do estabelecimento no eSocial |
| `employees` | `registration_number` (matrícula), `esocial_category_code`, `esocial_vinculo_confirmed_at`, `esocial_vinculo_confirmed_by_user_id` | Campos obrigatórios do `ideVinculo` + confirmação manual de pré-requisito |
| `positions` | `cbo_code` | Obrigatório no eSocial para função (`ideVinculo` referencia via cargo do trabalhador) |

Nenhuma dessas alterações remove ou duplica dado existente — todas são colunas
adicionais, seguindo o padrão já usado no histórico de migrations do projeto (ex.
`0035_positions.sql` adicionou `position_id` a `employees` sem remover o campo texto
`position`).
