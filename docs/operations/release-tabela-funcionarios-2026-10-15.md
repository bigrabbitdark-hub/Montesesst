# Release — tabela oficial de funcionários (Fatias 1–4) sobre a linha de produção 8b9e5bf

Estado em 2026-10-15 (simulação REFEITA do zero com a onda de privacidade: migrations 0083/0084, filtro global de exceções, job de expiração, política RLS RESTRICTIVE). Nada foi commitado, mesclado nem aplicado em produção. Este documento é um PLANO; a decisão e a execução são do proprietário (AGENTS.md). Rótulos: VERIFICADO (comando e resultado nesta simulação) / NÃO VERIFICADO / RECOMENDADO.

## O que foi simulado (VERIFICADO)
Árvore temporária = `git archive 8b9e5bf` (linha em produção desde 2026-10-13, migration 0079) + os arquivos das quatro fatias por cima. Merge de três vias dos 5 arquivos tocados pelos dois lados (`pg-error.util.ts`, `documents.service.ts`, `company-units.e2e-spec.ts`, `employees-company-unit.e2e-spec.ts`, `DocumentsPanel.tsx`): **0 conflitos de texto**. Os mesmos 5 arquivos compartilhados; os novos (`all-exceptions.filter.ts`, `employees.module.ts`, `documents.service.ts` etc.) não são tocados pela produção. Banco de ensaio novo com as migrations 0001–0064, 0065–0071, 0076–0084 (79) e depois 0063 e 0072–0075 aplicadas DEPOIS da 0084: todas OK. Reaplicadas 0083 e 0084 duas vezes (idempotentes): 2 policies em `documents`, 1 CHECK de status, 1 CHECK de categorias.

| Verificação (na árvore mesclada) | Resultado |
|---|---|
| `tsc` backend e frontend | 0 erros |
| e2e em 6 lotes (nossas suítes + CNPJ, validade, eSocial, ASO, CAT, tenants, RLS) | 34 suítes, 291 testes, 0 falhas |
| Suítes de upload real ao R2 (`tenants-logo`, `documents-partner/-technical-categories/-upload/-word-excel`) | 16 testes falham, os MESMOS 10 nomes listados + contagens (3/5/2/6) na produção pura 8b9e5bf (R2 falso do ensaio): ambiental, 0 regressões nossas |
| Unit completo | 1484/1485 (só `r2-get-object`, ambiental: sem `R2_BUCKET`) |
| Vitest do frontend | 49 arquivos, 561 testes, verdes |
| Política 0083 | `documents_isolation` PERMISSIVE com definição idêntica (md5 igual) à de um banco só com a produção; `documents_hide_employee_registry` RESTRICTIVE FOR ALL (USING e WITH CHECK); RLS e FORCE RLS ligados. `documents-hide-employee-registry`, `aso*`, `esocial*`, `documents-validity` passam. Técnico, parceiro e papel vazio não veem `cadastro_funcionarios` e veem as outras categorias |
| Job de expiração | `AppModule` sobe com o `ScheduleModule.forRoot()` da produção; 7 crons registrados, o novo em `03:15`, nenhum com `lastDate`, `run()` não chamado durante o teste. `tenant-context-callsites.unit-spec` da produção é idêntica à base (a nossa, com a lista revisada, passa) |
| CHECKs finais | `documents_category_check` = 12 da produção + `cadastro_funcionarios`; `employee_document_extractions_status_check` com `expirado` |

## Única quebra encontrada e sua correção
A produção tornou o CNPJ **obrigatório na filial** (commit `bd91369`: 14 dígitos válidos, único por tenant, diferente do da matriz). Cinco specs nossos criavam filial sem CNPJ e falhavam com 400. Correção: fixture `makeCnpj(seed)` (CNPJ sintético válido, determinístico) + `cnpj: makeCnpj(...)` no corpo do POST. Patch: `docs/operations/tabela-funcionarios-merge-adaptacao-testes.patch` (7 arquivos de teste; nenhuma asserção alterada). **Só aplicar DEPOIS do merge**: antes dele o `ValidationPipe` desta linha recusaria o campo `cnpj`.

## Ordem sugerida para o proprietário (RECOMENDADO)
1. Separar o diff das quatro fatias do restante da árvore (a branch está empilhada sobre outras frentes) e commitar em branch própria — **decisão e execução do proprietário**. Migrations a incluir: `0080_employees_official_fields.sql`, `0081_employee_field_history.sql`, `0082_employee_document_extractions.sql`, `0083_documents_hide_employee_registry.sql`, `0084_employee_extraction_expired_status.sql` (hoje untracked).
2. Mesclar sobre `8b9e5bf` (ou o que estiver em produção na data).
3. `cd backend && git apply ../docs/operations/tabela-funcionarios-merge-adaptacao-testes.patch`; rodar `tsc` e o unit.
4. Rodar o e2e em LOTES (o lote único estoura o rate limit do ensaio) num ambiente de teste. O jest do backend precisa de `NODE_OPTIONS=--experimental-vm-modules` para os testes com PDF real.
5. **Antes de produção:** restaurar um dump estrutural (e, se autorizado, uma cópia dos dados) e aplicar 0080–0084 nele; conferir `SELECT tableowner FROM pg_tables WHERE tablename IN ('documents','employees','audit_log','employee_field_history','employee_document_extractions')` (leitura) por causa de `ON DELETE CASCADE` x `REVOKE DELETE`; aplicar fora do horário de uso (a 0080 cria índice único em `employees`).
6. As migrations 0063 e 0072–0075 (hoje só em `/opt/Montese`, não commitadas) são independentes das nossas e o runner (`db/migrate.ts`: por nome, ordem alfabética, só o que falta) aceita qualquer ordem.

## Riscos e decisões que continuam abertas
- **IA desligada por padrão** (`EMPLOYEE_INGESTION_AI_ENABLED`; o `docker-compose.yml` não a passa). Ligar exige base legal/contrato de operador/transferência internacional (nomes de funcionários vão ao MiniMax; CPF não), smoke controlado com chave real (NÃO feito: o comportamento real do modelo é NÃO VERIFICADO) e acrescentar as variáveis ao compose.
- Retenção: documentos `cadastro_funcionarios` ficam no R2/`documents` (inclusive ASO e escaneados) sem prazo de expurgo (agora só empresa e admin os veem; técnico/parceiro não, pela 0083); `candidates` pendentes expiram em 30 dias (job `03:15`, `EMPLOYEE_EXTRACTION_TTL_DAYS`); histórico sem expurgo.
- Efeito colateral deliberado da 0083: qualquer contexto sem `app.role` (ou com papel desconhecido) deixa de ver SÓ essa categoria; os demais não mudam.
- Filtro global de exceções (revisado na onda de privacidade); parse sem teto no Pente-Fino/checklist/indexador; semáforo por processo; confirmar `NODE_ENV=production` e se há proxy com limite ~100 s (requisição de leitura pode chegar a ~200 s).
- Não testado: `next build`, Playwright real, e2e contra banco de produção (proibido), migrations sobre dados reais. Obs.: o `@Cron` roda diariamente às 03:15 (hora do servidor); não rodar e2e nesse minuto.
