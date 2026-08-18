# Pooling, observabilidade e rate limiting

> Segunda peça da spec de Escala + Auditoria + Confiabilidade (ver
> [`docs/vision.md`](../vision.md) seção 9), depois do backup
> ([`docs/operations/backups.md`](backups.md)) e da trilha de auditoria
> (`backend/db/migrations/0002_audit_log.sql`). Escrita e testada de ponta a
> ponta em 2026-08-18 contra os containers reais desta VPS — evidência de
> terminal real em cada seção abaixo, nunca resumo do que "deveria" acontecer.

## 1. Pooling de conexões do Postgres

`DatabaseService` (`backend/src/common/database/database.service.ts`) usava
um `pg.Pool` sem nenhum limite explícito — sem teto de conexões, sem timeout
de query, e sem handler pro evento `error` do pool (um erro de conexão
ociosa não tratado derruba o processo Node inteiro, não só a query).

Limites agora configuráveis por env, com defaults pensados pra "dezenas de
empresas" numa VPS pequena, não centenas de conexões simultâneas:

| Variável | Default | O que faz |
|---|---|---|
| `DB_POOL_MAX` | 10 | Nº máximo de conexões simultâneas ao Postgres |
| `DB_POOL_IDLE_TIMEOUT_MS` | 30000 | Fecha conexão ociosa do pool após esse tempo |
| `DB_POOL_CONN_TIMEOUT_MS` | 5000 | Tempo máximo esperando conexão livre do pool antes de falhar |
| `DB_STATEMENT_TIMEOUT_MS` | 10000 | Aborta no próprio Postgres qualquer query mais lenta que isso |

Teste real: suíte e2e completa rodada contra o Postgres do container com
`DB_POOL_MAX=5` (menor que o normal, de propósito, pra forçar reuso de
conexão) — 8/8 testes originais passaram sem erro de timeout ou conexão.

## 2. Logs estruturados (observabilidade)

Decisão confirmada com o fundador: logs estruturados via `docker logs`,
sem infra nova na VPS (descartadas as opções de Prometheus+Grafana e de APM
externo tipo Sentry nesta fase — ver seção 4, pendências).

- **`JsonLoggerService`** (`common/logging/`) substitui o logger padrão do
  Nest — toda saída (inclusive logs internos do framework) vira uma linha
  JSON em stdout/stderr.
- **`RequestIdMiddleware`** gera um `request_id` (UUID) por requisição,
  devolvido também no header `X-Request-Id` — permite achar todas as linhas
  de log de uma requisição específica.
- **`RequestLoggingInterceptor`** loga uma linha por requisição: método,
  path, status, duração, `tenant_id`/`user_id` (quando autenticado), IP.
  Papel diferente do `AuditInterceptor` (que só grava mutações no
  `audit_log` como trilha de compliance) — este cobre 100% do tráfego pra
  debugging operacional.
- **`AllExceptionsFilter`** captura qualquer erro não tratado — devolve
  resposta genérica ao cliente (nunca stack trace), mas loga em JSON com
  stack completo. Erros 4xx (senha errada, 404, rate limit — rejeição
  esperada) logam como `warn` sem stack; só 5xx vira `error` com stack, pra
  não afogar bug real no meio de todo 401 de login normal.

**Bug pego durante o próprio teste, corrigido antes de fechar esta etapa:**
o interceptor de log inicialmente lia `response.statusCode` no caminho de
erro, mas nesse ponto o Nest ainda não tinha aplicado o status final (ele
pré-define um status de sucesso antes do handler rodar; só o filtro global
corrige depois) — todo 401/429 aparecia logado como 201. Corrigido lendo o
status direto da exceção capturada, não do response. Ver commit para o
diff.

**Bug de wiring pego durante o teste:** `app.useGlobalFilters(...)` em
`main.ts` só roda no bootstrap real — a suíte e2e monta a aplicação via
`Test.createTestingModule` e nunca passa por `main.ts`, então o filtro
global ficava inativo nos testes. Corrigido registrando `AllExceptionsFilter`
como `APP_FILTER` em `AppModule`, mesmo padrão já usado pros guards e
interceptors — agora ativo em produção e em teste.

