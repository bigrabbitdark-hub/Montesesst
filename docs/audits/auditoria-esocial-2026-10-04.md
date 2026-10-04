# Auditoria do eSocial SST — andamento e o que falta

**Data:** 2026-10-04 (leitura feita entre 22:30 e 23:00 UTC)
**Escopo:** módulo eSocial SST, Sub-projeto 1 (Fundação + Certificado + piloto S-2220) e o roadmap dos Sub-projetos 2 a 6.
**Natureza:** somente leitura. Nenhum arquivo do código do eSocial foi alterado, nenhum teste e2e foi executado e nenhum
banco foi tocado. O executor (outro fluxo, com Cline e MiniMax) continua trabalhando na worktree
`.claude/worktrees/esocial-sst-subprojeto1`; esta auditoria é uma fotografia do estado às 22:36 UTC.
**Rótulos (AGENTS.md):** VERIFICADO = conferi no código, no git ou rodando algo. INFERIDO = dedução com base no que li.
NÃO VERIFICADO = não consegui conferir. RECOMENDADO = sugestão minha.

---

## 1. Resumo executivo

| Pergunta | Resposta curta |
|---|---|
| **Quanto está pronto?** | **12 das 23 tasks** do Sub-projeto 1 (52%). Todas são **base**: banco, criptografia, cadastro de ASO e upload de certificado. |
| **O eSocial funciona hoje?** | **Não.** Nenhum evento é gerado, assinado ou transmitido. Falta toda a parte que "fala com o governo" (tasks 13 a 19). VERIFICADO. |
| **Critérios de aceite cumpridos?** | **Nenhum cumprido por completo com e2e comprovado.** 1 verde, 7 parciais, 4 não iniciados (seção 3.3). |
| **A base entregue é boa?** | **Sim, no essencial.** RLS forçada em todas as tabelas, criptografia correta, senha do certificado fora de logs e do `audit_log`, histórico append-only. Nenhum segredo exposto foi encontrado. |
| **O que me preocupa?** | (1) **não dá para integrar na `main` como está** (numeração de migrations e variável de ambiente que derruba o backend); (2) **o plano tem lacunas**: ninguém cria o evento nem preenche matrícula/CBO/CNAE, e o cron **assinaria e transmitiria sozinho** qualquer rascunho, sem autorização humana (G-03); (3) dois testes foram **apagados** para o build passar; (4) 18 achados técnicos (seção 5), nenhum crítico; **um deles (E-18) é de processo e envolve credenciais de produção**. |
| **O que preciso de você?** | 5 decisões (seção 7). As duas mais urgentes: **destino da migration 0063 do PDF** e **política da chave mestra** do certificado. |
| **Falta o quê, no total?** | As 11 tasks restantes, **4 lacunas do plano**, **pré-requisitos externos** (certificado A1 real, credenciamento, XSD oficial, validação jurídica da LGPD) e os **Sub-projetos 2 a 6** (S-2240, S-2210, procuração, central de rejeições, observabilidade). |

**Leitura honesta:** o que existe é o alicerce, e está bem feito. A parte difícil e arriscada (XML do governo, assinatura digital,
transmissão com certificado do cliente) **ainda não começou**. Por contagem de tasks está na metade, mas o esforço e a
incerteza restantes são maiores do que os já gastos (INFERIDO: as tasks 13 a 19 dependem de documentos oficiais que o spec
declara não terem sido lidos).

---

## 2. O que é o eSocial no Montese (contexto)

O eSocial é o sistema do governo em que as empresas informam dados trabalhistas e de SST. O Montese quer **transmitir os eventos
de SST** em nome do cliente, hoje feitos fora do sistema. Decisões já tomadas com o fundador (spec `esocial-arquitetura.md`):

- **Eventos de SST apenas:** S-2210 (acidente), S-2220 (saúde do trabalhador, o ASO), S-2240 (condições ambientais), S-3000 (exclusão).
  Eventos de tabela e vínculo (S-1000, S-2200, S-2300, S-2190) são da folha do cliente: o Montese depende deles e nunca os envia.
- **Piloto:** S-2220.
- **Certificado digital do cliente (A1)** guardado pelo Montese, com criptografia em envelope. É uma responsabilidade legal maior
  do que a procuração, e o spec registra isso como escolha consciente.
