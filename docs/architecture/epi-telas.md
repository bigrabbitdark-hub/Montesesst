# Módulo EPI — Subsistema 4: menu, telas do responsável e dashboard

Status: **implementado e testado no ensaio descartável; não commitado** (worktree `/opt/montese-epi`, branch `feat/epi-estoque`; a árvore de trabalho foi só "snapshotada" por `git add -A`/`write-tree` do controlador, sem commit). **Nada em produção.** A prova ponta a ponta em navegador foi feita em ensaio com **MinIO no lugar do R2** (o R2 real não foi exercitado).

Rótulos: VERIFICADO (conferido por quem redigiu no código lido para este documento), RELATADO (resultado de execução vindo de relatório; o redator **não reexecutou** nada), NÃO VERIFICADO, INFERIDO, RECOMENDADO.

Observação sobre "testes passaram": todos os resultados de execução deste documento vêm de `.superpowers/sdd/2026-10-18-epi-telas-dashboard/` (`task-1..6-report.md`, `task-5-backend-reversed-report.md`, `progress.md` = o "ledger") e do relatório da prova em navegador (`scratchpad/e2e-browser/relatorio.md` da sessão do orquestrador, fora do repositório). A origem de cada número vem junto dele. O que é "VERIFICADO" aqui é leitura de código.

Fontes: spec `docs/superpowers/specs/2026-10-18-epi-telas-dashboard-design.md`; plano `docs/superpowers/plans/2026-10-18-epi-telas-dashboard.md`; backend `backend/src/epi/{epis.controller.ts,epi-dashboard.service.ts,tenant-scope.util.ts,epi-stock.service.ts,epi.service.ts}`, `backend/src/epi-signature/*`, `backend/src/common/interceptors/audit.interceptor.ts`; frontend `frontend/src/lib/epi/*`, `frontend/src/components/epi/*`, `frontend/src/app/empresa/epi/*`, `frontend/src/app/tecnico/empresas/[tenantId]/epi/page.tsx`, `frontend/src/lib/dashboard/menu.ts`. Complementa `epi-estoque.md` (subsistema 1), `epi-ficha.md` (2) e `epi-assinatura.md` (3).

## 1. Visão geral e escopo

Entrega do subsistema 4 (VERIFICADO no código):
- setor **EPI** no menu da Empresa com 4 telas: Painel, Cadastro, Movimentação e Fichas de controle;
- fluxo de assinatura **do lado do responsável**: gerar link com QR e código de 6 dígitos, assinatura presencial, revogar link ativo, acompanhar pendências;
- backend de apoio: dashboard agregado, dias de aviso de vencimento, lista de pendências de assinatura, `tenant_id` opcional nas listagens, flag `reversed` nas movimentações, endurecimento da rota legada de entrega;
- rota única do técnico/parceiro com abas, que reaproveita os mesmos componentes, e cartão-resumo na página da empresa;
- remoção do `EpisPanel` antigo (VERIFICADO: `frontend/src/components/EpisPanel.tsx` não existe mais; `/empresa/epis` virou redirecionamento).

**Fora de escopo** (spec): importação de EPI por planilha; navegação própria do técnico além da rota única; envio do link por e-mail/WhatsApp; edição do texto do termo; página pública de verificação; mudança de infraestrutura. **Nenhuma migration nova** (VERIFICADO: as últimas são 0081, 0082, 0083; o ledger registra que a medição de custo do dashboard não justificou a "0084").

## 2. Mapa de rotas e menu

| Rota | Quem | O que renderiza |
|---|---|---|
| `/empresa/epi` | empresa | Painel (`EpiDashboardView`) + `SignatureLinkDialog` + `InPersonDialog` |
| `/empresa/epi/cadastro` | empresa | `EpiCadastroView` |
| `/empresa/epi/movimentacao` | empresa | `EpiMovimentacaoView` |
| `/empresa/epi/fichas` | empresa | `EpiFichasView` |
| `/empresa/epis` | empresa | **redireciona** para `/empresa/epi` (server component com `redirect`); mantém links e favoritos antigos |
| `/tecnico/empresas/[tenantId]/epi` | técnico, parceiro | as quatro views em **abas** (Painel, Cadastro, Movimentação, Fichas) com o `tenantId` da URL |
| `/tecnico/empresas/[tenantId]` | técnico, parceiro | página da empresa; o antigo `EpisPanel` foi trocado por `EpiResumoCard` |

- **Menu** (`frontend/src/lib/dashboard/menu.ts`, VERIFICADO): o item "EPIs" saiu do setor "Segurança"; novo setor **EPI** com `Painel de EPI`, `Cadastro de EPI`, `Movimentação de EPI` e `Fichas de controle`. "Consulta de CA" permanece em "Segurança". O ledger e o relatório da Task 3 informam que o menu passou de 24 para 27 itens e que os testes de `menu`/`shell`/`tecnico-shell` foram atualizados (RELATADO).
- **Guarda de papel:** o layout da empresa (`app/empresa/layout.tsx`) só aceita `empresa` (`RoleGuard allow={['empresa']}`, VERIFICADO). A rota do técnico usa o layout do técnico. As permissões reais são do backend; no cliente, ações exclusivas da empresa ficam desligadas de forma explícita na rota do técnico (`canEditSettings={false}`, `canManageStock={false}`).
- **EpiResumoCard** (VERIFICADO): na página da empresa do técnico, mostra 3 KPIs do painel ("EPIs ativos", "Estoque baixo ou zerado", "Aguardando assinatura") e o botão "Abrir módulo de EPI". Em 404 mostra "Empresa não encontrada ou sem acesso para você." com "Tentar novamente".
- O alerta do dashboard geral da empresa (`backend/src/dashboard/dashboard.service.ts`) agora aponta para `/empresa/epi` (VERIFICADO; antes era `/empresa/epis`).

## 3. Componentes e responsabilidades

Cliente e utilitários em `frontend/src/lib/epi/`:

