# Backup e restauração do Postgres

> Primeira peça da spec de Escala + Auditoria + Confiabilidade (ver
> [`docs/vision.md`](../vision.md) seção 9). Escrito e testado de ponta a
> ponta em 2026-08-18 — não é teórico, foi executado contra o Postgres real
> desta VPS (ver seção "Teste de restauração" abaixo).

## O que existe

- **Script:** [`ops/backup-postgres.sh`](../../ops/backup-postgres.sh) —
  `pg_dump` em formato custom (comprimido) dentro do container
  `montese_postgres`, copiado para `/opt/montese-backups/postgres/` no
  disco da VPS (fora do repositório git, fora dos volumes Docker).
- **Retenção:** 14 backups diários mais recentes; mais antigos são apagados
  automaticamente pelo próprio script.
- **Agendamento:** cron do usuário `root`, diário às 03:00 UTC:
  ```
  0 3 * * * /opt/Montese/ops/backup-postgres.sh >> /var/log/montese-backup.log 2>&1
  ```

## Cópia externa (Cloudflare R2) — desde 2026-09-28 (ITEM 007 da auditoria)

Depois do backup local, o mesmo `ops/backup-postgres.sh` envia o dump para o
R2, em `backups/postgres/montese-<TIMESTAMP>.dump`, usando
[`ops/r2-backup.js`](../../ops/r2-backup.js) (roda dentro do container
`montese_backend`, que já tem o SDK e as variáveis `R2_*` — nenhuma
credencial nova, nada de segredo no script).

- O envio é conferido no destino (tamanho **e** MD5 do objeto remoto contra o
  do arquivo local); divergência aborta com erro.
- Retenção remota: **30** dumps mais recentes (local continua 14 dias). A
  rotação só considera chaves no padrão `backups/postgres/montese-*.dump` —
  nunca toca nos documentos dos clientes que vivem no mesmo bucket (lógica
  testada offline com chaves de documento misturadas).
- Uma falha no envio externo **não impede** o backup local nem a rotação
  local: roda por último e faz o script terminar com código 1 e a linha
  `[ERRO] cópia externa para o R2 FALHOU` em `/var/log/montese-backup.log`.

### Limitações que continuam (leia antes de confiar cegamente nisto)

- **Mesmo bucket e mesmas credenciais da aplicação.** Quem comprometer a VPS
  (ou o backend) consegue apagar/ler também os backups remotos — a cópia
  protege contra perda de disco/servidor, **não** contra invasão. Endurecer:
  bucket dedicado + token de escrita apenas + versionamento/Object Lock (não
  configurados).
- **Sem criptografia do lado do cliente.** O dump contém todos os tenants
  (dados de funcionários, hashes de senha, tokens cifrados do Google). Conta
  com a criptografia em repouso do R2. Escolher criptografar antes de subir
  exige decidir onde guardar a chave **fora** da VPS (senão um servidor
  perdido leva a chave junto).
- **NÃO verificado:** que o bucket não tem acesso público (r2.dev/domínio
  customizado) — conferir no painel da Cloudflare.
- **Sem alerta ativo:** falha só aparece no log (pendência abaixo).
- O primeiro disparo pelo cron (03:00 UTC) não foi observado ainda — a
  execução manual reproduz o mesmo caminho; conferir
  `/var/log/montese-backup.log` na manhã seguinte.

## Limitação do backup local

O backup local fica **no mesmo disco da mesma VPS** que roda o banco. Isso
protege contra:
- erro de aplicação, migração ruim, comando `DELETE`/`DROP` sem `WHERE`;
- corrupção pontual do container/volume do Postgres.

**Sozinho, não protege contra** perda total do servidor — é para isso que
existe a cópia externa acima (com as limitações listadas).

## Restauração manual

```bash
# 1. Copiar o arquivo de backup escolhido para dentro do container
docker cp /opt/montese-backups/postgres/montese-<TIMESTAMP>.dump montese_postgres:/tmp/restore.dump

# 2. Restaurar (--clean --if-exists derruba e recria os objetos existentes
#    antes de restaurar — ou seja, isso SUBSTITUI o estado atual do banco
#    pelo estado do backup. Rodar com cuidado, nunca sem entender a
#    limitação: qualquer dado criado depois do backup escolhido é perdido.)
docker exec -e PGPASSWORD='<POSTGRES_SUPERUSER_PASSWORD do .env>' montese_postgres \
  pg_restore -U postgres -d montese --clean --if-exists /tmp/restore.dump

# 3. Limpar o arquivo temporário de dentro do container
docker exec montese_postgres rm /tmp/restore.dump
```

## Teste de restauração (executado em 2026-08-18)

Procedimento seguido para provar que o ciclo funciona de verdade, não só no
papel:

1. Criado um registro marcador em `tenants` (`MARCADOR TESTE BACKUP`,
   CNPJ `99999999000199`).
