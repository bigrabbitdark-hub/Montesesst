# Base normativa do LIP (insalubridade e periculosidade) — design

> Data: 2026-10-09 · Escopo: **backend (`backend/src/normative`) + migration aditiva + ingestão de fontes oficiais** · **Nenhum código ainda** · Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
> Origem: pedido do proprietário de 2026-10-09 (estruturar base normativa sólida para o Assistente e a Auditoria Montese, começando pelo LIP; depois as demais áreas, uma a uma). Abordagem A aprovada em chat; alcance aprovado: **fundação + ingestão dos textos**.

## 1. Objetivo

Separar, no armazenamento, três coisas que hoje se misturam no texto bruto indexado:

1. **Fonte oficial** (documento, URL, versão, hash) — já existe.
2. **Dispositivo literal** (artigo, item, anexo, trecho exato) — novo.
3. **Regra interpretativa** (critério técnico da Montese, sempre ligada a dispositivos literais e revisada por humano) — novo.

Regra essencial do proprietário: nunca misturar texto oficial com interpretação produzida pelo modelo; toda afirmação mostra de onde veio.

## 2. Estado atual (VERIFICADO no repositório, 2026-10-09)

- Camada 1 existe: `official_sources`, `normative_documents` (status `aguardando_validacao/vigente/rejeitado/substituido`, `content_hash`), `normative_document_chunks` (migration 0021); estado do monitor (0050); monitor, aprovação e diff de parágrafos em `backend/src/normative/`.
- `splitIntoChunks` corta texto sem noção de artigo/item/anexo: o Assistente não cita item estruturado hoje.
- Não existe tabela de dispositivos nem de regras. Próxima migration livre: **0072** (confirmar com `ls | sort -V` na hora).
- Fase 28 (Pente-Fino × LIP) decidiu **não recalcular a NR-15**; extrai a conclusão escrita no laudo. Este design mantém essa decisão.
- Spec `2026-10-08-catalogo-fontes-por-tipo-e-tema-design.md` (sem código) propõe `source_type` e temas; este design não depende dela e se encaixa depois.
- Há trabalho não commitado em `normative-*` e `pente-fino/` na branch `feat/conformidade-por-nr`: a implementação deve ocorrer em branch/worktree próprio.
- **Bloqueio de indexação (VERIFICADO na memória do projeto):** OpenRouter sem crédito; embeddings dependem dele. Dispositivos e regras **não** dependem de embedding.

## 3. Modelo de dados (migration aditiva, sem RLS — conhecimento global como `official_sources`)

### 3.1 `normative_provisions` (camada 2a — literal)
`id`, `document_id → normative_documents`, `norma` (ex.: `NR-15`, `CLT`), `anexo` (`text NOT NULL DEFAULT ''`; '' = corpo da norma, para a UNIQUE funcionar sem NULL), `item_path` (ex.: `3.1.g`, `art. 192 §2`), `literal_text`, `char_start`, `char_end`, `document_hash` (cópia do `content_hash`), `parser_version`, `status` (`ativo`/`obsoleto`), `created_at`. `char_start`/`char_end` são offsets 0-based em pontos de código Unicode (não unidades UTF-16 do JS), de modo que `substring(raw_text from char_start + 1 for char_end - char_start) = literal_text` no PostgreSQL.
Único: `(document_id, anexo, item_path, parser_version)`. Índice por `(norma, anexo)`.
Gerada **só por parser determinístico** sobre o `raw_text` de documento `vigente`. Estrutura não reconhecida → sem linha, e entra no relatório de cobertura. Nunca preencher por modelo.

### 3.2 `lip_rules` (camada 2b — interpretação)