- **Ambiente:** o Sub-projeto 1 opera **só em Produção Restrita** (ambiente de testes do governo, sem efeito legal).
- **Infra:** `@nestjs/schedule` (cron), sem fila nova.
- **`PRODUCT.md` hoje afirma que o envio automatizado ao eSocial NÃO existe** (linha 39). VERIFICADO. Só deve mudar depois da
  validação em Produção Restrita (princípio "nunca apresentar roadmap como funcional").

### Os 6 sub-projetos

| # | Sub-projeto | Estado |
|---|---|---|
| 1 | Fundação + certificado + piloto S-2220 | **Em andamento (12/23 tasks)** |
| 2 | Procuração eletrônica (Montese como procuradora) | Não iniciado |
| 3 | S-2240 (condições ambientais): exige módulo novo de inventário de risco e agentes nocivos | Não iniciado; **pré-requisito de dado inexistente** |
| 4 | S-2210 (acidente) + S-3000 generalizado: exige módulo novo de acidente/CAT | Não iniciado; **pré-requisito de dado inexistente** |
| 5 | Central eSocial (UI completa, central de rejeições, notificações) | Não iniciado |
| 6 | Observabilidade + integração com o Assistente Montese SST | Não iniciado |

---

## 3. Andamento do Sub-projeto 1

### 3.1 As 23 tasks

| Task | O que é | Estado | Evidência |
|---|---|---|---|
| 1 | Migration `esocial_layout_versions` (S-1.3 + URLs de Produção Restrita) | ✅ | `e88f2e6`; migration lida |
| 2 | Migration `esocial_certificates` | ✅ | `432ed2b` |
| 3 | Migration ASO (`aso_records`, `aso_exam_details`, `tenant_pcmso_physicians`) | ✅ | `b4c49e5` |
| 4 | Migration `esocial_events` + `esocial_event_history` (append-only) | ✅ | `5bb67cf` |
| 5 | Colunas de pré-requisito (CNAE, matrícula, categoria, CBO...) | ✅ só schema | `9ed1c4f`; **sem API/tela para preencher** (lacuna G-01) |
| 6 | Variável `ESOCIAL_CERT_ENCRYPTION_KEY` (fail-fast em produção) | ✅ | `5ecda06`; **ver achado E-02** |
| 7 | `envelope-crypto.util.ts` (AES-256-GCM) | ✅ | `ce95650`; 5 testes unitários passam |
| 8 | `certificate-crypto.service.ts` (seal/unseal) | ✅ | `32f0741`; 3 testes passam |
| 9 | `pkcs12.util.ts` (ler .pfx) | ✅ | `e23cc82`, `d505e1d`; 3 testes passam; **ver E-04** |
| 10 | Módulo ASO (service, controller, DTOs, RLS) | ✅ | `6749e09`, `1687173`; **ver E-06, E-09, E-12** |
| 11 | `CertificatesService` (upload, listar, remover, carregar para assinar) | ✅ | `947146c`; **ver E-05, E-10** |
| 12 | `CertificatesController` + teste de RLS dedicado | ✅ **commitada hoje** | `a45b7fd`, `d714bbb`, `d266553` (22:22 a 22:28 UTC) |
| 13 | Verificar o XSD oficial + `s2220-event-builder` | ❌ | não iniciada |
| 14 | `xml-generator.service` (payload → XML) | ❌ | não iniciada |
| 15 | `xml-signer.service` (assinatura XMLDSig) | ❌ | não iniciada; dependência `xml-crypto` ainda não instalada |
| 16 | `esocial-diagnostics.service` (o que falta antes de transmitir) | ❌ | não iniciada |
| 17 | Cliente SOAP + mTLS | ❌ | não iniciada; dependência `soap` ainda não instalada |
| 18 | `transmission-queue.cron` (máquina de estados) | ❌ | não iniciada |
| 19 | API de status (`GET /esocial/status`) | ❌ | não iniciada |
| 20 | Tela mínima de status no frontend | ❌ | não iniciada; **o caminho do plano não existe** (E-15) |
| 21 | Suíte completa de testes do sub-projeto | ❌ | verificação final |
| 22 | Atualizar `PRODUCT.md` | ❌ | só depois da Task 23 |
| 23 | Validação manual em Produção Restrita | ❌ | **exige certificado A1 real e credenciamento**; não automatizável |

**Resultado: 12 prontas, 11 pendentes (52% por contagem).**

### 3.2 Linha do tempo (git)