2. Rodado `ops/backup-postgres.sh` — backup gerado capturando o marcador.
3. Apagado o marcador via `DELETE`, simulando perda de dado.
4. Confirmado via `SELECT` que o marcador realmente sumiu (contagem = 0).
5. Restaurado o backup do passo 2 via `pg_restore --clean --if-exists`.
6. Confirmado via `SELECT` que o marcador voltou, com os dados corretos.
7. Confirmado que login (`POST /auth/login` com credencial do seed) e a
   contagem de `tenants`/`employees` pré-existentes continuaram intactos
   após o restore — o `--clean` não quebrou RLS, funções `SECURITY
   DEFINER` nem dados que já existiam antes do teste.
8. Marcador de teste removido ao final.

Resultado: ciclo completo (backup → perda → restauração) funcionou sem
erros, com evidência real de terminal em cada etapa.

## Restauração a partir do R2

Para um servidor novo/perdido. **Nunca restaurar direto sobre o banco de
produção para "testar"** — usar um banco temporário.

```bash
# 1. Baixar o dump do R2 (dentro do container do backend, que tem as R2_*).
#    Copiar ops/r2-backup.js para o container antes; ver ops/backup-postgres.sh.
docker exec -e NODE_PATH=/app/node_modules -e NODE_NO_WARNINGS=1 \
  -e BACKUP_ACTION=list montese_backend node /tmp/r2-backup.js        # escolher a chave
docker exec -e NODE_PATH=/app/node_modules -e NODE_NO_WARNINGS=1 \
  -e BACKUP_ACTION=get -e BACKUP_KEY=backups/postgres/montese-<TS>.dump \
  montese_backend node /tmp/r2-backup.js > montese-<TS>.dump

# 2. Daí em diante, o mesmo procedimento de "Restauração manual" acima.
```

## Teste de restauração a partir do R2 (executado em 2026-09-28)

1. `ops/backup-postgres.sh` rodado de verdade (pg_dump real + envio ao R2).
2. Objeto conferido no R2: 21.680.890 bytes, MD5 do envio = ETag remoto.
3. Dump baixado **do R2** e comparado com o local: `cmp` byte a byte idêntico.
4. Restaurado num banco temporário (`pg_restore` saiu com código 0 e zero
   linhas de erro) e comparado com a produção: 59 tabelas, 51 policies, 48
   tabelas com FORCE RLS, 12 funções SECURITY DEFINER, 135 índices, 31
   tenants, 113 usuários, 29 documentos, 25 funcionários, 54 migrations —
   **todos iguais**.
5. Banco temporário removido (0 restantes), arquivos temporários apagados.
6. Caminho de falha testado: com o container do backend inexistente, o backup
   local foi criado normalmente e o script terminou com código 1 e mensagem
   explícita.

Não testado: restauração sobre um servidor limpo (só em banco temporário do
mesmo servidor) e login da aplicação apontando para o banco restaurado.

## Cópia dos arquivos (documentos, fichas, assinaturas)

> Escrito em 2026-10-29 e revisado no mesmo dia, após a revisão independente.
> Foi testado em **ensaio descartável** (MinIO próprio, dois buckets, usuários
> com permissões mínimas) e em 49 testes unitários. **Ainda não rodou contra o
> R2 de produção**, porque depende do bucket e do token que só o dono pode
> criar (passo a passo abaixo).

Até aqui, o backup do Postgres tinha cópia externa, mas os **arquivos** dos
clientes não tinham cópia nenhuma: ficavam só no bucket principal, acessado
com as credenciais da aplicação. Em 2026-10-29 o bucket tinha 748 objetos e
1,07 GB.

- **Helper:** [`ops/r2-files-backup.js`](../../ops/r2-files-backup.js).
- **Script do cron, que também serve para restaurar:**
  [`ops/backup-r2-files.sh`](../../ops/backup-r2-files.sh).
- **Testes:** `backend/test/r2-files-backup.unit-spec.ts`, com clientes S3
  falsos em memória. O fake de produção **lança erro em qualquer escrita**.

### O que cobre

Todas as chaves de primeiro nível permitidas no bucket principal:

| Prefixo | Conteúdo |
|---|---|
| `tenants/<tenant>/documents/` | documentos enviados pelas empresas |
| `tenants/<tenant>/epi-fichas/` | fichas de EPI em PDF, incluindo as assinadas |
| `tenants/<tenant>/epi-signatures/` | imagens/arquivos de assinatura de EPI |
| `tenants/<tenant>/prevention-checklists/`, `fire-safety-equipment/`, `branding/` | checklists, extintores e logos |
| `esocial-certificates/*.pfx.enc` | certificados A1 **já cifrados** pela aplicação |
| `normative/` | PDFs da base normativa |
| `RAG*/` (ex.: `RAG MONTESESST/Arquivos pdf/...`) | material do RAG |

