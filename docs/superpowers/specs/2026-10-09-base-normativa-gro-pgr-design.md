# Base normativa GRO/PGR (NR-01) — design

> Data: 2026-10-09 · Escopo: **backend (`backend/src/normative`) + migration aditiva `0073` + seed versionado de regras + docs** · Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
> Origem: material de 2026-10-09 do proprietário (seções 10–20: fluxo da NR-01, perigos, avaliação, hierarquia de medidas, plano de ação, psicossociais, inventário, revisão, exceções, RAG, módulo). Segunda área da base normativa (a primeira foi o LIP: `2026-10-09-base-normativa-lip-design.md`). Escolha do proprietário: **regras GRO/PGR em rascunho, generalizando a camada de regras**.

## 1. Verificações que fundamentam o design

| Fato | Evidência |
|---|---|
| O Assistente usa a NR-01 **antiga**: o texto em produção é idêntico (sha256) ao PDF "NR-1 vigência até 25/05/2026" e **não contém "psicossocia"** | hash de produção = hash do `NR-01.txt` do repositório = texto extraído de `nr-01-atualizada-2024-i-1.pdf` (VERIFICADO, 2026-10-09) |
| O monitor aponta para esse PDF antigo (`official_sources.official_url` termina em `nr-01-atualizada-2024-i-1.pdf`), que segue no ar com o mesmo conteúdo; por isso marca `ok` todo dia sem ver a versão nova | consulta somente leitura + `curl` HTTP 200 (VERIFICADO) |
| A versão vigente é o PDF `…/normas-regulamentadoras-vigentes/nr-01-atualizada-2025-i-3.pdf` (**vigência a partir de 26/05/2026**, Portaria MTE nº 1.419/2024, prorrogada pela nº 765/2025). Página oficial atualizada em 06/08/2026 | página `…/nr-1` e `curl` (200, `application/pdf`, 398 KB; 21 páginas) (VERIFICADO) |
| Texto novo extraído: 52 486 caracteres (54 392 bytes), **"psicossocia" 3×** (linhas 185, 196, 276 do texto extraído); itens `1.5.4.4.6`/`1.5.4.4.6.1` (revisão 2 anos / 3 anos com certificação), `1.5.5.1.1` (medidas de prevenção), `1.8.1` (MEI) | extração com o mesmo `pdf-parse` do monitor (VERIFICADO) |
| Hierarquia das medidas, revisão a cada 2/3 anos e dispensa do MEI **batem** com o material colado (já constavam na versão antiga) | ordem de prioridade I–IV no **item 1.4.1, alínea g** (o `1.5.5.1.1` trata de *quando* adotar medidas, alíneas a–d — correção feita na execução, 2026-10-09); `1.5.4.4.6(.1)`; `1.8.1` (VERIFICADO no texto) |
| Parser no texto novo: 151 dispositivos / 64,3% / 11 anomalias; `Anexo I da NR-01` e `Anexo II da NR-01` ficam em quarentena (`anexo_nao_reconhecido`) | medição em memória (VERIFICADO) |
| Outras fontes da produção também têm nome de arquivo versionado (ex.: `nr-09-atualizada-2026.pdf`); a CLT (`del5452.htm`), `d3048.htm`, `d4882.htm`, `l8212cons.htm`, `l8213cons.htm` e a TNU/STF estão com `last_check_status = erro`; a página `nr-1` (cadastrada como "NR1") **nunca foi verificada** | consulta somente leitura (VERIFICADO) |

O que o material colado afirma e **não está no repositório** (NÃO VERIFICADO até haver trecho literal): a lista de exemplos de perigos, a tabela de exemplos de plano de ação, os exemplos de fatores psicossociais, o conteúdo do Manual do cap. 1.5, das Perguntas e Respostas (maio/2026) e do Guia (2025).

## 2. Decisões

