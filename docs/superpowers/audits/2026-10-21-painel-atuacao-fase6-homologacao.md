# Painel de Atuação — Fase 6: homologação em navegador real (2026-10-21)

Executor: agente de QA (somente leitura sobre o produto; nenhum código do produto alterado).
Ambiente: backend + frontend + nginx de teste + stub S3 em containers descartáveis, banco `montese_hom` com dados fictícios. Produção (`montese_*`) intocada.
Método: scripts Node ESM + Playwright (Chromium 1140 do host, headless), em `/tmp/claude-0/-opt-Montese/bac8b5c8-7575-4e72-a1f2-42d204d1d1d3/scratchpad/hom-journeys/` (`lib.mjs`, `j1_3`, `j4_5`, `j6_7`, `j8`, `j8b`, `j8c`, `j8d2`, `j9_10`, `j12_13` e logs `*.log`). Banco conferido só com `hom-sql.sh`. Capturas: `/tmp/claude-0/-opt-Montese/bac8b5c8-7575-4e72-a1f2-42d204d1d1d3/scratchpad/hom-shots/`. Nenhuma senha foi escrita em arquivo, log ou captura (lidas só de `process.env`).

Observação: o texto literal de AC-01…AC-15 ("proposta original") não está no repositório. O mapeamento AC → jornada segue a tabela do plano (`docs/superpowers/plans/2026-10-21-painel-atuacao-fase6.md`).

## Resultado por critério de aceite