- **2026-09-29:** tasks 1 a 11 (migrations, criptografia, ASO, serviço de certificados), 13 commits na branch do executor.
- **Pausa de 5 dias** (de 29/09 a 04/10) sem commits.
- **2026-10-04, 22:22 a 22:28 UTC:** Task 12 (controller, e2e do serviço, RLS de certificados), 3 commits.
- **Às 22:36 UTC:** working tree com 2 arquivos de teste **apagados e sem commit** (E-03).

### 3.3 Os 12 critérios de aceite (spec `esocial-arquitetura.md`)

| # | Critério | Estado |
|---|---|---|
| 1 | Certificado A1 enviado, validado e guardado com envelope encryption | 🟡 **Quase:** código e testes unitários prontos; e2e **NÃO VERIFICADO por mim** (exige banco) |
| 2 | Senha nunca em log, resposta de API ou texto puro no banco | 🟢 **VERIFICADO por leitura:** só cifrada; `AuditInterceptor` e `request-logging` não gravam o corpo; resposta (`toSummary`) não devolve campo cifrado |
| 3 | Diagnóstico identifica o que falta antes de transmitir | 🔴 Não iniciado (Task 16) |
| 4 | XML do S-2220 gerado, assinado e validado | 🔴 Não iniciado (13 a 15) |
| 5 | Evento transmitido em Produção Restrita e consulta funcionando | 🔴 Não iniciado (17, 18, 23) |
| 6 | Sucesso (recibo) e rejeição (código e mensagem) armazenados | 🟡 Só as **colunas** existem; nenhuma lógica grava |
| 7 | Evento duplicado não gera segunda transmissão | 🟡 Só a restrição `UNIQUE (tenant_id, idempotency_key)` no banco; nenhuma lógica |
| 8 | `esocial_event_history` registra toda transição com ator e hora | 🟡 Tabela e `REVOKE` prontos; ninguém escreve nela ainda |
| 9 | Toda tabela nova passa no `tenant-isolation-sweep` | 🟡 Todas as 6 tabelas com `tenant_id` têm `ENABLE` e `FORCE` RLS (VERIFICADO por leitura); **sweep e2e NÃO executado por mim** |
| 10 | Teste de RLS dedicado para certificados **e eventos** | 🟡 Certificados: 2 testes commitados. **Eventos: o teste foi apagado** (E-03) |
| 11 | `PRODUCT.md` atualizado | 🔴 Não (Task 22) |
| 12 | Testes cobrindo certificado inválido/expirado, XML inválido, duplicado, cross-tenant, timeout | 🟡 Parcial: certificado inválido e cross-tenant de certificado; o resto depende das tasks 13 a 19 |

**Total: 1 verde (critério 2), 7 amarelos (1, 6, 7, 8, 9, 10, 12) e 4 vermelhos (3, 4, 5, 11).** Nenhum está plenamente cumprido
com e2e comprovado.

