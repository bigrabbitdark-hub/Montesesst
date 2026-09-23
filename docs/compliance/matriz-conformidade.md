# Matriz de Políticas e Conformidade — Montese SST

> **Postura deste documento:** mesma postura do
> [`lgpd-compliance.md`](lgpd-compliance.md) — ponto de partida técnico e
> organizacional, sem advogado envolvido na redação. **Nada aqui é uma
> declaração pública de conformidade.** Onde este documento diz "existe",
> significa que o controle técnico ou o processo já está implementado e
> testado — não que foi auditado ou certificado por terceiro. Pontos
> marcados com ⚠️ precisam de validação jurídica ou de especialista antes
> de virar texto publicado no site ou promessa contratual.
>
> Este documento é o **índice/inventário** de tudo que compõe segurança,
> privacidade e conformidade no Montese SST — decisão confirmada com o
> fundador em 2026-08-26: não duplica o `lgpd-compliance.md` existente,
> referencia ele onde já cobre o assunto (categoria E principalmente, e
> partes de A/C/D) e só desenvolve conteúdo novo onde ainda não existe
> nada. Cada linha marcada **Pendente** é candidata a virar seu próprio
> sub-projeto (spec → plano → implementação), na mesma disciplina do
> resto do roadmap — este documento não implementa nada sozinho.

## Como ler as colunas

- **Onde vive / Status:** arquivo, tabela, endpoint ou processo que já
  existe (com caminho exato), ou "Pendente" se não existe nada ainda.
- **Evidência:** como comprovar que aquilo é verdade hoje (teste
  automatizado, migration, documento) — sem evidência, não vira alegação
  pública.
- **Observação:** contexto, limitação conhecida, ou o que falta pra
  fechar.

---

## A — Políticas públicas do site

**Categoria inteira fechada em 2026-08-26** — todos os 11 itens
publicados, em duas rodadas (núcleo bloqueante primeiro, depois o
restante).

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Política de Privacidade | **✅ Publicada** — `/privacidade`, conteúdo em `frontend/content/legal/privacidade.mdx`, traduzido de `lgpd-compliance.md` §3-6 | Build isolado confirmado, rota estática gerada | Marcada como "documento inicial, sem revisão jurídica formal" no topo da própria página — nenhum prazo de retenção específico foi publicado (ainda ⚠️ no doc interno) |
| Termos de Uso | **✅ Publicado** — `/termos`, conteúdo em `frontend/content/legal/termos.mdx` | Build isolado confirmado, rota estática gerada | Inclui a cláusula operador/controlador, a frase "não substitui avaliação profissional habilitado", CNPJ e endereço comercial preenchidos em 2026-09-21; seguem como placeholders explícitos a razão social (`[RAZÃO SOCIAL — PREENCHER]`) e o foro (`[CIDADE/ESTADO — PREENCHER]`), aguardando dado real do fundador |
| Política de Segurança da Informação | **✅ Publicada** — `/seguranca`, tradução de `lgpd-compliance.md` §8 pra linguagem acessível, com seção honesta de limitações conhecidas | `frontend/content/legal/seguranca.mdx` | Fechada em 2026-08-26 |
| Política de Cookies | **✅ Resolvida como seção**, não página própria — nota no topo de `/privacidade` ("não usamos cookies hoje") | `frontend/content/legal/privacidade.mdx` | Decisão confirmada: página própria seria promessa vazia, já que não há cookie nenhum hoje |
| Política de Tratamento de Dados | **✅ Resolvida como o mesmo documento** que a Política de Privacidade, com nota explícita no topo de `/privacidade` explicando a equivalência | `frontend/content/legal/privacidade.mdx` | Decisão confirmada: evita duplicar texto que podia dessincronizar |
| Política de Retenção e Exclusão de Dados | **✅ Expandida dentro de `/privacidade`** — seção "Por quanto tempo mantemos os dados", por categoria de dado, sem publicar o prazo de ASO/PCMSO ainda não confirmado juridicamente | `frontend/content/legal/privacidade.mdx` | ⚠️ mantido explícito na própria página — prazo de dado de saúde continua pendente de validação jurídica/especializada |
| Política de Incidentes de Segurança | **✅ Publicada** — `/incidentes`, referenciando um processo interno novo (`docs/compliance/processo-incidentes.md`, categoria B) escrito primeiro | `frontend/content/legal/incidentes.mdx`, `docs/compliance/processo-incidentes.md` | Não promete prazo de comunicação específico — ⚠️ mantido até confirmação jurídica do Art. 48 LGPD |
| Política de Subcontratação/Parceiros | **✅ Publicada** — `/fornecedores`, nomeando os 3 fornecedores reais (Resend, Mercado Pago, Cloudflare R2) sem alegar certificação de nenhum deles | `frontend/content/legal/fornecedores.mdx` | ⚠️ cláusula contratual de proteção de dados com cada fornecedor ainda não confirmada — registrado na própria página |
| Compromisso de Conformidade SST | **✅ Publicada** — mesmo item da categoria F, ver `/compromisso-sst` | `frontend/content/legal/compromisso-sst.mdx` | Linha duplicada entre A e F no desenho original desta matriz — mantida aqui só como referência cruzada |
| Canal de contato de privacidade | **✅ Publicado** — `privacidade@montesesst.com.br`, referenciado em todas as páginas desta categoria | `/privacidade`, `/termos`, `/seguranca`, `/incidentes`, `/faq-privacidade` | Endereço ainda não verificado como caixa de e-mail real recebendo mensagens — confirmar operacionalmente |
| FAQ de Segurança e Privacidade | **✅ Publicada** — `/faq-privacidade`, escrita por último, sintetizando as demais páginas em formato de pergunta/resposta | `frontend/content/legal/faq.mdx` | Fechada em 2026-08-26 |

