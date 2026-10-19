# Tabela oficial de funcionários + ingestão documental — design

Data: 2026-10-13 · Status: aprovado em conversa, aguardando revisão da spec pelo proprietário.
Rótulos: VERIFICADO (lido no código/planilha) · NÃO VERIFICADO · RECOMENDADO.

## 1. Objetivo
Uma única fonte oficial de dados cadastrais por funcionário (a tabela `employees` existente, estendida), exibida e editável no setor Funcionários do dashboard da empresa, alimentada por cadastro manual, edição da tabela e extração automática de documentos enviados pelo RH — com revisão de conflitos e histórico campo a campo.

## 2. Modelo de referência (VERIFICADO em `data/Cadastro Funcionários - Laudos e eSocial.xlsx`)
Aba `Plan1`, cabeçalho na linha 8, dados a partir da linha 10 (20 linhas disponíveis; linhas 30–35 são observações e devem ser ignoradas pelo parser):

| Coluna | Campo | Coluna no banco | Observação |
|---|---|---|---|
| Qtde | sequencial | — (calculado na tela) | nunca é identificador |
| Funcionário | nome | `full_name` (existe) | |
| Matrícula esocial | matrícula | `registration_number` (existente, 0069; única matrícula — decisão do dono em 2026-10-19) | texto, 11 dígitos no modelo |
| CPF | CPF | `cpf` (existe) | modelo traz com máscara; banco guarda 11 dígitos |
| Data de nascimento | | `birth_date` (existe) | `DATE`, sem fuso |
| Sexo F/M | | `sex` (nova) | `CHECK IN ('F','M')` |
| Função/Cargo | | `position` (existe) | `position_id` preservado |
| Data de Admissão | | `admission_date` (existe) | |
| CBO | | `cbo_code` (nova) | texto 6 dígitos; no Excel vem às vezes como número → normalizar com padding |
| Descrição da atividade | | `activity_description` (nova) | opcional (vazia no modelo) |

Empresa e CNPJ vêm do topo da planilha; **filial não consta** — vem do contexto da tela (`company_unit_id`).

## 3. Decisões do proprietário
1. Conflito com dado já cadastrado → **sempre revisão manual**. Auto-aplica só campos vazios de funcionário identificado com certeza por CPF.
2. Histórico guarda **valores completos, exceto CPF mascarado**; visível só à empresa dona e ao admin.
3. Extração **híbrida**: planilha/CSV determinísticos sem IA; regex local para CPF/datas/matrícula/CBO; MiniMax só para o restante, com CPF/matrícula trocados por marcadores e trecho literal obrigatório. Imagem/PDF escaneado → "ilegível, revisão manual" (sem OCR até autorização).
4. Funcionário **novo** vindo de documento nunca é criado direto: vai para revisão (respeita limite de plano).

## 4. Banco (migration aditiva, próxima numeração livre — hoje `0080`; ver numeração em PROJECT_STATE item 5)
- `employees` + 3 colunas nullable (`sex`, `cbo_code`, `activity_description`); a matrícula é a coluna existente `registration_number` (0069), sem coluna nova. Sobre ela: CHECK de formato `NOT VALID` e índice único parcial `(tenant_id, registration_number) WHERE registration_number IS NOT NULL`, cada um criado só se os dados atuais permitirem (senão RAISE NOTICE e a regra fica só na aplicação; ver o cabeçalho da 0080). Nada removido.
- `employee_field_history` (append-only; RLS + FORCE RLS; `REVOKE UPDATE, DELETE, TRUNCATE` da role da aplicação, como `audit_log`): tenant_id, employee_id, field, old_value, new_value (CPF mascarado), actor_user_id, actor_role, source (`cadastro|tabela|documento|revisao`), document_id, extraction_id, changed_at.
- `employee_document_extractions`: tenant_id, document_id, content_hash, status (`processando|aplicado|requer_revisao|sem_dados|ilegivel|erro`), candidates JSONB (campos, confiança, trecho, resultado do casamento, conflitos), resolved_by/at. Único por (tenant_id, document_id, content_hash) → idempotência. Valores brutos são apagados ao resolver. RLS + FORCE RLS.
- Aplicação em produção **somente com autorização**; testes em ambiente descartável.

## 5. Backend
- `GET /employees` (paginação, filtro por filial, numeração calculada). `PATCH /employees/bulk` (atômico, validação completa, trava otimista por `updated_at`, grava só o que mudou + histórico). `GET /employees/:id/history`.
- `EmployeeIngestionService` (único): detector local de documento cadastral → extração (determinística; MiniMax por último) → normalização (CPF com dígito verificador, CBO 6 dígitos, datas sem fuso, sexo F/M) → casamento **só por CPF no tenant** → auto-aplicar campos vazios / enviar divergências e novos para revisão. Nome parecido nunca une nem cria; nunca transfere entre filiais; nunca exclui duplicata.
- `POST /employees/documents` (upload pelo setor, reaproveita `DocumentsService.upload`), `GET /employees/extractions/:id`, `POST /employees/extractions/:id/resolve` (decisão registrada).
- Fluxos de upload existentes chamam o mesmo serviço após o upload, fora de transação (padrão do indexador de embeddings). Documento sem dado cadastral só é armazenado.
- Permissões validadas no backend (`empresa`/`admin`; técnico/parceiro conforme vínculo de tenant já existente); tenant sempre do token; `company_unit_id` conferido contra o tenant.
- Logs sem conteúdo de documento nem CPF.

## 6. Frontend
Nova página `/empresa/funcionarios` + item no menu lateral da empresa. Tabela de 10 colunas (cartões em tela pequena). Botões: Anexar documento, Atualizar tabela (relê do backend), Editar tabela, Confirmar alterações, Cancelar. Células alteradas destacadas; sucesso só após resposta do backend. Cadastro manual na mesma página, painel de revisão (novo/alterado/conflitante), gaveta de histórico. Onboarding (`FuncionariosForm`) segue funcionando, mesma tabela.

## 7. Fatias (aprovação do proprietário entre cada uma)
1. Migration + API + tabela editável + cadastro manual.
2. Histórico campo a campo.
3. Ingestão determinística + revisão.
4. IA híbrida + integração dos demais fluxos de upload.

## 8. Testes (os 17 itens do pedido)
Executados em ambiente descartável isolado (e2e atuais apontam para produção — PROJECT_STATE item 9). Inclui: cadastro/edição/cancelamento/persistência, upload e extração, auto-aplicação sem conflito, revisão, ilegível/sem campos, múltiplos funcionários, duplicidade, zeros à esquerda (matrícula/CBO), isolamento entre empresas/filiais, histórico, registros antigos, fluxos de documento existentes. Revisão final de QA e segurança por agentes diferentes de quem implementa.

## 9. Riscos / pendências
- NÃO VERIFICADO: fluxos de upload do Pente-Fino e CIPA/treinamentos e categorias de documento aceitas — confirmar na fatia 4.
- Índice único de matrícula pode colidir com dados legados duplicados → checar antes de aplicar.
- Sem OCR: escaneados caem em revisão manual.
- Árvore com ~97 alterações não commitadas de outras frentes; implementação deve ocorrer em branch/worktree próprio (decisão do proprietário).