| Arquivo | Responsabilidade |
|---|---|
| `api.ts` | **único ponto de rede** do módulo (`request`, `epiApi`, `epiPaths`, `fetchBlob`, `openBlankWindow`, `openOrDownload`, `clampPeriod`). Lê o token de `getToken()`, `cache: 'no-store'`, nunca grava em storage |
| `errors.ts` | `EpiApiError` e `mapEpiError` (lista fechada de mensagens, seção 6) |
| `idempotency.ts` | `newIdempotencyKey()` (UUID v4; plano B sem `randomUUID`) |
| `format.ts` | datas `AAAA-MM-DD`, hora de Brasília, dinheiro, quantidade, CNPJ |
| `types.ts` | tipos copiados dos controllers/DTOs reais |

Componentes em `frontend/src/components/epi/`:

| Componente | Responsabilidade |
|---|---|
| `EpiDashboardView` | Painel: filtros (período, equipamento, funcionário), 6 KPIs, alertas, movimentações recentes, pendências de assinatura (ações "Gerar link" e "Assinatura presencial"), controle dos dias de aviso (só `empresa`) |
| `EpiCadastroView` + `EpiCadastroDialogs` | tabela com busca, filtros e paginação; criar (catálogo + CA, com consulta ao CAEPI), editar (PATCH), inativar/reativar, ver lotes, abertura de estoque e ajuste (só `empresa`) |
| `EpiMovimentacaoView` | histórico com filtros e formulários de entrada, entrega, devolução, troca, baixa, ajuste e estorno; após a entrega, painel de assinatura (gerar link, presencial, ver links ativos) |
| `EpiFichasView` | seleção de funcionário, ficha com filtros, pré-visualizar PDF, emitir versão, baixar documento emitido, verificar integridade, assinatura presencial e links ativos |
| `SignatureLinkDialog` | cria o link e exibe QR, link e código uma única vez (seção 7) |
| `InPersonDialog` | assinatura presencial (testemunha + motivo) |
| `ActiveLinks` | lista links `ativa` do funcionário/entrega e permite revogar (com confirmação) |
| `Modal`, `ConfirmDialog` | diálogos acessíveis (foco preso, Esc, `aria-modal`, `z-[60]` para ficar acima do botão flutuante do WhatsApp) |
| `EpiTabs` | abas com setas/Home/End e `tabindex` móvel (usadas só na rota do técnico) |
| `Pagination`, `StockBadge`, `CaBadge`, `SignatureStatusBadge` | apresentação (texto + tom; 16 px na variante `large` do `Badge`) |
| `EpiResumoCard` | cartão-resumo do técnico (seção 2) |
| `signatureErrors.ts`, `fichaErrors.ts` | mapeamentos locais e estreitos de erro (seção 6) |

Padrões (VERIFICADO): as views recebem `tenantId?` e são envelopadas por um componente com `key={tenantId}`, de modo que trocar de empresa remonta tudo (dados, filtros, página, erro) e descarta respostas em voo. Painel e Movimentação carregam o seletor de EPIs com `epiApi.searchAllEpis` (páginas de 100, **teto de 1000**; `truncated` mostra o aviso "Mostrando os primeiros 1000 EPIs; refine pela busca."). O componente `KpiCard` ganhou a prop opcional `large` (16 px) e o `Badge` a prop `large`; os padrões antigos não mudam (teste do ledger).

## 4. Endpoints consumidos e novos

### 4.1 Novos ou alterados no backend (VERIFICADO no código)

| Rota | Papéis | Parâmetros | Respostas |
|---|---|---|---|
| `GET /epis/dashboard` | empresa, tecnico, parceiro, admin | query `from`, `to` (`AAAA-MM-DD`, data real), `epi_id`, `employee_id`, `tenant_id` (UUIDs); `forbidNonWhitelisted` | 200 `{alert_days, period{from,to}, kpis, alerts, recent_movements, pending}`; 400 (período inválido, `to < from`, mais de 366 dias, `tenant_id` ausente para tecnico/parceiro/admin ou divergente para empresa, parâmetro desconhecido/repetido); 404 (empresa inexistente ou invisível pela RLS) |
| `GET /epis/settings` | empresa, tecnico, parceiro, admin | query `tenant_id` | 200 `{epi_alert_days}` (padrão 30); 400; 404 |
| `PATCH /epis/settings` | **empresa, admin** | query `tenant_id`; corpo `{epi_alert_days}` inteiro 1 a 365 | 200 `{epi_alert_days}`; 400; 403 (tecnico/parceiro); 404 |
| `GET /epi-signatures/pending` | empresa, tecnico, parceiro, admin | query `tenant_id`, `employee_id`, `page` (1-10000, padrão 1), `page_size` (1-100, padrão 25) | 200 `{items,total,page,page_size}`; 400; 404 |
| `GET /epis/search` | os mesmos 4 | acrescenta `tenant_id` **opcional** | ver 4.3 |
| `GET /epis/movements` | os mesmos 4 | acrescenta `tenant_id` **opcional**; cada item ganha `reversed` (boolean) | ver 4.3 |
| `POST /epis/:id/deliveries` (legado) | empresa, tecnico, parceiro | inalterado | agora **409** em 3 casos (4.4) |

`GET|PATCH /epis/settings` e `GET /epis/dashboard` são declaradas **antes** de `:id` (para não serem lidas como id).

