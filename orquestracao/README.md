# Orquestração Montese SST — guia de uso

Você descreve o que precisa. O chefe planeja, pede o seu OK, distribui para os agentes
(cada um com a IA definida em `agentes.conf`), outro modelo revisa, e você decide o commit.

## Onde rodar
Terminal do Orca na VPS (alvo `root@187.127.54.72`). Sempre comece com:

```bash
cd /opt/Montese
```

## Jeito 1 — Fila de tarefas (várias ao mesmo tempo)  ← recomendado

Aba A (deixe ligada):
```bash
./orquestracao/rodar
```
Aba B (suas ordens):
```bash
./orquestracao/nova "Descreva o que você precisa"   # coloca na fila (pode repetir várias vezes)
./orquestracao/status                               # mostra em que etapa cada tarefa está
./orquestracao/ver 001                              # lê o plano / resultado / revisões
./orquestracao/aprovar 001                          # dá o OK para os agentes executarem
./orquestracao/aprovar 001 não                      # cancela
```
Etapas: na fila → planejando → **ESPERANDO SEU OK** → agentes trabalhando → revisão independente → **PRONTA PARA VOCÊ REVISAR**.

- No máximo **2 tarefas executam ao mesmo tempo** (a VPS também roda o site). Mude com `MAX_PARALELO=3 ./orquestracao/rodar`.
- Cada tarefa roda numa **cópia isolada** (`/opt/montese-work/<id>`, branch `agente/tarefa-<id>`), só com o que já foi **commitado**.
- Se a tarefa depende de alterações **ainda não commitadas**, use `./orquestracao/nova --principal "..."` (roda na pasta principal, uma de cada vez).

## Jeito 2 — Conversar com o chefe (uma coisa por vez)
```bash
./orquestracao/montese
./orquestracao/montese "Descreva o que precisa"
```

## Revisar e decidir
1. `./orquestracao/ver <id>` — leia o resultado e o `VEREDITO:` das revisões.
2. Veja o que mudou: `git -C /opt/montese-work/<id> status -sb` e `git -C /opt/montese-work/<id> diff`
   (ou abra a pasta no VS Code / diff do Orca).
3. Gostou? **Você** faz o commit. Não gostou? Peça ajuste com uma nova tarefa.
Nenhum agente faz commit ou push.

## Quem usa qual IA
Edite `agentes.conf` (uma linha por agente). Claude: `opus | sonnet | haiku`. MiniMax: `padrao`.
A revisão independente **nunca usa o mesmo modelo** de quem implementou (troca sozinha).

## Agentes
| Agente | Faz |
|---|---|
| orquestrador | decide, divide, delega, confere evidência (não edita código) |
| planejador | arquitetura + produto: mapeia o que existe e planeja (só lê) |
| banco-rls | migrations, RLS, índices |
| backend / frontend | NestJS / Next.js |
| normativo-ia | normas, RAG, assistente |
| qa | revisão adversarial do diff, testes, veredito |
| seguranca | tenant, LGPD, acessos (só lê) |
| performance | mede e otimiza |
| infra-release | Docker/Nginx/release: analisa e propõe |
| normas | fontes oficiais, vigência, versões; regras em rascunho até validação humana |
| rag-qualidade | testa o Assistente (citação, incerteza, versões, adversarial) |
| risco-ocupacional | PGR/GRO, LIP, LTCAT, PCMSO/ASO: lacunas e divergências (só lê) |
| auditor-documentos | Pente-Fino: evidência com origem, página e confiança (só lê) |
| esocial | S-2210/2220/2240: analisa e documenta; nunca envia evento real |

## Segurança (vale para todos)
Sem commit/push, sem `docker compose`, sem ler `.env`, sem `npm install` (bloqueios em `lib.sh`).
Chave do MiniMax: `/root/.montese/minimax.env` (só root). Registros: `/root/.montese/tarefas/` (cada delegação) e `/root/.montese/fila/`.
Logs da fila: `./orquestracao/rodar` mostra na tela.

## Limpeza (só você, depois de integrar ou descartar uma tarefa)
```bash
git -C /opt/Montese worktree remove --force /opt/montese-work/001
git -C /opt/Montese branch -D agente/tarefa-001
```

## Outros comandos
`./orquestracao/testar` (confere Claude e MiniMax) · `./orquestracao/instalar` (reinstala agentes/skills) ·
`./orquestracao/configurar-minimax` (guarda a chave) · `contratos/contrato-delegacao.md` (formato das delegações).
