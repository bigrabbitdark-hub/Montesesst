# Orca — trabalho paralelo com agentes no Montese

Guia para organizar a construção do projeto com o [Orca](https://www.onorca.dev) (app de desktop que roda vários agentes, cada um em um worktree git).

## Status

- VERIFICADO: o servidor tem Node v20.20.2, sshd ativo e glibc 2.39.
- INFERIDO: como a glibc é 2.39 (fora da faixa 2.17–2.27 do "Orca-managed Node"), usar **Host Node** nas configurações de SSH do Orca.
- NÃO VERIFICADO: o fluxo completo Orca (Windows) → SSH → este servidor. Testar com um worktree descartável antes de confiar nele.

## Configuração no Windows

1. Instalar o Orca (página de download do site) e o Claude Code.
2. Orca → Settings → SSH → Add Target: host, usuário, porta e chave. Usar chave SSH, não senha. Clicar em Test e depois em Save.
3. Em runtime do relay, escolher **Host Node** (Node 18+ já existe no servidor).
4. Adicionar o repositório `/opt/Montese` pelo alvo SSH.

## Regras para worktrees em paralelo

1. **Uma tarefa = uma branch = um worktree.** Nunca dois agentes na mesma branch.
2. **Partir de um estado limpo.** Commitar ou separar as alterações pendentes antes de criar worktrees; um worktree novo não herda alterações não commitadas. Quem commita é o proprietário (AGENTS.md).
3. **Migrations:** numeração sequencial colide entre branches. Só um agente por vez cria migration; combinar o número antes (última em uso: consultar `backend/db/migrations/`).
4. **Banco, Docker, Nginx e Redis:** nenhum agente altera ou reinicia. Nunca `docker compose down -v`. Nenhum agente toca em `docker-compose.override.yml` (ver memória de incidentes).
5. **Testes:** usar o container descartável na rede `montese_internal`; os e2e usam PROD, então não rodar em paralelo sem coordenar.
6. **Segredos:** nenhum agente recebe ou procura credencial de admin. Não colar segredos em prompts.
7. **Sem push, reset, revert ou force push por agente.** O proprietário integra as branches.
8. **Tarefas independentes por área** (ex.: frontend de uma tela vs. serviço de backend isolado) para evitar conflito de merge. Arquivos compartilhados (módulos Nest, layouts) ficam com um agente só por rodada.

## Worktrees existentes (VERIFICADO em 2026-10-07)

| Caminho | Branch / estado |
|---|---|
| /opt/Montese | feat/conformidade-por-nr |
| /opt/Montese/.claude/worktrees/dashboard-inicio-fase1 | worktree-dashboard-inicio-fase1 |
| /opt/Montese/.claude/worktrees/documentos-referencia-sst | worktree-documentos-referencia-sst |
| /opt/Montese/.claude/worktrees/esocial-sst-subprojeto1 | worktree-esocial-sst-subprojeto1 |
| /opt/montese-esocial | feat/esocial-transmissao |
| /opt/montese-release-nr | detached HEAD |
| /opt/montese-release-shell | detached HEAD |

Revisar quais ainda são necessários antes de criar novos (`git worktree list`). Remoção só com autorização.

## Fluxo sugerido

1. Definir a tarefa e a branch (`feat/<assunto>`).
2. Criar o worktree no Orca e escolher o agente.
3. Agente trabalha, roda typecheck/testes e reporta com VERIFICADO / NÃO VERIFICADO.
4. Proprietário revisa o diff, commita e decide a integração.