**Dashboard — conteúdo** (VERIFICADO em `epi-dashboard.service.ts`):
- `kpis`: `epis_total`, `stock_total`, `stock_value` (texto, NUMERIC sem estouro), `low_stock`, `zero_stock`, `ca_expired`, `ca_expiring`, `lots_expired`, `lots_expiring`, `pending_signatures`. KPIs de estoque, CA e lote consideram **só EPI `ativo`**; lotes só com saldo > 0.
- `alerts` (até 10): EPI ativo sem estoque/abaixo do mínimo, CA vencido/a vencer, lote vencido/a vencer; ordenados por gravidade.
- `recent_movements` (até 10, dentro do período) com `reversed`; sem CPF.
- `pending` (até 10): entregas `pendente` ou `recusada`, com nome do funcionário, EPI, quantidade e `active_request_expires_at` (só link `ativa` e não vencido). Sem token, código nem hash.
- Período: padrão **últimos 30 dias** (hoje e os 29 anteriores, dia de São Paulo); só `from` vai até hoje; só `to` volta 30 dias; máximo **366 dias** (acima disso, 400). O cliente recua o `from` sozinho (`clampPeriod`) e avisa.
- `epi_id` filtra KPIs, alertas, movimentações e pendências; `employee_id` filtra movimentações e pendências.

**`GET /epi-signatures/pending` — campos** (VERIFICADO em `epi-signature.service.ts`, `listPending`): `delivery_id`, `employee_id`, `employee_name`, `tenant_epi_id`, `epi_description`, `ca_number`, `quantity`, `delivered_at`, `signature_status`, `active_request_id`, `active_request_status`, `active_request_expires_at`. **Sem** token, hash do token, hash do código, código e CPF. Só entregas com `quantity` não nula (as legadas, sem quantidade, ficam de fora). Ordem: `delivered_at ASC, id`. `tenant_id` obrigatório para tecnico/parceiro/admin.

### 4.2 Regra de escopo de tenant (`resolveTenantScope`)

`backend/src/epi/tenant-scope.util.ts` (VERIFICADO):
- **empresa**: usa o `tenantId` do token; `tenant_id` diferente do próprio -> 400 ("tenant_id inválido"); sem tenant no token -> 400.
- **tecnico, parceiro, admin**: `tenant_id` **obrigatório** (400 se ausente) nas rotas agregadas (dashboard, settings, pending). Sem isso os números somariam empresas diferentes. O parâmetro nunca amplia o escopo: a RLS continua valendo e as consultas filtram por `tenant_id` **e** rodam sob o contexto de tenant.
- **404 uniforme:** técnico/parceiro com `tenant_id` de empresa inexistente **ou não vinculada** recebe 404 "Empresa não encontrada" (a RLS esconde a linha de `tenants`; não há como distinguir "não existe" de "não é sua").
- **`/epis/search` e `/epis/movements` (Ruling 1 e Ruling 4):** `tenant_id` é **opcional**. Presente, filtra; ausente, vale só a RLS (comportamento anterior). Empresa com `tenant_id` de outra -> 400. Técnico/parceiro com `tenant_id` invisível recebe **200 com lista vazia** (não 404), para não criar oráculo de existência numa rota em que o parâmetro é opcional.
- Outras rotas (assinatura, movimentos, estorno, ficha) **não** recebem `tenant_id`: o tenant vem da linha do EPI/funcionário sob RLS. O front mantém `tenantId` nas props só para identificar a empresa em uso e remontar a tela.

### 4.3 Códigos de `search` e `movements` com `tenant_id`
400 para `tenant_id` inválido/repetido; empresa com outro tenant, 400; sem parâmetro, igual ao `epi-estoque.md`. `reversed` em `movements`: calculado por `EXISTS` sobre `reverses_movement_id` **depois** do `LIMIT` (página limitada em subconsulta), filtrando pelo tenant da linha (VERIFICADO em `epi-stock.service.ts`). Aditivo: não quebra o contrato anterior.

### 4.4 Rota legada endurecida
`POST /epis/:id/deliveries` agora responde **409** (VERIFICADO em `epi.service.ts`, `createDelivery`, nesta ordem):
1. EPI inativo: "EPI inativo: não é possível entregar este EPI";
2. CA vencido: "CA vencido: não é possível entregar este EPI" (comparação feita no SQL com a data de São Paulo, porque `ca_valid_until` chega do driver como `Date`);
3. EPI com qualquer movimentação no livro: "Este EPI usa o registro de movimentação de estoque; registre a entrega em Movimentação."

EPI sem livro e válido segue com o comportamento antigo (201, `signature_status = 'legado'`). Mensagens sem dado pessoal.

### 4.5 Já existentes, consumidos pelas telas
`GET|POST|PATCH|DELETE /epis`, `GET /epis/:id/lots`, `POST /epis/:id/movements|adjustments`, `POST /epis/movements/:id/reversal`, `GET /epi-catalog-items`, `GET /caepi/search`, `GET /employees`, `GET /epi-fichas/employees/:id` (+ `preview.pdf`, `issue`, `documents`), `GET /epi-fichas/documents/:id/download|verify`, `POST|GET /epi-signatures/requests`, `POST /epi-signatures/requests/:id/revoke`, `POST /epi-signatures/in-person`, `GET /epi-signatures/:id/receipt.pdf`. O cliente cobre `DELETE /epis/:id` (`deleteEpi`), mas a UI **não** expõe exclusão (apaga a linha; inativar é `PATCH status`).

## 5. Auditoria de `PATCH /epis/settings`

VERIFICADO: o controller define `req.auditResourceId = tenantId` e o `AuditInterceptor` usa `request.auditResourceId ?? params.id ?? id da resposta`. Logo o registro aponta a empresa-alvo como recurso. **Não registra valor antes/depois**: `audit_log` só tem coluna de detalhe em texto (decisão do ledger, S3). Há teste de auditoria em `epi-settings.e2e-spec.ts` (RELATADO).

## 6. Mensagens de erro (lista fechada)

Princípio (VERIFICADO): o texto do servidor **só escolhe** uma mensagem; nunca é exibido. Ordem de `mapEpiError` (`frontend/src/lib/epi/errors.ts`): erro de rede -> 401 -> 403 -> 404 -> 429 -> resposta 2xx não JSON -> regras por texto -> 502/503 -> 400 -> 409 -> genérica.