### 3.4 Testes: o que rodei e o que não rodei

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` do backend da worktree | **VERIFICADO: exit 0, 0 erros** (só passa porque os 2 testes com erro foram apagados, E-03) |
| Testes unitários do eSocial (`envelope-crypto` 5, `certificate-crypto` 3, `pkcs12-util` 3) | **VERIFICADO: 11/11 passam** |
| Suíte unitária inteira da worktree | **513/518.** As 3 suítes que falham (`normative-answer-shared`, `question-notices`, `r2-get-object`) são o baseline antigo, **nenhuma é do eSocial** |
| `tenant-context-callsites` e `env-validator` na base deles | Passam. O eSocial usa só `req.withTenantContext`, sem chamada direta |
| e2e do eSocial (aso 1, aso-rls 2, certificates-service 2, certificates-rls 2: **7 testes**) | **NÃO VERIFICADO:** exigem Postgres; não rodei |
| `tenant-isolation-sweep` (e2e) | **NÃO VERIFICADO** |
| Migrations aplicadas em banco de ensaio | O ledger afirma que as migrations 1 a 5 foram aplicadas de verdade e que o `REVOKE` foi reproduzido por revisor independente. **Não repeti.** |

---

## 4. O que falta

### 4.1 Tasks restantes do Sub-projeto 1 (13 a 23)

São 11 tasks, e as **mais arriscadas estão nelas**:

- **13 a 15 (XML + assinatura):** dependem do **XSD oficial** do `evtMonit` e do Manual de Orientação (MOS) S-1.3. O spec declara que os PDFs
  oficiais "retornaram como imagem não extraível" e que a estrutura do evento e o algoritmo de assinatura (RSA-SHA256 ou o SHA-1 histórico) são
  **INFERIDOS por fontes secundárias**. Nenhum pode virar constante sem confirmação humana contra o documento oficial.
- **17 e 18 (SOAP, mTLS, cron):** o WSDL real pode falhar com a geração dinâmica do `node-soap` (risco conhecido do spec). As URLs de **Produção real**
  não foram verificadas e ficam `NULL` no banco (correto).
- **16, 19, 20, 21, 22:** o Diagnóstico, a API de status, a tela, a bateria final e o `PRODUCT.md`.
- **23 (validação manual):** não é automatizável; precisa de **certificado A1 real** (ou de uma AC de teste), inscrição em Produção Restrita
  e conferência humana contra o Pacote de Comunicação oficial.

### 4.2 Lacunas do **plano** (coisas que nenhuma task cobre) — importantes

| ID | Lacuna | Por que importa | Severidade |
|---|---|---|---|
| **G-01** | **Nenhuma task cria API ou tela para preencher** matrícula, categoria eSocial, CBO, CNAE e código do estabelecimento (colunas da Task 5). Também **não há ação para "confirmar que o vínculo já existe no eSocial"**. | O Diagnóstico (Task 16) exige exatamente esses campos; sem eles **nunca passa com dados reais**, só com SQL manual. | **Alta** |
| **G-02** | **Nenhuma task cria ou dispara um evento.** O único `INSERT INTO esocial_events` do plano é um helper de teste (superusuário). A API de status (Task 19) e a tela (Task 20) são só leitura. | O cron (Task 18) só processa eventos já em `aguardando_transmissao`, mas **ninguém os cria nem os promove**. O fluxo "ASO → rascunho → transmitir" não tem porta de entrada. | **Alta** |
| **G-03** | **O cron do plano assina e transmite sozinho, sem autorização humana.** `PENDING_STATUSES = ['rascunho','assinado','transmitido','processando']` (plano, Task 18): todo evento que nascer em `rascunho` é montado, **assinado com o certificado do cliente e transmitido** em até 2 minutos. O spec (§5) diz que assinar "sempre roda como o usuário autenticado que disparou a transmissão, nunca como processo anônimo"; a linha de histórico do cron não tem `actor_user_id`; e os estados `validando` e `aguardando_transmissao` do spec não são usados. | Quando a G-02 for resolvida, **criar um rascunho já seria enviar**. Perde-se a rastreabilidade de quem autorizou na trilha legal. Precisa de uma etapa explícita de autorização humana, com o autor gravado no evento e no histórico. | **Alta** |
| **G-04** | **Não há ASO "completo" para o S-2220:** `aso_exam_details` (exames complementares) existe só como tabela, **sem endpoint**; `aso_records.file_key` (PDF do ASO) **sem upload**; `tenant_pcmso_physicians` só cria, **não lista, edita nem desativa**. | O bloco `exame` e o médico coordenador (`respMonit`) do S-2220 ficam sem fonte de dado. | Média |

### 4.3 Pré-requisitos externos (não dependem de código)

1. **Certificado A1 ICP-Brasil de teste** e inscrição em Produção Restrita (Task 23).
2. **XSD oficial e MOS S-1.3** baixados e lidos por uma pessoa (o spec lista 6 itens NÃO VERIFICADOS, entre eles prazo do S-2220, algoritmo
   de assinatura e URLs de Produção).
3. **Validação jurídica da LGPD** para o ASO (dado de saúde sensível, art. 5º, II): retenção, minimização, quem vê o resultado do exame.
4. **Decisão de produto do técnico autônomo** (iniciativa "Grande Evolução"): o eSocial assume empresa + médico PCMSO, a evolução propõe técnico autônomo.

### 4.4 Sub-projetos 2 a 6

Cada um é um ciclo próprio (spec, plano, implementação). Os sub-projetos **3 e 4** têm **pré-requisitos de dado que não existem** hoje
(inventário de risco estruturado; registro de acidente/CAT), ou seja, antes de o evento existir é preciso construir o módulo de origem.

---

## 5. Achados da auditoria do código entregue

Escala: **Alta** = bloqueia integração ou release; **Média** = corrigir antes de produção; **Baixa** = melhoria; **Info** = para saber.
Nenhum achado é **Crítico**: não encontrei segredo exposto no código nem vazamento entre tenants na base entregue. **E-18** é de processo (credenciais de produção em arquivo temporário), sem evidência de gravação em produção.

### 5.1 O que está bom (VERIFICADO)

- As **6 tabelas com `tenant_id`** (`esocial_certificates`, `esocial_events`, `esocial_event_history`, `aso_records`, `aso_exam_details`,
  `tenant_pcmso_physicians`) têm `ENABLE` + `FORCE ROW LEVEL SECURITY` e a política padrão de 3 ramos. `esocial_layout_versions` é global, de propósito.
- **Histórico append-only:** `REVOKE UPDATE, DELETE, TRUNCATE ... FROM montese_app`.
- **Criptografia correta:** AES-256-GCM, IV de 12 bytes **novo a cada operação**, `authTag` gravado, data key aleatória por certificado, chave mestra só em variável de ambiente (64 hex).
- **Senha do certificado:** nunca em texto puro; `AuditInterceptor` grava só método, caminho e status; `request-logging` não grava corpo; a resposta devolve só metadados.
- **O `.pfx` cifrado vai para o R2**, nunca para disco nem para coluna grande.
- **URLs de Produção real ficam `NULL`** até serem verificadas; as de Produção Restrita foram conferidas no gov.br em 2026-09-29.
- **Isolamento no código:** controllers usam só `req.withTenantContext`; nenhum `tenantId` vem do corpo (o `tenant-context-callsites` não precisa de entradas novas).
- **Dependências mínimas** até aqui (`node-forge`); `xml-crypto` e `soap` só entram nas tasks 15 e 17.
- **Mapeamento de acesso do certificado** segue a matriz do spec: `empresa` e `admin` cadastram e removem; `tecnico` só lê.

### 5.2 Achados

| ID | Sev. | Achado | Evidência | Correção sugerida |
|---|---|---|---|---|
| **E-01** | **Alta** | **Numeração de migrations colide com a `main`.** A frente usa `0061` a `0065`. A `main` já tem `0061_openrouter_credit_status` e `0062_minimax_usage_estimated_cost` (**ambas aplicadas em produção**), mais `0064_company_applicable_nrs` (NR) e a `0063` do PDF (na branch `wip/…`). | `ls backend/db/migrations` nas duas árvores | Renumerar as 5 do eSocial (a partir da `0065`, conforme o destino da `0063`), mantendo a ordem de chaves estrangeiras |
| **E-02** | **Alta** | **`ESOCIAL_CERT_ENCRYPTION_KEY` entra no fail-fast de produção:** o backend **não sobe** sem ela. O commit `5ecda06` também alterou `docker-compose.yml` (que é infraestrutura, exige sua autorização) e deixou `.env.example` com a chave vazia. Mesmo cenário do incidente do Google Calendar em 2026-09-30. | `common/config/env.validator.ts:29`; `docker-compose.yml:93`; `.env.example:147` | Decisão sua (seção 7): chave **obrigatória** (spec §2) com criação prévia no `.env`, ou **opcional** enquanto não houver transmissão (módulo 503 claro, padrão `0b2fe82`) |
| **E-03** | **Alta** | **Dois testes foram apagados no working tree do executor, sem commit:** `esocial-events-rls.e2e-spec.ts` (o único teste de RLS de eventos, que dava os 3 erros de tipo) e `esocial-layout-versions.unit-spec.ts` (checava que a migration não traz URL de Produção como fato). O `tsc` limpo se explica por isso. | `git status` da worktree: ` D` nos dois | Não aceitar a remoção como "correção": recriar o RLS de eventos junto com os helpers (`insertRawRow`, `getActiveLayoutVersionId`) e manter o teste do seed de URLs |
| **E-04** | Média | **`pkcs12.util` pega o primeiro certificado do arquivo** (`certBags[0]`). Arquivos A1 ICP-Brasil costumam trazer a **cadeia** (folha + intermediárias) em ordem qualquer: pode extrair o certificado errado (validade, titular, thumbprint errados). Só aceita `pkcs8ShroudedKeyBag` (rejeita chave não cifrada) e não confere tamanho de chave (2048 bits), uso da chave nem ICP-Brasil. | `pkcs12.util.ts` | Casar o certificado com a chave privada (`localKeyId` ou módulo da chave pública); validar tamanho de chave e `keyUsage`; testar com PFX de cadeia |
| **E-05** | Média | **Certificado expirado pode ser usado para assinar.** `loadRawPfxForTransmission` filtra só `status='ativo'`; **nada marca `expirado`** (não há cron) e `not_after` não é conferido no uso. | `certificates.service.ts` | Checar `not_after > now()` no uso e agendar atualização de status; alerta de vencimento |
| **E-06** | Média | **ASO aceita `employeeId` e `pcmsoPhysicianId` de outro tenant.** Chave estrangeira do Postgres **ignora RLS**: o `INSERT` passa se o UUID existir em qualquer tenant (e falha se não existir, o que revela a existência). Hoje exige conhecer o UUID. | `aso.service.ts` `createRecord`; `0063` | Validar, sob RLS, que o funcionário e o médico pertencem ao tenant (padrão `assertCompanyUnitBelongsToTenant`) |
| **E-07** | Média | **`ON DELETE CASCADE` contradiz a retenção.** O spec §8 manda reter XML, recibo e histórico "indefinidamente" (evidência legal). Mas excluir um `aso_record`, funcionário ou tenant **apaga em cascata** os eventos e o histórico. O `REVOKE` só barra a role da aplicação, não a cascata. | `0063`, `0064` | Trocar para `RESTRICT` nas relações de evidência; política de arquivamento em vez de exclusão |
| **E-08** | Média | **`esocial_layout_versions` está sem `REVOKE`:** a role da aplicação pode alterar as URLs de transmissão. Como a transmissão usa o certificado do cliente por mTLS, um bug ou injeção poderia redirecionar o envio a um endereço arbitrário. | `0061` | `REVOKE INSERT, UPDATE, DELETE ON esocial_layout_versions FROM montese_app` (alteração só por migration) |
| **E-09** | Média | **Admin e dado de saúde:** o spec (§3, §7) pede acesso do admin ao ASO **"com motivo registrado"**; não há captura de motivo. E o **upload de certificado por `admin` falha** (500: `tenant_id` nulo viola `NOT NULL`). O próprio relatório da Task 12 registrou esse concern; o e2e não cobre. | `certificates.controller.ts` (`@Roles('empresa','admin')`); `aso.controller.ts` | Remover `admin` do POST/DELETE ou receber o tenant alvo por rota validada; implementar motivo na leitura de ASO |
| **E-10** | Baixa | **Upload de certificado:** grava no R2 **antes** do `INSERT` (se o banco falhar, sobra objeto órfão); `remove` é soft-delete e **não apaga o R2**; sem `UNIQUE (tenant_id, thumbprint)` (o mesmo certificado entra várias vezes); `:id` sem `ParseUUIDPipe` (id inválido dá 500); sem rate limit próprio. | `certificates.service.ts`, `.controller.ts` | Inserir primeiro e gravar no R2 depois (ou limpar no erro); política de purga; índice único; pipe de UUID |
| **E-11** | Baixa | **Duplicação:** `envelope-crypto.util.ts` repete a lógica AES-GCM de `secret-crypto.util.ts` (Google). Sem `authTagLength` explícito no `setAuthTag` e sem AAD vinculando o dado ao registro. | `common/crypto/` | Refatorar para um núcleo único; passar `authTagLength: 16` |
| **E-12** | Baixa | **Validação fraca no ASO:** CPF sem dígito verificador, UF do CRM livre (2 caracteres), `doctorCrm` livre, data de exame aceita futuro; `employeeId` do GET sem validação de UUID. | DTOs e `aso.controller.ts` | Validadores de CPF/UF/data; `ParseUUIDPipe` |
| **E-13** | Info | `esocial_events.ambiente` aceita `'producao'` no `CHECK`. A regra "só Produção Restrita nesta fase" precisa ser **imposta no serviço**, não só por convenção. | `0064` | Teste que impede transmitir em `producao` enquanto o proprietário não liberar |
| **E-14** | Info | A **Task 12 teve apenas autorrevisão** (o ledger diz que subagentes não estavam disponíveis). Não houve revisor independente. | `task-12-report.md` | Esta auditoria cobre a leitura; revisar de novo antes do merge |
| **E-15** | Info | A Task 20 aponta `frontend/src/app/(app)/esocial/page.tsx`, **caminho que não existe**; o frontend usa `/empresa/...` e o menu novo já tem "eSocial" como "em construção". | plano; `lib/dashboard/menu.ts` | Adaptar a task ao padrão atual |
| **E-16** | Info | O ASO guarda `result` (apto/inapto) em texto puro no banco, sem criptografia em repouso. É dado de saúde; é decisão do projeto hoje, mas precisa constar da validação jurídica. | `0063` | Registrar na validação de LGPD |
| **E-17** | Info | O **CPF do médico** (`tenant_pcmso_physicians.cpf`) é dado pessoal em texto puro. | `0063` | Incluir no inventário de dados pessoais |
| **E-18** | **Alta** | **Segredos de produção usados pelo executor.** O script `/tmp/run-cert-e2e.sh` (22:54 UTC) lê dos containers de produção, via `docker exec`, a **senha do superusuário do Postgres, a senha da aplicação, a do Redis e o `JWT_SECRET`**, grava num `.env` em `/tmp` e roda o e2e no **banco de produção** com o `montese-backend:latest`, sem clone nem Redis descartável. O `.env` (`/tmp/jest-env-<pid>.env`) **ficou em disco** (o `rm` do script não rodou) e o processo ficou **pendurado** com o container ativo. Os testes falharam no bootstrap (faltam `GOOGLE_CLIENT_ID/SECRET`) antes de criar fixtures. | Verificado em leitura às 22:55 UTC: `esocial_certificates` **não existe** em produção; 63 migrations; **0 tenants e 0 usuários** criados nos últimos 45 min; 0 ocorrências de `postgresql://` no log. Nada foi gravado, mas as credenciais ficaram expostas em arquivo e variáveis de shell (root). | Parar o container e o script; apagar o `.env` temporário (**com sua autorização**); ensaio **só** em clone descartável (checklist, seção 6); regra explícita de **nunca ler credencial de produção de container** (memória do projeto). Avaliar rotação da senha do superusuário se o `.env` tiver sido lido por outro processo |

