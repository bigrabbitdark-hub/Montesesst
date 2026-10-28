# Painel de Atuação — decisões pendentes do proprietário (2026-10-25)

Cada item traz a recomendação do agente (RECOMENDADO). Nada abaixo foi aplicado; a decisão é do proprietário.

| # | Decisão | Situação hoje (VERIFICADO) | Recomendação |
|---|---|---|---|
| 1 | Permissões sensíveis de documentos (`review`, `approve`, `sign`, `publish`, `cancel`, `view_registration`) | Ninguém as tem. Concedem-se pela tela `/admin/permissoes-socios`, com confirmação. | Conceder só depois de 2 e 3, e uma por pessoa conforme o papel real de cada sócio. Elaborar ≠ aprovar. |
| 2 | Matriz de responsabilidades por tipo de documento | Vazia: bloqueia todos, inclusive o admin. | Preencher tipo a tipo em `/admin/documentos-fluxo`, usando o indicador de viabilidade; começar por 1 tipo (ex.: PGR). |
| 3 | Registros profissionais (conselho/número/UF) | Nenhum cadastrado. Só registro "confirmado" permite assinar. | Cadastrar com dados fornecidos e conferidos em fonte oficial do conselho; nunca inserir dado presumido. |
| 4 | Separação de funções também para aprovar, assinar e publicar | Hoje só vale: revisor e aprovador ≠ elaborador. | Exigir também assinante ≠ aprovador para tipos de risco alto. Exige mudança de código (`SEPARACAO_PADRAO`) e novo release. |
| 5 | `documents.cancel` | Adicional à regra conservadora por estágio; ainda sem aprovação formal. | Aprovar como está; conceder somente a quem já pode publicar. |
| 6 | Retenção / LGPD do texto livre (tarefas, interações) | Sem política; só existe proposta em `docs/compliance/2026-10-20-painel-atuacao-retencao-lgpd-proposta.md`. | Aprovar a proposta antes de qualquer expurgo. Nenhuma exclusão irreversível sem aprovação. |
| 7 | MFA para o admin | Conta única de admin, sem MFA. | Implementar MFA (TOTP) antes de conceder permissões sensíveis. |
| 8 | Senhas | Credenciais foram escritas em chat. Contas dos sócios sem senha utilizável (definem por "Esqueci minha senha"). | Trocar toda senha que passou pelo chat. |
| 9 | Sócio desativado | Mantém permissões e o JWT vale até 8 h. A tela só permite remover. | Ao desativar um sócio, remover as permissões em seguida; avaliar revogação de sessão. |
| 10 | Achados pré-existentes (não do painel) | `tenant-context-callsites` vermelho na base de produção (3 chamadores não revisados); auditoria grava a query string; `0072` sem arquivo no repositório. | Abrir tarefas separadas, com revisão de outro agente. |
