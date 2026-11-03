# Desligamento do sócio Danilo — roteiro (NÃO EXECUTADO)

Decisão do proprietário (2026-11-01): Danilo deixa a equipe; sem backup dedicado; Évelyn (eng.evelynsouza@montesesst.com.br) assume elaborar, revisar, aprovar, assinar e executar.
Conta desativada, nunca apagada: preserva auditoria, tarefas, versões e eventos (FKs para users).

Executar em produção como usuário de banco com acesso de manutenção, numa única transação. Conferir antes: `SELECT id,email,role,status FROM users WHERE role='socio';`

```sql
BEGIN;
-- :danilo e :evelyn = ids conferidos no SELECT acima (nunca por nome)
UPDATE users SET status='inativo' WHERE id=:danilo AND role='socio';
DELETE FROM socio_permissions WHERE user_id=:danilo;
-- tarefas abertas passam para a Évelyn (as concluídas/canceladas ficam com o histórico)
UPDATE tasks SET assignee_user_id=:evelyn
 WHERE assignee_user_id=:danilo AND status NOT IN ('completed','cancelled');
-- matriz de documentos: remover o Danilo (a Évelyn precisa estar com todas as ações, pela tela /atuacao/admin)
DELETE FROM document_type_responsibles WHERE user_id=:danilo;  -- conferir o nome real da tabela da matriz na 0096
COMMIT;
```
Depois: pedir à Évelyn "Esqueci minha senha"; confirmar que o login do Danilo é recusado; o admin concede à Évelyn as permissões que faltarem (tela /admin/permissoes-socios) e cadastra/confirma o registro profissional dela.
Preferir, quando possível, as telas de admin (auditam a mudança) ao SQL direto.
