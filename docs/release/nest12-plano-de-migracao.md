# Plano — backend NestJS 10 → 12 (fecha os alertas altos restantes)

Estado: **plano, nada executado.** Branch sugerida: `chore/nest12-migracao`, a partir de `chore/deps-seguranca-2026-11-03`.

## Por que

`npm audit --omit=dev --package-lock-only` (backend, já com bcrypt 6 e correções semver-safe) ainda aponta:

| Pacote | Gravidade | Origem | Sai com |
|---|---|---|---|
| `multer` <=2.4.0 (4 avisos: DoS por nomes de campo, bypass de limite de tamanho) | **alta** | `@nestjs/platform-express` | platform-express 12 (multer 2.5.0) |
| `body-parser` <=1.20.8 (2 avisos de DoS) | **alta** | `express` 4 | platform-express 12 (Express 5.3.0) |
| `@nestjs/core` <=11.1.17 (injeção em saída) | moderada | direto | core 12 |
| `minimatch`, `uuid` | moderada | CLI / dependências de build | `@nestjs/cli` 12 |
| `file-type`, `qs` | moderada | — | `npm audit fix` (sem major) |

Os dois altos são de **upload e corpo de requisição**, justamente a superfície pública do sistema (13 usos de `FileInterceptor`/`FilesInterceptor`).

## Versões-alvo (VERIFICADO com `npm view`)

`@nestjs/common|core|platform-express|testing` 12.3.2; `@nestjs/jwt` 12.0.3; `@nestjs/passport` 12.0.0; `@nestjs/schedule` 12.0.2; `@nestjs/cli` 12.0.11.
Exige **Node >= 20**; o `Dockerfile` usa `node:20-alpine` (compatível, sem mudar infraestrutura).
Hoje: Express 4.22.1 via platform-express 10.4.22. O Nest 12 traz **Express 5.3.0**: é aí que está o risco real.

## Pontos de risco no código (levantados por leitura; INFERIDO onde marcado)

1. `src/app.module.ts:125` — `consumer.apply(RequestIdMiddleware).forRoutes('*')`. Express 5 (path-to-regexp 8) não aceita `*` solto; o Nest costuma converter com aviso, mas **conferir** que o ID de requisição continua sendo gerado em todas as rotas. (INFERIDO)
2. `src/app-setup.ts:21` — `set('trust proxy', 1)` e `helmet()`. Comportamento de `req.ip` atrás do Nginx precisa ser conferido (limites de taxa e auditoria dependem dele).
3. Uploads: 13 `FileInterceptor`/`FilesInterceptor` com `limits.fileSize` (2, 5, 10 e 100 MB). Testar um arquivo acima do limite em cada controller: deve devolver 413, não derrubar o processo.
4. `req.query` é somente leitura no Express 5. **Nenhuma mutação encontrada** por `grep` em `src/` (VERIFICADO). Corpo ausente agora é `undefined`, não `{}`: conferir DTOs e `ValidationPipe`.
5. Rotas com curinga em `@Get/@Post/...`: **nenhuma** (VERIFICADO por `grep`).
6. Tipos `Response`/`Request` importados de `express` (auth, tenants, google-calendar, normative-assistant, middleware): subir `@types/express` para 5.x junto.
7. `helmet` 7, `passport` 0.7, `class-validator` 0.15 e `ioredis` não dependem do Express 4; **conferir** compatibilidade de `@nestjs/schedule` 12 com `cron` em uso.
8. 143 arquivos usam `@nestjs/testing`. Esperar ajustes pontuais de tipo/mocks; a suíte é o principal medidor.

## Passos (cada um termina com evidência)

1. Criar a branch e o worktree; **não** tocar em produção.
2. `npm audit fix` sem `--force` (file-type, qs). Rodar `npm run test:unit`. Comparar com a linha base (hoje: 11 suítes falhando por PDF/R2, idênticas na linha base).
3. Subir a família `@nestjs/*` para 12.x + `@types/express` 5 + `@nestjs/cli` 12 num único commit lógico. `npm run build` e `npx tsc --noEmit`.
4. Corrigir o que quebrar (ordem provável: tipos de `req`, `forRoutes('*')`, mocks dos testes).
5. `npm run test:unit` até igualar a linha base.
6. **Ensaio de integração em ambiente descartável** (Postgres + Redis próprios, ver nota do projeto "ensaio descartável e isolado"): login por papel, um upload por controller, upload acima do limite, `X-Request-Id`, `req.ip` atrás de proxy simulado, isolamento entre tenants (RLS) nos testes e2e **apontando para o banco descartável, nunca o de produção**.
7. `npm audit --omit=dev`: meta é 0 altos/críticos no backend.
8. Segunda opinião: revisão por outro agente/modelo (`montese-seguranca` + `montese-qa`) antes de qualquer decisão de release.

## Fora do escopo / precisa de autorização do proprietário

- Commit, push, imagem Docker candidata, deploy, qualquer mudança em Nginx/Docker/banco.
- Rodar os e2e do backend contra o banco de produção (os atuais usam produção: não rodar).