A listagem é feita **só por esses prefixos**, nos dois buckets.

### O que NÃO cobre

- **`backups/` (os dumps do Postgres)** nem é listado: já tem rotina própria
  (seção acima).
- **Chaves fora da lista ou malformadas** são ignoradas. Isso inclui
  marcadores terminados em `/`, chaves com caracteres de controle e chaves com
  mais de 1024 bytes. Elas só aparecem contadas no campo `ignored`.
- **O banco.** Um arquivo restaurado sem a linha correspondente em
  `documents`/`epi_fichas` fica órfão. Num desastre, restaure o dump do
  Postgres **e** os arquivos.
- **A chave de decifração dos certificados eSocial.** Os `.pfx.enc` só servem
  com a chave que está no `.env`. Ela não vai junto, e não deve ir.
- **Arquivos apagados na origem continuam no backup.** O backup é só de
  acréscimo e não tem expiração automática. Isso é intencional, mas não
  substitui uma política de retenção ou eliminação de dados pessoais (LGPD),
  que o dono ainda precisa decidir.

### Como funciona (garantias testadas)

**Isolamento da execução: container efêmero, não o backend**

O script não roda nada dentro do `montese_backend`. Ele cria um container
temporário a partir da **mesma imagem** do backend, que já tem o SDK, com:

- `--rm --init --read-only --cap-drop ALL --security-opt no-new-privileges`;
- `--memory 512m --pids-limit 256` e usuário `1000:1000` (sem root);
- o helper montado **somente-leitura**;
- sem compartilhar o PID do backend;
- rede `bridge` padrão do Docker: tem saída para a internet (R2), mas **não**
  enxerga o Postgres/Redis da rede interna do compose. Dá para trocar com
  `FILES_BACKUP_DOCKER_NETWORK`.
  - **Limite:** pela `bridge`, o container alcança as **portas publicadas no
    host** (ex.: 80/443 do Nginx), via IP do gateway. Não alcança serviços que
    só existem na rede interna.
- a imagem é descoberta pelo **ID** da imagem que o `montese_backend` está
  rodando (`docker inspect --format '{{.Image}}'`), não pela tag.

As duas credenciais (produção e backup) chegam a ele só durante a execução.
A credencial do backup **nunca entra** no container da API.

- **Falhas de rede:** se o container efêmero não resolver o endpoint, o helper
  falha com "não foi possível resolver o host de R2_…".
- **Falhas do `docker run`** (imagem ou rede inválida, código 125): o script
  diz "NÃO há fallback para docker exec no backend".
- **Ensaio:** os flags foram observados com `docker inspect` durante a
  execução (`ReadonlyRootfs=true`, `CapDrop=[ALL]`, `no-new-privileges`,
  `Memory=536870912`, `PidsLimit=256`, `User=1000:1000`, `AutoRemove=true`).
- **Neste host:** um container com os mesmos flags na rede `bridge` resolveu
  `cloudflarestorage.com` e leu o SDK como uid 1000 (VERIFICADO em
  2026-10-29).

**Sentido normal (produção → backup)**

- **A produção só é lida** (List/Get/Head).
  - Ensaio: o usuário de origem tinha política somente-leitura, e um
    `PutObject` com ele foi negado.
  - Testes: o fake de produção lança erro em qualquer escrita, e mesmo assim
    o sync passa.
- **Nada é apagado no backup.** Não existe `DeleteObject` no helper.
  - Ensaio: o usuário do backup **não tinha** permissão de exclusão (o
    `DeleteObject` foi negado) e tudo funcionou.
- **O helper só escreve num bucket marcado como backup.** O bucket precisa
  ter o objeto-sentinela `_montese-backup-destination`, gravado uma única vez
  com `init-destination`.
  - Sem o sentinela, o `sync` recusa sem escrever nada. `dry-run`, `verify` e
    `list-missing` funcionam sem ele.
  - Se o **bucket de produção** tiver o sentinela, toda ação é recusada:
    produção e backup seriam o mesmo bucket.
- **"Igual" significa:** mesma chave, mesmo tamanho e mesmo ETag (MD5) para
  objeto simples. Para objeto copiado em multipart, o ETag é diferente; aí
  valem os metadados gravados por nós (`montese-src-etag` igual ao ETag atual
  da origem e `montese-sha256` presente).
- **A versão divergente é preservada antes de ser sobrescrita.**
  - Ela vai para `_superseded/<etag-antigo>/<chave>`. A chave é
    determinística: o helper faz um `HeadObject` antes e não duplica.
  - Se a regravação falhar (ex.: Bucket Lock), a próxima execução **reusa** a
    cópia preservada (`supersededReused`) em vez de criar outra.
  - Ensaio: duas execuções seguidas com regravação negada → `_superseded`
    ficou em 3 objetos, sem crescer.