| Condição | Mensagem exibida |
|---|---|
| sem resposta / erro de rede | Não foi possível conectar ao servidor. Verifique a conexão e tente de novo. |
| 401 | Sua sessão expirou. Entre novamente. |
| 403 | Você não tem permissão para esta ação. |
| 404 | Registro não encontrado. |
| 429 | Muitas tentativas. Aguarde alguns minutos. |
| 2xx com corpo não JSON | Resposta inesperada do servidor. Atualize a tela e tente de novo. |
| "Estoque insuficiente" | Estoque insuficiente para esta operação. |
| "CA vencido" | O CA deste EPI está vencido: não é possível entregá-lo. |
| "Lote já existe com outra validade" | Já existe um lote com este código e outra validade. |
| "Lote vencido" | O lote selecionado está vencido. |
| "Devolução maior que a quantidade entregue" | A devolução é maior que a quantidade entregue a este funcionário. |
| "Estorne antes as devoluções" | Estorne antes as devoluções deste funcionário neste EPI. |
| "já estornada" | Esta movimentação já foi estornada. |
| "Saldo máximo excedido" | O saldo máximo permitido seria excedido. |
| "Chave de idempotência" | Esta operação já foi registrada. Atualize a tela e confira o histórico. |
| "EPI inativo" | Este EPI está inativo. |
| "movimentação de estoque" | Este EPI usa o registro de movimentação: registre a entrega em Movimentação. |
| "termo ... aprovado" | O termo de recebimento ainda não foi aprovado. A assinatura eletrônica fica indisponível até a aprovação. |
| "Já existe movimenta..." | Este EPI já tem movimentação: use Entrada ou Ajuste. |
| "controle de lote com movimenta..." | O controle de lote não pode ser alterado: este EPI já tem movimentação. |
| "Já existe uma emissão em andamento" (backend responde 503) | Já existe uma emissão em andamento para este funcionário. Tente de novo em instantes. |
| 502/503 sem regra | O serviço está indisponível agora. Tente novamente em instantes. |
| 400 | Verifique os dados informados e tente de novo. |
| 409 | A operação conflita com o estado atual. Atualize a tela e tente de novo. |
| qualquer outro | Não foi possível concluir a operação. Tente novamente. |

Assinatura (`signatureErrors.ts`, regras locais): 503 "outra operação de assinatura em andamento" -> "Há outra emissão de assinatura em andamento para este funcionário. Aguarde alguns instantes e tente de novo."; 409 "Link já emitido" -> "Um link já foi emitido e o código não pode ser exibido de novo. Gerar outro invalida o anterior."; 409 sem entregas -> "Não há entregas aguardando assinatura para este funcionário."; 409 "não aguardam assinatura / já foram tratadas" -> "Estas entregas já foram tratadas (assinadas ou registradas). Atualize a tela e confira o histórico."; 409 "entregas mudaram de situação" -> "A situação das entregas mudou. Atualize a tela e tente de novo."; 404 "Entrega não encontrada" -> "Entrega não encontrada. Atualize a tela e tente de novo."; 404 "Funcionário não encontrado" -> "Funcionário não encontrado."; demais, `mapEpiError`.

Fichas (`fichaErrors.ts`, por contexto): 400 "Ficha muito grande" -> "A ficha tem registros demais para um único documento. Restrinja o período e tente de novo."; 400 ao carregar/prévia/emitir -> "Verifique o período e a situação da assinatura escolhidos e tente de novo."; 404 ao listar funcionários -> "Não foi possível carregar os funcionários desta empresa."; 404 em baixar/verificar -> "O arquivo deste documento não está disponível."; 404 no comprovante -> "Comprovante não encontrado."; 404 nos demais -> "Funcionário não encontrado. Atualize a lista e tente de novo."; 409 ao emitir -> "Esta emissão já foi registrada com outros dados. Atualize a lista de versões e confira antes de emitir de novo."; 502 ao emitir -> "Não foi possível guardar o documento agora. Nenhuma versão foi criada; tente de novo em instantes."; 502 ao baixar/verificar -> "Não foi possível ler o documento agora. Tente novamente em instantes."; 502 na prévia -> "Não foi possível gerar a prévia agora. Tente novamente em instantes."; demais, `mapEpiError`. Observação: o backend também usa 502 ao ler imagens de assinatura, então "guardar o documento" pode ser impreciso nesse caso (minor do ledger).

## 7. Assinatura do lado do responsável

Backend e evidência estão em `epi-assinatura.md`; aqui só a interface (VERIFICADO em `SignatureLinkDialog.tsx`).

