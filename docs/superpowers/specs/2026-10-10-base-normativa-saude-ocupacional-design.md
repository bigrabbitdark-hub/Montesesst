# Base normativa de saúde ocupacional (PCMSO, ASO, LGPD) — design

> Data: 2026-10-10 · Escopo: **parser (3 correções) + migration `0075` + seed de regras + docs** · Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
> Origem: material do proprietário de 2026-10-10 ("PCMSO e ASO: saúde ocupacional, requisitos legais e fontes oficiais"). Quarta área da base normativa (LIP, GRO/PGR, previdenciário: specs `2026-10-09-…` e `2026-10-10-base-normativa-previdenciario-design.md`). Mesmo método: regras em rascunho ligadas a trechos literais, nada em produção.

## 1. Verificações (produção e sites oficiais, 2026-10-10; só leitura)

| Fato | Evidência |
|---|---|
| **A NR-07 do Assistente está ATUAL**: o texto em produção (vigente, hash `682207e135ad`, 72 349 caracteres) é **idêntico byte a byte** ao PDF que a página oficial publica hoje (`nr-07-atualizada-2022-1.pdf`, mesma URL do monitor; página atualizada em 02/06/2025; última portaria listada: SEPRT 8.873/2021; a nota da Portaria MTP 567/2022 consta dentro do texto) | `curl` + extração com o `pdf-parse` do monitor + página `…/norma-regulamentadora-no-7-nr-7` (VERIFICADO). Limite: vale até a data da página; **não** substitui conferir o DOU |
| Os itens do material existem no texto e o parser os acha no corpo: 7.5.1 (PCMSO a partir dos riscos do PGR), 7.5.6 (exames obrigatórios), 7.5.8 (prazos/periodicidade), 7.5.9 (retorno), 7.5.10 (mudança de risco), 7.5.11 (demissional, 10 dias), 7.5.19 e **7.5.19.1 (conteúdo do ASO, inclui CAEPF)**, 7.6.1–7.6.3 (prontuário, relatório analítico) | parse em memória (VERIFICADO) |
| NR-07 parseia em 198 dispositivos / 75,6%; o Anexo I (quadros) não gera dispositivos; **defeito conhecido:** o título do "QUADRO 1 …" ocupa 2 linhas e a 2ª (`POEIRA CONTENDO SÍLICA, ASBESTO OU CARVÃO MINERAL`) é tomada como início de seção → 8 dispositivos do Anexo 3 saem com endereço `3/POEIRA CONTENDO…` (motivo de a NR-07 estar bloqueada para geração) | parse em memória (VERIFICADO) |
| **CLT art. 168 (+§§1–3) e 169** saem com a redação vigente do pipeline novo (art. 168: "Será obrigatório exame médico, por conta do empregador…") | parse em memória (VERIFICADO) |
| **LGPD** (Planalto `L13709compilado.htm`, 231 KB; HTTP 200 com `User-Agent`): 414 dispositivos / 96,1%; arts. 6, 7, 11 (+§1), 46 e 48 reconhecidos; **art. 5 (definições, incl. dado pessoal sensível) NÃO é reconhecido**; a fonte **não está cadastrada** | parse em memória (VERIFICADO) |
| eSocial S-2220 (prazo até dia 15 do mês seguinte; MOS S-1.3; Nota Orientativa nº 08/2026), ANPD | **NÃO VERIFICADO**: nenhuma fonte ingerida; URLs oficiais não verificadas |
| Produto: já existe o módulo eSocial S-2220 em worktree separado (`/opt/montese-esocial`, "pronto, nada em produção") e a verificação PCMSO↔PGR no pente-fino (Fase 25) | memória do projeto; **não** duplicar (AGENTS.md) |

## 2. Decisões
1. **Nova área `saude_ocupacional`** (migration `0075`, mesmo molde da `0074`): categorias `pcmso`, `exames_ocupacionais`, `aso`, `relatorio_analitico`, `excecao`, `privacidade_dados`, `cruzamento_documental_saude`. As áreas anteriores e a `0072`–`0074` não são editadas.
2. **Parser (3 correções, nenhuma pode alterar as 36 NRs além do necessário):** (a) título de seção que **continua** outro título em maiúsculas (linha anterior não vazia toda em maiúsculas) não abre seção — corrige a NR-07; (b) reconhecer o art. 5 da LGPD (investigar a marcação real: provável `Art. 5º` seguido de incisos "I – …" com travessão ou quebra); (c) `resolveKind` aceita `LEI-13709` (já cobre `LEI-<n>`, confirmar). `NR-07` e `LEI-13709` entram em `GENERATION_ALLOWED_NORMAS` **só se o aceite passar** (medido: NR-07 sem seção falsa; art. 5 da LGPD presente, com os incisos literais).
3. **Seed `saude-ocupacional.json`** (rascunho; `contem` obrigatório): NR-07 (7.5.1, 7.5.4/7.5.5 integração PGR↔PCMSO, 7.5.6–7.5.11 exames e prazos, 7.5.19/7.5.19.1 ASO, 7.6.x prontuário e relatório analítico, regras de dispensa de MEI/ME/EPP onde literais), CLT art. 168/169, NR-01 (liga ao PCMSO só onde o texto citar), LGPD (art. 5 II dado sensível, 11, 46, 48 — só o que o literal diz). **Fora do seed:** prazo do S-2220, Tabela 24, MOS, ANPD, "não enviar prontuário a modelo externo" (princípio do Assistente/AGENTS.md, não norma), qualquer lista de exames "ilustrativa" do material sem literal.
4. **Dados de saúde e IA:** nenhuma mudança de código toca dado de trabalhador; as regras do seed são normativas (sem PII). O princípio "IA não diagnostica nem decide aptidão" vai para a documentação do Assistente, sem alterar prompt/modelo.
5. **Fonte LGPD:** cadastrar `LEI-13709` (tela de admin; ação do proprietário); a NR-07 já tem fonte e hash vigente — **não há troca de URL**.

## 3. Entregas
T1 parser (+ liberação condicional); T2 migration `0075` + enums; T3 seed + fixtures reais (NR-07, CLT 168/169, LGPD) + validação; T4 docs (runbook, release, reference de produto).

## 4. Riscos
- A aprovação da LGPD (≈45 chunks, estimado; medir) é pequena; a NR-07 já está aprovada — **nenhuma aprovação nova é necessária para a NR-07**, só gerar dispositivos (depois do deploy com o gancho).
- Mudança do parser pode alterar endereços da NR-07 (a seção falsa some): conferir que nada vigente em produção dependa deles (nenhum dispositivo foi gerado em produção).
- Interpretação virar autoridade (conteúdo de saúde): rascunho + ligação literal + revisão por médico do trabalho/profissional habilitado.

## 5. Fora desta rodada
Módulo de produto (agenda de exames, gestão de ASO, controle de acesso a dado médico), eSocial S-2220 (já em worktree), ANPD, MOS/leiautes, relatório analítico como modelo.