- **Conferência pós-cópia:** um `HeadObject` confere tamanho, ETag e o
  SHA-256 gravado.
- **Leitura da origem conferida:** quando o objeto é simples, o MD5 lido tem
  que bater com o ETag da origem.
- **Objetos acima de 8 MiB vão em streaming multipart.**
  - 1ª leitura: calcula o SHA-256.
  - 2ª leitura, com `If-Match`: envia as partes.
  - Se a origem mudar entre as leituras, o upload é **abortado** (com prazo
    próprio de 30 s) e a retentativa copia a versão nova.
- **Objeto que some da origem** entre a listagem e a leitura conta em
  `vanished`. Não conta como falha e não é retentado.

**Guardas contra "destino = origem"**

O helper recusa antes de qualquer chamada quando:

- os hosts normalizados e os buckets são iguais. A normalização ignora
  maiúsculas, ponto e barra final e o prefixo `<bucket>.` do virtual-host;
- o endpoint tem caminho, bucket embutido ou query;
- `R2_BACKUP_ACCESS_KEY_ID` é igual a `R2_ACCESS_KEY_ID`;
- o bucket tem o mesmo nome **e** os hosts resolvem para algum IP em comum.

Depois disso entra o **sentinela**:

- o `init-destination` grava o sentinela no backup e confere que ele **não
  apareceu** na produção. Se aparecer, é um alias, e o helper acusa o erro;
- toda execução recusa se a produção tiver o sentinela.

**Limite:** um alias de DNS para o mesmo bucket físico, com outro IP e outro
nome de bucket, só é pego pelo sentinela. Por isso o sentinela é obrigatório
para escrever.

**Efeito colateral:** um bucket de **outra conta** com o **mesmo nome** atrás
dos IPs anycast da Cloudflare seria recusado (falso positivo). Basta usar
outro nome de bucket.

**Higiene**

- **Nenhum valor de variável vai para a saída**, nem conteúdo de arquivo.
  - Erros passam por um filtro que troca endpoint, host, bucket e chaves de
    acesso por `[REDACTED:...]`.
  - A stdout tem **só** a linha JSON final. As mensagens vão para a stderr.
  - O script grava o JSON no log **também quando há erro**.
- **Chaves de objeto** só aparecem em `failures`/`notOverwritten`/`items`, até
  200 itens com no máximo 200 caracteres cada.
  - **`/var/log/montese-backup.log` é SENSÍVEL:** nomes de arquivo podem
    conter dados pessoais (ex.: nome de funcionário). Mantenha o arquivo só
    para root e não cole trechos dele em chat ou issue.
- **O `.env` não é executado.** O script lê **só** as 8 variáveis
  `R2_*`/`R2_BACKUP_*` com um parser simples, sem `source` nem `eval`.
  - Comentário no fim da linha é cortado como no compose: `NOME=valor # nota`
    vira `valor`, e `NOME="valor # x" # nota` vira `valor # x`. Num valor
    **sem** aspas, `#` colado (`a#b`) é mantido; um ` #` com espaço sempre
    inicia comentário. Testado com 8 formatos.
  - `FILES_BACKUP_*` no `.env` são **ignoradas**: o controle é só pela linha
    de comando ou pelo cron.
  - Ensaio: um `.env` com `FILES_BACKUP_DRY_RUN=1`, `FILES_BACKUP_ACTION=verify`
    e uma linha `touch ...`. O sync rodou de verdade e o arquivo do `touch`
    não foi criado.
- **Credenciais fora de `ps`.** Elas vão ao `docker run` por **nome**
  (`-e NOME`, exportadas pelo builtin `export`), nunca como `NOME=valor` na
  linha de comando.
  - Ensaio: 44.266 linhas de `ps` amostradas durante 4 execuções; 0 com
    credencial.
  - **Mas o `docker inspect` do container efêmero mostra o `Env` enquanto ele
    roda.** No ensaio, 70 amostras continham as credenciais. Quem tem acesso
    ao Docker do host (root) já lê o `.env` de qualquer forma. Com `--rm`, o
    container some ao terminar.

**Execução**

- `flock` em `/var/lock/montese-r2-files.lock`: uma execução por vez. A
  segunda sai com "já em execução" (testado com o lock ocupado e com duas
  execuções simultâneas).
- `timeout 2h`, configurável em `FILES_BACKUP_RUN_TIMEOUT`.
  - Ensaio com 1 s: o script saiu com "tempo esgotado" e não sobrou container.
  - Código 137 (SIGKILL) aparece como "processo morto (timeout após o prazo
    extra ou falta de memória)". O script não afirma qual dos dois foi.
    Ensaio: `docker kill` no meio → essa mensagem, 0 containers sobrando.
