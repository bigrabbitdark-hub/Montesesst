# Monitor normativo — revisar melhor (fatia 2b) — design

> Data: 2026-10-09 · Escopo: **backend (`backend/src/normative`) + frontend (`/admin/normativa`)** · **Sem migration, sem dependência nova** · Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
> Continua as fatias 1 (`dbda6cb`) e 2a (`3e114fa`, E1 `bb227e5`).

## 1. Problema (VERIFICADO no código de 2026-10-09)

1. **A revisão de uma versão mostra dois blocos de texto lado a lado** (`page.tsx`, "Revisar versão": `previous_text` e `raw_text`), sem destacar o que mudou. Documentos de milhares de parágrafos (a CLT tem ~3,5 MB) tornam inviável achar a mudança a olho; é por isso que mudanças triviais (data, menu) geram revisão cara e mudanças reais podem passar.
2. **Só se rejeita um documento por vez** (`POST /normative-documents/:id/reject`). Limpar uma fila de ruído exige N cliques com N motivos.
3. **Não há como retirar um documento já `vigente`** (ex.: o texto vigente de 9 caracteres, ou o de uma fonte-portal). `reject` só aceita `aguardando_validacao`; a única saída hoje é SQL.

## 2. Decisões

### 2.1 Diff por parágrafos, calculado no backend
`GET /normative-documents/:id/diff` (admin; lê o documento + o vigente da mesma fonte, como `findOneWithPrevious`) devolve:
```
{ has_previous: boolean,
  summary: { added: n, removed: n, unchanged: n },
  truncated: boolean,
  hunks: [ { kind: 'added'|'removed'|'context', text: string }, ... ] }
```
- **Unidade = parágrafo** (separador: uma ou mais linhas em branco ou quebra de linha; `trim` e espaços internos colapsados para comparar).
- **Algoritmo, sem dependência:** tira prefixo e sufixo comuns; sobre o miolo, se `n_antigo × n_novo ≤ 4.000.000` calcula a **maior subsequência comum** por programação dinâmica (memória em linhas comprimidas ou `Uint16/32Array`); acima disso cai para **diferença por multiconjunto** (parágrafos que só existem de um lado, sem ordem) e marca `truncated: true` para a tela avisar.
- **Contexto:** mostra no máximo 2 parágrafos `context` ao redor de cada trecho alterado; blocos grandes inalterados viram um único `context` "… N parágrafos sem mudança …". Resposta limitada a **500 trechos alterados**; o excedente vira `truncated: true` com a contagem.
- O texto é **texto extraído**, nunca HTML: a tela o mostra como texto (sem `dangerouslySetInnerHTML`).
- Primeira versão de uma fonte (sem vigente): `has_previous: false`; a tela mostra só o texto novo, como hoje.
- O endpoint **não substitui** `GET :id` (a tela continua baixando o texto completo para quem quiser ler tudo).

### 2.2 Tela de revisão
No cartão "Revisar versão": cabeçalho com `+N / −N parágrafos`, lista de trechos (removido em tom crítico, adicionado em tom ok, contexto em tom neutro; **cor nunca é a única pista: prefixo "+"/"−" e `aria-label`**), aviso quando `truncated`, e botão "Ver texto completo lado a lado" (comportamento atual) como alternativa. Aprovar e rejeitar não mudam.

### 2.3 Rejeição em lote
`POST /normative-documents/reject-batch` (admin) com `{ ids: string[] (1–50 UUIDs distintos), reason: string }`:
- numa **única transação**: valida que todos existem e estão `aguardando_validacao`; se qualquer um não estiver, **nenhum** é rejeitado e a resposta lista os inválidos (400);
- reaproveita a regra de `reject` (mesmo UPDATE, mesmo `reviewed_by_user_id`/`reviewed_at`/`rejection_reason`);
- devolve `{ rejected: n }`. Registrado pelo `AuditInterceptor` global.
- UI: caixas de seleção na lista "Aguardando validação", "Selecionar todos", campo de motivo e "Rejeitar selecionados (n)" com confirmação; após o sucesso a lista recarrega.

