# Monitor normativo — gerir fontes pela tela (fatia 2a) — design

> Data: 2026-10-08 · Escopo: **backend (`backend/src/normative`, `backend/src/common/url`) + frontend (`/admin/normativa`)** · **Sem migration** · Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
> Continua `2026-10-08-monitor-normativo-parar-ruido-design.md` (fatia 1, commit `dbda6cb`). A fatia 2b (diff real, rejeitar em lote, retirar um vigente) fica para depois.

## 1. Problema (VERIFICADO no código e nos dados de 2026-10-08)

1. A API de fontes só tem **criar e listar** (`official-sources.controller.ts`). Uma fonte que aponta para a página errada (TNU, "Base do LTCAT", "Para acompanhar mudanças", "EPI e custeio" apontam para portais) **não pode ser corrigida nem desativada pela tela**; só por SQL.
2. A primeira verificação de uma fonte nova só acontece no cron das 03:00. Não há "Verificar agora" nem como **testar uma URL antes de salvar**.
3. **Não existe nenhuma proteção contra SSRF no backend** (busca por `isPrivate`/`ssrf`/`169.254`/`isIP` não achou nada). O monitor já busca toda noite qualquer URL cadastrada por um admin e o texto aparece na tela de revisão; "Verificar agora" e "pré-visualizar" fariam isso **sob demanda e devolvendo conteúdo**, o que amplia o risco: um admin (ou uma conta de admin comprometida) poderia ler `http://montese_postgres:5432`, `http://backend:4000`, serviços do Docker ou os metadados da nuvem (`169.254.169.254`).
4. O cadastro aceita qualquer esquema de URL (`@IsUrl()` padrão aceita `ftp:` etc.).

## 2. Decisões

