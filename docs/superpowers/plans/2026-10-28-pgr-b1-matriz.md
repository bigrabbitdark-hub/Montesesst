# PGR — Sub-projeto B1 (matriz de risco versionada e classificação) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a equipe técnica configura uma matriz de risco versionada (nasce vazia), publica versões imutáveis e classifica os riscos do inventário (inerente e residual previsto) apontando para a versão exata da matriz usada.

**Architecture:** `pgr_matrix_versions` (global Montese; só admin escreve; sócio lê versões publicadas) com `config` JSONB validado por função pura e SHA-256 do JSON canônico; `pgr_risk_assessments` (por empresa, append-only) filha de `pgr_risks`. Backend em `backend/src/atuacao/pgr/matriz/**`. Telas: editor em `/admin/pgr/matriz` (admin) e classificação dentro do fluxo do inventário (`/atuacao/pgr/empresas/[tenantId]`).

**Spec:** `docs/superpowers/specs/2026-10-28-pgr-subprojeto-b-design.md` (B1) + pedido do proprietário §8.

## Decisões do proprietário (2026-10-28)
- Autorizado: começar o B1, migration **0099** primeiro no banco descartável. Matriz **nasce vazia** (nenhum rótulo, peso, faixa ou texto normativo inventado). Sem commit/deploy por agentes.

## Rulings provisórios do controlador (a confirmar pelo proprietário; custo se errado: retrabalho de uma fatia)
1. Matriz **global da Montese** (não por empresa). 2. **Publicar/arquivar só o admin** (sem permissão nova de sócio). 3. Metodologia padrão **severidade × probabilidade**, configurável (campo `metodologia` com `formula` ∈ {`severidade*probabilidade`}); validação da metodologia (quem, registro, data) é texto informado pelo admin na publicação — nada presumido. 4. Risco residual é **previsto**, informado pelo técnico (não calculado dos controles). 5. Sócio com `pgr.read`+`pgr.write` classifica; classificação **append-only** (nova avaliação substitui a vigente, histórico mantido).

## Global Constraints
- Base: worktree `/opt/montese-work/painel-release` (commit 2e327a3 contém Z e A). **Sem commit/push/reset/stash/deploy**; nada em produção; não ler `.env`/`ensaio.env`; proibido `/opt/Montese/run-backend-tests.sh`; não tocar `/opt/Montese`.
- Migration **0099**, aditiva, cabeçalho com rollback SQL; aplicar só no banco `montese_prodschema` do ensaio (`docker exec -i socio_ensaio_pg psql -U ensaio_su -d montese_prodschema -v ON_ERROR_STOP=1`, em transação, GRANT ao `montese_app`, INSERT em `_migrations`).
- **Nenhum valor inventado**: a matriz não tem semente; testes usam nomes "TESTE ...". Nenhum texto normativo.
- Padrões obrigatórios (aprovados no A): `@Roles`, `@RequirePermission('pgr.read','pgr.write')` nas escritas do sócio, `is_montese_tenant` para todos os papéis, lista branca de colunas no serviço, checagem de papel antes de `FOR UPDATE`, auditoria na MESMA transação (fail-closed) com `detail` só de ids/nomes de campo, 404 uniforme, FORCE RLS, triggers de coerência/imutabilidade.
- Versão publicada **imutável** (trigger: nenhum UPDATE de `config`/`config_sha256`/`version_number`; só `status` publicada→arquivada; DELETE proibido). Avaliações guardam `matrix_version_id`; alterar a matriz nunca recalcula avaliações antigas.
- Testes backend: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão>`; `npx tsc --noEmit -p tsconfig.json`; `npm run build`. E2E SOMENTE: `H=/tmp/claude-0/-opt-Montese/bac8b5c8-7575-4e72-a1f2-42d204d1d1d3/scratchpad; $H/reset-redis.sh >/dev/null && $H/run-e2e-cand.sh <padrão> > $H/<log> 2>&1`, uma suíte por vez. Frontend SOMENTE via `$H/sync-f7-front.sh <comando>`.
- pt-BR; VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO; sem "assinatura digital"/"ICP-Brasil".
- Fora de escopo: plano de ação (B2), emissão/PDF (C), Tabela 24, S-2240, upload.

## Formato do `config` (estrutura, sem valores)
```
{ "severidade":   [{ "valor": int>=1, "rotulo": str, "descricao": str }],
  "probabilidade":[{ "valor": int>=1, "rotulo": str, "descricao": str }],
  "niveis":       [{ "id": str, "rotulo": str, "aceitabilidade": str, "decisao": str, "bloqueia_emissao": bool }],
  "faixas":       [{ "min": int, "max": int, "nivel_id": str }],
  "metodologia":  { "formula": "severidade*probabilidade", "validada_por": str, "registro": str, "data": "AAAA-MM-DD", "observacoes": str } }