### 2.4 Retirar um documento vigente (sem migration)
`POST /normative-documents/:id/retire` (admin) com `{ reason }`:
- só `status = 'vigente'` (400 caso contrário);
- numa transação: `status = 'rejeitado'`, `rejection_reason = 'Retirada: ' || reason`, `reviewed_*` do admin, **apaga os chunks** (`normative_document_chunks`, ON DELETE CASCADE não se aplica; DELETE explícito) e zera `indexed_at`. Efeito: sai do RAG **e** libera o índice "um vigente por fonte";
- **não apaga** o documento, o texto nem o arquivo no R2 (rastreabilidade); o histórico mostra a retirada pelo motivo;
- **por que `rejeitado` e não um status novo:** o CHECK de `status` não tem "retirado" e adicionar exige migration; o prefixo do motivo basta para distinguir e a tela mostra "Retirada".
- Efeito no monitor: o último registro da fonte passa a ser `rejeitado` com o hash antigo; se a página não mudar, **não** nasce novo pendente; se mudar, nasce. INFERIDO (conferir no teste, regra de `recordDetectedVersion`).
- UI: botão "Retirar" na lista "Vigentes", com confirmação e motivo obrigatório. **Ação destrutiva para o Assistente → confirmação explícita na tela.**

## 3. Resultado esperado
Revisar uma versão passa a significar ler algumas dezenas de parágrafos alterados em vez de comparar o documento inteiro; a fila de ruído se limpa em um passo; um vigente ruim sai do Assistente sem SQL.

## 4. Fora de escopo
Diff por palavra/caractere; histórico de versões navegável; reativar um documento retirado (reabrir exige novo pendente); envio manual de arquivo e cadastro em lote de fontes (fatia 3); classificação por tipo/tema (spec do catálogo); aprovação em lote (**deliberadamente excluída**: aprovar exige leitura humana de cada versão).

## 5. Riscos
- **Custo do diff em documentos grandes:** limite de 4 M células e de 500 trechos; teste com documento de ~20 mil parágrafos para provar tempo e memória aceitáveis (medir, não presumir).
- **Retirada é irreversível pela tela** (reverter = novo pendente + aprovação). Mitigado pela confirmação e pelo motivo obrigatório; o texto fica guardado.
- **Lote**: transação única e limite de 50 evitam rejeição parcial e lotes gigantes.
- **Release:** backend e frontend juntos; o backend continua travado pelo commit do eSocial. Sem migration.
- e2e não rodam neste shell (banco de produção): casos novos com cliente falso/`req` falso.

## 6. Decisões abertas do proprietário
A. Retirar vigente via `rejeitado` com prefixo "Retirada:" (sem migration) está bom, ou prefere um status próprio (migration)? RECOMENDADO: sem migration agora.
B. Limite do lote em 50 está bom?

## 7. Git e release
Sem commit, push ou deploy automáticos (AGENTS.md).

## 8. Resultado da verificação (2026-10-09)

**Backend (VERIFICADO)**
- `npx tsc --noEmit -p tsconfig.json`: 0 erros.
- Comparação rigorosa em worktree descartável do HEAD (`bb227e5`): HEAD limpo = 57 suítes (8 falham, 49 passam), 742 testes (20 falham, 722 passam). HEAD + só os 7 arquivos da fatia = 59 suítes (8 falham, 51 passam), 766 testes (20 falham, 746 passam). As 8 suítes que falham são as mesmas nos dois (`company-document-indexer`, `document-checklist-extractor`, `lip-agent-extractor`, `pdf-text-full`, `pdf-text`, `pente-fino-comparison`, `pente-fino-extractor`, `r2-get-object`); nenhuma a mais. As 2 suítes novas (`paragraph-diff`, `normative-documents-review`) passam: 24 testes. Worktree removida.

**Frontend (VERIFICADO)**
- `vitest run`: 29 arquivos, 308/308. `tsc --noEmit`: 0 erros. `eslint src/app/admin src/components/admin`: 0 erros (1 aviso preexistente, `<img>` em `AdminBrand.tsx`). `next build`: ok, `/admin/normativa` 6,65 kB.