1. **Guarda contra SSRF antes de qualquer endpoint novo**, em `common/url/public-url.util.ts` (sem dependência nova):
   - só `http`/`https`; sem usuário/senha na URL; só portas 80 e 443;
   - nome de host sem ponto (`backend`, `montese_postgres`, `nginx`), `localhost` e sufixos `.local`/`.internal` são bloqueados;
   - IP literal ou endereços resolvidos por DNS precisam ser **públicos** (bloqueia 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, faixas de documentação, multicast/reservados, e em IPv6 `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, IPv4 mapeado, NAT64);
   - **se o DNS falhar, a requisição segue** e falhará naturalmente na conexão (bloquear só quando a resolução tem sucesso e devolve endereço não público). Isso mantém os testes existentes (que simulam `fetch` com `exemplo.gov.br`) funcionando;
   - **redirecionamentos são seguidos à mão** (`redirect: 'manual'`, no máximo 5 saltos), **revalidando cada destino**.
   - *Risco residual declarado:* uma troca de DNS entre a checagem e a conexão (DNS rebinding) não é eliminada sem fixar o IP na conexão, o que exigiria dependência ou reescrever o cliente HTTP; fica registrado como pendência. O exploit exige um DNS controlado por quem já é admin.
2. **A guarda vale também para o monitor noturno** (não só para os endpoints novos): `processSource` passa a usar `fetchPublic`. Efeito: uma URL que resolva para a rede interna passa a falhar com a mensagem da guarda em vez de ser lida.
3. **Limite de tamanho** de 25 MB ao ler o corpo (hoje não há limite). A CLT em HTML tem ~3,5 MB.
4. **Endpoints novos (todos `@Roles('admin')`, registrados pelo `AuditInterceptor` global — INFERIDO):**
   - `PATCH /normative-sources/:id` — `entity`, `code`, `title`, `official_url`, `active` (todos opcionais). Trocar a URL **zera** `consecutive_failures`, `last_error`, `last_check_status` e `last_checked_at`; código vazio limpa o campo; `404` se não existir. **Desativar = `active = false`** (não há exclusão: `normative_documents` referencia a fonte).
   - `POST /normative-sources/:id/check-now` — `@RateLimit` (20/hora por IP); reaproveita o caminho do monitor (mesma contabilidade de falha/sucesso), **sem e-mail** (é o próprio admin olhando). Devolve `{ outcome: 'nova_versao' | 'sem_mudanca' | 'erro', message }`. A mensagem de "sem mudança" é honesta: *"Nenhuma versão nova criada (sem mudança relevante ou já há uma versão aguardando revisão)."*
   - `POST /normative-sources/preview` — `@RateLimit` (30/hora por IP); busca e extrai **sem gravar nada** e devolve `{ ok, status_code, mime_type, chars, meaningful_chars, sample (400 caracteres), suspicious, duplicate_of }`. `duplicate_of` aponta a fonte que já usa a mesma URL (normalizada: minúsculas, sem `#` e sem `/` final).
   - `POST /normative-sources` passa a **validar com a guarda** e a exigir `http`/`https` (`@IsUrl({ protocols: ['http','https'], require_protocol: true })`).
5. **Tela (`/admin/normativa`, cartão "Fontes monitoradas")**: a lista vira **tabela** (Fonte, Estado, Verificada, Ações) com `Badge` de estado (Inativa / Falhando (n) — erro / Nunca verificada / ok), filtro **"Mostrar só fontes com problema"**, ações **Verificar agora**, **Editar** (formulário na própria linha), **Desativar/Reativar**, e **Testar URL** no cadastro e na edição, com o resultado da pré-visualização. O componente sai de `page.tsx` para `normativa/FontesPanel.tsx`; os rótulos e textos do cadastro atual são mantidos.
6. **Sem migration.** Tudo cabe nas colunas atuais de `official_sources`.
7. **A validação humana não muda**: nada disso aprova ou publica norma; "Verificar agora" só pode criar um pendente, como o cron.

## 3. Resultado esperado

- O admin corrige a URL das fontes que apontam para portais, ou as desativa, **sem SQL**; "Verificar agora" mostra na hora se a nova URL funciona; "Testar URL" mostra, antes de salvar, quantos caracteres a página entrega e se a extração parece vazia.
- Um admin não consegue mais fazer o servidor ler a rede interna por URL ou redirecionamento direto; o DNS rebinding (resolução trocada entre a checagem e a conexão) segue como risco residual declarado, mitigável no futuro validando o IP na hora da conexão.

## 4. Fora de escopo

Diff real, rejeitar em lote e retirar vigente (fatia 2b); envio manual de arquivo e cadastro em lote (fatia 3); fixar o IP na conexão contra DNS rebinding; excluir fonte; **escolher a URL oficial correta de cada norma — decisão do proprietário, não minha**.

## 5. Riscos e tratamento

- **Guarda bloqueando fonte legítima.** Todas as 51 fontes são `https` públicas de órgãos oficiais (INFERIDO); a verificação do plano passa as 51 URLs pela guarda **antes** do release. Se alguma for bloqueada por engano, a mensagem diz o motivo e o admin vê o badge "Falhando".
- **Mudar o `fetch` do monitor** mexe num fluxo que funciona: manter os cabeçalhos, o tempo-limite e as asserções da fatia 1; os testes unitários existentes do monitor devem passar **sem edição**.
- **Testes que dependem de DNS:** `assertPublicUrl` recebe o resolvedor por parâmetro; os testes unitários injetam um falso ou usam `jest.mock('dns/promises')`, para não depender de rede.
- **Dependência de release:** é backend + frontend. O backend só entra num release depois do commit/merge do eSocial (produção roda `0969bb7-esocial-wip2`). O frontend pode seguir o seu próprio release, mas a tela nova precisa dos endpoints novos: **liberar juntos**, ou a tela mostra erro nas ações novas.
- **e2e** continuam sem rodar neste shell (banco). Os novos casos são testes unitários com cliente falso.

## 6. Verificação

Testes unitários sem banco (guarda, monitor com `fetch` e resolvedor falsos, controller com `req` falso, serviço com cliente falso); `tsc`; suíte unitária comparada **HEAD limpo + só esta fatia vs HEAD limpo**; frontend `vitest`/`tsc`/`eslint`/`next build`; QA no navegador com API simulada (390 e 1440 px); passar as 51 URLs reais pela guarda (exige leitura de produção, que o classificador do Claude Code pode bloquear: nesse caso o proprietário roda o export) e a pré-visualização contra as 7 fontes que falhavam.

## 7. Git e release

Sem commit, push ou deploy automáticos (AGENTS.md).

## 8. Resultado da verificação (2026-10-08)

**VERIFICADO**
- Backend: `tsc --noEmit` limpo. Jest unit em worktree (HEAD dbda6cb + só os arquivos da fatia): 48 suítes passam, 8 falham (721 testes: 701 passam, 20 falham). As 8 são exatamente as já conhecidas do HEAD limpo (`company-document-indexer`, `document-checklist-extractor`, `lip-agent-extractor`, `pdf-text-full`, `pdf-text`, `pente-fino-comparison`, `pente-fino-extractor`, `r2-get-object`); nenhuma a mais. Suítes novas (`public-url`, `official-sources`, `normative-monitor-sources`) e `normative-monitor-guard` passam.
- Frontend: vitest 28 arquivos / 285 testes verdes; `tsc` limpo; eslint 0 erros (único aviso: `AdminBrand.tsx:13`, preexistente); `next build` compila, `/admin/normativa` 4,96 kB.
- Leitura real (GET, a partir deste host, com `fetchPublic` + `MONITOR_FETCH_HEADERS` + `decodeHtmlBuffer`): 5 páginas do `planalto.gov.br` voltam 200 e `text/html`, com acentos corretos e sem `U+FFFD`: Lei 8.213 (755.476 caracteres), CLT/Decreto-Lei 5.452 (3.531.201), Lei 8.212 (771.440), Decreto 3.048 (2.390.338), Decreto 4.882/2003 (11.142). Os caracteres são do HTML decodificado, antes de `extractHtmlText`. As URLs de 8.212, 3.048 e 4.882 são as páginas consolidadas do Planalto, inferidas por padrão; a spec não lista as 5 URLs.
- QA visual (Playwright 1.48, build local na porta 3100, API simulada, sessão falsa de admin) em `/admin/normativa`, 1440x900 e 390x844: 0 erros de console; `scrollWidth <= innerWidth` nos dois; a tabela rola dentro do cartão (390 px: 489 de conteúdo em 316 de área visível, `overflow-x:auto`). Filtro "só com problema" mostra 2 de 6. Corpos conferidos: `PATCH {"active":false}`, `PATCH {"active":true}`, `PATCH` da edição (4 campos), `POST …/check-now`, `POST …/preview` (suspeita + duplicada; erro; ok). Todas as chamadas com `Authorization: Bearer`. Tab percorre cadastrar, testar URL, filtro, link, verificar agora, editar, com contorno visível de 2 px.
- Achado cosmético (não corrigido, fora do escopo de verificação): o badge de estado com texto longo (`Falhando (3) — Fonte respondeu status 403`) quebra em várias linhas e fica com aspecto de elipse nos dois viewports. RECOMENDADO: `whitespace-normal`/raio menor ou mover o motivo para fora do badge.

**NÃO VERIFICADO**
- e2e (usam banco; não executados neste shell).
- As 51 URLs de produção contra a guarda: requer export do proprietário (`select official_url from official_sources`).
- CAEPI e STF (403): não testados nesta rodada.
- DNS rebinding residual (fora de escopo, aceito).
- Comportamento em produção; a tela com API real e sessão real; que o `PATCH`/`check-now`/`preview` funcionem de ponta a ponta com o backend real (só testados com API simulada e testes unitários).
