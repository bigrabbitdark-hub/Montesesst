# Montese SST — instruções para o Claude Code

@AGENTS.md

## Leia antes de agir
- `PRODUCT.md` (produto e usuários), `docs/vision.md`, `docs/roadmap.md`.
- `PROJECT_STATE.md` (estado atual e decisões pendentes) e `docs/architecture/README.md` (onde está cada assunto).
- Skill do projeto: `.agents/skills/montese-engineering/SKILL.md` (engenharia, segurança, multi-tenant, SST).

## Equipe de agentes (Maestro Montese)
- O proprietário pede em português; o **Maestro** planeja, delega e confere. Quem implementa são os agentes especializados.
- Comandos: `/montese` (planejar), `/relatorio` (estado), `/auditoria` (analisar sem modificar).
- Agentes, modelos por agente e scripts: `orquestracao/README.md` e `orquestracao/agentes.conf`.

## Regras de ouro (resumo; o texto completo é o AGENTS.md)
- Sem commit, push, reset ou alteração de histórico: quem decide é o proprietário.
- Sem mexer em Docker, Nginx, banco, Redis, TLS, DNS, backups, secrets ou produção sem autorização.
- Nunca ler nem imprimir `.env`, chaves ou certificados. Nunca `docker compose down -v`.
- Isolamento entre tenants (RLS + FORCE RLS) é crítico.
- Nunca inventar norma, artigo, prazo ou penalidade; fonte oficial primeiro; a IA não é autoridade normativa.
- Só afirmar que algo funciona com evidência (comando e resultado). Rotular: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
- Quem implementa não aprova o próprio trabalho crítico: a revisão é de outro agente/modelo.
