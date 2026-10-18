# eSocial SST — Desenho das lacunas G-01 a G-04 (proposta para aprovação)

> **Status: DESENHO APROVADO em 2026-10-04 (4 decisões, seção 9). Nada implementado. Só implementar depois da Rodada 2 do executor (`esocial-handoff-executor-rodada-2.md`) e das decisões abertas da seção 9.2.** Origem: `docs/audits/auditoria-esocial-2026-10-04.md` (seção 4.2).
> Relação com os specs: complementa `esocial-arquitetura.md`, `esocial-seguranca.md` e `esocial-mapeamento-dados.md`; **emenda o plano**
> `2026-09-29-esocial-sst-subprojeto1.md` (novas tasks na seção 7). Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

## 1. O problema em uma frase

Hoje o plano constrói a tubulação (certificado, XML, assinatura, transmissão), mas **não tem porta de entrada** (ninguém cria o evento),
**não tem como preencher os dados que o Diagnóstico exige**, **não tem etapa de autorização humana** (o cron assina e transmite sozinho) e
**não permite registrar o ASO completo** (exames, PDF, médicos).

## 2. Fatos do código atual (VERIFICADO em 2026-10-04)

- `employees`, `company_units` e `positions` já têm CRUD completo com `PATCH` (`employees.controller`, `company-units.controller`, `positions.controller`),
  papéis `empresa` e `admin`. `employees.position_id` aponta para `positions` (migration `0035`): **o CBO deve ficar no cargo** (`positions.cbo_code`).
- O cadastro de funcionário na tela "Empresas" (`/empresa/onboarding`) pede só nome, CPF, cargo e filial. "Funcionários" no menu novo ainda é "em construção".
- `employees` tem `UNIQUE (tenant_id, cpf)` e `cpf VARCHAR(11)`; já existe importação de planilha com mapeamento de colunas (`import-mapped`).
- As colunas novas (`registration_number`, `esocial_category_code`, `esocial_vinculo_confirmed_at/by`, `cnae`, `esocial_establishment_code`, `cbo_code`) existem
  na migration `0065` do executor, mas **nenhum código as lê ou grava** hoje.
- Plano, Task 18: `PENDING_STATUSES = ['rascunho','assinado','transmitido','processando']` e o `advance()` de `rascunho` **monta, assina e segue**.
  O único `INSERT INTO esocial_events` do plano é um helper de teste.
- O `CHECK` de `esocial_events.status` já prevê os 10 estados do spec (`rascunho`, `validando`, `assinado`, `aguardando_transmissao`, `transmitindo`,
  `transmitido`, `processando`, `processado`, `rejeitado`, `erro_tecnico`).

## 3. Princípios (inegociáveis; vêm do AGENTS.md e do spec de segurança)

1. **Nenhum envio sem autorização humana explícita e rastreável** (quem, quando). O sistema nunca presume o vínculo do trabalhador no eSocial.
2. **Tenant sempre do JWT** (`req.withTenantContext`), nunca do corpo. Toda chave estrangeira entre tabelas de tenant é validada **sob RLS** (a FK ignora RLS).
3. **Só Produção Restrita** nesta fase; `producao` bloqueado no serviço, por teste, até autorização do proprietário.
4. **Nada de leiaute/categoria/prazo inventado:** tabelas oficiais (categorias, CBO, CNAE) entram por fonte oficial; até lá, validação **só de formato**, marcada INFERIDO.
5. **Dado de saúde (ASO) com mínimo acesso:** `empresa` dona e `tecnico` vinculado; `admin` somente com motivo registrado.

## 4. G-01 — Dados de pré-requisito (matrícula, categoria, CBO, CNAE, estabelecimento, vínculo)

### 4.1 Opções

| Opção | Descrição | Prós | Contras |
|---|---|---|---|
| **A (RECOMENDADA)** | Página nova **`/empresa/esocial`** (o item "eSocial" já existe no menu como "em construção"), com a seção **"Pendências de dados"**: lista, por ASO/funcionário, o que falta (resultado do Diagnóstico) e abre um **formulário curto** só desses campos | Um lugar só; o usuário vê exatamente o que falta e por quê; reaproveita o Diagnóstico | Cria tela nova (a Task 20 já cria a página; amplia seu escopo) |
| B | Acrescentar os campos aos formulários de funcionário, filial e cargo da tela "Empresas" | Sem página nova | Espalha o preenchimento em 3 telas; o usuário não sabe o que falta; formulário já é longo |
| C | Estender a **importação de planilha** (`import-mapped`) com colunas matrícula/categoria | Preenchimento em massa; infra existe | Não cobre CNAE/CBO/vínculo; serve só de complemento |