- O lock é aberto com `9>>`, que não trunca o arquivo.
- O helper encerra com `process.exit` logo depois de escrever o JSON.
- **Memória medida no ensaio** (pico de RSS do processo, campo `rssPeakMb`):
  - cerca de 60 MB em repouso;
  - **112 MB** no pior caso: sync com objeto de 20 MiB em multipart e 4
    cópias paralelas;
  - 91 MB no `verify` profundo.
- **Estimativa de memória**, por cópia simultânea:
  - até cerca de 2 × 8 MiB (parte + concatenação) no multipart;
  - até cerca de 2× o tamanho do objeto (≤ 8 MiB) no caminho simples;
  - ou seja, uns 64 MiB com 4 cópias paralelas, além da base do Node.
- O limite do container é 512 MiB.

### Ações e opções

Ações (`FILES_BACKUP_ACTION`):

| Ação | O que faz |
|---|---|
| `sync` (padrão) | produção → backup; exige o sentinela no backup (exceto em dry-run) |
| `verify` | compara sem copiar; acusa faltantes e divergentes (código 1). Com `FILES_BACKUP_VERIFY_DEEP=1`, baixa cada objeto do backup e confere MD5/SHA-256, o que pega corrupção silenciosa |
| `list-missing` | lista até 200 chaves que faltam no backup (código 0) |
| `init-destination` | grava o sentinela no backup; exige `FILES_BACKUP_CONFIRM_BUCKET=<nome exato do bucket de backup>`; é idempotente |
| `list-superseded` | **só lista** `_superseded/`: total, bytes e, com `FILES_BACKUP_SUPERSEDED_MAX_AGE_DAYS=N`, quantos têm mais de N dias. Não apaga nada: a limpeza é decisão do dono, no painel ou em regra de lifecycle |
| `restore` | backup → produção (ver f); os papéis são trocados **dentro** do helper; grava com `If-None-Match: *` |

Opções:

| Opção | Efeito |
|---|---|
| `FILES_BACKUP_DRY_RUN=1` | não escreve nada |
| `FILES_BACKUP_PREFIX=tenants/<id>/` | restringe a um sub-prefixo permitido |
| `FILES_BACKUP_ONLY_MISSING=1` | só copia o que falta; o divergente vai para `notOverwritten` |
| `FILES_BACKUP_CONCURRENCY` / `_RETRIES` / `_TIMEOUT_MS` | 4 / 3 / 300000 por padrão |

### Estado em produção (2026-11-01)

- Bucket de backup `montese-backup-arquivos` (conta Cloudflare da Montese, região automática ENAM), token só desse bucket, `R2_BACKUP_*` no `.env`.
- Scripts instalados em `/opt/Montese/ops/` (cópias idênticas ao commit `de30063`).
- Primeira cópia: 720 de 720 arquivos (402 MB), 0 falhas; 2ª execução copiou 0; `verify`: 720 iguais, 0 faltando, 0 divergentes.
- Cron do root: `10 4 * * *` (04:10 UTC), após o backup do banco (03:00 UTC).
- **NÃO VERIFICADO:** acesso público desligado e Bucket Lock (conferir no painel); `If-None-Match` no R2 real (testar em objeto descartável antes de qualquer restore); primeira execução pelo cron.
- Lição: o endpoint deve ser exatamente o da conta (`https://<id-da-conta>.r2.cloudflarestorage.com`); um endpoint digitado errado falha com "não foi possível resolver o host".

### Passo a passo para o DONO

**(a) Criar o bucket dedicado e o token no painel da Cloudflare**

1. Em R2, crie um bucket novo com nome **diferente** do principal, ex.:
   `montese-backup-arquivos`. Deixe **sem** acesso público: sem `r2.dev` e sem
   domínio customizado.
2. Em R2 → *Manage API tokens*, crie um token **novo** com leitura e escrita
   de objetos, **restrito somente a esse bucket**.
   - Não reutilize o token da aplicação.
   - O token da aplicação não deve ter acesso a este bucket.
3. **NÃO VERIFICADO (depende do fornecedor):**
   - Os tokens de objeto do R2 provavelmente não separam "escrever" de
     "apagar". Confira no painel.
   - Se houver *Bucket Lock* / regra de retenção, ative no bucket de backup
     (ex.: 30 a 90 dias). Isso impede apagar **e** sobrescrever.
   - Com o bloqueio ativo, a regravação de um objeto divergente falha e
     aparece em `failures`. A versão antiga continua intacta e é preservada
     uma única vez.
4. Anote o endpoint S3 da conta (só `https://host`, sem caminho), o Access Key
   ID e o Secret Access Key.

**(b) Colocar as variáveis no `.env` do servidor**

Edite `/opt/Montese/.env` direto no servidor. **NUNCA** coloque esses valores
no git, no chat, em issue ou em print:

```
R2_BACKUP_ENDPOINT=<endpoint S3 da conta>
R2_BACKUP_ACCESS_KEY_ID=<access key do token NOVO>
R2_BACKUP_SECRET_ACCESS_KEY=<secret do token NOVO>
R2_BACKUP_BUCKET=montese-backup-arquivos
```