```
Regras de validação (função pura): escalas não vazias, `valor` únicos e crescentes, rótulos não vazios; `niveis.id` únicos; faixas inteiras com `min<=max`, **sem sobreposição e sem lacuna**, cobrindo de `1×1` até `max(severidade)×max(probabilidade)` (todos os escores possíveis do produto pertencem a uma faixa); todo `nivel_id` existe; metodologia com `formula` conhecida e `validada_por`/`data` preenchidos para **publicar** (rascunho aceita incompleto, sinalizando pendências).

### Task 1: Migration 0099 e RLS
**Files:** Create `backend/db/migrations/0099_pgr_matriz.sql`, `backend/test/pgr-matriz-rls.e2e-spec.ts`.
- `pgr_matrix_versions`: `id`, `version_number int UNIQUE` (gerado pelo serviço na criação do rascunho: max+1 sob lock), `status` CHECK (`rascunho`,`publicada`,`arquivada`), `config JSONB NOT NULL` (CHECK octet_length ≤ 200000), `config_sha256 TEXT` (CHECK hex64, NULL no rascunho), `notes TEXT`, `created_by`, `published_by`, `published_at`, timestamps. FORCE RLS: admin FOR ALL; sócio **SELECT só `status IN ('publicada','arquivada')`** (rascunho invisível ao sócio); empresa/técnico/parceiro sem policy. Triggers: imutabilidade pós-publicação; DELETE de publicada/arquivada proibido; `status` só avança rascunho→publicada→arquivada.
- `pgr_risk_assessments`: `id`, `tenant_id` NOT NULL, `risk_id` → `pgr_risks` ON DELETE CASCADE, `kind` CHECK (`inerente`,`residual_previsto`), `matrix_version_id` → `pgr_matrix_versions` (ON DELETE RESTRICT), `severity_value int`, `probability_value int`, `score int`, `level_id TEXT`, `justification TEXT NOT NULL CHECK (length(btrim(justification))>=1 AND length ≤ 4000)`, `assessed_by` → users, `assessed_at`. FORCE RLS: admin SELECT/INSERT; sócio `SELECT`+`INSERT` com `is_montese_tenant(tenant_id)`; **sem UPDATE/DELETE** (trigger bloqueia UPDATE; DELETE só em cascata `pg_trigger_depth()>1`); triggers de coerência de tenant com o risco (`pgr_check_parent_tenant`), imutabilidade de `tenant_id`; o `matrix_version_id` deve estar `publicada` ao inserir (arquivada recusada).
- [ ] e2e RED→GREEN: sócio lê só versões publicadas/arquivadas; sócio não escreve versões; empresa/técnico/parceiro nada; config imutável pós-publicação (UPDATE config/sha/version_number ⇒ erro; DELETE ⇒ erro; status regressivo ⇒ erro); avaliações: sócio insere em cliente Montese, não em parceiro, não UPDATE/DELETE, risco de outro tenant ⇒ erro, matriz em rascunho/arquivada ⇒ erro; cascata do risco apaga avaliações; rollback header; regressões `pgr-rls atuacao-empresas-rls socio-access-matrix`.

### Task 2: Validação e cálculo (funções puras)
**Files:** Create `backend/src/atuacao/pgr/matriz/matriz-config.ts` (tipos, `validarConfig(config, {publicar:boolean}) → {ok, erros[], pendencias[]}`, `calcular(config, sev, prob) → {score, nivel, faixa}`, `sha256Canonico(config)`), `backend/test/pgr-matriz-config.unit-spec.ts`.
- Unit exaustivos: lacuna, sobreposição, borda inclusiva, cobertura total (3×4, 5×5 e escalas não quadradas — só nos testes), nível inexistente, valores duplicados, formula desconhecida, metodologia incompleta bloqueia só `publicar`, JSON canônico estável (ordem de chaves) e SHA-256 determinístico, cálculo fora da escala ⇒ erro. Nenhum I/O.

### Task 3: API da matriz e das avaliações
**Files:** Create `backend/src/atuacao/pgr/matriz/matriz.{controller,service}.ts`, `dto/matriz.dto.ts`, `avaliacoes.{controller,service}.ts`; register in `atuacao.module.ts`; tests `pgr-matriz.e2e-spec.ts`, `pgr-matriz-service.unit-spec.ts`, `pgr-avaliacoes.e2e-spec.ts`.
- Matriz (`/atuacao/pgr/matriz`): `GET` (sócio `pgr.read`: versões publicadas/arquivadas, `GET vigente` = maior `version_number` publicada; admin: todas), `GET :id`; admin: `POST` (cria rascunho, opcional `copiar_de`), `PATCH :id` (só rascunho; valida estrutura em modo rascunho), `POST :id/publicar` (valida modo publicar; calcula `config_sha256`; registra `published_by/at`; **uma única publicada vigente por vez não é exigida** — a vigente é a de maior número), `POST :id/arquivar`. Sem DELETE de publicada.
- Avaliações (`/atuacao/pgr/empresas/:tenantId/riscos/:riscoId/avaliacoes`): `GET` (histórico + vigente por `kind`), `POST {kind, matrix_version_id?, severity_value, probability_value, justification}` — `matrix_version_id` omitido ⇒ vigente; o serviço **calcula** score/nível com `calcular` (o cliente não envia score/nível); `justification` obrigatória; sócio exige `pgr.read`+`pgr.write`; risco/tenant coerentes (404 uniforme); versão arquivada ou inexistente ⇒ 400; nível com `bloqueia_emissao` apenas informado (a regra de bloqueio será aplicada na emissão — C); auditoria `pgr.matrix.*`/`pgr.assessment.*` sem texto livre.
- `GET /atuacao/pgr/empresas/:tenantId/mapa-calor?kind=&matrix_version_id=` → contagem de riscos por célula (severidade×probabilidade) usando a avaliação vigente por risco.
- Testes: IDOR entre dois clientes, partner 404 para todos os papéis, 403 sem permissões, auditoria fail-closed, imutabilidade da versão publicada via API, histórico preservado, matriz mudando não altera avaliações antigas.

### Task 4: Frontend — editor da matriz (admin)
**Files:** Create `frontend/src/app/admin/pgr/matriz/page.tsx` + componentes, item no menu admin (`frontend/src/components/admin/nav.ts`), tipos em `frontend/src/components/admin/api.ts`, teste.
- Lista de versões; editor de rascunho (escalas, níveis, faixas, metodologia); validação visível (lacunas/sobreposições/pendências) usando as mesmas regras (cópia do módulo puro ou chamada de validação do backend — preferir endpoint `POST /atuacao/pgr/matriz/validar` para não duplicar regras); pré-visualização do mapa de calor; publicar com confirmação ("não poderá ser alterada"); duplicar versão; estado vazio explícito "Nenhuma matriz configurada. A configuração é feita pela equipe técnica."; acessibilidade; 401/403/404/409 com mensagem do servidor.

### Task 5: Frontend — classificar riscos e mapa de calor (sócio)
**Files:** alterar `frontend/src/app/atuacao/pgr/empresas/[tenantId]/{Riscos,RiscoCard,...}.tsx`, criar `MapaCalor.tsx`, `AvaliacaoRisco.tsx`, tipos em `atuacao/api.ts`, testes.
- No cartão do risco: classificar (inerente e residual previsto): escolher severidade/probabilidade da matriz vigente (rótulos/descrições da config), mostrar score/nível/decisão calculados pelo servidor, justificativa obrigatória, histórico; aviso quando não há matriz publicada ("Aguardando matriz publicada pela equipe técnica"); mapa de calor por empresa; nada presumido ("não classificado").

### Task 6: Verificação final, revisão de segurança e documentação
- Unit completo (falhas conhecidas: `r2-get-object`, `tenant-context-callsites`; `employee-document-text` só sob carga), `tsc`, `build`; e2e uma a uma: `pgr-matriz-rls pgr-matriz pgr-avaliacoes pgr-rls pgr-perigos pgr-ghes pgr-riscos atuacao-permissoes socio-access-matrix tenant-isolation-sweep`; frontend `vitest`, `tsc`, `eslint` (arquivos tocados), `build`.
- Revisão independente `montese-seguranca` (somente leitura) + uma rodada de correções + re-revisão restrita.
- Relatório `docs/superpowers/audits/<data>-pgr-b1-matriz.md`, roteiro de release (0099 depois de 0098), memória. **Parar**: commit e liberação são do proprietário.

## Auto-revisão
Spec §8: escalas/pesos/descrições/faixas/níveis/aceitabilidade/decisão (config), cálculo e explicação (Task 2/3/5), justificativa obrigatória (Task 1 CHECK + DTO), mapa de calor (Task 3/4/5), residual previsto (kind), faixas sem lacuna/sobreposição antes de publicar (Task 2/3), versão exata preservada (Task 1 imutabilidade + `matrix_version_id`), bloqueio alto/crítico na emissão → C (flag `bloqueia_emissao` guardado). Riscos: metodologia/validação são texto do admin; rulings 1–5 a confirmar; QA visual NÃO VERIFICADO.