1. **Fonte primeiro.** A NR-01 de 26/05/2026 precisa entrar no RAG antes de qualquer regra que dependa dela. Isso é **ação do proprietário em produção** (trocar a URL na tela de fontes → "verificar agora" → revisar o diff por parágrafos → aprovar). Aprovar exige crédito de embeddings. Este pacote só prepara e mede.
2. **Generalizar a camada de regras por renomeação (migration `0073`).** `lip_rules` → `normative_rules`, `lip_rule_provisions` → `normative_rule_provisions`, mais `area` (`lip` | `gro_pgr`). Momento barato: as tabelas estão vazias e nenhum código que as use está em produção. A `0072` já aplicada não é editada. Fix wave final (antes da `0073` ir a produção): `area` fica **sem DEFAULT** depois da migration (o DEFAULT `'lip'` só preenche linhas existentes; INSERT sem `area` falha) e a área `gro_pgr` ganha a categoria `estrutura_pgr` (composição/documentos do PGR).
3. **Parser:** reconhecer `Anexo <id> da NR-<n>` (linha sozinha, sem pontuação final) como anexo novo. É a lacuna já documentada; sem ela a NR-01 perde os Anexos I e II. A NR-01 só entra na lista liberada de geração (`GENERATION_ALLOWED_NORMAS`) **depois** da medição no texto novo e sem regressão nas demais normas.
4. **Conteúdo versionado no git, nunca digitado em produção.** Regras GRO/PGR em `backend/db/seed-data/normative-rules/gro-pgr.json`, sempre **rascunho**, cada uma ligada a dispositivos literais por (norma, anexo, item). Um importador idempotente (`db:import-normative-rules`, dry-run por padrão) resolve as ligações contra os dispositivos ativos e **falha** se uma ligação não existe. Nunca grava `revisada`.
5. **O que não é regra normativa:** o desenho do módulo (inventário, plano de ação, alertas) é produto → resumo em `docs/reference/`; a "regra central do Assistente" (não concluir regularidade só por haver PGR) é princípio do Assistente → registrada para `docs/assistente-montese-principios.md` (sem alterar o prompt do modelo nesta rodada: **não** alterar provider/modelo/prompt sem autorização).
6. Manual do cap. 1.5, Perguntas e Respostas e Guia de psicossociais: **orientações, não norma**. Entram depois, como fontes **inativas** até existir o tipo de fonte (spec `2026-10-08-catalogo-fontes-por-tipo-e-tema-design.md`, E2).

## 3. Mudanças

### 3.1 Parser (`provision-parser.ts`)
`ANEXO_RE`/gatilho passam a aceitar `Anexo <id> da NR-<n>` como anexo novo (id normalizado: romano → arábico; `Anexo I da NR-01` → `1`). Não pode reconhecer linhas de sumário (`Anexo I - Termos…`). Teste com trechos **reais** do texto novo (fixture: `backend/test/fixtures/normative/NR-01-vigente-2026-05-26.txt`, com origem, URL, sha256 e data no cabeçalho do teste). Critério: NR-01 sem `anexo_nao_reconhecido` e sem regressão em nenhuma das 36 NRs do seed — NR-15 e NR-16 **idênticas** às medições atuais (316/67,7% e 89/91,3%), invariante com 0 violações.

### 3.2 Migration `0073_normative_rules_generalization.sql` (aditiva, transacional)
`ALTER TABLE … RENAME` das duas tabelas, das constraints e dos índices; `CREATE OR REPLACE` da função do trigger com o corpo apontando para as tabelas novas (o corpo plpgsql resolve nomes na execução — sem recriá-lo o trigger quebraria) e renomeação do trigger; `ADD COLUMN area text NOT NULL DEFAULT 'lip' CHECK (area IN ('lip','gro_pgr'))` seguido de `ALTER COLUMN area DROP DEFAULT` (linhas existentes ficam `lip`; regra nova tem de declarar a área); `categoria` ganha os valores GRO (`identificacao_perigos`, `avaliacao_riscos`, `controle_riscos`, `plano_acao`, `inventario`, `revisao`, `excecao`, `psicossocial`, `estrutura_pgr`) com CHECK de coerência `area` × `categoria`. Sem `tenant_id`/RLS. Dados: nenhum (tabelas vazias; reconferir antes de aplicar).