| AC | Jornada | Resultado | Evidência |
|---|---|---|---|
| AC-01 | J1 | PASSOU | Login de sócio A e B pela UI cai em `/atuacao`; menu = Painel, Clientes Montese, Minhas tarefas, Agenda, Financeiro, Documentos; nenhum link `/admin`, `/tecnico`, `/empresa`. `/admin/overview` redireciona a `/atuacao`. Capturas `j1-socioA-painel.png`, `j1-socioB-painel.png`, `j1-*-admin-redirect.png`. |
| AC-02 | J1 | PASSOU | Mesmo conjunto: sem links de administração para ambos os sócios. |
| AC-03 | J2 | PASSOU | Lista UI e API = só HOM A e HOM B (2 itens), sem a empresa de parceiro. Busca "HOM B" e "Parceiro" e filtro Situação (Inativa vazio, Ativa 2) corretos. `GET /atuacao/clientes/<parceiro>` = 404. `j2-clientes.png`. |
| AC-04 | J4 | PASSOU | A cria tarefa para B (banco: `assignee`=B). B vê em "Minhas"; A só em "Todas" com marca "de …". Pendente→Concluir direto recusado (400, banco intacto); Bloquear sem motivo recusado na UI ("Informe o motivo.") e na API (400), banco `in_progress`; ciclo pending→in_progress→blocked→in_progress→completed gravado (`completed_at` preenchido); 5 eventos em `task_events`, histórico da UI na mesma ordem. `j4-*.png`. |
| AC-05 | J3 | PASSOU | Ficha: CNPJ/razão/plano/situação só texto (campos editáveis: nome fantasia, setor, contato, cargo, telefone, observações). Setor/contato/telefone gravados no banco; `cnpj`, `plan`, `name` intactos. PATCH com `cnpj`, `plan`, `name` ou `sector+plan` = 400 ("property … should not exist"), dados intactos. `j3-ficha-salva.png`. |
| AC-06 | J6 | PASSOU | UI × banco: MRR R$ 794,00 (= 2×39700 das assinaturas `authorized` Montese; parceiro excluído); Aprovado no mês R$ 299,00 (= payment_events do mês, só Montese); HOM B "Com pendência / Em atraso há 5 dias" (último pagamento rejeitado 16/10; banco: 5 dias); HOM A sem pendência; filtro "Só com pendência" mostra só B; cartão financeiro da ficha de B idem. `j6-financeiro*.png`. |
| AC-07 | J7 | PASSOU | Com token de sócio: `PATCH /plans/:id`, `PATCH /subscriptions/:id/status`, `POST /subscriptions`, `GET /admin/dashboard/{financeiro,alertas,clientes-recentes}`, `GET /subscriptions`, `GET /subscriptions/:id/payment-events` e rotas `/atuacao/admin/*` = 403. Snapshot de `plans`, `subscriptions` e contagem de `payment_events` idêntico antes/depois. |
| AC-08 | J8 (+J8c/J8d) | PASSOU | Ver seção "Detalhe J8". |
| AC-09 | J2 + J9 | PASSOU | Tenant de parceiro invisível ao sócio (UI/API 404); técnico vê só "Empresa de Parceiro HOM" e nunca HOM A/B; técnico e empresa recebem 403 em `/atuacao/*`. |
| AC-10 | J9 | PASSOU | Empresa: login → `/empresa/onboarding`; `/atuacao`, `/admin/*`, `/tecnico/empresas` redirecionam a `/dashboard-v2`; APIs `/atuacao/*`, `/tenants`, `/tenants/:id/detail`, `/admin/dashboard/*` = 403; `/tenants/me` = HOM A; `/documents` só de HOM A; UI sem menção a HOM B/parceiro. Técnico: login → `/tecnico/empresas`; `/atuacao*` e `/admin/overview` redirecionam. |
| AC-11 | J10 | PASSOU | Admin: login → `/admin/overview`; 9 telas abrem; `/admin/documentos-fluxo` mostra PGR "Viável" e Laudo "Não configurada" (também PCMSO etc.); admin recebe 403 em `GET /atuacao/{clientes,tarefas,agenda,documentos,financeiro/resumo}`, `PATCH /atuacao/clientes/:id` e `POST /atuacao/documentos`; `GET` de matriz/viabilidade/registros = 200; admin não aprova rascunho (403). |
| AC-12 | J11 | NÃO VERIFICADO (parcial) | Verificadas em `audit_log`: `role.denied` (11), `document_draft.*` (created/version_added/submitted/approved/signed/returned/cancelled/published/downloaded/denied), `client.update_operational` (detalhe: "campos: sector, contact_name, contact_phone"), `finance.viewed`; `detail` só com ids/status/nomes de campo; busca por textos livres digitados nas jornadas (motivos, notas, resumo, setor, contato) e por "TESTE"/"0001"/"0002" = 0 ocorrências. **`permission.denied` não foi exercitado**: ambos os sócios do ambiente têm as 14 permissões, então o `PermissionsGuard` nunca nega; sem poder alterar permissões, a ação não foi gerada. |
| AC-13 | J7 | PASSOU | Mesma evidência de AC-07 para escrita/leitura financeira fora do escopo; 11 linhas `role.denied` geradas (0 → 11) com método, path e 403, sem corpo. |
| AC-14 | J12 | PASSOU | Empresa (7 telas), técnico (4), admin (4) e sócio (6): 0 `console.error`, 0 pageerror, 0 respostas `/api` ≥ 400, nenhuma tela com erro de aplicação. |
| AC-15 | J6 | PASSOU | "Somente consulta" visível; único botão na tela de Financeiro é "Sair"; API de lista sem campos `mercadopago/preapproval/payer/token/payload` (chaves: id, name, trade_name, situacao, plano, valor_mensal_cents, ultimo_pagamento, pendencia, dias_em_atraso). |

Contagem: **PASSOU 14 · FALHOU 0 · NÃO VERIFICADO 1 (AC-12, parcial)**.