---

## 6. Integração com a `main` (o que precisa acontecer antes de qualquer release)

| Item | Situação |
|---|---|
| **Base defasada** | A worktree nasceu em 2026-09-29. A `main` evoluiu (NR, shell, skin, admin, higiene de testes). Conflitos prováveis em `app.module.ts`, `db-test-helper.ts`, `env.validator.ts` e no `docker-compose.yml` (INFERIDO). |
| **Migrations** | Renumerar (E-01). A `0063` do PDF define o próximo número livre. |
| **Variável de ambiente** | Resolver E-02 **antes** do build. A chave é segredo: **você** gera e guarda (`openssl rand -hex 32`); perdê-la torna os certificados irrecuperáveis. Eu não a gero nem a exibo. |
| **`docker-compose.yml`** | A alteração do `5ecda06` é infraestrutura: só com sua autorização, no release. |
| **Build** | O `nest build` compila `backend/test` inteiro. Sem os dois specs apagados o `tsc` passa; **recriar o teste de RLS de eventos** com os helpers, ou o critério 10 fica descoberto. |
| **Guardas de segurança** | `tenant-context-callsites`: a base deles passa; na integração a lista `ALLOWED` precisa acomodar também o cron de reconciliação (já feito na `main`, commit `0275696`) e o `sst-audit-facts.service` (frente do PDF, ainda não ligada). Não liberar sem revisar o `ctx`. |
| **Release** | backup → migrations → backend. **Sem frontend** enquanto a Task 20 não existir. Ensaio em clone do banco antes (padrão dos releases anteriores). |
| **`PRODUCT.md`** | Manter "não há envio ao eSocial" até a Task 23 ser cumprida. |

