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

O núcleo bloqueante (Privacidade, Termos, canal de contato) foi
**fechado em 2026-08-26** — o restante da categoria ainda está pendente,
decisão confirmada de fatiar em sub-projetos (ver "Próximos passos").

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Política de Privacidade | **✅ Publicada** — `/privacidade`, conteúdo em `frontend/content/legal/privacidade.mdx`, traduzido de `lgpd-compliance.md` §3-6 | Build isolado confirmado, rota estática gerada | Marcada como "documento inicial, sem revisão jurídica formal" no topo da própria página — nenhum prazo de retenção específico foi publicado (ainda ⚠️ no doc interno) |
| Termos de Uso | **✅ Publicado** — `/termos`, conteúdo em `frontend/content/legal/termos.mdx` | Build isolado confirmado, rota estática gerada | Inclui a cláusula operador/controlador, a frase "não substitui avaliação profissional habilitado", e dois placeholders explícitos (`[RAZÃO SOCIAL/CNPJ — PREENCHER]`, `[CIDADE/ESTADO — PREENCHER]`) aguardando dado real do fundador |
| Política de Segurança da Informação | **Pendente** — controles técnicos já existem e estão listados em `lgpd-compliance.md` §8, mas nunca viraram uma política redigida pro público | RLS testada (`rls-isolation.e2e-spec.ts`), senha com hash, segredos fora do git | Pode ser em grande parte "tradução" do §8 pra linguagem acessível, não pesquisa nova |
| Política de Cookies | **Não se aplica como está** — o site não usa cookie nenhum hoje, autenticação é 100% via `localStorage` (`montese_token`) | Busca no código: zero ocorrências de `document.cookie`/`cookie()` em frontend ou backend | Se algum dia entrar analytics/marketing com cookie, isso muda. Por ora, nota mínima ("não usamos cookies") é mais honesta que uma política cheia de cláusulas que não se aplicam |
| Política de Tratamento de Dados | **Pendente** — se sobrepõe fortemente com Política de Privacidade | — | Decidir na hora de redigir se vira seção da Política de Privacidade ou documento separado — redação, não modelagem |
| Política de Retenção e Exclusão de Dados | **Pendente como página pública** — regra técnica já em `lgpd-compliance.md` §5, com ⚠️ explícito pro prazo de ASO/PCMSO (~20 anos, prática de setor, não confirmação jurídica) | — | Não publicar prazo de retenção de dado de saúde sem validar com jurídico/especialista em medicina do trabalho primeiro (⚠️ já registrado) |
| Política de Incidentes de Segurança | **Pendente** — nem o processo interno existe ainda (ver categoria B) | — | Escrever o processo interno primeiro (B), a política pública depois — não pode prometer um SLA de resposta que não existe |
| Política de Subcontratação/Parceiros | **Pendente** — fornecedores reais já identificados: Resend (e-mail), Mercado Pago (pagamento), Cloudflare R2 (storage de documentos, credenciais ainda não configuradas) | `backend/package.json`, `.env.example` | Nomear fornecedor real é mais forte que texto genérico — mas confirmar com cada um se tem certificação/compliance próprio antes de citar |
| Compromisso de Conformidade SST | **Pendente** — ver categoria F | — | — |
| Canal de contato de privacidade | **✅ Publicado** — `privacidade@montesesst.com.br`, referenciado nas duas páginas acima | `/privacidade`, `/termos` | Endereço ainda não verificado como caixa de e-mail real recebendo mensagens — confirmar operacionalmente |
| FAQ de Segurança e Privacidade | **Pendente** — depende das políticas acima existirem primeiro | — | Último item natural desta categoria, não o primeiro |

## B — Políticas internas da empresa (processo, não produto)

Como a Montese *opera* internamente quando algo relacionado a
privacidade/segurança acontece — distinto de A (o que o público lê).

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Processo de atendimento a direito do titular (LGPD) | **Existe, manual** — `lgpd-compliance.md` §6 já documenta o processo passo a passo | — | Funciona pro volume atual (zero clientes pagantes); vira risco operacional se o número de clientes crescer sem virar tela |
| Processo de resposta a incidente de segurança | **Pendente** — nenhum processo formal, nem informal, documentado | — | Pré-requisito da Política de Incidentes pública (A) |
| Processo de avaliação de fornecedor novo | **Pendente** — hoje a escolha de fornecedor (Resend, Mercado Pago, R2) foi decisão técnica direta, sem checklist formal de segurança/compliance do fornecedor | — | Baixa prioridade — só 3 fornecedores hoje, mas vale existir antes do 4º |
| Papel de Encarregado (DPO) | **Existe, informal** — fundador assume o papel provisoriamente (`lgpd-compliance.md` §2) | — | Formalizar quando o canal de contato (A) for publicado |

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
| Regra "documento nunca em disco da VPS" | **Decisão registrada, aguardando R2** | `docs/vision.md` §8 | Credenciais R2 ainda vazias no `.env` — bloqueia a regra virar realidade em produção |
| Transferência internacional de dado | **Pendente de verificação** — região de hospedagem do VPS/R2 não confirmada | `lgpd-compliance.md` §8 ⚠️ | Se dado sair do Brasil, precisa de base legal própria (Art. 33 LGPD) — não é automático |