**Recomendação:** **A**, e **C como complemento opcional depois** (matrícula e categoria em massa).

### 4.2 Backend (para A)

| Mudança | Detalhe |
|---|---|
| `PATCH /employees/:id` | aceitar `registration_number` (texto, 1 a 30) e `esocial_category_code` (3 dígitos; **só formato**; lista oficial = NÃO VERIFICADO) |
| `PATCH /company-units/:id` | aceitar `cnae` (7 dígitos) e `esocial_establishment_code` (texto) |
| `PATCH /positions/:id` | aceitar `cbo_code` (6 dígitos) |
| `POST /esocial/employees/:id/confirm-vinculo` | `@Roles('empresa')` (e `tecnico` vinculado, ver decisão 7.3). Grava `esocial_vinculo_confirmed_at = now()` e `..._by_user_id = req.user.id`. **Sem valor padrão marcado**; exige corpo `{ "confirmo": true }` |
| `DELETE /esocial/employees/:id/confirm-vinculo` | revoga a confirmação (limpa os dois campos) e grava no `audit_log` |
| Validação | `PATCH` valida que o registro pertence ao tenant (já é o padrão do módulo); DTOs com `class-validator` (os DTOs atuais de funcionário são classes simples, **sem decoradores**: acrescentar validação só nos campos novos, sem mexer nos antigos) |

### 4.3 Aceite

- Atualizar funcionário/filial/cargo de **outro tenant** → 404 (e2e). CBO/CNAE/categoria com formato inválido → 400.
- Confirmar vínculo sem `{"confirmo": true}` → 400; com sucesso grava autor e hora; revogar limpa e fica no `audit_log`.
- O Diagnóstico (Task 16) passa a reprovar por campo faltante **e aponta o campo** (`key` estável), para a tela ligar ao formulário certo.

## 5. G-02 e G-03 — Porta de entrada do evento e **autorização humana** (resolver juntos)

### 5.1 Máquina de estados corrigida

```
POST /esocial/events            (humano: cria)          ──► rascunho            ← o cron NÃO enxerga
POST /esocial/events/:id/authorize   (humano: autoriza) ──► aguardando_transmissao  ← grava quem e quando
        cron (sistema, só executa o que um humano autorizou):
aguardando_transmissao ─► validando (monta XML) ─► assinado ─► transmitindo ─► transmitido ─► processando ─► processado | rejeitado
                                 qualquer falha técnica ─► erro_tecnico ─(humano: retry)─► aguardando_transmissao
```

**Correção principal ao plano:** `PENDING_STATUSES` do cron passa a ser `['aguardando_transmissao','validando','assinado','transmitindo','transmitido','processando']`.
**`rascunho` sai da lista**: criar um evento nunca o envia. Um teste (RED primeiro) cria um evento em `rascunho`, roda o cron e prova que **nada é assinado nem transmitido**.

### 5.2 Endpoints novos

| Endpoint | Papéis | O que faz |
|---|---|---|
| `POST /esocial/events` `{ asoRecordId, certificateId }` | `empresa`, `tecnico` vinculado | Roda o **Diagnóstico**; se `ready=false`, **400 com a lista de pendências** (nada é criado). Se `ready=true`, cria `rascunho` com `payload_json` completo e `idempotency_key = tenant + aso + versão` (clique duplo devolve o mesmo evento, 200). Valida, sob RLS, que ASO e certificado são do tenant |
| `POST /esocial/events/:id/authorize` | `empresa`, `tecnico` vinculado | `rascunho → aguardando_transmissao`; grava `authorized_by_user_id` e `authorized_at`; escreve o histórico **com o ator**. Falha se o certificado estiver vencido (E-05) ou se `ambiente <> 'producao_restrita'` |
| `POST /esocial/events/:id/retry` | idem | `erro_tecnico → aguardando_transmissao` (reautoriza; novo registro de autor) |
| `GET /esocial/events` e `GET /esocial/events/:id` | `empresa`, `tecnico`, `admin` | Lista e detalhe com histórico. **Nunca** devolve `xml_signed` nem certificado em listagem; XML só no detalhe e só para `empresa`/`tecnico` vinculado |

