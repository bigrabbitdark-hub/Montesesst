# Módulo EPI — Subsistema 4: menu, telas do responsável e dashboard (design)

Data: 2026-10-18. Status: rascunho para revisão do proprietário. Sem commit.
Rótulos: VERIFICADO (lido no código), RECOMENDADO (proposta), NÃO VERIFICADO.
Depende dos subsistemas 1 (estoque, 0081), 2 (ficha/PDF, 0082) e 3 (assinatura, 0083), todos no worktree `/opt/montese-epi` (`feat/epi-estoque`), ainda sem commit.

## Escopo

Entrega: setor **EPI** no menu da Empresa com Painel, Cadastro, Movimentação e Fichas; as quatro telas; fluxo de assinatura do lado do responsável (gerar link com QR/código, assinatura presencial, acompanhamento); endpoint de dashboard e demais rotas de apoio no backend; endurecimento da rota legada de entrega; remoção do `EpisPanel` antigo; resumo e atalho para o técnico/parceiro.

Fora de escopo: importação de EPI por planilha; navegação própria do técnico além de uma rota única; envio do link por e-mail/WhatsApp; edição do texto do termo; página pública de verificação; qualquer mudança de infraestrutura.

## Estado atual (VERIFICADO)

- Menu em `frontend/src/lib/dashboard/menu.ts` (`MENU_SETORES`): um único item "EPIs" (`/empresa/epis`) no setor "Segurança", mais "Consulta de CA". `itemAtivo` escolhe o href mais específico por prefixo de segmento.
- `frontend/src/app/empresa/layout.tsx`: `RoleGuard allow={['empresa']}` + `EmpresaShell`. Padrão de página: `PageHeader`, `DashSkin`, `Card`; token em `localStorage['montese_token']` (`@/lib/auth`: `getToken`, `getUser`); chamadas por `/api/...`.
- `components/EpisPanel.tsx` (381 linhas): cadastro por catálogo + entrega pela rota LEGADA `POST /epis/:id/deliveries` (não baixa estoque; ignora CA vencido/EPI inativo). Usado em `app/empresa/epis/page.tsx` e na página longa `app/tecnico/empresas/[tenantId]/page.tsx` (`<EpisPanel tenantId=…/>`).
- Componentes de UI reaproveitáveis: `Card`, `Badge`, `Skeleton`, `AsyncBody`, `KpiCard`, `PageHeader`, `DashSkin`, `VencimentosCard`, `PendenciasCard`.
- Backend já oferece: `GET /epis/search` (filtros e paginação), `POST/PATCH /epis`, `POST /epis/:id/movements|adjustments`, `POST /epis/movements/:id/reversal`, `GET /epis/movements`, `GET /epis/:id/lots`, `GET /epi-fichas/employees/:id` (+ `preview.pdf`, `issue`, `documents`, `documents/:id/download|verify`), `POST /epi-signatures/requests|in-person`, `GET/POST …/requests`, `GET /epi-signatures/:id/receipt.pdf`, `GET /employees`, `GET /epi-catalog-items`, `GET /caepi/search`.
- NÃO existe: endpoint de indicadores do EPI; rota que edite `tenants.epi_alert_days` (padrão 30); lista de entregas aguardando assinatura; `tenant_id` opcional nas listagens novas (`/epis/search` rejeita `tenant_id`).
- O frontend NÃO tem biblioteca de QR code.

## Decisões do proprietário (2026-10-18)

1. **Quem usa**: telas construídas para a área da **Empresa**, com todos os componentes recebendo `tenantId`; o técnico/parceiro reaproveita os mesmos componentes por uma rota única `/tecnico/empresas/<id>/epi` (abas) e a página da empresa na área do técnico troca o `EpisPanel` por um resumo com link. Sem navegação nova para o técnico.
2. **QR code**: adicionar a biblioteca `qrcode` com **versão fixa** no frontend (altera `package.json` e o lockfile; sem commit). QR gerado no navegador, a partir do link (nada vai a terceiros).
3. **Painel antigo e rota legada**: o painel novo substitui o antigo; a rota legada `POST /epis/:id/deliveries` continua existindo, mas passa a recusar (409) EPI inativo, CA vencido e EPI que já tem movimentação no livro.
4. Padrões aceitos na aprovação do desenho: dashboard abre com **período de 30 dias**; o ajuste dos dias de aviso de vencimento fica **no cabeçalho do painel**, só para `empresa`.

## Abordagem