Teste real (suíte completa, `docker logs` real):
```
{"timestamp":"...","level":"log","context":"HTTP","request_id":"...","method":"GET","path":"/employees","status_code":200,"duration_ms":14,"tenant_id":"fa1cc737-...","user_id":"dac5c4d6-...","ip":"::ffff:127.0.0.1"}
{"timestamp":"...","level":"warn","context":"ExceptionFilter","request_id":"...","method":"POST","path":"/auth/login","status_code":401,"message":"Credenciais inválidas"}
```

## 3. Rate limiting (Redis)

Decisão confirmada com o fundador: usar o Redis já provisionado no
docker-compose (persistente entre restart do backend, pronto se um dia
houver mais de uma instância) em vez de contador em memória.

- **`RedisService`** (`common/redis/`) — cliente único `ioredis`, módulo
  global. `pool.on('error', ...)` evita que uma falha transitória do Redis
  derrube o backend inteiro.
- **`RateLimitGuard`** — `APP_GUARD` global, roda antes de qualquer guard de
  autenticação (login precisa ser limitado mesmo sem `request.user` ainda
  existir). Contador de janela fixa via `INCR`+`PEXPIRE` no Redis (não é
  perfeitamente atômico sob concorrência extrema — pior caso é a janela
  ficar alguns ms mais longa, aceitável pra esse caso de uso). Se o Redis
  falhar, o guard deixa passar (fail-open) em vez de derrubar login
  legítimo.
- **Limite global** (`RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_SECONDS`, default
  300 requisições/5min por IP) em toda rota, exceto `/health`
  (`@SkipRateLimit()`).
- **Limite de `/auth/login`** mais estrito
  (`AUTH_RATE_LIMIT_MAX`/`AUTH_RATE_LIMIT_WINDOW_SECONDS`, default 10
  tentativas/15min), com chave por **IP + e-mail** — protege contra força
  bruta numa conta específica sem punir todo mundo atrás do mesmo IP (ex:
  NAT de escritório). Resposta `429` com header `Retry-After`.

Teste automatizado (`backend/test/rate-limit.e2e-spec.ts`, roda como parte
de `npm run test:e2e`): confirma bloqueio com 429 após N tentativas no mesmo
e-mail e isolamento (e-mail diferente não é afetado).

Teste real contra o backend de produção rodando nesta VPS (via nginx,
`curl` real, limite padrão 10/15min):
```
tentativa 1 -> 401
...
tentativa 10 -> 401
tentativa 11 -> 429

HTTP/1.1 429 Too Many Requests
Retry-After: 900
{"statusCode":429,"message":"Muitas requisições, tente novamente mais tarde"}
```
Confirmado também que as 10 tentativas permitidas geraram 10 linhas em
`audit_log` (`login_failure`) e a 11ª (barrada pelo rate limit) não gerou
entrada duplicada — o rate limiter também protege a trilha de auditoria de
ser inundada.

## 4. Pendências

- [ ] **Observabilidade além de logs** — se o volume de clientes justificar
      um painel visual (Prometheus+Grafana) ou alerta automático de
      erro/latência, isso é uma decisão nova a confirmar com o fundador, não
      implícita nesta etapa (decisão explícita: só logs, por ora).
- [ ] **Alertar sobre rate limit / erros 5xx em tempo real** — hoje só fica
      no log; ninguém é avisado ativamente. Mesma pendência já registrada em
      `docs/operations/backups.md` pro cron de backup — depende da mesma
      decisão de observabilidade acima.
- [ ] **Visibilidade do `audit_log` sem contexto de tenant** — consultar a
      tabela como `montese_app` sem `app.role`/`app.tenant_id` definidos
      retorna 0 linhas por RLS (`current_setting` vazio não bate com
      `actor_tenant_id`, mesmo pra eventos sem tenant como login com e-mail
      inexistente). Não é um bug introduzido aqui — é um comportamento
      pré-existente da policy criada em `0002_audit_log.sql` — mas vale
      revisão futura se o admin precisar consultar esses eventos fora de uma
      sessão autenticada como `admin`.