**(c) docker-compose: NÃO acrescentar**

O helper roda num container efêmero que recebe as variáveis do script. Pôr
`R2_BACKUP_*` no serviço `backend` deixaria a credencial do backup
**permanentemente** no ambiente da API, que é justamente o que o desenho
evita.

Se, mesmo assim, o dono quiser, estas seriam as linhas, logo abaixo das
`R2_*` do serviço `backend` (exige recriar o container, numa janela de
produção):

```yaml
      R2_BACKUP_ENDPOINT: ${R2_BACKUP_ENDPOINT}
      R2_BACKUP_ACCESS_KEY_ID: ${R2_BACKUP_ACCESS_KEY_ID}
      R2_BACKUP_SECRET_ACCESS_KEY: ${R2_BACKUP_SECRET_ACCESS_KEY}
      R2_BACKUP_BUCKET: ${R2_BACKUP_BUCKET}
```

**(d) Marcar o destino, rodar em dry-run e depois de verdade**

Use subshell `( … )` para as variáveis de controle não ficarem no seu shell.
Nenhum segredo vai na linha de comando: o script lê do `.env`.

```bash
( FILES_BACKUP_ACTION=init-destination FILES_BACKUP_CONFIRM_BUCKET=montese-backup-arquivos /opt/Montese/ops/backup-r2-files.sh )
( FILES_BACKUP_DRY_RUN=1 /opt/Montese/ops/backup-r2-files.sh )            # espera wouldCopy ≈ 718, failed 0
/opt/Montese/ops/backup-r2-files.sh                                        # espera copied ≈ 718, failed 0
/opt/Montese/ops/backup-r2-files.sh                                        # 2ª vez: copied 0
( FILES_BACKUP_ACTION=verify /opt/Montese/ops/backup-r2-files.sh )
( FILES_BACKUP_ACTION=verify FILES_BACKUP_VERIFY_DEEP=1 /opt/Montese/ops/backup-r2-files.sh )   # ocasional; baixa ~330 MB
```

O ≈ 718 vem de 748 objetos − 30 dumps. É estimativa, pelo inventário de
2026-10-29.

**(e) Agendar no cron (root)**

O horário fica depois do backup do banco (03:00 UTC) e fora da janela
02:55–03:35 UTC, que tem conflitos conhecidos:

```
10 4 * * * /opt/Montese/ops/backup-r2-files.sh >> /var/log/montese-backup.log 2>&1
```

O script é idempotente e tem lock. Uma execução manual simultânea sai com
"já em execução".

**(f) Restauração e teste de restauração (faça uma vez, e de tempos em tempos)**

O modo `restore` troca os papéis **dentro do helper**: lê do bucket de backup
e escreve na produção.

- **Nunca sobrescreve** um objeto que já existe na produção. O divergente é
  só relatado em `notOverwritten`, e você decide caso a caso.
- **Corrida protegida:** o objeto que a aplicação criar na produção entre a
  listagem e a gravação também não é sobrescrito.
  - O `PutObject` e o `CompleteMultipartUpload` vão com `If-None-Match: *`.
  - O 412 do provedor vira `createdMeanwhileNotOverwritten` e entra em
    `notOverwritten`. Não é falha e não é retentado.
  - Ensaio MinIO, corrida real: objeto simples e de 20 MiB criados no meio do
    restore → nenhum sobrescrito, 0 uploads pendentes.
  - **NÃO VERIFICADO no R2 real.**
- Não cria `_superseded/` na produção.
- Exige `FILES_BACKUP_CONFIRM_BUCKET` com o nome **exato** do bucket de
  produção.
- Exige um `FILES_BACKUP_PREFIX` **estreito**:
  - aceitos: `tenants/<id>/...`, `normative/...`, `esocial-certificates/...`
    ou `RAG.../<algo>`;
  - recusados sempre: vazio, `/`, `..`, `.`, `//`, `RAG` e `backups/`;
  - prefixos amplos (`tenants/`, `tenants/<id>` sem barra, `RAG MONTESESST/`)
    só com `FILES_BACKUP_ALLOW_BROAD_RESTORE=1`. Nesse caso o relatório traz
    um `aviso`: um restore amplo pode **ressuscitar arquivos apagados de
    propósito** (ex.: eliminação a pedido do titular, LGPD).
- Exige o sentinela no bucket de backup e a ausência dele na produção.

**Antes do PRIMEIRO restore real (obrigatório):** confirme que o R2 honra
`If-None-Match: *`.

1. Grave um objeto descartável no **bucket de backup**, ex.:
   `tenants/_teste-inm/x.txt`, pelo painel.
2. Tente gravar de novo a mesma chave com `If-None-Match: *` (S3 API). O
   esperado é **412**.
