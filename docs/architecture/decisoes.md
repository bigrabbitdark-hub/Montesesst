# Registro de decisões e aprovações

Formato: data · decisão · quem decidiu · observação. Só decisões já tomadas pelo proprietário; pendências ficam em `PROJECT_STATE.md`.

| Data | Decisão | Quem | Observação |
|---|---|---|---|
| 2026-10-12 | Camada de orquestração em `orquestracao/` (agentes, scripts, fila) | proprietário | Commitar essa pasta continua sendo decisão do proprietário |
| 2026-10-12 | MiniMax-M3 para o volume de código; Claude para decidir, proteger dados, revisar e normas | proprietário | Modelo por agente em `orquestracao/agentes.conf` |
| 2026-10-12 | Modelos grátis (OpenRouter) só em `performance` e `infra-release`, com reserva automática | proprietário | Limite diário por conta; podem registrar o que se envia |
| 2026-10-12 | 9router **não** será instalado na VPS | proprietário | Autor desconhecido; roda como root junto da produção |
| 2026-10-12 | Menu lateral da empresa por setores (Empresa, CIPA, Brigada e Incêndio, Segurança, Agenda, Gestão; Dashboard e Assistente no topo) | proprietário | Commit `39de7d2` em `agente/tarefa-002`; merge e deploy pendentes |
| 2026-10-13 | Ambiente oficial de trabalho: **VS Code** (Remote-SSH); Orca fora do fluxo | proprietário | Orca permanece instalado, sem uso |
| 2026-10-13 | Maestro Montese usa Sonnet por padrão; Opus só em tarefa crítica | proprietário | Preserva o limite do plano Claude Pro |
| 2026-10-13 | Marketing e copywriting num único agente, separável depois | proprietário | |
| 2026-10-13 | Memória do projeto no repositório, **sem commit** até o proprietário decidir | proprietário | `CLAUDE.md`, `PROJECT_STATE.md`, `docs/architecture/` |
| 2026-10-13 | Implantação do Maestro em etapas F1 a F6; F1 e F2 autorizadas | proprietário | Plano em `vps-kit/PLANO-MAESTRO-MONTESE.md` (cópia local do proprietário) |
| 2026-10-13 | Menu por setores publicado no frontend | proprietário | Commit `39de7d2`; depois incorporado ao release de documentos |
| 2026-10-13 | Trabalho solto do eSocial commitado para permitir unir os releases | proprietário | Commit `fd3cd19` em `feat/esocial-transmissao` |
| 2026-10-13 | Item eSocial do menu continua "em construção" | proprietário | Painel no código, sem link; liberar é decisão à parte |
| 2026-10-13 | Validade de documentos: regras globais editadas só pelo admin; PCMSO 12 meses, PGR 24, demais tipos sem vencimento automático; alerta de 30 dias | proprietário | Parâmetros operacionais, não prazos legais. Migration `0079` |
| 2026-10-13 | Vencimento calculado pode ser trocado à mão (fica `manual`); mudar a regra não altera documentos salvos; datas editáveis só por quem enviou ou admin | proprietário | Seguiu as recomendações do orquestrador |
| 2026-10-13 | Release de documentos publicado unindo menu, eSocial, CNPJ e documentos | proprietário | `release/documentos-esocial-20261013`, commit `8b9e5bf`; nota em `docs/operations/release-documentos-validade-2026-10-13.md` |
| 2026-10-14 | **Não** usar Obsidian, obsidian-mcp nem obsidian-git no projeto | proprietário | Ideia cancelada; nada foi instalado. Navegação por links, se um dia necessária, seria com a extensão Foam no VS Code (não instalada) |
| 2026-10-16 | **Reversão:** 9Router e Obsidian (app + obsidian-mcp + obsidian-git) reautorizados para o projeto | proprietário | Decisões 2026-10-12 (9Router) e 2026-10-14 (Obsidian) revertidas a pedido do proprietário. Decisão, ressalvas e gates em `/opt/montese-ai/docs/decisions/0002-tooling-reversal.md`. Nenhuma instalação foi feita; o uso real continua gated por decisão posterior do proprietário. |
