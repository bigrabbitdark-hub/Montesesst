# Roteiro de verificação — migração do frontend para Next 16 / React 19

Branch: `chore/next16-migracao` (worktree `/opt/montese-work/next16`, a partir de `21d3a5e`).
Estado: **não commitada, sem imagem Docker, sem deploy.** Este roteiro cobre o que os testes
automatizados e o build **não** exercitam: o app logado.

## O que já foi verificado (com comando e resultado)

| Item | Resultado |
|---|---|
| `npx tsc --noEmit` | sem erros |
| `npx vitest run` | 47 arquivos, 591 testes passando |
| `npx next build` (Turbopack) | exit 0; `.next/standalone/server.js` gerado |
| `npm audit --omit=dev` (frontend) | 0 vulnerabilidades (antes: 1 crítica, 3 altas) |
| 19 rotas públicas em build local | todas 200 com o `h1` esperado (home, planos, notícias, cadastro, login, 8 páginas MDX, etc.) |
| `/cadastro/confirmado` e `/noticias/[slug]` | conteúdo correto; slug inexistente devolve 404 |
| Console do navegador (5 telas públicas) | sem erro de JS; único 404 é `/api/plans` (backend, ausente no servidor local) |

## O que NÃO foi verificado

- Qualquer tela logada (empresa, técnico, admin, atuação, dashboard-v2).
- Comportamento com backend real, uploads, redirecionamentos pós-login.
- Build da imagem Docker e execução em produção.
- Lint: 0 erros. Os 10 erros pontuais (`refs`, `immutability`, `no-explicit-any`) foram corrigidos; a regra nova
  `react-hooks/set-state-in-effect` (80 ocorrências) está como **aviso** em `frontend/eslint.config.mjs`, até as telas
  logadas serem verificadas. Depois disso, migrar efeito a efeito.

## Regras para quem executar

- Usar **ambiente de teste**: backend e banco descartáveis. **Não usar o banco nem as credenciais de produção.**
  Os testes e2e do backend acessam o banco de produção; não rodá-los.
- Subir o frontend desta branch com `node .next/standalone/server.js` (após `npm run build`) ou
  `npm run dev`, apontando para o backend de teste.
- Anotar cada item como VERIFICADO / NÃO VERIFICADO e a evidência (captura ou mensagem de erro).

## Roteiro por risco

### A. Fluxos de autenticação e navegação (risco alto)
- [ ] Login de empresa, técnico, admin e sócio; logout; sessão expirada.
- [ ] Redirecionamento por papel após o login.
- [ ] `/empresa/dashboard` redireciona (307) para `/dashboard-v2`.
- [ ] Redefinir senha (`/redefinir-senha`) e reenviar confirmação.
- [ ] `/cadastro/confirmado?status=ok` e sem o parâmetro (já conferido localmente; reconferir pelo fluxo real do e-mail).

### B. Telas com mais erros do lint novo (`set-state-in-effect`; risco médio)
Conferir que carregam dados, não entram em loop de requisição e não piscam/zeram campos ao digitar:
- [ ] `/atuacao` (painel inicial), `/atuacao/agenda`, `/atuacao/clientes/[tenantId]`, `/atuacao/documentos`, `/atuacao/financeiro`, `/atuacao/tarefas`
- [ ] `FireBrigadePanel`, `EmergencyDrillPanel`, `PreventionChecklistPanel` (empresa e técnico)
- [ ] CIPA: capacitação / SIPAT (`SipatTab`)
- [ ] Paleta de comandos do admin (`CommandPalette`)

### C. Componentes que mexem em `ref` durante a renderização (risco médio)
- [ ] CNPJ: cadastro e filial — a consulta preenche os campos uma única vez (`src/lib/useCnpjLookup.ts`).
- [ ] `/cadastro` (formulário público).
- [ ] Diálogos de fluxo de documentos: `admin/documentos-fluxo/Dialogo.tsx` e `atuacao/documentos/[id]/Dialogo.tsx` — abrem, fecham, foco e tecla Esc.
- [ ] `/planos` e `/tecnico/planos` — troca de plano e checkout até a tela do provedor (**sem concluir pagamento real**).

### D. Uploads e formulários com arquivo (risco médio)
- [ ] `FileInput` (componente base).
- [ ] Inspeções: `InspectionUploadModal`.
- [ ] CIPA: reuniões `[id]` e treinamentos.
- [ ] Onboarding: `MatrizForm`, `FuncionariosForm`.

### E. Leitura de parâmetros de URL (risco médio)
- [ ] `/tecnico/configuracoes?google=...` (retorno do Google Calendar).
- [ ] Páginas com `useSearchParams` (9) e rotas dinâmicas `[id]` / `[tenantId]`: abrir, recarregar, voltar.