## Detalhe J8 (documentos, matriz de teste só para `pgr`)
- A cria rascunho PGR (evento `created`); sem versão a UI não oferece "Enviar para revisão" e a API recusa (409 "Envie ao menos uma versão…").
- A envia PDF mínimo válido pela UI; SHA-256 no banco = SHA-256 calculado localmente do mesmo buffer. Upload com conteúdo não-PDF declarado como PDF = 400 (`verifyFileContent`), nada gravado. B sem permissão `elaborar` não envia versão (403).
- A envia à revisão; A não vê "Aprovar" e `POST aprovar` = 403 (mensagem da matriz), status intacto. A tentando devolver a própria versão = 409 "Quem elaborou o documento não pode revisá-lo nem aprová-lo."; A sem permissão de assinar = 403; A não publica (409).
- B aprova → aprovado; diálogo "Registrar assinatura interna" contém o aviso exato; assinatura gravada com snapshot TESTE/0002/SP, hash = hash da versão, IP e user-agent presentes; B publica → `documents` ganha linha (tenant HOM A, categoria `pgr`, `uploaded_by_role='socio'`); eventos exatamente `created, version_added, submitted, approved, signed, published`.
- `empresa.hom` vê o documento em `/empresa/documentos` somente após publicar (um segundo documento assinado, não publicado, não aparece).
- Devolver sem nota recusado (UI "Informe a nota."); devolvido volta a `em_elaboracao`. Cancelar em elaboração funciona; versão em cancelado = 409. Cancelar documento já aprovado exige matriz de aprovar (A não tem) — comportamento de regra, não defeito.
- Laudo (sem matriz): criar rascunho é bloqueado, UI e API 403 com "Ação não habilitada para este tipo de documento. Peça ao administrador para configurar as responsabilidades."; nada gravado (0 → 0). `j8-laudo-bloqueio.png`.
- Nova versão após assinar: documento volta a `em_elaboracao`, a assinatura aparece "não vigente (versão substituída)", assinatura e 2 versões preservadas no banco; publicar = 409 e assinar = 409.
- Download de versão: URL temporária do stub S3 (`GET …/download` 200; aba abre).
- Varredura de texto nas telas do fluxo: nenhuma ocorrência de "assinatura digital", "ICP-Brasil" ou "certificado digital" fora do aviso oficial.
- Admin, empresa e técnico recebem 403 em detalhe e lista do fluxo.

## Achados

### Critical
Nenhum.

### Important
Nenhum.

### Minor
1. **Ficha do cliente mostra "Plano: trial" enquanto a assinatura é Start (R$ 397,00).** Passos: sócio A abre `/atuacao/clientes/<HOM A>`. Esperado: plano coerente com o cartão Financeiro da mesma tela. Obtido: card "Dados cadastrais" mostra `tenants.plan` ("trial"), cartão Financeiro mostra "Start". Provável coluna legada/semente (INFERIDO); em produção pode não ocorrer. Captura: `j5-ficha-interacao.png`.
2. **Admin `/admin/overview` em 1280 px: cartões de KPI cortados/sobrepostos** ("Receita Total R$ 1.19…", gauges de "Saúde do Sistema" sobrepostos). Tela existente, fora do painel do sócio; sem erro de console. Captura: `j10-admin-overview.png`.
3. **Botão flutuante do WhatsApp sobrepõe conteúdo no mobile (375 px)** nas telas do painel (ex.: `j13-375-dialogo-foco.png`).
4. **Aviso de assinatura interna aparece também no detalhe sem ação de assinar** (card "Assinaturas internas registradas"). Provavelmente intencional (decisão do proprietário: aviso sempre exibido); registrado só para conhecimento.

## Falhas de script (corrigidas; não são defeitos do produto)
- `J10.abre /admin/overview`: falso positivo (regex "Erro" casou o filtro "Erro" dos logs); a tela está íntegra (captura `j10-admin-overview.png`; J12 admin: 0 erros).
- `J5.interacao-ficha`: checagem feita antes do recarregamento; a captura `j5-ficha-interacao.png` mostra o registro na ficha e J5.B-vê-interacao confirmou. O script foi ajustado com espera, mas **não foi reexecutado** (evidência = captura + leitura de B).
- `J8d.cancelado-terminal` (1ª versão): tentou cancelar documento aprovado sem permissão; reescrito (`j8d2.mjs`) e passou.
- Chromium: o headless-shell esperado pelo Playwright não existe; usado `/root/.cache/ms-playwright/chromium-1140/chrome-linux/chrome` com `--no-sandbox`.