## B — Políticas internas da empresa (processo, não produto)

Como a Montese *opera* internamente quando algo relacionado a
privacidade/segurança acontece — distinto de A (o que o público lê).

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Processo de atendimento a direito do titular (LGPD) | **Existe, manual** — `lgpd-compliance.md` §6 já documenta o processo passo a passo | — | Funciona pro volume atual (zero clientes pagantes); vira risco operacional se o número de clientes crescer sem virar tela |
| Processo de resposta a incidente de segurança | **✅ Existe, documentado** — `docs/compliance/processo-incidentes.md` (detecção, triagem, contenção, comunicação, registro, pós-incidente), honesto sobre a ausência de equipe dedicada e de SLA formal | `docs/compliance/processo-incidentes.md` | Fechado em 2026-08-26, junto da Política de Incidentes pública (A) |
| Processo de avaliação de fornecedor novo | **✅ Existe, documentado em 2026-08-27** — checklist de 6 pontos (função/dado, localização, DPA, histórico de segurança, alternativa nacional, plano de saída), com avaliação retroativa dos 3 fornecedores atuais | `docs/compliance/processo-avaliacao-fornecedores.md` | Página pública (`fornecedores.mdx`) atualizada pra não dizer mais "em desenvolvimento" |
| Papel de Encarregado (DPO) | **✅ Formalizado em 2026-08-27** — fundador assume o papel (`lgpd-compliance.md` §2), canal `privacidade@montesesst.com.br` publicado desde o fechamento da categoria A | `lgpd-compliance.md` §2 | Falta só confirmar operacionalmente que a caixa recebe mensagens de verdade (mesma pendência da categoria A) |

## C — Controles técnicos do sistema