Fora do Sub-projeto 1 (não implementar agora): retificação (`ind_retif=2`) e S-3000; as colunas já existem no schema.

### 5.3 Mudanças de schema (editar a migration de eventos **antes** de qualquer banco compartilhado recebê-la)

- `esocial_events` + `authorized_by_user_id UUID REFERENCES users(id)` e `authorized_at TIMESTAMPTZ`.
- `esocial_event_history.actor_user_id` já existe: o cron grava o **autor da autorização** nas transições que executa e `detail` informa `executado pelo sistema (autorizado por <user>)`.
- `CHECK` que impede `status` ≥ `aguardando_transmissao` com `authorized_by_user_id` nulo (defesa em profundidade contra bug de serviço).

### 5.4 O ponto que **precisa da sua decisão** (G-03)

O spec (§5) diz que assinar "sempre roda como o usuário autenticado que disparou a transmissão". Duas formas de cumprir:

| Opção | Como | Prós | Contras |
|---|---|---|---|
| **A (RECOMENDADA)** | O **cron executa**, mas só eventos **autorizados por um humano**, com o autor gravado no evento e em cada linha do histórico. Emenda o spec: "a assinatura é executada pelo sistema, sob autorização humana registrada". | Funciona com a fila e o retry; já é o padrão dos crons; rastreia quem autorizou | Desvia da letra do spec (precisa da sua aceitação) |
| B | A **assinatura roda dentro da requisição** de `authorize` (usuário presente) e o cron só **transmite** o XML já assinado | Cumpre o spec ao pé da letra | O cron **ainda precisa decifrar o `.pfx`** para o mTLS, então o certificado continua sendo aberto sem usuário; mais complexidade sem ganho real de segurança |

**Recomendação: A**, com o autor da autorização como evidência. O cron roda em contexto `admin` (todos os tenants); essa chamada direta entra na lista `ALLOWED` do
`tenant-context-callsites.unit-spec.ts` com justificativa por escrito, **depois de revisão** (não antes).

### 5.5 Aceite

- RED primeiro: rascunho + cron ⇒ nada assinado/transmitido. `authorize` sem autor ⇒ impossível (CHECK). `authorize` em `producao` ⇒ 409.
- Clique duplo em `POST /events` ⇒ o mesmo evento (idempotência). Tenant A cria evento com ASO ou certificado do tenant B ⇒ 404.
- Cada transição do cron grava histórico com `actor_user_id` = quem autorizou. `GET` de listagem não contém XML.
- Diagnóstico `ready=false` ⇒ 400 e **nenhuma** linha criada.

## 6. G-04 — ASO completo para o S-2220

| Item | Proposta |
|---|---|
| **Exames complementares** (`aso_exam_details`) | `POST/GET /aso/records/:id/exams`, `DELETE /aso/records/:id/exams/:examId` (apenas enquanto o ASO não tiver evento autorizado). Valida que o ASO é do tenant (sob RLS) e `exam_date` ≤ hoje |
| **PDF do ASO** (`file_key`) | `POST /aso/records/:id/file` com o mesmo padrão dos uploads do projeto: limite de tamanho, tipo conferido pelo **conteúdo** (não só `Content-Type`), objeto no R2, nunca em disco; sem antivírus (limitação conhecida do projeto, registrar) |
| **Médicos PCMSO** | `GET /aso/pcmso-physicians`, `PATCH /aso/pcmso-physicians/:id` (editar, `active=false` em vez de apagar). Validações: CPF com dígito verificador, UF do CRM entre as 27, CRM só dígitos |
| **Integridade entre tenants** (E-06) | `employeeId` e `pcmsoPhysicianId` conferidos sob RLS; mesma mensagem 404 para "não existe" e "é de outro tenant" |
| **Admin e dado de saúde** (E-09) | `GET` de ASO por `admin` exige `?reason=` (≥ 10 caracteres); o motivo fica no `audit_log` (a URL completa já é gravada pelo `AuditInterceptor`). `empresa` e `tecnico` vinculado não precisam de motivo |
| **LGPD** | Resposta de listagem **sem** `result` para quem não tem permissão de ver resultado; `result_disclosure_authorized=false` impede o resultado de entrar no XML (`indResult`). Retenção e minimização final dependem da validação jurídica (spec §7) |