- **Criação sob demanda:** o link só é criado ao clicar em "Gerar link de assinatura" (não ao abrir o diálogo), o que evita duas criações no StrictMode. Antes de gerar, a tela avisa que gerar novo link **invalida o link ativo** das entregas e que o link vale 24 horas.
- **Código e link aparecem uma vez:** a resposta de `POST /epi-signatures/requests` (`url`, `code`, `expires_at`) vive **somente em `useState`** do diálogo. Aparecem em `<span>`/`<code>` (não em `<input>`, para o navegador não guardá-los), nunca vão a `localStorage`/`sessionStorage`/cookie/console/URL/título, e somem ao fechar ou desmontar. A tela diz que o código "não poderá ser exibido de novo". Botões "Copiar código" e "Copiar link": se o clipboard for negado, o texto é selecionado para cópia manual. (A área de transferência do sistema, depois de copiar, está fora do controle da página; ver seção 12.)
- **QR code local:** gerado no navegador com `qrcode@1.5.4` (`QRCode.toDataURL(url, {margin:1, width:240, errorCorrectionLevel:'M'})`); nenhuma requisição a terceiros. Falha do QR mostra "Não foi possível desenhar o QR code. Use o link abaixo." Dependência: `qrcode` **1.5.4** (publicada em 2024-08-05) e `@types/qrcode` **1.5.5**, ambas em versão **exata** (`--save-exact`) em `frontend/package.json`/`package-lock.json` (relato da Task 3; VERIFICADO em `package.json`). O QR codifica `result.url`.
- **Ciclo de vida do estado:** antes de gerar (explicação + Cancelar/Gerar) -> gerando (`busy`, cliques ignorados) -> resultado (alerta de "anote agora", QR, código, link, expiração em horário de Brasília) -> Fechar. O diálogo avisa o pai com `onClose(changed)`: só um sinal booleano (link gerado nesta abertura); link e código **não saem** do componente. O pai recarrega o painel/links ativos quando `changed`.
- **`idempotency_key` e reaproveitamento:** uma chave por criação, guardada em `useRef` com a "forma" `funcionário|entregas`. Nova tentativa depois de falha **reaproveita a chave** (se a primeira requisição não chegou a gravar, funciona; o backend **não** repete a resposta de uma chave já usada: responde 409 "Link já emitido com esta chave", ver `epi-assinatura.md` 7.1). Mudou funcionário/entregas: chave nova. **409 "Link já emitido"** (a chave já foi consumida e a resposta com o código se perdeu): a chave é zerada, a mensagem explica que o código não pode ser exibido de novo e a próxima tentativa usa chave nova (gera outro link e invalida o anterior). Nas outras telas, cada diálogo/formulário tem sua chave, renovada quando um campo muda; a Ficha zera a chave em 409.
- **Presencial:** `InPersonDialog` (testemunha + motivo) na Movimentação, na Ficha e no Painel.
- **Revogação:** `ActiveLinks` lista requisições `ativa` (por entrega na Movimentação; por funcionário na Ficha, "Ver links ativos do funcionário") e revoga com `ConfirmDialog`.
- **Termo em rascunho (só se `EPI_TERM.draft` voltar a ser `true`; o vigente `v1-2026-11` é aprovado):** o backend bloqueia link e presencial com 409 enquanto `EPI_SIGNATURE_ALLOW_DRAFT_TERM` não for `true` (VERIFICADO em `signature-secrets.util.ts`: `!EPI_TERM.draft || env === 'true'`). A tela traduz como "O termo de recebimento ainda não foi aprovado...". Na Ficha, o aviso vem de `term.draft` no JSON da ficha (a ficha é emitida mesmo com termo em rascunho).

## 8. Downloads e PDF

VERIFICADO em `api.ts`: PDFs são sempre buscados com `fetch` autenticado (`Authorization: Bearer`), convertidos em `Blob` e abertos/baixados por URL temporária (`URL.createObjectURL`, revogada após 60 s). **Nunca** URL pública.
- `fetchBlob` só aceita `Content-Type: application/pdf`; outro tipo (por exemplo HTML de erro de proxy) vira "resposta inesperada" e nunca é aberto; o `Blob` é criado com `type: 'application/pdf'`.
- **Janela pré-aberta:** navegadores (Safari/iOS) bloqueiam `window.open` depois de um `await`. O clique chama `openBlankWindow()` (`window.open('', '_blank')` com `opener = null`) **antes** da busca e passa a janela em `win`; o `openOrDownload` navega essa aba para o Blob e a fecha se o fetch falhar. Sem `win`, tenta abrir; se o navegador bloquear, baixa por âncora e devolve `'downloaded'` para o chamador avisar o usuário. (`window.open` com `noopener` retorna sempre `null`, por isso o `opener` é zerado à mão.)
- **Sessão expirada:** o `fetchBlob` recebe 401 e a tela mostra "Sua sessão expirou. Entre novamente." (mensagem fixa; não há renovação automática do token).

## 9. Decisões e rulings

Decisões do proprietário em 2026-10-18 (spec): (1) telas para a Empresa, componentes com `tenantId`, técnico/parceiro por rota única com abas e resumo na página da empresa; (2) `qrcode` com versão fixa, QR no navegador; (3) painel novo substitui o antigo e a rota legada recusa com 409 EPI inativo, CA vencido e EPI com movimentação; (4) período padrão de 30 dias e ajuste dos dias de aviso no cabeçalho do painel, só `empresa`. Autorização de execução (ledger): subagent-driven, ensaio Docker, `qrcode` em versão fixa, **nenhum commit**.

Rulings do controlador (ledger, `progress.md`):
- **Ruling 1:** `tenant_id` obrigatório (via `resolveTenantScope`) em dashboard, settings e `/epi-signatures/pending` para tecnico/parceiro/admin; **opcional** em `/epis/search` e `/epis/movements` (filtra quando presente; empresa com outro tenant -> 400), por compatibilidade com consumidores atuais. Custo se errado: técnico sem `tenant_id` em search segue agregando pela RLS.
- **Ruling 2:** os valores esperados dos KPIs no teste da Task 1 são calculados pelo implementador a partir das fixtures reais (o exemplo do plano era ilustrativo). Custo: nenhum.
- **Ruling 3:** `employee_id` em `/epis/search` está **fora de escopo**; a frase confusa do plano foi ignorada.
- **Ruling 4:** em `/epis/search` e `/epis/movements`, técnico/parceiro com `tenant_id` invisível recebe **200 vazio** (não 404): o parâmetro é opcional (Ruling 1) e não deve virar oráculo de existência. Custo se errado: a UI mostra lista vazia em vez de erro.
- **Ruling 5:** a marca "Estornada" inferida no cliente falhava com filtro de tipo/paginação; o backend passou a expor `reversed` (aditivo) em `GET /epis/movements`, com `EXISTS` depois do `LIMIT`, e o frontend usa a flag. Custo se errado: pequena mudança aditiva de contrato; sem migration.
- **Ruling 6:** o botão "Baixar comprovante" por linha depende de `signature_id`, que o backend **não envia** no JSON da ficha (`epi_signatures.id`; o snapshot é hasheado). Não se alterou o backend da ficha (risco no hash/snapshot). A tela mostra código e hora do comprovante e o comprovante segue anexado ao PDF da ficha. Custo se errado: falta o atalho de download individual.