> **Nota (2026-10-09):** a `0072` criou `lip_rules`/`lip_rule_provisions` como descrito aqui; a `0073` renomeia para
> `normative_rules`/`normative_rule_provisions` (rotas `/normative-rules`, `NormativeRulesService`) e acrescenta `area`
> (`lip` | `gro_pgr`) — ver `2026-10-09-base-normativa-gro-pgr-design.md` §3.2/§3.3. O texto abaixo é o desenho original.
`id`, `rule_key` (único, ex.: `NR15-A1-RUIDO-CONTINUO`), `categoria` (`insalubridade|periculosidade|prevencao|previdenciario`), `agente_ou_atividade`, `metodo_avaliacao` (`quantitativo|qualitativo|misto|nao_aplicavel`), `unidade` (nullable), `criterio` (texto que **aponta** ao dispositivo; sem número copiado de memória), `excecoes`, `dependencias` (jsonb de `rule_key`/normas), `interpretacao`, `exige_revisao_profissional` (bool, default true), `vigencia_inicio`, `vigencia_fim`, `status` (`rascunho|revisada|revisar|retirada`), `reviewed_by_user_id`, `reviewed_at`, `reviewer_registro` (identificação do profissional habilitado), `created_at`, `updated_at`.
Restrições: `status='revisada'` exige `reviewed_by_user_id`, `reviewed_at`, `reviewer_registro` e ao menos um vínculo em `lip_rule_provisions` com dispositivo `ativo` (CHECK + trigger, ou validação transacional no service — decidir na implementação conforme padrão do repositório).

### 3.3 `lip_rule_provisions`
`rule_id`, `provision_id`, `papel` (`fundamento|criterio|excecao|metodo`). PK `(rule_id, provision_id, papel)`.
`provision_id` usa `ON DELETE RESTRICT` (apagar um dispositivo ligado a uma regra não pode deixar a regra `revisada` sem fundamento); `rule_id` usa `ON DELETE CASCADE`.

### 3.4 Invalidação por versão
Quando um documento vira `substituido`, seus dispositivos viram `obsoleto` e as regras ligadas passam a `revisar` (não são apagadas). O gancho fica no fluxo de aprovação existente (`NormativeDocumentsService`), sem alterar o monitor.

## 4. Fontes da ingestão (camada 1)

Cadastrar em `official_sources` (idempotente, via serviço existente, nunca SQL direto em produção): CLT arts. 189–197 (Planalto), NR-01, 06, 07, 09, 10, 15 (+anexos), 16 (+anexos), 17, 20, 23 (MTE), NHO 01, 03, 06 (3ª ed. 2025), 08, 09, 10 (Fundacentro).
- **Cada URL é validada ao vivo** com o "testar URL" existente antes de cadastrar; nenhuma URL é escolhida de memória. URL que falhar fica de fora e é reportada.
- Página-portal ("todas as NRs", portal do PGR, manuais eSocial) entra só como monitor/descoberta, **não alimenta o RAG de resposta**; isso se formaliza com `source_type` na E2 da outra spec — até lá, ficam `active=false` ou não são cadastradas (decisão do proprietário no momento).
- Os anexos da NR-15 e da NR-16 podem ser PDFs/páginas separados: cadastrar um por anexo, com `code` que o distinga (ex.: `NR-15 Anexo 03`).
- NR-15 Anexo 4 é revogado: não cadastrar como fundamento vigente.
- Data/versão vigente é lida do **próprio texto/página oficial na data da ingestão** e registrada; nada de datas de portaria vindas deste documento sem conferência.

**Achado de 2026-10-09:** as NRs 01, 06, 07, 09, 10, 15, 16, 17, 20 e 23 já existem em `backend/db/seed-data/normative-sources/manifest.json` (36 NRs; faltam NR-02 e NR-27); os anexos da NR-15 e da NR-16 estão no mesmo texto da norma (uma fonte por NR, não por anexo). Faltam a CLT e as NHOs. O texto da NR-15 do manifesto lista alterações só até a Portaria SEPRT nº 1.359/2019 e traz "Este texto não substitui o publicado no DOU": conferir a vigência contra a página oficial antes de usá-lo (ver `docs/operations/runbook-ingestao-lip.md`).

## 5. Parser de dispositivos

Módulo puro `provision-parser.ts` (sem I/O), uma estratégia por tipo de norma: `clt` (artigos, parágrafos, incisos), `nr` (itens numerados `15.1.1`, anexos, alíneas), `nho` (seções). Saída: lista de dispositivos com offsets. Relatório de cobertura: % do texto coberto, trechos não classificados, anomalias (numeração fora de ordem). Teste com **fixtures de trechos reais** baixados na ingestão.