Quatro telas dedicadas com componentes compartilhados e um endpoint de dashboard agregado no backend. Rejeitadas: uma página única com abas (não entrega as "três áreas" do menu) e calcular indicadores no navegador a partir das listas (totais errados com paginação, várias requisições).

## Menu e rotas

`MENU_SETORES`: remover "EPIs" de "Segurança"; novo setor **EPI** com `Painel de EPI` (`/empresa/epi`), `Cadastro de EPI` (`/empresa/epi/cadastro`), `Movimentação de EPI` (`/empresa/epi/movimentacao`), `Fichas de controle` (`/empresa/epi/fichas`); "Consulta de CA" permanece em "Segurança". `/empresa/epis` redireciona para `/empresa/epi`. A contagem de itens citada em comentários/testes do menu (24) deve ser atualizada com os testes existentes de `menu`/`DashboardSidebar`/shell.
Técnico/parceiro: `/tecnico/empresas/[tenantId]/epi` renderiza os mesmos componentes em abas (Painel, Cadastro, Movimentação, Fichas) com o `tenantId` da URL; a página `app/tecnico/empresas/[tenantId]/page.tsx` troca o `EpisPanel` por um cartão-resumo com link.

## Telas

1. **Painel** (`/empresa/epi`): `KpiCard`s — EPIs cadastrados, estoque disponível (soma), estoque baixo/zerado, CA e lotes vencidos e a vencer (usando os dias de aviso da empresa), entregas aguardando assinatura, valor em estoque. Listas: alertas (EPIs em estoque crítico e CA/lotes a vencer), movimentações recentes, entregas aguardando assinatura (com ação "Gerar link"). Atalhos: registrar entrega, abrir ficha, consultar estoque. Filtros por período (padrão 30 dias), equipamento e funcionário. Controle dos dias de aviso (1–365) no cabeçalho, só `empresa`.
2. **Cadastro**: tabela com busca, filtros (situação, categoria, faixa de estoque, alerta de CA), paginação; criar (catálogo + CA, com consulta ao CAEPI quando disponível), editar (PATCH, incluindo fabricante/modelo/mín/máx/custo/lote), inativar, ver lotes. Abertura de estoque e ajuste só para `empresa`.
3. **Movimentação**: histórico com filtros (EPI, funcionário, tipo, período, paginação) e formulários de entrada, entrega, devolução, troca, baixa, ajuste e estorno; cada envio gera uma `idempotency_key` própria (reenvio seguro); erros do backend (estoque insuficiente, CA vencido, limite de devolução) traduzidos em mensagens claras; confirmação em baixa, ajuste e estorno. Após a entrega: **"Gerar link de assinatura"** abre painel com QR, link (copiar), código de 6 dígitos **mostrado uma única vez** (copiar, aviso explícito de que não pode ser recuperado), expiração e instrução ao responsável; também **"Registrar assinatura presencial"** (testemunha + motivo) e revogação de link ativo. A resposta de criação nunca é persistida em storage do navegador.
4. **Fichas**: seleção/busca de funcionário; ficha com filtros (período, situação da assinatura); **pré-visualizar PDF** e **baixar documento emitido** por `fetch` autenticado → Blob → abertura/download (nunca URL pública); **emitir** versão (idempotency key); lista de versões com **verificar integridade** (íntegro/divergente/ausente); status da assinatura por linha; download do comprovante de cada assinatura; ações "Gerar link" para entregas pendentes.

## Backend novo

- `GET /epis/dashboard` (`empresa`, `tecnico`, `parceiro`, `admin`; RLS): query `from`, `to` (datas), `epi_id`, `employee_id`, `tenant_id` opcional (técnico/parceiro/admin) — validadas (nunca 500). Resposta: `{ kpis: { epis_total, stock_total, stock_value, low_stock, zero_stock, ca_expired, ca_expiring, lots_expired, lots_expiring, pending_signatures }, alerts: [...], recent_movements: [...], pending: [...], alert_days }`; uma consulta agregada por bloco, limites nas listas (ex.: 10), sem CPF.
- `PATCH /tenants/me/epi-settings` ou `PATCH /epis/settings` { `epi_alert_days` 1–365 } (`empresa`, `admin`), auditado; o técnico/parceiro não altera.
- `GET /epi-signatures/pending` (`?employee_id`, `?tenant_id`): entregas `pendente`/`recusada` com funcionário (nome), EPI, data, quantidade, status do link ativo (se houver) — sem token/código/hash.
- `tenant_id` opcional (UUID) em `GET /epis/search` e `GET /epis/movements` para técnico/parceiro/admin (a RLS continua limitando; para `empresa` o valor é ignorado ou 400 se divergir do próprio — decidir no plano).
- **Rota legada** `POST /epis/:id/deliveries`: 409 quando EPI inativo, CA vencido ou EPI com movimentação no livro (mensagens sem dado pessoal); testes de regressão do comportamento anterior para EPI sem livro.