## Dados criados no `montese_hom` por esta execução
Tarefas, compromissos de agenda, interação e rascunhos de documento com sufixo de timestamp; setor/contato/telefone de HOM A alterados; 2 documentos publicados/assinados. Idempotente por sufixo; nada fora do banco descartável.

## Não testado / limitações
- `permission.denied` (AC-12): inalcançável sem remover permissões de um sócio (não permitido neste ambiente); recomenda-se um sócio de teste C com permissões parciais numa próxima rodada.
- Imutabilidade de `task_events`/eventos por trigger: o `hom-sql.sh` é somente leitura e não há endpoint de alteração; não testada em navegador (coberta, segundo o plano, pelos testes de backend).
- Matriz e registros profissionais do admin foram verificados só por leitura (tela e API); gravação/confirmação/revogação pela UI de admin não exercitadas.
- Edição de ficha por sócio B, edição de interação pelo criador e filtros de período da agenda não exercitados em profundidade; sem concorrência (duplo clique/duas abas).
- Download verificado só até a URL do stub S3 (conteúdo do arquivo não aberto); sem R2 real, e-mail, IA ou Mercado Pago.
- `NODE_ENV=development`, sem TLS, Chromium de uma versão, dados fictícios; "Sistema degradado / Site inacessível" no overview do admin é efeito do ambiente de teste (INFERIDO). Não substitui validação com os usuários reais.
- Acessibilidade: verificado teclado/foco/Esc nos diálogos e ausência de rolagem horizontal em 375 e 1280 px; sem leitor de tela nem auditoria de contraste.

## Verificação independente do controlador (2026-10-21)
Reconferi no banco de homologação (somente leitura, `hom-sql.sh`) as evidências mais sensíveis do relatório acima:
- **AC-07/13:** preços dos planos e as 3 assinaturas (`authorized`) intactos; 11 linhas `role.denied`.
- **AC-08:** `document_drafts`: 1 publicado, 1 aprovado, 2 cancelados, 4 em elaboração; `documents` tem 1 linha `pgr` com `uploaded_by_role='socio'`; a `file_key` do documento publicado **difere** da chave da versão e é igual à `publish_file_key` do rascunho (cópia própria, como projetado).
- **AC-12 (auditoria):** `detail` só contém ids, status, categoria, nome da consulta e nomes de campo; nenhuma ação do painel grava query string no `path`.
- **AC-12 — FECHADO:** criei um sócio de teste C (`socio.c.hom`) com **apenas** `clients.read` (script `seed-socio-parcial.js`) e exercitei: `GET /atuacao/clientes` ⇒ 200; `/atuacao/financeiro/resumo`, `/atuacao/tarefas`, `/atuacao/documentos`, `/atuacao/agenda` ⇒ 403 `PERMISSION_DENIED`; `PATCH /atuacao/clientes/:id` ⇒ 403 e o setor no banco **não mudou**. `audit_log` recebeu 4 linhas `permission.denied` (403) com `faltando: <permissão>`; a query string `?x=segredo` enviada na requisição **não** aparece no `path` auditado. **AC-12 passa de NÃO VERIFICADO para PASSOU.**
- **Minor 1 confirmado como artefato do seed:** `tenants.plan` ficou "trial" porque o seed inseriu a assinatura direto, sem passar por `payments_update_subscription_status`, que é quem atualiza `tenants.plan` (0006, linha 90). RECOMENDADO: a ficha exibir o plano da assinatura (fonte única) ou rotular "Plano (cadastro)"; decisão do proprietário sobre `tenants.plan` ser autoritativo.

**Contagem final: PASSOU 15 · FALHOU 0 · NÃO VERIFICADO 0** (nos limites do ambiente descartável: `NODE_ENV=development`, sem TLS, stub S3, dados fictícios, Chromium único).

### Ainda não exercitado em navegador
Gravação da matriz e dos registros profissionais pela UI do admin (só coberta por testes de unidade e e2e de API); imutabilidade de `task_events` por trigger (testes de backend); download real pelo R2; QA com leitor de tela; contraste e foco por inspeção humana.