## E — LGPD

Totalmente coberta por [`lgpd-compliance.md`](lgpd-compliance.md) — esta
matriz não duplica, só referencia. Pendências já rastreadas lá (checklist
§10): canal do Encarregado, Política de Privacidade/Termos publicados
(= categoria A desta matriz), prazo de retenção validado, região de
hospedagem confirmada.

## F — Conformidade SST

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Compromisso Montese com Segurança do Trabalho (texto público) | **Pendente** — ver rascunho do fundador nesta conversa | — | Frase-chave já esboçada: "a plataforma não substitui a avaliação profissional quando a situação exigir análise técnica, responsabilidade legal ou emissão de documento por profissional habilitado" |
| Checklists/modelos de NR reais no produto | **Existe parcialmente** — checklist de inspeção (Fase 6A, 9 blocos do modelo de referência real), catálogo de EPI (Fase 6C, 93 itens do Anexo I da NR-06) | `docs/reference/modelos-relatorios-sst.md`, `docs/reference/catalogo-epi-nr06.md` | Isso já É conformidade SST em código, só falta virar texto institucional que explique isso pro cliente |

## G — Responsabilidades dos agentes (IA)

**Vazio de propósito.** A Fase 8 (Copiloto de IA) não foi iniciada — não
existe nenhuma chamada a API de IA no sistema hoje. Redigir uma "Política
de Funcionamento dos Agentes Especializados" agora seria descrever um
sistema que não existe. Fica registrado aqui como requisito confirmado
para quando a Fase 8 for brainstormada — a regra central já foi
articulada pelo fundador nesta conversa e deve entrar na spec daquela
fase quando ela começar: **"Os agentes não devem ser apresentados como
substitutos de profissionais legalmente habilitados."**

## H — Responsabilidades do cliente (empresa)

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Cláusula de controlador (dado de funcionário) | **Especificada, não publicada** — `lgpd-compliance.md` §2 | — | Vira cláusula dos Termos de Uso (categoria A) |
| Veracidade dos dados inseridos | **Pendente de texto formal** | — | Comum em Termos de Uso — a empresa responde pela exatidão do que cadastra |

## I — Responsabilidades do técnico/parceiro

| Item | Onde vive / Status | Evidência | Observação |
|---|---|---|---|
| Responsabilidade técnica por inspeção/relatório assinado | **Implícita no fluxo, não formalizada em texto** — assinatura por nome digitado já existe (Fase 6A) | `backend/db/migrations/0010_inspections.sql` | Vira cláusula própria dos Termos de Uso — o sistema já registra quem assinou, falta o texto legal em cima disso |
| Acesso a múltiplas empresas (parceiro) | **Existe tecnicamente, sem cláusula de confidencialidade formal** | Fase 6B (`tenant_partners`) | Um parceiro vê dados de N empresas — vale cláusula explícita de sigilo entre clientes diferentes |

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
decompostas. Ordem confirmada pelo fundador em 2026-08-26:

1. ~~**Categoria A (páginas públicas do site, núcleo bloqueante)**~~ —
   ✅ fechado em 2026-08-26 (Política de Privacidade, Termos de Uso,
   canal de contato). Os demais 8 itens da categoria A (segurança,
   cookies, retenção, incidentes, fornecedores, FAQ) ficam para uma
   rodada seguinte, sem bloquear nada.
2. ~~**Auditoria consultável (C/J)**~~ — ✅ fechado em 2026-08-26
   (`GET /audit-log` + `/admin/auditoria`).
3. **Categoria F (Compromisso SST)** — próximo da fila, conteúdo
   institucional, sem dependência técnica nova.
4. **Categoria G (agentes)** — continua deliberadamente parado até a
   Fase 8 existir.