## Frontend — estrutura

`frontend/src/lib/epi/` (cliente tipado: `api.ts` com `getToken`, tratamento de 401/403, `downloadBlob`, `idempotencyKey()`), `frontend/src/components/epi/` (views por área: `EpiDashboardView`, `EpiCadastroView`, `EpiMovimentacaoView`, `EpiFichasView`, `SignatureLinkDialog`, `InPersonDialog`, `StockBadge`, `CaBadge`, `SignatureStatusBadge`), páginas finas em `app/empresa/epi/*` e `app/tecnico/empresas/[tenantId]/epi/page.tsx`. Remoção de `components/EpisPanel.tsx` e atualização dos testes que o mockam (`skin-paginas.test.tsx`). Dependência nova: `qrcode` (versão fixa) para o QR do diálogo; os dados do QR (o link) nunca saem do navegador.

## Qualidade e segurança

Mobile-first e acessível (rótulos, foco em diálogos, `aria-live` para erros, contraste AA, alvos ≥ 44 px, tabelas responsivas), estados vazio/erro/carregando, confirmação em ações destrutivas. O código de assinatura e o link ficam só em estado React do diálogo, são limpos ao fechar e não são colocados em log/storage. Papéis: as telas da Empresa exigem `empresa` (layout atual); a rota do técnico usa o layout do técnico. Mensagens de erro de lista fechada, sem texto cru do servidor. Sem CPF em tela (a ficha já vem mascarada).

## Testes

Backend (ensaio descartável): dashboard (KPIs corretos contra fixtures de estoque/CA/lotes/assinaturas, filtros, limites, isolamento entre empresas, papéis, entrada inválida → 400), configuração de dias de aviso (validação, papéis, efeito nos alertas), pendências de assinatura (sem token/código/hash), `tenant_id` opcional, rota legada endurecida e regressão. Frontend (Vitest + Testing Library, `fetch` mockado): cada view (carregamento, vazio, erro, filtros, paginação, formulários e mensagens de erro), diálogo de assinatura (código exibido uma vez, QR, copiar, fechar limpa o estado), downloads por Blob, verificação de integridade, menu e redirecionamento. Verificação visual por captura (mobile e desktop) com o ferramental já usado. Regressão completa (unit + e2e em lotes + frontend), `tsc`, `lint` sem avisos novos, `next build`.

## Riscos e pontos em aberto

- Dependência nova `qrcode`: auditar (`npm audit`), fixar versão e registrar no relatório; sem commit do lockfile.
- O dashboard agrega várias tabelas: medir o custo da consulta com volume realista (ex.: 5 mil EPIs, 200 mil movimentos) e criar índices só se houver prova (migration `0084`, a confirmar).
- Contagem do menu (24 itens) em testes/comentários existentes muda.
- O backend só emite os PDFs de ficha/comprovante por rota autenticada: o download no navegador depende do token em memória; documentar o comportamento quando a sessão expira.
- Termo em rascunho: a geração de link/presencial responde 409 em produção até a aprovação do texto — a tela deve explicar isso ao responsável.
- Retenção/LGPD: funcionário com ficha/movimentação não pode ser apagado (já registrado); decisão do proprietário.
- Nada deste subsistema foi implementado ou testado ainda.

## Critérios de aceitação

1. O menu EPI aparece no dashboard da Empresa com as quatro áreas e respeita permissões; `/empresa/epis` redireciona.
2. Cadastro, movimentação e ficha funcionam pela interface com dados persistidos; o estoque na tela reflete o livro.
3. O responsável gera o link de assinatura (QR, link, código uma única vez), acompanha, revoga e registra assinatura presencial; vê o status na ficha.
4. Ficha pode ser pré-visualizada, emitida, baixada e verificada pela interface.
5. Dashboard mostra indicadores reais da empresa logada, com filtros e alertas configuráveis.
6. A rota legada de entrega não permite entregar EPI inativo, com CA vencido ou com movimentação no livro.
7. Técnico/parceiro acessam os mesmos componentes pela rota única com isolamento por RLS comprovado.
8. Testes de backend e frontend, `tsc`, `lint` (sem avisos novos), `next build` e regressão completa passam; verificação visual feita.