---

## 7. Decisões que dependem de você

1. **Destino da migration `0063` do PDF** (hoje só na branch `wip/auditoria-cruzada-pdf-base`): define a numeração do eSocial (E-01).
2. **Chave mestra do certificado** (E-02): **obrigatória** (spec §2; você cria a chave no `.env` antes do release) ou **opcional** enquanto não houver transmissão.
   Meu RECOMENDADO: opcional até a Task 17, porque evita derrubar o backend por uma funcionalidade que ainda não transmite.
3. **Retenção do certificado removido e do histórico** (E-07, E-10): prazo de purga do `.pfx` cifrado no R2 e proibição de apagar evidência em cascata. Depende da validação jurídica.
4. **Quem autoriza e assina** (G-03): confirmar que a transmissão registra **o usuário que autorizou**, e que o cron só executa o que um humano liberou.
5. **Prioridade do eSocial** frente ao release do shell/admin, ao release da NR e ao lote 3 de páginas, e o **modelo de produto** (empresa + médico PCMSO × técnico autônomo).

---

## 8. Recomendação e roteiro

**Não retomar as tasks 13 a 23 antes de fechar o que já existe.** Ordem proposta:

| Etapa | O quê | Quem | Bloqueia |
|---|---|---|---|
| 1 | Decidir os itens 1 e 2 da seção 7 | Você | Tudo |
| 2 | Corrigir **E-03** (recriar o teste de RLS de eventos e o do seed de URLs) | Executor (Cline) | Merge |
| 3 | Aplicar **E-04 a E-09** (certificado e ASO) com testes | Executor | Release |
| 4 | **Renumerar as migrations**, rebasear a worktree numa branch de integração, resolver conflitos | Executor, revisão minha | Release |
| 5 | **Ensaio em clone do banco**: aplicar as 5 migrations, rodar e2e (incluindo `tenant-isolation-sweep`), boot isolado sem a chave | Com sua autorização (banco e segredos) | Release da base |
| 6 | **Decidir e planejar as lacunas G-01 a G-04** antes de escrever as tasks 13 a 19 (sem elas o Diagnóstico e a transmissão não têm entrada) | Eu proponho, você aprova | Tasks 13+ |
| 7 | Tasks 13 a 19 com o XSD/MOS oficiais lidos por uma pessoa; Task 20 adaptada ao `/empresa` | Executor | Task 23 |
| 8 | Task 23 (certificado A1 real, Produção Restrita) e só então Task 22 (`PRODUCT.md`) | Você + executor | Critério de aceite |