3. Teste também `CompleteMultipartUpload` com `If-None-Match: *` sobre uma
   chave existente.

Se o R2 aceitar a gravação, a proteção contra a corrida **não existe** nesse
provedor. Restaure então só com a aplicação parada para o tenant em questão.

```bash
# 1. O que falta na produção sob o prefixo (sem escrever nada):
( FILES_BACKUP_ACTION=restore FILES_BACKUP_DRY_RUN=1 \
  FILES_BACKUP_PREFIX='tenants/<tenant-id>/documents/' \
  FILES_BACKUP_CONFIRM_BUCKET='<nome exato do bucket de produção>' \
  /opt/Montese/ops/backup-r2-files.sh )
#    -> confira wouldCopy e notOverwritten no log.

# 2. Mesma linha sem FILES_BACKUP_DRY_RUN=1, para restaurar de fato.
```

Teste periódico recomendado:

1. Escolha um documento de teste num tenant de teste.
2. Apague esse documento no bucket principal pelo painel.
3. Restaure com o prefixo exato.
4. Baixe o documento pela aplicação.

No ensaio, o objeto apagado voltou e o divergente **não** foi tocado: o
SHA-256 ficou igual antes e depois.

**(g) Monitorar**

Cada execução grava em `/var/log/montese-backup.log`:

- `início (ação=..., dry-run=...)`;
- `resultado: {JSON}`;
- `[ok] fim`, ou `[ERRO] ...` (falha, tempo esgotado, lock ocupado,
  `docker run` falhou).

Enquanto não houver alerta automático (pendência abaixo), confira:

```bash
grep '\[r2-files\]' /var/log/montese-backup.log | tail -n 6
( FILES_BACKUP_ACTION=list-superseded FILES_BACKUP_SUPERSEDED_MAX_AGE_DAYS=90 /opt/Montese/ops/backup-r2-files.sh )
```

Sinais de alerta:

- `"ok":false` ou `failed` maior que 0;
- nenhuma linha do dia;
- `copied` ou `superseded` muito acima do normal: a origem pode estar trocando
  conteúdo em massa (ex.: ransomware). Nesse caso, olhe `_superseded/`.

### Limitações honestas

- **Mesmo fornecedor (Cloudflare) e, provavelmente, a mesma conta.** Não
  protege contra falha ou bloqueio do fornecedor nem contra perda da conta.
- **O token do backup fica no `.env` da VPS.**
  - Quem tem root lê o token e o `Env` do container efêmero via
    `docker inspect` enquanto ele roda.
  - Se o token permitir exclusão, essa pessoa consegue apagar o backup. Só
    retenção ou bloqueio no bucket fecha essa porta (NÃO VERIFICADO).
- **A credencial de produção vai ao container efêmero**, e ela tem escrita.
  - O sentido normal só faz List/Get/Head na produção, o que está provado
    pelo código, pelos testes e pelo ensaio com usuário somente-leitura.
  - Mas o token em si continua podendo escrever. Um token de **leitura** só
    para o backup seria mais estreito: decisão do dono, e o `restore` então
    precisaria do token de escrita.
- **Criptografia em repouso depende do provedor.** A exceção são os
  `.pfx.enc`, que já chegam cifrados.
- **Custo:** uns 330 MB hoje (1,07 GB menos os 744 MB de dumps), crescendo com
  os uploads e com `_superseded/`. Sem expiração automática. Preço NÃO
  VERIFICADO.
- **Corrupção silenciosa** que mantenha tamanho e ETag só aparece no `verify`
  com `FILES_BACKUP_VERIFY_DEEP=1`.
- **Compatibilidade com o R2 real (NÃO VERIFICADO):**
  - `If-None-Match: *` no `PutObject` e no `CompleteMultipartUpload` (proteção
    do restore; teste obrigatório antes do primeiro restore, item f);
  - multipart com `Content-MD5`;
  - `If-Match` no GET;
  - `CopyObject` com `x-amz-copy-source-if-match` e chave acentuada;
  - endereçamento virtual-host.

  Tudo isso só foi testado no MinIO. `FILES_BACKUP_FORCE_PATH_STYLE=1` existe
  só para o ensaio.

### Ensaio executado (2026-10-29, versão revisada)

**Ambiente:**

- MinIO `elestio/minio` (RELEASE.2025-09-07) na rede `--internal`
  `montese_filesbkp_ensaio`, com 0 portas publicadas e dois aliases de rede;
- helper e script rodando com a imagem `montese-backend:latest`, com os mesmos
  flags de endurecimento;
- usuários:
  - origem: só leitura;
  - backup: sem `DeleteObject`;
  - "trava": nega `PutObject` numa chave do backup;
  - app: lê e escreve na origem, usado no `restore`.

**Objetos semeados:** 12, somando 36.017.233 bytes.