## Critério de parada

Se os passos 4–6 mostrarem regressão de autenticação, RLS ou upload que não se resolva em ajuste pequeno, **parar** e levar ao proprietário. A alternativa é aceitar o risco dos altos de DoS temporariamente, com o limite de tamanho já aplicado na borda (Nginx `client_max_body_size`, a conferir).

## Alternativa que fechou os altos sem migrar (2026-11-03, worktree `/opt/montese-work/deps-seguranca`, nada commitado)

Em vez do Nest 12, `backend/package.json` ganhou `overrides` (`multer` 2.5.0, `body-parser` 1.20.9) sobre o Nest **10.4.22**, mais `npm audit fix` sem `--force`.

| Verificação | Resultado |
|---|---|
| `npm ls` | multer 2.5.0 e body-parser 1.20.9 (overridden), qs 6.16.2, file-type 20.4.1 |
| `npm audit --omit=dev` | **0 altos, 0 críticos, 15 moderados** (antes: altos em multer e body-parser) |
| `npx tsc --noEmit` / `npm run build` | exit 0 / exit 0 |
| `test:unit` | 11 suítes falhando (as mesmas ambientais PDF/R2 da linha base) + `normative-extract-html` uma vez sob carga; isolada passa 3/3 (22 testes). 27 testes falhando, 1362 passando (linha base: 28 e 1361) |
| Nest 11 | **descartado**: o mais recente (11.2.8) traz multer 2.4.0, ainda vulnerável; não resolve nada que o override já não resolva |

Moderados restantes: `@nestjs/core` <=11.1.17 (injeção em saída, só sai com major), `minimatch`/`uuid` (cadeia do CLI/build), parte de `file-type`/`qs`.

### NÃO verificado
- O app **não foi iniciado**; nenhum upload real, e2e, `X-Request-Id`, `req.ip`, RLS. Os testes unitários usam mocks: um override de multer/body-parser merece um ensaio de upload (um por controller, mais um arquivo acima do limite) em ambiente descartável antes de qualquer release.
- Se o override é aceitável como política: é uma divergência intencional da faixa que o `@nestjs/platform-express` 10 declara (multer ^2.0.x → 2.5.0, mesma major). Revisar quando o Nest 12 for viável.

### Recomendação (RECOMENDADO)
Adotar o override (opção B reforçada) e tratar o Nest 12 como projeto separado, que começa pela migração do runner de testes. A worktree `/opt/montese-work/nest12` guarda só o experimento (família 12 instalada, `tsc` e build passando, Jest não carrega); pode ser removida a seu critério.

## Ensaio de upload e corpo em ambiente descartável (2026-11-03)

Ambiente: Postgres (pgvector pg16) + Redis + S3 falso em rede própria, 80 migrations aplicadas, senhas aleatórias, chaves falsas, `NODE_ENV=development` (o validador de produção não roda; R2 apontado para o S3 falso). Backend compilado, **sem publicar porta**; sondas por `docker exec`. Nada de produção foi lido ou tocado. Ambiente destruído ao final.

Sonda de 18 verificações (login, `X-Request-Id`, upload válido, 3 MB e 100 MB acima do limite de 2 MB, sem arquivo, sem autenticação, multipart com índice de array enorme / nome de campo longo / campo inesperado / 20000 campos, JSON de 2 MB, JSON inválido, gzip falso, servidor vivo após cada bloco).

| Cenário | Original (multer 2.0.2 / body-parser 1.20.4) | Override (multer 2.5.0 / body-parser 1.20.9) | Override + filtro corrigido |
|---|---|---|---|
| 18 verificações | 15 OK, 3 falhas | 13 OK, 5 falhas | **18 OK** |
| multipart hostil (3 casos) | 400 | **500 (regressão do override)** | 400 |
| JSON 2 MB | 500 (já existia) | 500 | 413 |
| gzip falso | 500 (já existia) | 500 | 400 |

Causa da regressão: o `multer` 2.5.0 mudou o texto `Unexpected field` para `Unexpected file field` e criou códigos novos (aninhamento, índice de array, nome inválido, stream destruído). O Nest 10 converte os erros do multer **comparando o texto**, então esses erros caíam em 500. O servidor não caiu nem demorou (11–30 ms). A mesma causa-raiz do filtro explica os 500 antigos de JSON grande e de gzip inválido (já existiam na versão original).

Correção: `src/common/filters/all-exceptions.filter.ts` (`clientErrorStatus`, decide pelo `code`/`status` e não pelo texto; mensagens ao cliente genéricas) + spec `test/all-exceptions-filter.unit-spec.ts` (11 testes). Esses dois arquivos foram escritos **em paralelo por outra sessão do Claude** na mesma worktree (a versão final do filtro e do spec é a dela, mais completa: também trata erros `Z_*` de descompressão). Conferir antes do commit que não há duplicidade.

Suíte unitária final: 90 suítes passando, 11 falhando (as ambientais PDF/R2), 27 testes falhando e 1373 passando; `tsc` e `nest build` ok.

