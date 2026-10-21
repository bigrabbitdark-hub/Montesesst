# Painel de Atuação — Fase 5: documentos e assinatura interna — Design

Data: 2026-10-20 · Status: decisões do proprietário recebidas (colagem de 2026-10-20), plano 5A escrito · Auditoria: `docs/superpowers/audits/2026-10-20-painel-atuacao-fase5-documentos.md` (+ complemento abaixo).

## 1. Decisões do proprietário (vinculantes)
1. **Assinatura na v1 = registro de assinatura interna.** Registra o usuário autenticado, data/hora, a **versão exata** do documento (hash SHA-256), histórico de eventos e etapas distintas (elaboração, revisão, aprovação, assinatura). A interface exibe sempre o aviso: *"Registro de assinatura interna do sistema. Não é certificado digital ICP-Brasil e não garante, por si só, validade jurídica em todos os casos."* **Nunca** chamar de "assinatura digital", "ICP-Brasil" ou afirmar que atende a exigências legais. ICP-Brasil/gov.br: avaliação futura, separada.
2. **Matriz de responsabilidades nasce vazia.** Por tipo de documento: quem pode elaborar, revisar, aprovar, assinar e publicar. Sem linha = ação bloqueada para todos. Profissão/cargo isolados nunca liberam ação. O admin gerencia a matriz mas **não a contorna** (não elabora, revisa, aprova, assina nem publica sem entrada).
3. **Registros profissionais não são inventados.** O sistema só guarda o que o admin cadastrar; o registro precisa estar **confirmado** (conferido pelo admin) para permitir assinar. Nenhum dado profissional entra em migration, seed, teste ou código. Os dados da Évelyn "informados anteriormente" **não foram recebidos de forma verificável** e não serão usados; os do Danilo ainda não existem.
4. **Seguir com a Fase 5** reaproveitando o que existe e criando estruturas novas só onde há lacuna demonstrada; sem segunda linhagem incompatível de documentos; integração planejada para evitar duplicidade e perda de histórico.
5. **Geração automática de documentos fora da v1** (upload do arquivo elaborado).

