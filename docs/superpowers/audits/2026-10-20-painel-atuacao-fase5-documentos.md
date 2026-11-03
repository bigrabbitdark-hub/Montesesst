# Auditoria da Fase 5 — documentos e assinaturas (somente leitura)

Data: 2026-10-20. Nenhum código, banco ou configuração foi alterado. A Fase 5 é a maior lacuna do projeto e precisa de spec própria antes do plano; esta auditoria fundamenta essa spec.

## O que existe hoje (VERIFICADO)
- **`documents` (0008 + 0012/0020/0032/0053 + 0080 na árvore):** repositório de arquivos por `tenant_id`: `category` (CHECK com `pgr, pcmso, laudo, ficha_epi, treinamento, cipa_*, ltcat, lip`), `title`, `file_key` (R2), `file_name`, `mime_type`, `size_bytes`, `expires_at`, `company_unit_id`, `uploaded_by_user_id`, `uploaded_by_role` (CHECK de papéis de upload), `inspection_id` (0080, não commitado). **Não há status de fluxo, versão, revisor, aprovador nem signatário.**
- **Rotas (`documents.controller.ts`):** `POST /documents` (upload multipart), `POST classify-batch`, `GET` lista, `GET compliance`, `GET compliance/portfolio`, `GET :id/download` (URL de download gerada no momento, sob RLS), `DELETE :id`. Roles: `empresa`, `tecnico`, `parceiro` (e `admin` no DELETE). **Sem ramo para `socio`.**
- **RLS:** `documents_isolation` (admin, o próprio tenant, técnico/parceiro vinculados). O download é checado no momento da requisição pelo RLS (bom: sem link permanente).
- **Satélites:** `company_document_chunks` (RAG/IA), `document_checklist_findings` (extração de profissional/data), `cipa_meetings.ata_document_id`, `document_validity_rules` (linhagem `feat/documentos-validade`, migration 0079 própria).
- **Assinaturas existentes (nenhuma é genérica nem de valor legal):**
  - `inspections`: `technician_signature_name/_at` e `company_signature_name/_at` — nome digitado + carimbo de tempo, sem evidência (hash, IP, versão).
  - Linhagem EPI (`feat/epi-estoque`, 0083): fluxo robusto para o **funcionário** reconhecer entrega de EPI (token + PIN com hash, hash do termo, hash da assinatura, IP, user-agent, `evidence_sha256`, snapshot dos itens). É um **reconhecimento**, não assinatura qualificada, e não serve a documentos técnicos.
  - Linhagem eSocial (`feat/esocial-transmissao`): usa certificado A1 só para transmitir eventos; não assina documentos.
- **Geração de documentos:** existe geração de PDF para inspeção/relatório de visita e (linhagem) tabela de funcionários. **Não existe gerador de PGR/LTCAT/laudo.**
- **Dados do profissional:** `technicians.registration_number` existe para técnicos; **o sócio não tem registro profissional cadastrado** (CREA/CFT/etc.) em lugar nenhum.

## Lacunas comprovadas
1. Estado do documento (rascunho → revisão → aprovado → assinado → publicado) e **histórico imutável** das etapas.
2. **Versionamento** do arquivo (cada versão com hash SHA-256).
3. **Quem pode elaborar, revisar, aprovar e assinar cada tipo de documento** (competência profissional). Isso é matéria regulatória: **não pode ser inventada nem fixada no código**. Precisa ser uma matriz configurável por tipo de documento, definida pelo proprietário/responsáveis técnicos, com fonte oficial quando houver (AGENTS.md: nunca inventar norma).
4. Registro profissional dos sócios (número e conselho) — dado do proprietário, não deduzível.
5. Regras de "informações essenciais" por tipo antes de gerar versão definitiva.
6. Acesso do `socio` a `documents` (hoje inexistente) e `uploaded_by_role` sem valor para sócio.

## Riscos de conflito com outras linhagens
- Linhagens em andamento alteram `documents` (`valid_from`, `expires_source`, `validity_months_applied` em 0079; `inspection_id` em 0080; tabela de validade; relatório de visita). Mexer em colunas de `documents` agora aumenta o conflito de merge. **Recomendação:** o fluxo vive em **tabelas novas** que apontam para `documents`, e só a **publicação** cria/atualiza uma linha em `documents` (alteração mínima: permitir o papel `socio` em `uploaded_by_role`).
- A numeração das migrations já está duplicada entre linhagens (0079); as migrations do painel (0090+) precisarão de renumeração no merge.

## Desenho proposto (para a spec da Fase 5)
- **Tabelas novas (internas da Montese, RLS do `socio` e do admin; empresa/técnico/parceiro sem acesso até a publicação):**
  - `document_drafts` (tenant, tipo/categoria, título, unidade, responsável pela elaboração, estado, `published_document_id`, prazos).
  - `document_draft_versions` (arquivo no R2, nome, tipo, tamanho, **SHA-256**, autor, nota) — append-only.
  - `document_draft_events` (transições: elaborou, enviou à revisão, revisou/devolveu, aprovou, **registrou assinatura**, publicou, cancelou; ator; versão; nota) — append-only.
  - `document_type_roles` (matriz **configurável** tipo × função: quem pode `elaborar|revisar|aprovar|assinar`) — preenchida pelo admin; **sem valores padrão inventados**: sem linha = ninguém além do admin.
  - `professional_registrations` (usuário, conselho, número, UF, validade opcional) — preenchido pelo admin com dados fornecidos pelo proprietário.
- **Fluxo (servidor decide):** rascunho → em revisão → aprovado → assinado → publicado (+ cancelado/devolvido). Regras: quem elabora não revisa o próprio documento; aprovar e assinar são etapas distintas; só profissional habilitado na matriz para aquele tipo pode assinar; cada etapa referencia a **versão e o hash**; qualquer nova versão invalida aprovação/assinatura anteriores.
- **"Assinatura" na v1 = registro de assinatura interna**, não assinatura digital qualificada: grava signatário, registro profissional, versão, hash do arquivo, data/hora, IP e user-agent, e a tela deve dizer explicitamente "Registro de assinatura no sistema — sem certificado digital ICP-Brasil". Assinatura com valor legal (ICP-Brasil/gov.br/provedor) é integração separada, com decisão de fornecedor e custo do proprietário; o modelo já guarda hash e versão para permitir isso depois.
- **Publicação:** cria a linha em `documents` (reaproveita lista da empresa, vencimento, RAG, auditoria de conformidade) e só então o cliente enxerga. O sistema **impede** publicar/exibir como "aprovado/assinado" fora desse estado.
- **Geração a partir de modelos:** fora da v1 (upload do arquivo elaborado). Geradores por tipo exigem fonte normativa e revisão técnica própria.

## Decisões necessárias do proprietário (bloqueiam a spec)
1. **Assinatura com valor legal:** confirmar que a v1 usa apenas o **registro de assinatura interna** (explícito na tela) e que ICP-Brasil/gov.br fica para depois.
2. **Competências:** quem pode elaborar/revisar/aprovar/assinar cada tipo de documento (PGR, LTCAT, laudos, PCMSO, treinamentos…). Você (ou os responsáveis técnicos) preenche a matriz; eu **não** deduzo da profissão do Danilo e da Évelyn.
3. **Registros profissionais** do Danilo e da Évelyn (conselho, número, UF) para o cadastro — fornecidos por você.
4. **Ordem de merge:** a Fase 5 depende de como as linhagens de documentos (validade, relatório de visita) serão integradas; quer que a Fase 5 espere o merge dessas linhagens ou prossiga em tabelas novas (recomendado)?