### F. Visual (risco baixo)
- [ ] Desktop 1280 e celular 390 nas áreas empresa, técnico, admin e atuação: cabeçalho, rodapé, tabelas, modais.
- [ ] Impressão/PDF disparados pelo frontend, se houver.

## Observações

- `recharts` (não importado em `src/`) foi **removido** do `frontend/package.json` e do lockfile.
- O `Dockerfile` do frontend usa `npm install`, e não `npm ci`: o build de produção pode resolver versões diferentes do lockfile.
  Mudança de infraestrutura — só com autorização.
- Aviso do Turbopack sobre a raiz: resolvido com `turbopack: { root: __dirname }` em `next.config.js`. O aviso vinha de um
  `package-lock.json` vazio e versionado na raiz do repositório (sem `package.json`); candidato a remoção, decisão do proprietário.
- Build após todas as mudanças (lint, recharts, turbopack.root): `next build` exit 0, 69 páginas.

## Critério para seguir

Só depois de A–E sem regressão e da decisão sobre o lint o proprietário decide o commit, a imagem candidata e o deploy.

## Resultado da verificação das telas logadas (2026-11-04)

Ambiente descartável (Postgres + Redis + S3 falso, 80 migrations, chaves falsas, nada de produção), backend da branch `deps-seguranca` e frontend desta branch em modo `standalone`, com um proxy local replicando `/api/` do Nginx. Navegador: Chromium (Playwright). Usuários de teste: empresa, técnico, admin e sócio. Ambiente destruído e credenciais apagadas ao final.

| Bloco | Resultado |
|---|---|
| Carregamento (desktop 1280) | 37 telas dos 4 papéis abrem com o `h1` esperado, sem erro de JS e sem laço de requisições. Único 4xx: 403 em `/atuacao/documentos` até semear `documents.read`/`documents.approve` no ambiente de teste (permissão faltando no meu seed, não defeito) |
| A. Autenticação e navegação | VERIFICADO: login por papel (empresa, técnico, admin, sócio) cai na página certa; senha errada fica em `/login` com mensagem; rota logada sem sessão vai a `/login`; empresa em `/admin`, `/atuacao`, `/tecnico` é devolvida a `/dashboard-v2`; `/empresa/dashboard` responde 307 para `/dashboard-v2`; token expirado vai a `/login`; logout dos 4 papéis limpa a sessão e volta a `/`; `/esqueci-senha` envia e mostra o retorno |
| B. Telas com `set-state-in-effect` | VERIFICADO em formulários reais: simulado, equipamento de incêndio, EPI, meta da brigada e registro do fluxo de documentos mantêm o valor digitado após 2 s, sem piscar nem refazer requisições; os que gravaram devolveram 201 (equipamento, EPI, registro). Simulado e meta da brigada: o salvar ficou bloqueado pela validação do formulário (selects obrigatórios que o meu preenchimento genérico não escolheu), **não concluído** |
| C. Refs em render | VERIFICADO: `Dialogo` do admin e do sócio (abre como `dialog`, foco entra, Tab e Shift+Tab não escapam, Esc fecha, foco volta ao botão); CNPJ no `/cadastro` dispara a consulta (200) e não sobrescreve a razão social digitada; `/cadastro` envia e mostra o 409 de CNPJ/e-mail já cadastrado; `/planos` e `/tecnico/planos`: assinar não navega para pagamento, mostra "Erro interno" (a chave do Mercado Pago é falsa, 500 do backend `MPAuthenticationError`) e o botão volta a ficar utilizável |
| D. Uploads | VERIFICADO: onboarding de funcionários — escolher CSV, analisar (201), mapear, confirmar importação (201) e 1 funcionário gravado no banco de teste; modal de relatório de inspeção abre e aceita o PDF, mas o envio **não foi testado** (exige uma inspeção existente, que o seed não tem) |
| E. Parâmetros de URL | VERIFICADO: `/tecnico/configuracoes?google=conectado|erro|(vazio)` mostra a mensagem certa; recarregar mantém sessão e página; voltar vai para a página anterior |
| F. Visual (celular 390) | VERIFICADO sem estouro horizontal em 36 de 37 telas. **`/admin/documentos-fluxo` estoura 78 px**; não consegui isolar o elemento. A migração só alterou a lógica de `Dialogo.tsx` nessa pasta (sem CSS): sem relação aparente (INFERIDO) |

### Não verificado
- Envio de relatório de inspeção, CIPA (reuniões e treinamentos) e brigada com salvar completo.
- Pagamento real e provedores externos (IA, Resend, Google Calendar real).
- `FileInput` em todas as telas; imagem Docker e produção.
- Comparação visual com a versão anterior (Next 14): não rodei a linha base.
- Observação: no ambiente de teste, a empresa continua caindo em `/empresa/onboarding` ao logar (passos 2 e 3 pendentes). Comportamento anterior à migração (a regra de redirecionamento não foi alterada); abrir `/dashboard-v2` direto funciona.