A maior parte já existe — esta categoria é principalmente sobre dar
**visibilidade** (tela de admin) ao que já está implementado, não
construir do zero.

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Controle de acesso (RBAC) | **Existe** — `RolesGuard` global (`backend/src/app.module.ts`), `@Roles()` por endpoint | Testado em toda suíte e2e | — |
| Segregação entre empresas (multi-tenant) | **Existe** — RLS `FORCE ROW LEVEL SECURITY` em toda tabela multi-tenant | `backend/test/rls-isolation.e2e-spec.ts` | Único caso deliberado sem RLS própria é `tenants` (raiz do isolamento) — ver `docs/specs/fase-7-gestao-tenants.md` |
| Logs | **Existe** — logging estruturado por request (`docs/operations/reliability.md` §2) | — | Log de aplicação, não confundir com `audit_log` (linha abaixo) — são dois sistemas diferentes |
| Auditoria | **✅ Existe, com tela** — `audit_log` (`0002_audit_log.sql`), append-only, protegido até contra `UPDATE`/`DELETE`/`TRUNCATE` da própria role da aplicação, agora consultável via `/admin/auditoria` (fechado em 2026-08-26) | Migration + RLS + `backend/src/audit-log/` | Ver categoria J pro detalhe do fechamento |
| Gestão de permissões | **Existe, sem tela** — papéis (`empresa`/`tecnico`/`parceiro`/`admin`) fixos no schema, vínculo tenant↔pessoa via `tenant_technicians`/`tenant_partners` | — | "Gestão" aqui é binária hoje (vinculado ou não) — não há granularidade de permissão dentro de um papel |
| Histórico de alterações | **Parcial** — `audit_log` registra create/update/delete, mas não guarda valor antes/depois do campo (escopo confirmado com o fundador na Fase 1) | `0002_audit_log.sql` comentário de topo | Se precisar de "o que mudou exatamente", é um redesenho de escopo, não uma tela nova |
| Controle de documentos | **Existe** — módulo `documents` (Fase 4), versionamento não existe (upload substitui, não empilha versão) | `backend/src/documents/` | Se "controle de versão de documento" for requisito real, é gap técnico, não só de exibição |
| Rastreabilidade | **Existe** — combinação de `audit_log` + logs estruturados + `request_id` por requisição | `request-logging.interceptor.ts` | — |
| Backups | **Existe, testado** — `docs/operations/backups.md`, `pg_dump` diário, restauração testada de ponta a ponta | Documento próprio, com teste real registrado | Limitação conhecida: backup fica no mesmo disco da mesma VPS (sem cópia externa ainda, pendência já registrada) |
| Gestão de incidentes | **Pendente** — ver categoria B | — | — |
| Gestão de fornecedores | **Pendente** — ver categoria B | — | — |
| Controle de versões (código) | **Existe** — git, todo histórico do projeto | `git log` | Isso é sobre o código-fonte, não confundir com "controle de versão de documento de SST" acima |
| Evidências de conformidade | **Este documento é o começo disso** | — | Uma matriz sem evidência real vira teatro — cada linha "Existe" aqui tem um caminho de arquivo/teste ao lado, de propósito |

## D — Controles de Segurança da Informação

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Senha nunca em texto puro | **Existe** — bcrypt, custo 10 | `technicians.service.ts` e equivalentes | — |
| Segredos fora do controle de versão | **Existe** — `.env` nunca versionado | `.gitignore` | — |
| Banco/Redis não expostos publicamente | **Existe** — só rede Docker interna | `docker-compose.yml` | — |
| Rate limiting | **Existe** — Redis, por rota sensível (login, cadastro, contato) | `docs/operations/reliability.md` §3 | — |
| Regra "documento nunca em disco da VPS" | **✅ Existe** — Cloudflare R2 em produção desde 2026-08-23 (linha desatualizada até 2026-08-27, credenciais já estavam preenchidas) | `backend/test/documents-upload.e2e-spec.ts`, `documents-download-delete.e2e-spec.ts`, `documents-partner.e2e-spec.ts` — upload/download/delete reais contra o bucket | — |
| Transferência internacional de dado | **⚠️ Confirmado que existe, em 2026-08-27** — VPS no Brasil (Hostinger, Campinas/SP), mas o bucket R2 (`montese-documentos`) fica em Eastern North America (ENAM), confirmado pelo fundador no painel Cloudflare. Documentos de funcionários saem do Brasil. | `lgpd-compliance.md` §8 ⚠️ | Deixa de ser pendência de verificação e vira pendência de base legal — Cloudflare oferece DPA/SCCs no modelo europeu (GDPR), se isso serve de base sob a LGPD (Art. 33) precisa de validação jurídica antes do primeiro cliente pagante |

## E — LGPD

Totalmente coberta por [`lgpd-compliance.md`](lgpd-compliance.md) — esta
matriz não duplica, só referencia. Pendências já rastreadas lá (checklist
§10): canal do Encarregado, Política de Privacidade/Termos publicados
(= categoria A desta matriz), prazo de retenção validado, região de
hospedagem confirmada.

## F — Conformidade SST

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Compromisso Montese com Segurança do Trabalho (texto público) | **✅ Publicada** — `/compromisso-sst`, fechado em 2026-08-26 | `frontend/content/legal/compromisso-sst.mdx` | Inclui a frase-chave do fundador ("a plataforma não substitui a avaliação profissional...") e nota explícita de que a mesma regra vai valer pra futuros assistentes automatizados (Fase 8/categoria G) |
| Checklists/modelos de NR reais no produto | **Existe parcialmente** — checklist de inspeção (Fase 6A, 9 blocos do modelo de referência real), catálogo de EPI (Fase 6C, 93 itens do Anexo I da NR-06) | `docs/reference/modelos-relatorios-sst.md`, `docs/reference/catalogo-epi-nr06.md` | Isso já É conformidade SST em código, só falta virar texto institucional que explique isso pro cliente |