Outras decisões registradas (ledger e relatórios):
- Sem migration `0084`: medição no ensaio com 5.000 EPIs, 800 funcionários e 200.000 movimentações deu, por bloco, `kpi` 9,7 ms, `lots` 9,9 ms, `pending_count` 19,6 ms, `pending_list` 42,1 ms, `alerts` 120,1 ms e `movements` 0,8 ms (após mover o `EXISTS` para fora do `LIMIT`; antes 144,6 ms). Soma ~202 ms. RELATADO (Task 1). NÃO medido: tempo HTTP ponta a ponta e consultas com `employee_id`/`epi_id` no volume grande. `alerts` cresce linearmente com o número de EPIs da empresa.
- Inativar/reativar é `PATCH status` com confirmação; a exclusão definitiva não é exposta.
- Abertura/ajuste só para `empresa`; histórico envia `to` como fim do dia (`-03:00`) porque o backend compara `occurred_at <= valor`.
- Pendência de assinatura inclui `recusada` (onda final, M1).
- Onda final de correções (backend e frontend) após as revisões: overflow numérico do `stock_value`/`stock_total` (S1), auditoria do settings (S3), força `application/pdf` no Blob (S2), pendências antigas com presencial/revogar fora da sessão da Movimentação (I1), seletor de EPIs além de 100 (I2), 404 sem "Tentar novamente", z-index dos diálogos, `formatCnpj`, regra estreita de lote, período padrão "hoje + 29 anteriores", "Carregando..." em 16 px.

## 10. Testes

### 10.1 Como rodar (somente ensaio descartável)
- **Nunca contra produção.** Valem as regras de `epi-estoque.md` e `epi-assinatura.md`: Postgres e Redis descartáveis em rede própria (`montese_ensaio_epi`), migrations em ordem **até a 0083**, chaves falsas, `NODE_ENV=test`, Jest com `--config ./test/jest-e2e.json --runInBand --forceExit` em `node:20-bookworm-slim`, e2e **em lotes** (a suíte inteira num processo estoura memória), `RATE_LIMIT_MAX` alto. Os scripts do ensaio ficam no scratchpad da sessão, **não** no repositório.
- **Frontend:** `run-fe.sh <log> <comando>` (scratchpad) copia o frontend (`/opt/montese-epi/frontend`, montado somente leitura) para um container descartável `node:20-bookworm-slim` e usa um cache de `node_modules` externo (`nmf`); roda `vitest`, `tsc --noEmit`, `npm run lint` e `next build` sem escrever `node_modules` no worktree.
- **Prova em navegador:** `playwright@1.48.0` (imagem `mcr.microsoft.com/playwright:v1.48.0-jammy`, Chromium), backend compilado (`nest build`) e frontend `next build` + `next start` atrás de um Nginx de ensaio (`/api/` sem prefixo, como em produção), **MinIO** (`elestio/minio`) no lugar do R2, `EPI_SIGNATURE_ALLOW_DRAFT_TERM=true`, semeadura por API e SQL no banco do ensaio.

### 10.2 Backend — specs novos ou alterados (VERIFICADO no repositório)
`epi-dashboard.e2e-spec.ts` (KPIs contra fixtures, filtros, limites, isolamento, papéis, entrada inválida), `epi-settings.e2e-spec.ts` (validação, papéis, efeito nos alertas, auditoria), `epi-signature-pending.e2e-spec.ts`, `epi-tenant-scope.e2e-spec.ts`, `epi-legacy-delivery-guard.e2e-spec.ts`, caso novo de `reversed` em `epi-stock-movements.e2e-spec.ts`, `tenant-scope.unit-spec.ts` (`resolveTenantScope` e `resolvePeriod`). `epi-ficha-data.e2e-spec.ts` foi editado porque a fixture usava a rota legada em EPI com livro (agora 409 por desenho).

### 10.3 Resultados (todos RELATADOS; cada um com a origem)
- **Tasks 1 e 2** (relatórios `task-1-report.md` e `task-2-report.md`, ensaio): unit 3 suítes/27 testes; e2e da Task 1 7 suítes/92 testes; Task 2: 5 suítes/21 testes, mais 142 passaram e 2 falharam por fixture legada (corrigida; 19/19 depois). `tsc`+`nest build` OK. Uma primeira execução do teste de CA vencido falhou (201 em vez de 409) e revelou o bug real do `Date` do driver, corrigido.
- **Regressão backend completa em lotes** (ledger, Task 7; comparação de logs r3 = subsistema 3 contra r4 = subsistema 4): **as mesmas 20 suítes e2e falham antes e depois**, 0 novas, 0 resolvidas; todas por causas ambientais do ensaio (R2, Mercado Pago e OpenRouter falsos, rate limit etc.). **Unit: 85 de 86 suítes**; a falha é `r2-get-object.unit-spec` (usa R2 real; `ENOTFOUND` com endpoint falso; ambiental). Esta regressão foi feita **antes** da onda final de correções.
- **Depois da onda final** (ledger e relatórios): backend, 7 suítes e2e/80 testes (`epi-dashboard`, `epi-settings`, `epi-signature-pending`, `epi-tenant-scope`, `epi-stock-movements`, `dashboard-overview`, `dashboard-summary`) e 14 testes unit (`dashboard-atencao-auditoria`, `tenant-scope`) segundo o relato do agente; os logs `final3-e2e.log` e `final3-unit.log` do scratchpad terminam com `exit=0` para os lotes selecionados (leitura do rodapé dos logs; as contagens por suíte não foram reconferidas). A regressão de 170 suítes **não foi reexecutada** depois da onda final (INFERIDO a partir do ledger; não há registro de nova rodada).
- **Frontend** (relato do implementador na onda final, via `run-fe.sh`): vitest **62 arquivos, 760 testes passando** (referências anteriores: baseline 452 antes da Task 3, 739 antes da onda final); `tsc --noEmit` exit 0; `npm run lint` **14 problemas (11 erros, 3 avisos), todos pré-existentes** (nenhum em arquivos EPI; um erro novo de import não usado foi corrigido); `next build` exit 0. Na revisão final de QA (modelo opus), antes da onda final, o revisor reexecutou `tsc` 0, vitest 739/739, lint 14, 7 suítes e2e de EPI com 79/79 e unit `tenant-scope` 11/11 (relato do revisor).
- **Prova ponta a ponta em Chromium: 10 de 10 passos PASS** (relatório do navegador, execução limpa, ensaio + MinIO). Passos: empresa entra e vê o menu EPI (4 itens) e o Painel; cadastro de EPI; abertura de estoque; entrega; link com QR e código (token e código ausentes do HTML/texto/`data-testid` ao fechar; URL do responsável sem token no caminho); funcionário assina em segundo contexto (mobile) e recebe o comprovante; Painel mostra "Aguardando assinatura" = 0 e Ficha mostra "Assinada"; emissão da ficha, download (`%PDF`, ~790 KB) e verificação "Íntegro"; técnico vinculado usa as 4 abas (sem "Dias de aviso", sem Abertura/Ajuste/Estorno), gera link, registra entrega e emite/baixa/verifica ficha; técnico não vinculado não vê nenhum dado (search/movements 200 com 0 itens; dashboard/settings/documents/pending 404; ficha 400/404; POST /epis 403) e empresa B contra A recebe 400/404. Transversais: CPF completo ausente em tela e HTML; link e código em nenhum storage (`localStorage` só com `montese_token` e `montese_user`); mobile 390x844 sem rolagem horizontal. Sem Critical/Important.
- **Revisões** (ledger): revisão final de segurança (opus) "Aprovar com ressalvas", 0 Critical/Important; revisão final de QA (opus) "Aprovar com ressalvas", 0 Critical e 2 Important (I1, I2), ambos tratados na onda final. A **re-revisão pós-onda** (snapshot `4b92ff0`) não tem veredito registrado nas fontes lidas (NÃO VERIFICADO).