**QA visual (VERIFICADO, API simulada, sessão falsa, servidor próprio na porta 3100)**

| Rota | 1440×900 | 390×844 |
|---|---|---|
| `/admin/normativa` — revisão com diff truncado, lado a lado, lote (2 selecionados), retirada | sem overflow (scrollWidth = innerWidth), 0 erros de console* | idem |
| `/admin/normativa` — 60 pendentes, "Selecionar todos" | aviso "Selecione no máximo 50 documentos por vez" e botão desabilitado; com 50 o botão habilita e o aviso some | idem |

\* único erro de console = o 500 provocado de propósito para testar a falha do diff (a tela cai no lado a lado, mantém Aprovar/Rejeitar e não mostra alerta de bloqueio).
- Corpos conferidos: `POST /api/normative-documents/reject-batch` → `{"ids":["dp1","dp2"],"reason":"Documento duplicado"}` (com `confirm` "Rejeitar 2 documentos?..."); `POST /api/normative-documents/dv1/retire` → `{"reason":"Norma revogada"}` (com `confirm` de retirada). Botões do lote e da retirada desabilitados sem motivo.
- Screenshots lidos: removido em vermelho, adicionado em verde, contexto neutro, prefixo +/−, aviso de truncado, texto longo e palavra sem espaço quebrando sem overflow, rolagem interna da lista do diff, lado a lado alternando (`aria-expanded`). Foco: Tab chegou a 39–40 elementos sem nenhum sem indicador de foco (outline ou sombra); ao clicar em "Retirar" o foco vai para "Motivo da retirada".

**Desempenho do diff com texto real (VERIFICADO)** — CLT (`del5452.htm`, GET público, HTTP 200, 3.531.201 bytes, UA do monitor, `decodeHtmlBuffer`), máquina de desenvolvimento, Node 18, `diffParagraphs` compilado do código da fatia:
- Extração pelo `extractHtmlText` do monitor: 1.360.384 caracteres em 200 ms, mas **1 único parágrafo**, porque `extractHtmlText` colapsa toda a quebra de linha (`\s+` → espaço). Nesse caso o diff degenera: ~30 alterações dão 1 removido + 1 adicionado (cada um com o texto inteiro, ~1,3 M de caracteres), 56–74 ms, +19 MB de heap, pico RSS 185 MB; 300 alterações: 56–61 ms (mesmo resultado).
- Medição complementar com extração local que preserva quebras de bloco (`</p>`, `</div>`, `<br>`… → `\n`; só nesta medição, nada no código de produção): 27.804 parágrafos, 3 repetições cada. ~30 alterações (+20/−20, 191 trechos): 99–123 ms. 300 alterações (+200/−200, 1.901 trechos, `truncated=false`): 93–112 ms. Textos idênticos: 56 ms. Heap +20–24 MB; pico RSS 167–180 MB.
- Conclusão: o algoritmo é rápido e leve com um texto real grande quando há parágrafos. **Achado:** para fontes HTML o texto armazenado pelo monitor não tem quebras de linha, então o diff por parágrafos não ajuda nelas (uma só linha trocada) e a resposta de `GET :id/diff` carregaria os dois textos inteiros. Fontes em PDF (extração com `\n`) não foram medidas aqui. RECOMENDADO: decidir se `extractHtmlText` deve preservar quebras de bloco (muda o texto armazenado e o hash de comparação do monitor, por isso fica fora desta fatia) ou se o diff limita/omite hunks gigantes.

**NÃO VERIFICADO**
- e2e (usam o banco de produção; não rodados); rotas `GET :id/diff`, `POST reject-batch`, `POST :id/retire` contra Postgres real/RLS real.
- Comportamento em produção e com login real do proprietário.
- Efeito da retirada no monitor (a fonte volta a detectar nova versão como pendente) e a limpeza de chunks/`indexed_at`: conferido só por leitura de código e teste unitário com cliente falso.
- Diff de PDFs reais grandes; diff com o conteúdo real de duas versões da mesma NR.
- Nenhum passo 🔒 foi executado; nenhum commit/add/push.
