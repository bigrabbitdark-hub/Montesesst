#!/usr/bin/env bash
# Funções comuns dos scripts de orquestração. Não execute direto.

ORQ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$ORQ_DIR/agentes.conf"
MM_ENV="/root/.montese/minimax.env"
LOG_DIR="/root/.montese/logs"
TASKS_DIR="/root/.montese/tarefas"      # registro de cada delegação (briefing, resultado, revisão)
FILA_DIR="/root/.montese/fila"          # fila de tarefas do proprietário
WORK_ROOT="/opt/montese-work"           # worktrees isoladas, uma por tarefa
REPO="/opt/Montese"
MAX_PARALELO="${MAX_PARALELO:-2}"       # tarefas executando ao mesmo tempo (a VPS também roda produção)

# Acha o executável do Claude Code (nvm Node 20 na VPS).
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"
[ -z "$CLAUDE_BIN" ] && CLAUDE_BIN="$(ls /root/.nvm/versions/node/*/bin/claude 2>/dev/null | tail -1)"
[ -z "$CLAUDE_BIN" ] && { echo "ERRO: executável 'claude' não encontrado." >&2; exit 1; }
export PATH="$(dirname "$CLAUDE_BIN"):$PATH"

# normaliza "backend" -> "montese-backend"
agent_name() { case "$1" in montese-*) echo "$1";; *) echo "montese-$1";; esac; }

# imprime "provedor modelo" do agente, ou falha
agent_cfg() {
  awk -v a="$1" '$1 !~ /^#/ && $1==a {print $2, $3; found=1; exit} END{exit !found}' "$CONF"
}

# imprime a cadeia de modelos do agente, uma por linha: "provedor modelo" (principal primeiro, depois reservas).
# No agentes.conf: montese-x  minimax padrao | openrouter padrao | claude haiku
agent_chain() {
  awk -v a="$1" '
    $1 !~ /^#/ && $1==a {
      sub(/#.*/, ""); n=split($0, seg, "|")
      for (i=1; i<=n; i++) { m=split(seg[i], f, " "); if (i==1) { if (m>=3) print f[2], f[3] } else if (m>=2) print f[1], f[2] }
      found=1; exit }
    END{exit !found}' "$CONF"
}

OR_ENV="/root/.montese/openrouter.env"

# prepara variáveis de ambiente para o provedor. Define MODEL_ARG. Retorna 1 se o provedor não está disponível.
setup_provider() {
  local provider="$1" model="$2"
  unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_MODEL \
        ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL \
        CLAUDE_CODE_SUBAGENT_MODEL
  case "$provider" in
    claude)
      MODEL_ARG="$model"
      ;;
    openrouter)
      if [ ! -s "$OR_ENV" ]; then
        echo "ERRO: chave do OpenRouter não configurada. Rode: $ORQ_DIR/configurar-openrouter" >&2
        return 1
      fi
      # shellcheck disable=SC1090
      . "$OR_ENV"
      [ -z "${OPENROUTER_API_KEY:-}" ] && { echo "ERRO: OPENROUTER_API_KEY vazia em $OR_ENV" >&2; return 1; }
      [ "$model" = "padrao" ] && model="${OPENROUTER_MODEL:-nvidia/nemotron-3-super-120b-a12b:free}"
      export ANTHROPIC_BASE_URL="${OPENROUTER_BASE_URL:-https://openrouter.ai/api}"
      export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"
      export ANTHROPIC_API_KEY=""          # tem que ser vazio (não removido), senão o Claude Code tenta a Anthropic
      export ANTHROPIC_MODEL="$model"
      export ANTHROPIC_DEFAULT_OPUS_MODEL="$model"
      export ANTHROPIC_DEFAULT_SONNET_MODEL="$model"
      export ANTHROPIC_DEFAULT_HAIKU_MODEL="$model"
      export CLAUDE_CODE_SUBAGENT_MODEL="$model"
      export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
      MODEL_ARG="$model"
      ;;
    minimax)
      if [ ! -s "$MM_ENV" ]; then
        echo "ERRO: chave do MiniMax não configurada. Rode: $ORQ_DIR/configurar-minimax" >&2
        return 1
      fi
      # shellcheck disable=SC1090
      . "$MM_ENV"
      [ -z "${MINIMAX_API_KEY:-}" ] && { echo "ERRO: MINIMAX_API_KEY vazia em $MM_ENV" >&2; return 1; }
      [ "$model" = "padrao" ] && model="${MINIMAX_MODEL:-MiniMax-M3}"
      export ANTHROPIC_BASE_URL="${MINIMAX_BASE_URL:-https://api.minimax.io/anthropic}"
      export ANTHROPIC_AUTH_TOKEN="$MINIMAX_API_KEY"
      export ANTHROPIC_MODEL="$model"
      export ANTHROPIC_DEFAULT_OPUS_MODEL="$model"
      export ANTHROPIC_DEFAULT_SONNET_MODEL="$model"
      export ANTHROPIC_DEFAULT_HAIKU_MODEL="$model"
      export CLAUDE_CODE_SUBAGENT_MODEL="$model"
      export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
      export API_TIMEOUT_MS="${API_TIMEOUT_MS:-3000000}"
      MODEL_ARG="$model"
      ;;
    *)
      echo "ERRO: provedor desconhecido '$provider' em agentes.conf (use claude, minimax ou openrouter)" >&2
      return 1
      ;;
  esac
}

# ---- fila ----
norm_id() { printf '%03d' "$((10#$1))"; }
estado_get() { cat "$FILA_DIR/$1/estado" 2>/dev/null; }
estado_set() { echo "$2" > "$FILA_DIR/$1/estado"; echo "$(date '+%F %T') $2" >> "$FILA_DIR/$1/historico"; }
log() { echo "$(date '+%H:%M:%S') $*"; }

# Ferramentas que os agentes delegados podem usar sem pedir permissão
# (headless não tem quem aprove). O resto fica negado.
# Obs.: sem "npm ci/install": em worktrees o node_modules é compartilhado.
ALLOWED_TOOLS=(
  "Read" "Grep" "Glob" "Edit" "Write" "TodoWrite"
  "Bash(npm run:*)" "Bash(npm test:*)"
  "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git branch:*)" "Bash(git worktree list:*)"
  "Bash(ls:*)" "Bash(pwd)" "Bash(wc:*)" "Bash(df:*)" "Bash(free:*)"
  "Bash(docker ps:*)" "Bash(docker logs:*)" "Bash(docker stats:*)"
  "Bash(/opt/Montese/run-backend-tests.sh test:unit:*)"
)
# Proibido sempre (AGENTS.md). Negação vence a permissão.
DENIED_TOOLS=(
  "Read(.env)" "Read(**/.env)" "Read(**/.env.*)" "Read(/root/.montese/**)" "Read(/root/.claude/.credentials.json)"
  "Bash(git commit:*)" "Bash(git push:*)" "Bash(git reset:*)" "Bash(git revert:*)"
  "Bash(git rebase:*)" "Bash(git clean:*)" "Bash(git checkout:*)" "Bash(git stash:*)" "Bash(git merge:*)"
  "Bash(docker compose:*)" "Bash(docker-compose:*)" "Bash(docker rm:*)" "Bash(docker stop:*)"
  "Bash(docker restart:*)" "Bash(docker kill:*)" "Bash(docker system:*)" "Bash(docker volume:*)"
  "Bash(npm ci:*)" "Bash(npm install:*)" "Bash(npm i:*)"
  "Bash(rm -rf:*)" "Bash(cat .env:*)" "Bash(printenv:*)" "Bash(env:*)"
)