## 11. Ordem de release (RECOMENDADO)

1. Esta entrega **não adiciona migration**. Mantêm-se as migrations dos subsistemas anteriores em ordem: **0081 -> 0082 -> 0083** (ver os riscos de cada uma em `epi-estoque.md` seção 9, `epi-ficha.md` e `epi-assinatura.md` seção 16; a consulta de duplicidade da 0081 precisa rodar antes). Conferir a numeração frente a outras branches no momento do merge.
2. **Backup** antes de aplicar qualquer migration (decisão do proprietário; este documento não aplica nada).
3. Aplicar migrations, depois **backend**, depois **frontend**. Frontend novo contra backend antigo quebra (rotas `dashboard`, `settings` e `pending` não existem).
4. **Pacote do frontend com a dependência `qrcode`:** o build de produção precisa de `qrcode@1.5.4` e `@types/qrcode@1.5.5` do `package.json`/lockfile (sem eles o Painel/Movimentação não compilam). Confirmar que a imagem de build instala dependências a partir do lockfile.
5. Decidir antes do uso real: aprovação do texto do termo (item 12 da seção 12, limitação 5), `PUBLIC_APP_URL` correto (o link do responsável usa essa variável; sem ela a URL cai em `https://app.invalid` e fica inutilizável) e remoção do uso da rota legada por qualquer consumidor externo (agora 409 em EPI com livro).
6. Merge, push e deploy são do proprietário.

## 12. LIMITAÇÕES e pendências do proprietário

