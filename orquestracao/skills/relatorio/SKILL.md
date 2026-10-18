---
name: relatorio
description: Resume o estado geral do projeto Montese SST em português simples, a partir do estado real (git, worktrees, fila de tarefas, documentos de estado e decisões). Somente leitura.
argument-hint: "[assunto opcional, ex.: pendências, equipe, segurança]"
disable-model-invocation: true
---

# Relatório do estado do projeto (somente leitura)

Foco opcional do proprietário: $ARGUMENTS

**Não edite arquivos, não faça commit, não rode nada que altere estado.** Fale em português simples.

## O que levantar (comandos de leitura apenas)
1. Documentos: `PROJECT_STATE.md`, `docs/architecture/decisoes.md`, `docs/roadmap.md` (só o necessário). Se algum não existir, diga.
2. Git: `git status -sb`, `git log -5 --oneline`, `git worktree list`, `git branch --list`. Conte as alterações não commitadas.
3. Fila de tarefas: `/opt/Montese/orquestracao/status`.
4. Containers: `docker ps --format '{{.Names}} {{.Status}}'` (só leitura).
5. Se houver divergência entre `PROJECT_STATE.md` e o que você viu agora, **aponte a divergência**: o estado real manda.

## Como responder
- **Em uma frase:** como está o projeto hoje.
- **Pronto e conferido** · **Em andamento** · **Esperando decisão sua** (liste cada decisão com a sua recomendação).
- **Riscos** (só os que têm evidência) e **o que não foi verificado**.
- **Próximos 3 passos** recomendados.
- Rotule VERIFICADO / INFERIDO / NÃO VERIFICADO; não afirme nada sobre produção sem conferir.

Ao final, ofereça: "Se quiser, digo 'atualize o estado' e eu atualizo o `PROJECT_STATE.md`." **Só edite esse arquivo se o proprietário pedir isso explicitamente.**