### 3.3 Código
`LipRulesService` → `NormativeRulesService`, controller `/normative-rules` (filtro `?area=`), DTOs com `area` obrigatório na criação e imutável na edição, `provision-lifecycle.ts` e testes com os nomes novos. Mesmas regras de estado (`rascunho → revisada ⇄ revisar → retirada`) e mesmo gancho. Todas as rotas continuam `@Roles('admin')`.

### 3.4 Seed de regras GRO/PGR + importador
Cada regra: `rule_key`, `area='gro_pgr'`, `categoria`, `agente_ou_atividade` (tema), `criterio` (aponta ao item), `interpretacao` (curta, só o que decorre do literal + material do proprietário, rotulada), `exige_revisao_profissional=true`, `provisions: [{norma, anexo, item_path, papel, contem}]` — `contem` é **obrigatório**: fragmento literal que o dispositivo resolvido por endereço DEVE conter (conferido pelo importador e pelos testes). Itens renumerados entre a NR-01 antiga e a nova resolveriam para texto diferente; sem `contem` o endereço sozinho não prova que o trecho é o mesmo. Candidatas (cada uma só entra com item literal **confirmado** no texto novo): composição do PGR (inventário + plano de ação), medidas de prevenção e sua ordem (`1.4.1` alínea g; `1.5.5.1.1` para quando adotar), revisão da avaliação (`1.5.4.4.6`, `.6.1`), gatilhos de revisão, fatores psicossociais no GRO (itens onde "psicossocia" ocorre), dispensas do PGR (MEI `1.8.1`/`1.8.1.1`; ME/EPP `1.8.x`), conteúdo do inventário e do plano de ação. Afirmações do material sem item literal (ex.: "EPI não prova eliminação do risco") ficam como regra **sem ligação** + nota "sem fundamento literal verificado", ou fora do seed. O teste do seed valida, contra o fixture do texto novo, que **toda ligação existe** e que nenhuma regra nasce com `status` diferente de `rascunho`.

### 3.5 Docs
`docs/reference/gro-pgr-modulo-insumos-2026-10-09.md` (resumo do desenho de produto colado, marcado como não normativo); atualização do runbook de ingestão (NR-01: troca de URL, ordem, a pendência das fontes em `erro`) e do plano de release complementar (migration `0073`, o que muda no `normative-rules`).

## 4. Fora desta rodada
Módulo GRO/PGR de produto (inventário, plano de ação, alertas) — projeto próprio; revisão das demais URLs versionadas (ideia: descoberta pela página-índice do MTE); fontes inativas (Manual, P&R, Guia); alterar prompt/regras de resposta do Assistente; CLT e fontes em `erro` (relatadas, não corrigidas).

## 5. Riscos
- **Produção:** a `0073` é uma segunda migration em produção (renomeia tabelas vazias). Só com autorização e backup; antes do deploy do backend reconciliado (que já depende da árvore reconciliada com o eSocial).
- **Rename:** quebra qualquer consumidor dos nomes antigos — nenhum em produção (tabelas vazias e backend sem o código).
- **Aprovar o texto novo da NR-01** altera as respostas do Assistente (psicossociais passam a existir): rodar a avaliação Camada A antes/depois, em ensaio.
- **Interpretação virar autoridade:** mitigada por rascunho padrão, ligação literal obrigatória para `revisada` e revisão por profissional habilitado.

## 6. Testes e entrega
Unit (parser com fixture real; serviço/DTO/controller renomeados; importador com mock; validação do seed contra o fixture), e2e em banco **descartável** (`0072` → `0073` aplicadas em sequência; trigger e CHECKs após o rename; coerência `area` × `categoria`; importador contra Postgres real), `tsc`, build, suíte unitária. Sem commit/push/deploy; nada em produção sem autorização.