1. **Baixar comprovante por linha (Ruling 6).** O botão só aparece se a linha trouxer `signature_id`, que o backend **não** envia (VERIFICADO: `EpiFichasView` exige `l.receipt_code && l.signature_id`). Hoje a ficha mostra o código e a hora do comprovante e o comprovante segue dentro do PDF da ficha. Testado só com fixture. Ligar o botão exige expor `signature_id` fora do snapshot hasheado.
2. **Admin sem interface própria.** O layout da empresa só aceita `empresa`. O `admin` altera os dias de aviso apenas pela API (`PATCH /epis/settings?tenant_id=`); não há tela de admin para EPI. Na view, abertura/ajuste/estorno e "Dias de aviso" dependem de `role === 'empresa'` (ou das props explícitas).
3. **Pendências contam EPI inativo, e o painel some sem EPI ativo.** VERIFICADO: a contagem e a lista de `pending_signatures` no dashboard **não** filtram `te.status = 'ativo'` (decisão de produto do ledger, "documentar"), enquanto os demais KPIs só contam EPI ativo. Além disso, `EpiDashboardView` mostra apenas "Nenhum EPI ativo. Cadastre os equipamentos ou reative..." quando `epis_total = 0` e não há filtro; nesse estado **os KPIs, a lista de pendências e os alertas não são exibidos** (só o controle dos dias de aviso, para `empresa`), mesmo que existam entregas pendentes de EPIs inativos. O `EpiResumoCard` do técnico, ao contrário, mostra os 3 números. Também: o KPI do dashboard conta entregas `pendente`/`recusada` **sem exigir `quantity`**, enquanto `GET /epi-signatures/pending` exige `quantity` não nula (INFERIDO a partir das duas consultas; entregas legadas sem quantidade entram no KPI, não na lista).
4. **Dashboard geral da empresa** (`backend/src/dashboard`, alerta de CA) usa **30 dias fixos** e conta EPI inativo; não acompanha `epi_alert_days` (o link já aponta para `/empresa/epi`). Divergência com o Painel de EPI possível.
5. **Termo de recebimento**: aprovado pelo proprietário em 2026-11-01 (`v1-2026-11`); a assinatura não depende mais de `EPI_SIGNATURE_ALLOW_DRAFT_TERM`. A revisão jurídica do texto segue pendente fora do sistema (`epi-assinatura.md` seção 17).
6. **Técnico/parceiro** não têm abertura, ajuste, estorno nem dias de aviso (backend: 403; UI: ocultos). Também não há navegação própria do técnico além da rota única.
7. **`GET /employees` entrega o CPF completo ao navegador** (backend; fora do escopo). O cliente EPI descarta o campo (`epiApi.employees` mapeia só `id, full_name, registration_number, department, position, status`; teste do ledger), mas ele trafega na rede e fica visível nas ferramentas do navegador. RECOMENDADO: endpoint enxuto de listagem de funcionários para o módulo.
8. **Rota legada `createDelivery` sem `FOR UPDATE`** no EPI: uma abertura de estoque concorrente pode passar entre a checagem do livro e o `INSERT`. Rota aposentável; considerar lock como em `update()`. Sem teste da borda "CA vence hoje = 201" (minor do ledger).
9. **Datas `DATE` dependem do backend em UTC.** `formatDate` usa só o `AAAA-MM-DD` escrito, sem converter fuso, e não valida o calendário; as colunas DATE do backend não têm type parser. Servidor em outro fuso desloca datas (latente, igual ao registrado no roadmap da Fase 6).
10. **PDF com sessão expirada** devolve 401 e a tela mostra a mensagem fixa de sessão expirada; sem renovação de token.
11. **Auditoria de `PATCH /epis/settings`** registra `resource_id` = empresa, mas **não** os valores antes/depois (`audit_log` só tem detalhe em texto).
12. **NÃO VERIFICADO** (relatório do navegador e ledger): **conteúdo interno do PDF** (texto, assinatura desenhada; só `%PDF`, tamanho e "Íntegro" foram conferidos); **prévia PDF** (nova aba); **presencial**, **recusa** e **expiração do link** exercitados na UI; **leitura do QR por câmera** (só se verificou a imagem gerada com a URL correta); **R2 real** (usado MinIO); **navegadores além do Chromium** (Safari/Firefox); e-mail, MiniMax e Mercado Pago (fora do escopo); tempo HTTP ponta a ponta do dashboard em volume grande; e a **re-revisão final pós-onda**.
13. **JWT em `localStorage`** (`montese_token`): é o desenho do sistema inteiro, não do EPI. O módulo só lê o token. Link e código de assinatura **não** vão a storage.
14. **Botão flutuante do WhatsApp** sobrepunha conteúdo e diálogos no mobile. Tratado com `z-[60]` nos diálogos e rolagem/`pb-24` (onda final, M4); a correção em navegador real **não foi reverificada** (relato da Task 6: "Não verificado: z-index sobre o botão do WhatsApp").
15. **Seletor de EPI carrega até 1000** (teto de `searchAllEpis`, páginas de 100) com aviso na tela; empresas com mais de 1000 EPIs precisam refinar pela busca. O filtro de equipamento do painel e a Movimentação usam essa lista.
16. **Outros minors adiados do ledger** que ainda valem: `pending_signatures`/`pending` sem filtro de funcionário ativo; sem asserção de ordem DESC/LIMIT 10 em `recent_movements`; sem teste de link expirado nem de parceiro não vinculado no dashboard; `ca_valid_until` tipado `string` mas `findOne` devolve `Date` (outras comparações textuais são suspeitas); `EpiTabs` com `aria-controls` para painéis ausentes; ícone `LayoutDashboard` repetido no menu; `Badge` padrão de 11 px (só a variante `large` tem 16 px); chave de idempotência duplicável se o usuário altera e restaura após falha de rede; replay mostra o painel de assinatura para entrega já tratada; estorno de entrega recém-criada mantém a oferta de link; clipboard retém link/código depois de copiar (aviso na UI é RECOMENDADO); campos de data aparecem em `mm/dd/aaaa` no Chromium do ensaio (do navegador, INFERIDO); rodapé com alvos de 20 px (fora do módulo EPI); `alerts` do dashboard com custo linear.
17. **Retenção/LGPD:** funcionário com ficha, movimentação ou assinatura não pode ser apagado (RESTRICT); decisão do proprietário (ver os outros documentos).

## 13. Riscos e segurança

- **Isolamento de tenant (VERIFICADO no código):** toda rota nova usa `req.withTenantContext` (RLS) e `resolveTenantScope`; o `tenant_id` do cliente nunca substitui a RLS. A prova em navegador exercitou técnico não vinculado e empresa B contra A (relatório; RELATADO).
- **Dados pessoais:** o dashboard e a lista de pendências não trazem CPF nem token/hash/código. A ficha mostra CPF mascarado (`***.982.247-**`, que expõe 6 dígitos centrais; mascaramento padrão aceito no relatório). O CNPJ da ficha ganhou máscara (`formatCnpj`).
- **Segredos de assinatura:** link e código só em estado do diálogo; resposta da criação com `Cache-Control: no-store` (`epi-assinatura.md`).
- **PDF:** só por rota autenticada e Blob; Content-Type validado.
- **Dependências (`npm audit`):** a revisão final de segurança rodou `npm audit` e reportou **17 vulnerabilidades hoje (3 críticas, 7 altas, 7 moderadas)**, **nenhuma na cadeia de `qrcode`** (`dijkstrajs`, `pngjs`, `yargs`); todas estão em `next`, `vite`, `vitest`, `esbuild`, `eslint-config-next`, `postcss`, `glob`, `js-yaml` e afins. O implementador da Task 3 havia relatado **6** (2 moderadas, 3 altas, 1 crítica) com `npm audit --omit=dev`, antes e depois de adicionar `qrcode` (sem mudança); a diferença de números é de **escopo** (produção x tudo) — INFERIDO. RECOMENDADO tratar à parte (atualização de `next` etc.), com plano de teste próprio; não faz parte deste subsistema. Fonte: ledger (revisão final de segurança) e `task-3-report.md`; o redator não reexecutou o `npm audit`.
- **Revisões independentes:** a implementação foi revisada por agentes distintos dos implementadores (segurança e QA), conforme a regra do projeto de que quem implementa não aprova o próprio trabalho crítico. Isso não substitui a decisão do proprietário nem uma revisão jurídica do termo.
