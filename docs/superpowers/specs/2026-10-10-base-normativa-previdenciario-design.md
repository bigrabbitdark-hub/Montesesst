# Base normativa previdenciária (LTCAT, PPP, aposentadoria especial) — design

> Data: 2026-10-10 · Escopo: **extração de HTML do Planalto + parser de leis/decretos + migration `0074` + seed de regras + docs** · Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
> Origem: material do proprietário de 2026-10-09/10 (LTCAT e PPP: exposição ocupacional e aspectos previdenciários). Terceira área da base normativa (LIP: `2026-10-09-base-normativa-lip-design.md`; GRO/PGR: `2026-10-09-base-normativa-gro-pgr-design.md`). Escolha do proprietário: **destravar a fonte e depois regras em rascunho**.

## 1. Verificações (produção e sites oficiais, 2026-10-09; só leitura)

| Fato | Evidência |
|---|---|
| A base previdenciária do Assistente está **vazia**: Lei 8.213 (`l8213cons.htm`), Decreto 3.048 (`d3048.htm`), Decreto 4.882 (`d4882.htm`), Lei 8.212 (`l8212cons.htm`) e CLT (`del5452.htm`) têm `fetch failed` há 8 verificações e **nenhum documento vigente**; as fontes do INSS ("portalin") têm 9 caracteres; a do Imprensa Nacional, 2 185 | consulta em `official_sources`/`normative_documents` (VERIFICADO) |
| **Causa raiz:** o Planalto responde `ECONNRESET` a requisições sem `User-Agent`; o monitor em produção chama `fetch(url, { signal })` sem cabeçalhos. Com o `User-Agent` do código novo (`MONITOR_FETCH_HEADERS`) as três respondem 200 (755 KB, 2,4 MB e 3,5 MB) | teste de dentro do container de produção + `dist/…/normative-monitor.service.js:132` (VERIFICADO). O deploy do monitor novo já planejado corrige o download |
| **Mesmo com o download, o texto é inutilizável:** as páginas trazem a redação revogada dentro de `<strike>…</strike>` (CLT 4 036 ocorrências; Lei 8.213 e Decreto 3.048 centenas) e `extractHtmlText` a mantém ao lado da vigente. Resultado: os arts. **192, 193, 196 e 197 da CLT** e o **art. 57 da Lei 8.213** não viram dispositivo | extração e parser em memória (VERIFICADO) |
| Descartar `<strike>`: Lei 8.213 passa a ter 6/6 artigos-chave; CLT ganha arts. 192/193 com a redação vigente (ex.: art. 193 "…Ministério do Trabalho e Emprego…"); **mas** Decreto 3.048 fica 4/7 (faltam 66, 67, 70) e a CLT perde 189, 190, 191, 194, 195, 197 → extração e parser precisam de ajuste, não só de remover texto | protótipo (VERIFICADO) |
| O parser de leis tem uma falha conhecida: `Art. 193 - São…` pode ser lido como artigo `193-S` (sufixo de letra) | análise do regex (INFERIDO; confirmar com texto real) |
| `official_sources.code` do CLT é `NR-15 e NR-16`; os demais não têm `code` — o gerador resolve a norma pelo `code` (`NR-xx`, `CLT`) | consulta (VERIFICADO) |

Itens do material **sem fundamento literal** nas leis/decretos (NÃO VERIFICADO até haver fonte ingerida): PPP eletrônico para períodos a partir de 01/01/2023 (IN INSS; página do INSS), idades 55/58/60 como "portal do INSS" (verificar no Decreto 3.048 e na EC 103/2019), Tabela 24 e S-2240 (manuais do eSocial), IN PRES/INSS 128/2022 consolidada (a URL cadastrada não serve; URL oficial **não verificada**).

## 2. Decisões

1. **Extração do Planalto:** descartar texto riscado (`<strike>`, `<s>`, `line-through`) **somente para `planalto.gov.br`** (as demais fontes mantêm o comportamento e os hashes). Manter as notas "(Redação dada pela…)" da redação vigente. Isso muda o texto extraído e, portanto, o `content_hash` de qualquer documento Planalto já aprovado: hoje não há nenhum vigente (todas em `erro`).
2. **Parser de leis (`kind: 'lei'`, ex-`clt`):** artigo, parágrafo, inciso, alínea; corrigir o sufixo (`Art. 193-A` ≠ `Art. 193 - S…`), `Art .193`, `Art. 1º`; unidade de endereço `art. N`, `art. N §M`, `art. N §M inc. X`, `art. N §único`. Critério de aceite medido nos textos reais, não por números de cobertura: **artigos-chave presentes com o literal vigente correto** — CLT 189–197; Lei 8.213 arts. 57 e 58 (e §§); Decreto 3.048 arts. 64–70.
3. **Códigos de fonte** (o dono edita na tela): `CLT`, `LEI-8213`, `LEI-8212`, `DEC-3048`, `DEC-4882`; `resolveKind` ganha `LEI-n` e `DEC-n` → `kind 'lei'`, norma `LEI-8213`/`DEC-3048`. Entram na lista liberada de geração **só** depois do aceite da decisão 2.
4. **Migration `0074`:** `area` ganha `previdenciario` e categorias próprias (`aposentadoria_especial`, `ltcat`, `ppp`, `agentes_nocivos`, `esocial`, `cruzamento_documental`, `exposicao`) com o CHECK área×categoria; `area` continua sem DEFAULT. A `0072` e a `0073` não são editadas.
5. **Regras em rascunho no git** (`backend/db/seed-data/normative-rules/previdenciario.json`), cada ligação com `contem` obrigatório, resolvidas pelo mesmo importador. Só entra regra com artigo literal confirmado: art. 57 e 58 da Lei 8.213 (aposentadoria especial; comprovação por formulário e laudo; PPP; manutenção do laudo), arts. 64–70 do Decreto 3.048 (conforme o texto vigente), a regra de **não confundir** insalubridade trabalhista (CLT 189–192) com exposição previdenciária (Lei 8.213 art. 57), e a dependência com o Anexo IV (se for possível ligá-lo; tabela — avaliar, senão fica fora e anotado).
6. **Fora do seed (viram regras de comportamento do Assistente ou insumo de produto):** "não declarar direito adquirido", "EPI não é prova automática", "não preencher campo ausente" — princípios do Assistente (docs/reference), sem alterar prompt/modelo.
7. **IN PRES/INSS 128/2022, MOS/leiautes do eSocial, Anexo IV:** não entram nesta rodada (faltam URLs oficiais verificadas / formato em tabela).

## 3. Entregas (ordem)
T1 extração + parser + resolução de códigos + liberação; T2 migration `0074` + enums; T3 seed + validação contra fixtures reais; T4 docs (runbook, release, reference de produto, memória).

## 4. Riscos
- O deploy do monitor novo é pré-requisito do download (Planalto). Sem ele, nada disso chega à produção.
- Aprovar os textos exige crédito de embeddings; os textos são grandes (CLT 660 mil caracteres úteis, Decreto 618 mil) — custo de indexação por chunk (verificar volume antes).
- Mudança de extração altera o hash: aprovar uma versão por extração antiga e depois reextrair gera pendente "novo" — por isso a extração nova precisa estar no ar **antes** da primeira aprovação.
- Interpretação virar autoridade: rascunho + ligação literal + revisão por profissional habilitado (e, para o previdenciário, validação da área previdenciária/jurídica).

## 5. Fora desta rodada
Módulo de produto (gestão de LTCAT/PPP, histórico, integração S-2240) — projeto próprio; eSocial; IN 128; Anexo IV; CAT/S-2210.
