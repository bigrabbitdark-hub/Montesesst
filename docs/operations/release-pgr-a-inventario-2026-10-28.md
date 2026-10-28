# Roteiro de release — PGR sub-projeto A (RECOMENDADO; nada foi executado)

Pré-requisitos e ordem: **Z primeiro** (`docs/operations/release-z-atuacao-por-empresa-2026-10-27.md`, migration 0097), depois A (migration 0098). Sem autorização expressa do proprietário nada disto é executado. Rótulo: RECOMENDADO.

1. **Commit** (proprietário): Z e A em commits separados, na branch de release da linhagem de produção. Conferir que `git status` não inclui `.env`, `.vite/`, `.clinerules`.
2. **Backup** do banco antes de qualquer migration (procedimento habitual do projeto; não alterar backups).
3. **Aplicar 0097** (se ainda não aplicada) e **depois 0098** em transação, registrando em `_migrations`. A 0098 é aditiva; confirmar antes: dono das funções `pgr_check_parent_tenant`/`pgr_guard_immutable_tenant` é o dono padrão (SECURITY INVOKER, sem bypass); `FORCE RLS` nas seis tabelas (`pg_class.relforcerowsecurity`); `GRANT` das tabelas ao papel da aplicação como nas demais migrations.
4. **Imagens**: construir backend e frontend a partir do commit; trocar os containers pelo procedimento já usado (sem `docker compose down -v`).
5. **Verificação pós-release (somente leitura primeiro)**: `GET /atuacao/pgr/perigos` como sócio com `pgr.read` ⇒ lista vazia; sem permissão ⇒ 403; empresa de parceiro ⇒ 404; `/admin/permissoes-socios` mostra o grupo "PGR".
6. **Conceder permissões** `pgr.read` + `pgr.write` (e `clients.read`, `empresas.read`) aos sócios pela tela de admin.
7. **Nginx**: a importação aceita até 2 MB no backend; confirmar `client_max_body_size` (alteração de Nginx só com autorização).
8. **Rollback**: cabeçalho da 0098 (DROP das 6 tabelas e 3 funções, DELETE de `socio_permissions 'pgr.%'`, restaurar CHECK de 16 valores); trocar imagens de volta.

Riscos: biblioteca vazia até a carga da equipe técnica; etapa Responsáveis sem registros; `grau_risco` indisponível; QA visual não feito.