### Ainda NÃO verificado
- Outros 12 controllers de upload e os `FilesInterceptor` de documentos (a sonda usou `/tenants/me/logo`; o multer e o filtro são os mesmos, mas é INFERIDO que os demais se comportem igual).
- `req.ip` atrás do Nginx, limites de taxa e `client_max_body_size` do Nginx de produção.
- Execução com `NODE_ENV=production` e com a imagem Docker de produção (Alpine/musl).
- e2e de isolamento de tenant (RLS) contra o código com o override.

## e2e de isolamento e uploads no ambiente descartável (2026-11-03, 2ª rodada)

Mesmo tipo de ambiente (Postgres + Redis + S3 falso, 80 migrations, sem credenciais reais), código da worktree `deps-seguranca` (Nest 10.4.22 + overrides multer 2.5.0 / body-parser 1.20.9 + filtro corrigido), `NODE_ENV=test`, `--runInBand`, 16 specs:
`tenant-isolation-sweep`, `rls-isolation`, `documents-rls`, `inspection-document-rls`, `fire-brigade-rls`, `fire-safety-equipment-rls`, `documents-upload`, `documents-word-excel`, `upload-content-validation`, `tenants-logo`, `employees-import`, `employees-import-flexible`, `cipa-trainings`, `fire-brigade`, `fire-safety-equipment`, `inspection-document-upload`.

| Rodada | Suítes | Testes |
|---|---|---|
| 1ª (S3 falso simples) | 14 de 16 passam | 97 passam, 4 falham (todos por limitação do S3 falso: sem `ContentLength` no HEAD, sem `ListObjectsV2`, HEAD de apagado devolvia 200) |
| 2ª (S3 falso com HEAD/List corretos, só `documents-upload` e `tenants-logo`) | `documents-upload` passa (5/5) | `tenants-logo` 8 de 9 |

O único teste que não passa (`tenants-logo`: "redireciona pra uma URL real do R2") assere que a URL assinada contém o `R2_ENDPOINT` sem `https://`; com endpoint falso `http://` e bucket em subdomínio isso não pode ser verdadeiro. É artefato do ambiente, **não** regressão (INFERIDO; não comparado com a versão original).

Isolamento de tenant (RLS e sweep) verde com o override. Uploads de logo, documentos, funcionários, CIPA, brigada, extintores e inspeções verdes, incluindo "sem objeto órfão no R2 quando a RLS rejeita" e "troca de logo apaga o antigo".

### Ainda NÃO verificado
- Execução com `NODE_ENV=production` e a imagem Alpine de produção; `req.ip`/`client_max_body_size` atrás do Nginx real.
- Controle da 2ª rodada na versão original (só a 1ª rodada de sondas teve controle).
- Os demais ~135 specs e2e (não rodados).
- Nenhum teste contra o R2 real (de propósito).

## e2e restantes (134 specs) no ambiente descartável (2026-11-03, 3ª rodada)

Mesmo ambiente descartável. Duas rodadas dos 134 specs não executados antes (os 16 de isolamento/upload já estavam verdes):

1. **Rodada contaminada:** 64 suítes falharam, mas 536 das divergências de status eram `429` (rate limit acumulado no Redis; 402 respostas 429 nos logs). Sem valor como evidência. Redis zerado e limites elevados no ambiente de teste.
2. **Rodada válida (limites altos, Redis zerado):** 112 suítes passam, 22 falham (794 testes passam, 92 falham).
3. **Controle** (as mesmas 22 suítes no código original, multer 2.0.2 / body-parser 1.20.4): 21 falham (81 testes), 1 passa.
4. Comparação teste a teste: **nenhum teste falha só no override, exceto 11 de `atuacao-agenda`**, que foram timeout de 5 s no `beforeAll` (partida a frio do ts-jest). Reexecutada isolada no override: 29/29 passa, duas vezes. Nenhum teste falha só no controle.
5. `rate-limit.e2e-spec` (limites padrão): 2 testes falham **igualmente** no override e no controle.

**Resultado:** zero regressão atribuível ao override ou ao filtro em 150 specs e2e (16 + 134).

As 22 suítes que falham nas duas versões (o controle falha também) concentram-se, pelos nomes, em provedores externos com chave falsa (IA/MiniMax/OpenRouter/Groq, pente-fino, classificação), Mercado Pago, Resend e PDF/download no S3 falso. A atribuição de causa por categoria é INFERIDA pelos nomes; o que está VERIFICADO é a paridade com o controle. Esses cenários só se provam com os provedores reais ou mocks, e não foram executados contra serviço real (de propósito).

### Ainda NÃO verificado
- `NODE_ENV=production` e imagem Alpine de produção.
- `req.ip` e `client_max_body_size` atrás do Nginx real.
- As 22 suítes de provedores externos (só paridade com o original).
- Os 2 testes de `rate-limit` falham também no original: causa não investigada (INFERIDO: valores padrão de limite diferentes do esperado pela spec).