## G — Responsabilidades dos agentes (IA)

**Ativo em produção desde 2026-08-28.** A Fase 8 (Copiloto de IA —
relato em campo → checklist estruturado, ver
[`docs/specs/fase-8-copiloto-ia.md`](../specs/fase-8-copiloto-ia.md))
foi implementada, revisada (revisão de tasks + revisão final de todo o
branch + fix wave) e está ativa com chamadas reais de IA via OpenRouter
(`anthropic/claude-sonnet-5`) — decisão do fundador de não esperar o
MiniMax. A regra central já está implementada, não só articulada: o
aviso "Sugestão gerada por IA — revise e confirme. Não substitui a
avaliação do profissional habilitado." está fixo e não-removível na
tela do Copiloto (`frontend/.../inspecoes/[id]/page.tsx`), mesma
frase-chave publicada em `/compromisso-sst`.

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Regra "agente não substitui profissional habilitado" | **✅ Implementada em código**, não só em texto público | Aviso fixo na tela do Copiloto (`page.tsx`), reforçado em `/compromisso-sst` | Revisão final confirmou o aviso verbatim, sem controle de dispensar/fechar |
| Revisão humana obrigatória antes de qualquer gravação | **✅ Existe** — o endpoint (`POST /inspections/:id/ai-draft`) nunca escreve no banco; técnico precisa clicar "Aplicar" por item, que grava pelo mesmo mecanismo já existente | `backend/src/inspections/inspections.controller.ts`, `frontend/.../page.tsx` | Corrigido na revisão final: "Aplicar" só limpa o card de sugestão se o salvamento realmente funcionou (antes apagava mesmo em caso de falha) |
| Chamada de IA é sempre externa, nunca local | **✅ Confirmado** — OpenRouter (openrouter.ai), API externa | `backend/src/ai-copilot/openrouter-extractor.service.ts` | Mesma regra não-negociável desde `docs/vision.md` |
| Rate limit e limite de tamanho de entrada (proteção contra abuso/custo) | **✅ Existe** — 20 chamadas/hora por IP, `report_text` até 5000 caracteres | `inspections.controller.ts`, `dto/ai-draft.dto.ts` | Implementado na hora da ativação — chamada real custa dinheiro de verdade desde 2026-08-28 |
| "Política de Funcionamento dos Agentes Especializados" (documento formal, público) | **Pendente** | — | Agora que o Copiloto está ativo de verdade (não só planejado), esse documento ganha mais urgência do que tinha antes — recomendado priorizar |

## H — Responsabilidades do cliente (empresa)

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Cláusula de controlador (dado de funcionário) | **✅ Publicada** — `/termos` §4 ("Empresa cliente: é a controladora dos dados de seus funcionários perante a LGPD...") — linha desatualizada até 2026-08-27, o texto já existia desde 2026-08-26 | `frontend/content/legal/termos.mdx` §4 | — |
| Veracidade dos dados inseridos | **✅ Publicada** — `/termos` §3 ("Os dados informados no cadastro... precisam ser verdadeiros") e §4 | `frontend/content/legal/termos.mdx` §3-4 | — |

## I — Responsabilidades do técnico/parceiro

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Responsabilidade técnica por inspeção/relatório assinado | **✅ Publicada** — `/termos` §4 ("Técnico responsável: assina, sob sua responsabilidade profissional...") e §5 (seção própria de Assinatura eletrônica) — linha desatualizada até 2026-08-27 | `frontend/content/legal/termos.mdx` §4-5 | — |
| Acesso a múltiplas empresas (parceiro) | **✅ Publicada** — `/termos` §4, cláusula explícita: parceiro vinculado a mais de uma empresa "não pode usar ou divulgar informações de uma empresa para outra" — linha desatualizada até 2026-08-27 | `frontend/content/legal/termos.mdx` §4 | — |

