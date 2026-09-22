// Roda antes de cada arquivo e2e (setupFiles em jest-e2e.json). Os e2e usam o
// Postgres de produção; sem isto, qualquer e2e que chame o Assistente gravaria
// linhas de teste em assistant_query_log e poluiria o uso real. Só o e2e do log
// (assistant-query-log.e2e-spec.ts) religa o registro.
process.env.ASSISTANT_QUERY_LOG_DISABLED = 'true';
