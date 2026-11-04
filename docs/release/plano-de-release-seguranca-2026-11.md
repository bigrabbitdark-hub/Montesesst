# Plano de release — atualização de segurança e dependências (2026-11)

Estado: **nada foi enviado ao GitHub, nenhuma imagem foi construída, nada foi para produção.** Este documento é a entrega da frente "GitHub atualizado e seguro".

## O que está pronto (3 branches locais, cada uma com commits sobre `21d3a5e`)

| Branch | Conteúdo | Evidência |
|---|---|---|
| `chore/sincronizacao-2026-11-03` (`a7a8a8d`) | `.gitignore` (chaves, certificados, dumps), IP removido da documentação, Dependabot (`.github/dependabot.yml`), `SECURITY.md` | YAML validado; revisão de leitura |
| `chore/deps-seguranca-2026-11-03` (`e0f7e89`) | bcrypt 6; `overrides` de `multer` 2.5.0 e `body-parser` 1.20.9 sobre o Nest 10; filtro de exceções que decide 4xx pelo `code`/`status` | `npm audit --omit=dev`: 0 altos, 0 críticos; `tsc` e build ok; unit: 11 suítes ambientais falham como na linha base; 150 e2e (isolamento de tenant, RLS, uploads) sem regressão frente ao controle |
| `chore/next16-migracao` (`bbf29f2`, `8524d2b`) | Next 16.4.4, React 19, ESLint 9, correções de lint, `recharts` removido, `turbopack.root` | `tsc` ok; 591 testes; `next build` ok (69 páginas); `audit` 0; 37 telas logadas e fluxos nos 4 papéis (ver roteiro) |

As três integram sem conflito entre si (`git merge-tree`, sem alterar nada).

## Ordem recomendada

1. **Tornar o repositório privado** (GitHub → Settings → Danger Zone). Antes de qualquer push: `21d3a5e` e os commits anteriores só existem localmente e um push os publicaria.
2. Ativar *private vulnerability reporting* e *Dependabot alerts* (Settings → Code security).
3. Revisar e integrar `chore/sincronizacao-2026-11-03` (baixo risco, sem código de produção).
4. Integrar `chore/deps-seguranca-2026-11-03`. Antes do deploy, ensaiar na **imagem Alpine de produção** com `NODE_ENV=production` (não feito) e conferir no Nginx real `client_max_body_size` e `req.ip`.
5. Integrar `chore/next16-migracao` por último, e só depois de fechar os itens "não verificado" abaixo.
6. Deploy de cada uma separadamente (backend e frontend), com backup antes, na ordem 4 → 5.

## Depende de decisão ou autorização do proprietário (não feito por mim)

- Visibilidade do repositório; commit/push/merge; imagens Docker candidatas e deploy.
- `Dockerfile`: `npm install` → `npm ci` (builds reproduzíveis; mudança de infraestrutura).
- Política de `overrides` do multer/body-parser (divergência intencional da faixa do Nest 10) até o Nest 12 ser viável.
- Lint: `react-hooks/set-state-in-effect` está como **aviso** (80 ocorrências); migrar efeito a efeito depois do deploy.
- `package-lock.json` vazio e versionado na raiz do repositório: candidato a remoção.
- Worktree `/opt/montese-work/nest12` e branch `chore/nest12-migracao` (só o experimento; conclusão em `nest12-plano-de-migracao.md`).

## Ainda NÃO verificado (riscos conhecidos)

- Backend: `NODE_ENV=production` e imagem Alpine; Nginx real; 22 suítes e2e de provedores externos (só paridade com o controle).
- Frontend: simulado e meta da brigada (salvar completo), envio de relatório de inspeção, CIPA completa, pagamento real, comparação visual com Next 14, estouro de 78 px no celular em `/admin/documentos-fluxo` (sem relação aparente com a migração).
- Alertas moderados restantes no backend (`@nestjs/core` <=11.1.17, `minimatch`, `uuid`): só saem com o Nest 12, que exige migrar o runner de testes (Jest 29 CommonJS não carrega o Nest 12, ESM).

## Rollback

Cada branch é independente e local. Antes de qualquer deploy: backup (`ops/backup-postgres.sh`), imagem anterior mantida com tag, e reverter é voltar a imagem; nenhuma migration de banco faz parte destas três branches.

## Referências

`docs/release/nest12-plano-de-migracao.md` (branch `deps-seguranca`), `docs/release/next16-roteiro-de-verificacao.md` (branch `next16`).