## 2. Complemento da auditoria das linhagens (VERIFICADO)
| Estrutura | Onde | Serve ao fluxo? |
|---|---|---|
| Repositório `documents` (categoria, arquivo no R2, vencimento, unidade, RLS, download sob RLS) | main + linhagens de validade e relatório de visita | **Reaproveitar como destino da publicação** (cliente, vencimento, conformidade e RAG já leem dali) |
| `R2Service` (`putObject`, `getObject`, URL de download), `verifyFileContent`, tipos permitidos | `common/r2`, `common/files`, `documents.service` | **Reaproveitar** para armazenar versões |
| Padrão de histórico imutável (`task_events`, 0093) e de guarda por trigger (0094) | painel | **Reaproveitar o padrão** |
| Aprovação de ata da CIPA (`cipa_meetings.status_ata`, "aprovada", reabrir) | CIPA | Específica da ata; **não generalizar nem migrar**; continua como está |
| Assinatura de inspeção (`*_signature_name/_at`) | inspections | Nome digitado + data, sem versão/hash; **fora do fluxo**, não alterar |
| Reconhecimento de EPI com token+PIN, hash e evidência (0083, linhagem EPI) | feat/epi-estoque | Fluxo do **funcionário**, ligado a entregas; **só referência de desenho** (hash + evidência), não reaproveitável como tabela |
| Rascunhos de ata por IA (`cipa_meeting_ata_drafts`) | CIPA | Rascunho de texto, sem versões de arquivo; não serve |
| Versionamento / revisão / aprovação / assinatura genéricos | — | **Inexistente em qualquer linhagem** → lacuna demonstrada |
| Documento-padrão Montese (marca d'água, rodapé, modelo de relatório) | `docs/reference/identidade-documentos-oficiais` | Útil na futura **geração** (fora da v1) |

**Conclusão:** criar apenas as tabelas do fluxo (rascunho, versões, eventos, assinaturas internas, matriz, registros profissionais); a **publicação grava em `documents`** (sem duplicar o repositório) usando a mesma chave do arquivo no R2 (sem cópia, sem reenvio). A publicação não altera `documents.service.ts` (arquivo com mudanças não commitadas de outra frente): a inserção é feita pelo novo módulo, e a indexação RAG pós-publicação **fica fora da v1** (registrada como pendência).

## 3. Modelo (tabelas novas, todas com RLS: só `socio` na carteira Montese e `admin`; empresa/técnico/parceiro sem acesso até a publicação)
- `document_drafts`: tenant, categoria (valor de `documents.category`), título, unidade opcional, `status` (`em_elaboracao | em_revisao | aprovado | assinado | publicado | cancelado`), versão atual, `published_document_id`, criador, datas.
- `document_draft_versions` (append-only): arquivo no R2, nome, mime, tamanho, **SHA-256 calculado no servidor**, autor, nota.
- `document_draft_events` (append-only): tipo (`created`, `version_added`, `submitted`, `returned`, `reviewed`, `approved`, `signed`, `published`, `cancelled`), ator, versão, nota.
- `document_draft_signatures` (append-only): versão, signatário, **snapshot** do registro profissional confirmado (conselho/número/UF), hash da versão, IP, user-agent, data/hora.
- `document_type_permissions` (matriz): `(categoria, user_id, ação)`, ação ∈ `elaborar|revisar|aprovar|assinar|publicar`; sem linhas por padrão.
- `professional_registrations`: usuário, conselho, número, UF, `status` (`pendente | confirmado`), `confirmed_by`, `confirmed_at`; sem dados semeados.
- `documents`: **única alteração** — `uploaded_by_role` passa a aceitar `socio`, e policies `documents_socio_select`/`documents_socio_insert` limitadas à carteira Montese.

## 4. Regras do fluxo (aplicadas no servidor; o frontend só reflete)
- `em_elaboracao → em_revisao` (submeter; exige ≥1 versão e permissão `elaborar`).
- `em_revisao → aprovado` (aprovar; `aprovar`) ou `→ em_elaboracao` (devolver com nota; `revisar`). **Revisar e aprovar ≠ elaboração:** o autor da versão em revisão **não** pode ser quem revisa essa versão (separação de funções).
- `aprovado → assinado` (assinar; `assinar` **e** registro profissional `confirmado`); grava assinatura vinculada à **versão atual e ao seu hash**.
- `assinado → publicado` (publicar; `publicar`): cria linha em `documents` com o arquivo da versão assinada; o cliente passa a enxergar. Antes disso nada é "aprovado/assinado" para o cliente.
- **Nova versão** em qualquer estado ≠ `publicado`/`cancelado` volta o rascunho para `em_elaboracao` e **invalida** revisão, aprovação e assinatura anteriores (as linhas permanecem no histórico; só valem para a versão a que se referem).
- `cancelado` é terminal; `publicado` é terminal (correções = novo rascunho que referencia o anterior em nota).
- Matriz vazia ⇒ toda ação restrita é negada com mensagem clara ("Ação não habilitada para este tipo de documento. Peça ao administrador para configurar as responsabilidades.").
- Documentos sem informações essenciais não são publicados: v1 exige título, categoria, arquivo válido e, quando a categoria tem vencimento, a data de vencimento informada no momento de publicar (a lista de categorias com vencimento obrigatório é configuração do admin, **vazia por padrão**; não é presumida).

## 5. Interface (5B)
Telas em `/atuacao/documentos`: lista de rascunhos por estado, detalhe com linha do tempo, versões, ações permitidas ao usuário, aviso fixo da assinatura interna, e mensagens claras de ação bloqueada. Admin: configuração da matriz e dos registros profissionais por API (tela depois).

## 6. Auditoria, segurança e LGPD
Eventos acima + `audit_log` (`document_draft.*`) sem texto livre; download de versões sempre sob RLS e URL temporária; arquivos validados por conteúdo; retenção/LGPD do texto livre segue pendente do proprietário.

## 7. Fora de escopo da v1
Geração automática de documentos; ICP-Brasil/gov.br; indexação RAG após publicar; tela de admin para a matriz; assinatura em lote; notificações; edição do conteúdo dentro do sistema.
