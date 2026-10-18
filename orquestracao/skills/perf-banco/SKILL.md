---
name: perf-banco
description: Performance de PostgreSQL no Montese SST com RLS multi-tenant. Use ao criar/alterar queries, índices e migrations, ou ao investigar consulta lenta. Mede com EXPLAIN antes de mudar.
---

# Performance de banco (PostgreSQL + RLS)

## Princípio
RLS adiciona um filtro a toda consulta. Performance e isolamento caminham juntos: nunca contorne a policy para ganhar velocidade.

## Método
1. **Reproduza** a query com parâmetros realistas. Só SELECT em produção.
2. `EXPLAIN (ANALYZE, BUFFERS)` **sob o mesmo papel e contexto do app** (usuário não superuser, com `SET LOCAL app.*` na transação). Rodar como superuser mostra um plano diferente, sem RLS, e engana.
3. Identifique: Seq Scan em tabela grande, `Rows Removed by Filter` alto, Sort em disco, Nested Loop com muitas voltas, estimativa de linhas muito diferente da real.
4. Mude **uma** coisa. Meça de novo. Registre antes/depois (tempo e buffers).

## Regras de índice
- Tabela com `tenant_id`: índice composto começando por `tenant_id` (`(tenant_id, coluna_de_filtro)`) casa com o filtro da policy e com o filtro do app.
- Colunas usadas na policy RLS precisam de índice. Evite funções caras ou subselects não indexados dentro de policy.
- Índice parcial para estados raros (`WHERE status = 'pendente'`, `WHERE deleted_at IS NULL`).
- Ordenação paginada: índice na ordem do `ORDER BY` + paginação por chave (keyset) em vez de `OFFSET` grande.
- Cada índice custa escrita e espaço. Remova o que não é usado (`pg_stat_user_indexes`), mas só proponha, não apague sem autorização.
- Em tabela grande, `CREATE INDEX CONCURRENTLY` (fora de transação) para não bloquear escrita. Migration que bloqueia tabela de produção precisa de aviso explícito.

## Padrões do app
- **N+1**: caçar loops que fazem uma query por item (documentos, funcionários, EPIs, inspeções). Trocar por um `WHERE id = ANY($1)` ou JOIN.
- **SELECT \***: listar só as colunas necessárias, principalmente em tabelas com texto longo ou embeddings.
- Embeddings/RAG: índice vetorial apropriado se houver pgvector (verifique a extensão antes). Não varrer a tabela inteira para similaridade.
- Agregações do dashboard/score de conformidade: considerar cache no Redis ou tabela/visão materializada só se a medição justificar, e com invalidação definida.
- Transações curtas: `SET LOCAL` por transação, sem trabalho externo (HTTP, IA) dentro da transação.
- Pool: respeitar o limite de conexões; não abrir conexão por request.
- `VACUUM`/`ANALYZE`: estatísticas desatualizadas causam plano ruim; proponha, não execute em produção sem autorização.

## Saída esperada
Query, plano antes, mudança, plano depois, ganho medido, impacto em escrita e no RLS, como reverter.
