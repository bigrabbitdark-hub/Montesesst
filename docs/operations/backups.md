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

## Pendências (checklist)

- [x] Cópia externa do backup (R2) — feito em 2026-09-28, com as limitações
      acima (mesmo bucket/credenciais, sem criptografia do lado do cliente).
- [ ] Alertar automaticamente se o cron de backup falhar ou parar de rodar
      (hoje só fica no log; ninguém é avisado ativamente) — depende da spec
      de observabilidade, ainda não escrita.
- [ ] Confirmar se o provedor da VPS já faz snapshot de VM por conta própria
      (fundador não sabia confirmar em 2026-08-18) — se sim, isso reduz o
      risco de perda total mesmo sem R2, mas não substitui backup granular
      do banco.