- 9 permitidos, incluindo 20 MiB em multipart (ETag `-4`), 9 MiB simples, um
  de 0 byte e chaves com espaço, acento, `ç` e travessão;
- 1 marcador;
- 1 em `backups/`;
- 1 fora da lista.

| Passo | Resultado |
|---|---|
| sync sem sentinela | exit 1 "sem o sentinela"; backup com 0 objetos |
| dry-run sem sentinela | `wouldCopy 9`, 34.968.653 B |
| `init-destination` sem confirmação / com / de novo | recusado / `created true` / `existed true` |
| sync / 2ª execução | `copied 9`, `ignored 1` (marcador); conferência independente 9/9 SHA-256 iguais / `copied 0` |
| apagar 1 no backup → `verify` → `list-missing` → `sync` → `verify` | exit 1 `missing 1` → lista a chave → `copied 1` → ok |
| corromper 2 (2 KB e 20 MiB) → `verify` → `sync` → `verify` profundo | `divergent 2` → `copied 2`, `superseded 2` → `deepChecked 9` ok |
| regravação negada ("trava") 2× → sync normal | `failed 1` + `superseded 1`, depois `failed 1` + `supersededReused 1`; `_superseded` ficou em 3 → `copied 1`, `supersededReused 1`; ainda 3 |
| `list-superseded` (30 dias) | `count 3`, `olderCount 0` |
| mesmo bucket (`/` final) / endpoint com caminho / alias de DNS | recusados, exit 1, sem chamadas ao bucket; produção continuou com 12 objetos |
| restore pelo shell: sem confirmação / sem prefixo / dry-run / real | recusado / recusado / `wouldCopy 1`, `divergentNotOverwritten 1` / `copied 1`; divergente intacto (SHA-256 igual antes e depois) |
| shell: sync / de novo / dry-run / verify profundo | `copied 1` / `copied 0` / `wouldCopy 0` / ok. `FILES_BACKUP_*` do `.env` ignoradas; `.env` não executado |
| shell: sem variáveis / lock ocupado / concorrente / timeout 1 s / rede `none` / imagem inválida | todos exit 1 com mensagem clara; 0 containers sobrando |
| vazamento | `ps`: 0 em 44.266 linhas; logs e saídas: 0; `docker inspect` durante a execução: mostra o `Env` (documentado acima) |

Containers `filesbkp_*` e rede removidos ao final (0 restantes).

**Ensaio 3 (mesma data, depois da 2ª revisão):** MinIO e rede novos,
credenciais novas.

| Passo | Resultado |
|---|---|
| suporte do MinIO a `If-None-Match: *` | Put sobre objeto existente → `PreconditionFailed HTTP 412`; chave nova → criada; Complete sobre existente → 412; conteúdo preservado |
| corrida real no restore: objeto simples (gancho cria o objeto na produção quando o helper lê do backup) | `copied 0`, `failed 0`, `createdMeanwhileNotOverwritten 1`; produção mantém os 41 bytes da "aplicação" |
| corrida real no restore: multipart de 20 MiB (gancho na 2ª leitura) | `createdMeanwhileNotOverwritten 1`, `failed 0`, 0 uploads pendentes |
| shell, `.env` com comentários no fim das linhas | sync ok |
| imagem por ID | os containers efêmeros usaram `sha256:4bd48bf1ac8f…`, o mesmo ID do container "backend" do ensaio |
| restore `tenants/` | recusado |
| restore `tenants/` + `ALLOW_BROAD` (dry-run) | ok, com `aviso` |
| restore `tenants/../normative/` | recusado |
| restore `tenants/t2/` | `copied 1` |
| `docker kill` no meio | "processo morto (SIGKILL…)", 0 containers sobrando |
| lock `9>>` ocupado | "já em execução" |
| vazamento | `ps`: 0 em 65.571 linhas; logs/saídas: 0 |

## Pendências (checklist)

- [x] Cópia externa do backup (R2) — feito em 2026-09-28, com as limitações
      acima (mesmo bucket/credenciais, sem criptografia do lado do cliente).
- [ ] Cópia dos arquivos para bucket dedicado: código e ensaio prontos
      (2026-10-29). Falta o dono criar o bucket e o token (seção acima, passos
      a–e), rodar `init-destination`, a primeira vez e agendar no cron.
- [ ] Decidir retenção/bloqueio no bucket de backup e política de eliminação
      de arquivos de clientes que saíram (LGPD).
- [ ] Alertar automaticamente se o cron de backup falhar ou parar de rodar
      (hoje só fica no log; ninguém é avisado ativamente) — depende da spec
      de observabilidade, ainda não escrita.
- [ ] Confirmar se o provedor da VPS já faz snapshot de VM por conta própria
      (fundador não sabia confirmar em 2026-08-18) — se sim, isso reduz o
      risco de perda total mesmo sem R2, mas não substitui backup granular
      do banco.