Aceite: e2e de RLS para cada rota nova (tenant A × B ⇒ 404); `admin` sem `reason` ⇒ 400; upload com tipo/tamanho inválido ⇒ 400/413; nenhum log contém CPF sem redação.

## 7. Emenda ao plano (novas tasks e reordenação)

| Nova task | Conteúdo | Depende de | Posição |
|---|---|---|---|
| **12b** | G-01: campos nos `PATCH` + `confirm-vinculo` + testes e2e | rodada 2 do executor concluída | antes da Task 13 |
| **12c** | G-04: exames, upload do PDF, médicos, motivo do admin | 12b | antes da Task 13 |
| **16** (ajustada) | Diagnóstico devolve `key` estável por pendência (para a tela ligar ao formulário) | 12b | como no plano |
| **18a** (nova) | G-02: `POST /esocial/events`, `authorize`, `retry`, `GET` | 16, 12c | **antes** da 18 |
| **18** (ajustada) | Cron só processa `aguardando_transmissao`→…; histórico com ator; teste "rascunho não é enviado" | 18a | como no plano |
| **20** (ampliada) | Página `/empresa/esocial` (não `(app)/esocial`): Certificado, **Pendências de dados**, Eventos (criar, autorizar, ver histórico) | 18a, 12b | como no plano |

Tasks 13, 14, 15, 17, 19, 21, 22, 23 permanecem como estão (com a correção do caminho da 20).

## 8. Riscos e o que NÃO fazer

- **Não** criar a rota que cria evento antes de corrigir o `PENDING_STATUSES` (senão criar = enviar).
- **Não** validar categoria, CBO ou CNAE contra lista que não seja oficial; manter só formato e marcar INFERIDO até a fonte oficial ser lida por uma pessoa.
- **Não** expor XML assinado em listagem; **não** logar payload completo nem CPF sem redação.
- **Não** transmitir em `producao`. **Não** gerar chave nem certificado reais; **não** usar o `.pfx` de um cliente em teste.
- Risco de escopo: a página `/empresa/esocial` cresce o Sub-projeto 1. Mitigação: entregar na ordem 12b → 12c → 16 → 18a → 18 → 20 e aceitar cada uma separadamente.

## 9. Decisões

### 9.1 Tomadas pelo proprietário em 2026-10-04 (todas na opção recomendada)

| # | Decisão | Resultado |
|---|---|---|
| 1 | **G-01:** onde preencher os dados de pré-requisito | **Opção A:** página `/empresa/esocial` com "Pendências de dados"; planilha em massa (C) fica como complemento futuro |
| 2 | **G-03:** quem executa a assinatura | **Opção A:** o cron executa **somente o que um humano autorizou**, com autor e hora gravados no evento e no histórico. **Emenda ao spec `esocial-seguranca.md` §5** (precisa ser escrita junto com a Task 18a) |
| 3 | **Quem autoriza a transmissão** | **`empresa` e `tecnico` vinculado**, cada autorização grava o autor |
| 4 | **Admin e ASO** | **Pode ler, com motivo registrado** (`?reason=` com pelo menos 10 caracteres, gravado no `audit_log`) |

### 9.2 Ainda abertas (não bloqueiam a Rodada 2, bloqueiam o merge e as tasks 12b em diante)

1. **Destino da migration `0063` do PDF** (define a numeração das migrations do eSocial, achado E-01).
2. **Chave mestra** `ESOCIAL_CERT_ENCRYPTION_KEY`: obrigatória ou opcional (achado E-02).
3. **Retenção:** trocar `ON DELETE CASCADE` por `RESTRICT` nas relações de evidência e prazo de purga do `.pfx` no R2 (achado E-07; depende da validação jurídica).
4. **Tabelas oficiais** (categorias do eSocial, CBO, CNAE): quem baixa e lê para a validação definitiva. Até lá, só formato, marcado INFERIDO.
5. **Prioridade do eSocial** frente aos releases do shell/admin e da NR, e o modelo de produto (empresa + médico PCMSO × técnico autônomo).
