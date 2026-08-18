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

## Limitação conhecida — leia antes de confiar cegamente nisto

O backup fica **no mesmo disco da mesma VPS** que roda o banco. Isso
protege contra:
- erro de aplicação, migração ruim, comando `DELETE`/`DROP` sem `WHERE`;
- corrupção pontual do container/volume do Postgres.

**Não protege contra:**
- perda total do servidor (disco morrer, conta da VPS comprometida,
  provedor de hospedagem com problema);
- qualquer cenário onde o disco inteiro da VPS se torna inacessível.

Proteção completa exige uma cópia externa (ex.: Cloudflare R2 — já é a
escolha de object storage do projeto para documentos, mas as credenciais
`R2_*` ainda estão vazias no `.env`). **Isso é uma pendência explícita**,
registrada aqui e no checklist da spec de Escala/Auditoria/Confiabilidade —
não decidi sozinho fazer isso agora porque exige o fundador criar a
conta/bucket primeiro.

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

## Pendências (checklist)

- [ ] Cópia externa do backup (R2 ou equivalente) — depende de credenciais
      que o fundador ainda precisa criar.
- [ ] Alertar automaticamente se o cron de backup falhar ou parar de rodar
      (hoje só fica no log; ninguém é avisado ativamente) — depende da spec
      de observabilidade, ainda não escrita.
- [ ] Confirmar se o provedor da VPS já faz snapshot de VM por conta própria
      (fundador não sabia confirmar em 2026-08-18) — se sim, isso reduz o
      risco de perda total mesmo sem R2, mas não substitui backup granular
      do banco.