Colisões de chave (mesmo anexo + item): título curto de sumário perde para o do corpo (que tem filhos); caso ambíguo não grava nenhum dos dois e vai para `anomalies`. Medição de referência do parser sobre os textos do manifesto (2026-10-09): NR-15 ≈ 296 dispositivos / 67% do texto; NR-16 ≈ 80 / 90%; NR-01 ≈ 162 / 95%.

## 6. Conteúdo das regras (matriz LIP)

Entra **depois** que os textos estiverem ingeridos e os dispositivos gerados, sempre `rascunho`:
- Matriz NR-15 por anexo (1, 2, 3, 5–14, 13-A) e NR-16 por anexo (explosivos, inflamáveis, segurança pessoal/patrimonial, energia elétrica, motocicletas, radiações/radioativos conforme o texto vigente), com método, evidências exigidas e casos de avaliação humana.
- Checklist de validação do LIP (14 itens do documento do proprietário) como regras de qualidade documental (`categoria=prevencao`), ligadas ao art. 195 da CLT.
- Percentuais do art. 192 e 30% do art. 193 §1º: **dispositivos literais**; regra de cálculo marcada `exige_revisao_profissional` e "não calcular sem enquadramento confirmado".
- Art. 193 §2º (opção entre adicionais): sempre sinaliza "revisão profissional", nunca decide.
- Distinção LTCAT/PPP/eSocial S-2240 (previdenciário) × LIP (trabalhista) registrada como regras de dependência.
- Rascunhos são redigidos a partir do texto ingerido, citando o dispositivo; o responsável técnico revisa e marca `revisada`.

## 7. Consumo (fora desta rodada)

API de leitura somente (service interno + endpoint admin de consulta), retornando regra + dispositivos literais + versão + hash + `last_checked_at`, com `rascunho` sempre rotulado. Ligar ao Assistente e à Auditoria exige avaliação Camada A antes/depois e é etapa seguinte. Nada de LLM no caminho de gravação.

## 8. Segurança, tenancy, IA

- Tabelas globais sem `tenant_id`/RLS, mesma categoria de `official_sources`; **nenhum dado de empresa/trabalhador** entra nelas (teste e2e/estático garante).
- Escrita só por rotas admin (guard de role existente). Sem segredos em log.
- Nenhum envio de dado a modelo; provider/modelo inalterados.

## 9. Testes

Unit: parser (fixtures reais CLT/NR-15/NR-16/NHO), máquina de estados da regra (incluindo "sem literal não vira revisada"), invalidação por versão. Integration/e2e em banco descartável (runbook do projeto): migration, constraints, gancho de substituição, ausência de tenant data. Typecheck e build. Migration **não** é aplicada em produção sem autorização + backup.

## 10. Ordem de entrega e autorizações

1. Migration 0072 + parser + services + testes (banco descartável). *Sem tocar produção.*
2. Cadastro das fontes e teste de URLs (leitura na internet). *Pede "pode" antes de gravar em produção.*
3. Download → `aguardando_validacao` → **você aprova cada documento** na tela existente.
4. Geração de dispositivos + relatório de cobertura (comando manual, rodado com autorização). O comando manual (`npm run db:generate-provisions -- <documentId>`) é SOMENTE LEITURA por padrão (transação `READ ONLY` + parser em memória); só `--apply` grava.
5. Rascunhos da matriz LIP; revisão profissional.
6. Indexação vetorial: quando o crédito dos embeddings for resolvido.
Sem commit, push, deploy, nem alteração de Docker/Nginx/PG/Redis (AGENTS.md).

## 11. Riscos

- Parser falhar em PDFs mal extraídos (NR em PDF) → cobertura parcial reportada, não preenchimento inventado.
- URL oficial mudar/desaparecer → monitor existente alerta.
- Texto do proprietário cita vigências (NR-01 em 26/05/2026, NR-09 jan/2026, Portaria 2.021/2025) → **NÃO VERIFICADO**; só entram se confirmados no texto oficial ingerido.
- Interpretação virar "autoridade": mitigado por `rascunho` padrão, revisor identificado e rótulo obrigatório.

## 12. Decisões abertas do proprietário

A. Páginas-portal: não cadastrar ou cadastrar inativas até existir `source_type`?
B. Quem é o profissional habilitado revisor (nome/registro) e se há mais de um.
C. Resolver o crédito de embeddings (OpenRouter) ou trocar de provedor (exige autorização, AGENTS.md).
