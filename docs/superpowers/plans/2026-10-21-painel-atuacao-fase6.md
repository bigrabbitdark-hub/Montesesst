# Painel de Atuação — Fase 6 (homologação em navegador real) — Plano

**Objetivo:** provar, com backend + frontend + banco rodando juntos, que cada perfil acessa só o que lhe compete e que os critérios de aceite AC-01 a AC-15 da spec valem de ponta a ponta — sem tocar em produção.

**Autorização do proprietário (2026-10-21):** "autorizado, prossiga" para montar o ambiente de homologação. **Escopo executado:** 4 containers `socio_hom_*` na rede descartável `socio_ensaio` (sem publicar porta), banco novo `montese_hom` no Postgres descartável, segredos de teste aleatórios fora do repositório. **Não tocado:** `montese_*` (produção), Nginx/TLS/DNS/backups/secrets reais, `.env`.

## Ambiente (VERIFICADO)
Scripts em `docs/superpowers/homologacao/` (`hom-up.sh`, `hom-run.sh`, `hom-sql.sh`, `hom-down.sh`, `README.md`). Cinco contas de TESTE (`@teste.invalid`): `admin.hom`, `socio.a.hom`, `socio.b.hom`, `empresa.hom`, `tecnico.hom`. Dados fictícios: Cliente Montese HOM A (em dia), HOM B (último pagamento rejeitado há 5 dias), Empresa de Parceiro HOM (vinculada ao técnico; fora da carteira). Matriz de TESTE só para `pgr` (A: elaborar+revisar; B: revisar+aprovar+assinar+publicar); `laudo` sem matriz de propósito; registros profissionais FICTÍCIOS `TESTE/0001` e `TESTE/0002` confirmados.

## Regras para quem executa
- Somente `hom-run.sh` (jornadas Playwright) e `hom-sql.sh` (leitura). Nenhum outro docker; nada de `montese_*`; nada de `.env`.
- **Não corrigir código do produto**: achados viram relatório (arquivo, passos, esperado × obtido, evidência); correções são tarefas separadas, revisadas.
- Capturas em `$HOM_SHOTS`; **nenhuma senha** em log/captura/relatório; as senhas de teste vêm do ambiente do processo.
- Dados profissionais: apenas os fictícios semeados.
- Cada jornada afirma o RESULTADO (dado correto exibido / ação realmente impedida no banco), não só "a página abriu".

## Jornadas (mapeadas aos critérios de aceite)
| # | Critério | Jornada |
|---|---|---|
| J1 | AC-01, AC-02 | Sócio A e B: login pela interface abre `/atuacao` com o menu esperado; sem links de administração |
| J2 | AC-03, AC-09 | `/atuacao/clientes` lista HOM A e HOM B e **não** a empresa de parceiro; busca e filtro funcionam |
| J3 | AC-05 | Ficha: editar setor e contato grava (conferir no banco); CNPJ/razão/plano/situação só como texto; PATCH direto com `cnpj`/`plan` ⇒ 400 e dado intacto |
| J4 | AC-04 | Tarefas: A cria tarefa para B; B vê em "Minhas tarefas"; transições válidas; bloquear sem motivo é recusado; histórico em ordem |
| J5 | agenda/interações | Criar compromisso e registro de contato; aparecem na ficha/agenda; encerrar/cancelar com motivo |
| J6 | AC-06, AC-15 | Financeiro: KPIs e lista **batem com o banco** (MRR, clientes ativos, pendência de HOM B com dias de atraso); parceiro ausente; "Somente consulta"; sem botão de ação financeira |
| J7 | AC-07, AC-13 | Com token do sócio, por chamada direta à API: `PATCH /plans/:id`, `PATCH /subscriptions/:id/status`, `POST /subscriptions`, `GET /admin/dashboard/financeiro` ⇒ 403; preço/assinatura **intactos no banco**; existem linhas `role.denied` em `audit_log` |
| J8 | AC-08 | Documentos `pgr`: A cria rascunho e envia versão (PDF pequeno válido); A tenta aprovar ⇒ recusado (elaborador); B aprova, assina ("Registrar assinatura interna" + aviso exato), publica; o documento **aparece para a empresa** (`empresa.hom`) em sua área de documentos; `laudo` ⇒ bloqueio por matriz com a mensagem do servidor; nova versão após aprovar invalida a assinatura; conferir hash, eventos e linha em `documents` no banco; nenhum texto "assinatura digital"/"ICP-Brasil" fora do aviso |
| J9 | AC-10, AC-09 | Empresa: login cai na área da empresa, só vê o próprio tenant, `/atuacao` e `/admin` redirecionam; Técnico: vê só a empresa de parceiro, nunca os clientes Montese; `/atuacao` redireciona |
| J10 | AC-11 | Admin: login vai ao `/admin/overview`; telas existentes abrem; `/admin/documentos-fluxo` mostra `pgr` "Viável" e `laudo` "Não configurada"; admin **não** acessa rotas do fluxo do sócio (403) |
| J11 | AC-12 | `audit_log` tem as ações relevantes (`permission.denied`, `role.denied`, `document_draft.*`, `client.update_operational`, `finance.viewed`) sem texto livre e sem número de registro |
| J12 | AC-14 | Regressão mínima de telas existentes (`/empresa/*` principais, `/tecnico/empresas`, `/admin/overview`) abrem sem erro de console |
| J13 | acessibilidade/mobile | Captura em 375×812 e 1280×800 das telas novas; sem rolagem horizontal; foco visível no teclado nos diálogos |

## Saída esperada
Relatório `docs/superpowers/audits/2026-10-21-painel-atuacao-fase6-homologacao.md` com: tabela AC-01…AC-15 (PASSOU / FALHOU / NÃO VERIFICADO e evidência), achados por severidade, capturas citadas por caminho, limitações do ambiente. **Nenhum AC é marcado PASSOU sem evidência executada.**

## Limitações assumidas (declarar no relatório)
`NODE_ENV=development`; sem TLS; stub S3 em memória (não R2 real); sem e-mail/IA/Mercado Pago reais; Chromium de uma versão; dados fictícios; não substitui validação com os usuários reais.