**Estimativa:** não consigo dar prazo confiável (NÃO VERIFICADO). O que sei: as tasks 13 a 19 concentram a maior incerteza (documentos oficiais
não lidos, WSDL real, mTLS) e a Task 23 depende de terceiros (certificado e credenciamento).

**Contrato de revisão:** o checklist `docs/operations/checklist-revisao-esocial.md` já está pronto para aplicar sobre cada entrega do executor.
Os achados E-03, E-04, E-05, E-06, E-08 e E-09 devem entrar como critérios explícitos para a próxima rodada.

---

## 9. Anexos

### 9.1 Como reproduzir a verificação (somente leitura)

```bash
cd /opt/Montese/.claude/worktrees/esocial-sst-subprojeto1
git log --oneline main..HEAD                       # commits do eSocial
git status --short                                 # 2 testes apagados (E-03)
ls backend/db/migrations | tail -6                 # 0061..0065 (E-01)
grep -n "ESOCIAL" backend/src/common/config/env.validator.ts docker-compose.yml .env.example   # E-02
cd backend && PATH=/root/.nvm/versions/node/v20.20.2/bin:$PATH
npx tsc --noEmit -p tsconfig.json                  # 0 erros
NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json --forceExit
```

### 9.2 Arquivos auditados

- Migrations `0061` a `0065` (`backend/db/migrations/`).
- `backend/src/common/crypto/envelope-crypto.util.ts`, `secret-crypto.util.ts` (comparação).
- `backend/src/esocial/certificates/` (`certificate-crypto.service`, `certificates.service`, `certificates.controller`, `pkcs12.util`, DTO, módulo).
- `backend/src/aso/` (controller, service, DTOs).
- `backend/src/common/interceptors/audit.interceptor.ts`, `request-logging.interceptor.ts`, `common/filters/all-exceptions.filter.ts`.
- Specs: `docs/specs/esocial-arquitetura.md`, `esocial-seguranca.md`, `esocial-mapeamento-dados.md`; plano `2026-09-29-esocial-sst-subprojeto1.md`; ledger `.superpowers/sdd/…/progress.md` e `task-12-report.md`.

### 9.3 Limites desta auditoria

- **Não rodei e2e** (exigem Postgres) nem o `tenant-isolation-sweep`. As afirmações de RLS vêm da leitura das migrations e do ledger.
- **Não li o `.env` de produção:** se a `ESOCIAL_CERT_ENCRYPTION_KEY` existe lá é **NÃO VERIFICADO**.
- **Não li o XSD nem o MOS oficiais** (o spec também não os leu). O que é INFERIDO ali continua INFERIDO.
- **Não auditei** o que o executor fizer depois das 22:36 UTC de 2026-10-04.
- Não sei qual ferramenta fez cada commit; o autor do git é o mesmo ("Montese Security Hardening") em todos.