## J — Auditoria e evidências

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Trilha de auditoria consultável | **✅ Existe, com tela** — `GET /audit-log` admin-only + `/admin/auditoria`, paginado, filtro por tipo de recurso — 5.651 eventos reais confirmados na base em 2026-08-26 | `backend/src/audit-log/`, `backend/test/audit-log.e2e-spec.ts`, `frontend/src/app/admin/auditoria/page.tsx` | Fechado em 2026-08-26. `LEFT JOIN` deliberado com `users`/`tenants` (não `INNER`) — evita repetir a classe de bug de RLS já corrigida na Fase 7A |
| Testes automatizados como evidência de controle | **Existe, crescente** — 38 suítes / 131 testes e2e reais (não mockados) na Fase 7A, mesma disciplina desde a Fase 1 | `backend/test/*.e2e-spec.ts` | Esta matriz cita arquivo de teste específico em cada linha "Existe" — decisão deliberada, evidência sem caminho verificável não conta |
| Relatório de auditoria formal (interno ou externo) | **Pendente** — nunca foi feito | — | Fora de escopo até essa matriz virar sub-projetos concluídos — não faz sentido auditar o que ainda não existe |

---

## Próximos passos

Este documento não implementa nada sozinho — é o inventário que guia a
decomposição em sub-projetos, exatamente como a Fase 6 e a Fase 7 foram
decompostas.

**Rodada de 2026-08-26 — concluída:**

1. ~~Categoria A completa (11/11 itens: Privacidade, Termos, Segurança,
   Cookies, Tratamento de Dados, Retenção, Incidentes, Fornecedores,
   Compromisso SST, canal de contato, FAQ)~~ ✅
2. ~~Auditoria consultável (C/J)~~ ✅ (`GET /audit-log` +
   `/admin/auditoria`)
3. ~~Categoria F (Compromisso SST)~~ ✅ (mesmo item de A, `/compromisso-sst`)
4. ~~Processo interno de incidentes (B)~~ ✅
   (`docs/compliance/processo-incidentes.md`)

**Rodada de 2026-08-27 — concluída:**

5. ~~Categorias H e I (responsabilidades de cliente e técnico/parceiro)~~
   ✅ — na revisão, as duas categorias já estavam cobertas em
   `termos.mdx` desde 2026-08-26 (cláusula de controlador, veracidade
   dos dados, responsabilidade técnica por assinatura, confidencialidade
   do parceiro entre empresas) — a matriz só não tinha sido atualizada
   pra refletir isso. Nenhum texto novo precisou ser escrito.
6. ~~Categoria D — regra de object storage externo~~ ✅ — linha também
   desatualizada, R2 já estava em produção desde 2026-08-23.
7. ~~Categoria B — papel de Encarregado (DPO)~~ ✅ formalizado, canal já
   publicado.
8. **Categoria D — transferência internacional de dado** — parcialmente
   resolvido: VPS confirmado no Brasil (Hostinger/Campinas-SP). Bucket
   R2 ainda pendente — precisa checagem manual no painel Cloudflare
   (token disponível não alcança config de bucket via API).

**Rodada de 2026-08-27 (Fase 8):**

9. ~~Categoria G — regra central "agente não substitui profissional
   habilitado"~~ ✅ implementada em código (não só planejada) — ver
   seção G acima. Documento formal público continua pendente, sem
   urgência.
10. ~~Categoria B — processo de avaliação de fornecedor novo~~ ✅
    documentado em 2026-08-27 — ver seção B acima
    (`docs/compliance/processo-avaliacao-fornecedores.md`). Fecha o
    último item genuinamente pendente que tinha sobrado de B/D/H/I.

**Ainda em aberto:**

- **Categoria G — "Política de Funcionamento dos Agentes
  Especializados"** (documento formal público) — a regra central já
  está em produção como código, e desde 2026-08-28 o Copiloto de IA
  está ativo de verdade (não só planejado) — recomendado priorizar
  esse documento agora, não é mais "sem pressa".
- **Placeholders nos Termos de Uso e na Política de Privacidade** — CNPJ
  (`69.203.754/0001-45`) e endereço comercial preenchidos em 2026-09-21
  (fonte: `frontend/src/lib/company.ts`). Pendentes, dependem do
  fundador: **razão social** (`[RAZÃO SOCIAL — PREENCHER]`) e **foro**
  (`[CIDADE/ESTADO — PREENCHER]`, cláusula 10 dos Termos — escolha
  jurídica; não decorre do endereço da sede).
- **Pontos ⚠️ que dependem de validação jurídica**, espalhados por
  `lgpd-compliance.md` e pelas páginas publicadas hoje (prazo de
  retenção de dado de saúde, prazo de comunicação de incidente,
  cláusula contratual com fornecedor, e agora também **base legal pra
  transferência internacional de dado pro bucket R2 em ENAM**,
  confirmado em 2026-08-27 — ver categoria D) — nenhum vira compromisso
  definitivo sem essa revisão.
