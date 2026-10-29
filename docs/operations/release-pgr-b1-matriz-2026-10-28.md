# Roteiro de release — PGR B1 (matriz de risco) (RECOMENDADO; nada foi executado)

Ordem: Z (0097) → A (0098) → **B1 (0099)**. Nada disto é executado sem autorização expressa do proprietário.

1. **Commit** (proprietário): B1 em commit próprio sobre `2e327a3` (a árvore atual contém só o B1 não commitado).
2. **Backup** do banco antes da migration.
3. **Aplicar 0099** em transação, registrando em `_migrations`, depois de 0097 e 0098. Conferir: `relforcerowsecurity` nas 2 tabelas; funções `pgr_*` sem SECURITY DEFINER e com `search_path` fixo; triggers `trg_a_pgr_risks_keep_assessments`, `trg_a_pgr_ghes_keep_assessments`, TRUNCATE nas duas tabelas; GRANT da aplicação (SELECT/INSERT nas avaliações). A tabela `pgr_matrix_versions` nasce **vazia** (sem seed).
4. **Imagens**: construir backend e frontend do commit; trocar os containers pelo procedimento habitual (sem `docker compose down -v`).
5. **Nginx**: o corpo da matriz aceita até 300 KB só nos caminhos da matriz (POST/PATCH) no backend; confirmar `client_max_body_size` (alteração só com autorização).
6. **Verificação pós-release (somente leitura)**: `GET /atuacao/pgr/matriz/vigente` ⇒ 404 "Nenhuma matriz publicada."; sócio sem permissão ⇒ 403; tela `/admin/pgr-matriz` ⇒ "Nenhuma matriz configurada. A configuração é feita pela equipe técnica."; classificar sem matriz ⇒ 409 "Aguardando matriz publicada pela equipe técnica.".
7. **Configuração pela equipe técnica**: o admin cria o rascunho, preenche escalas/faixas/níveis, preenche "validada por" e data, valida e publica; só então os sócios classificam.
8. **Rollback**: cabeçalho da 0099 (DROP dos triggers e das 2 tabelas e funções; confira a ordem — drop dos triggers em `pgr_risks`/`pgr_ghes` antes das funções); trocar imagens de volta. Avaliações já gravadas seriam perdidas: exportar antes, se houver.

Riscos: matriz vazia até a equipe publicar; QA visual não feita; B2 (plano de ação) e emissão (C) ainda não existem.
