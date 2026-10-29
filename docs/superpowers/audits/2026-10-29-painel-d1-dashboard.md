# Painel do Danilo — D1 (dashboard com dados reais, vencimentos da carteira, menu) — relatório de entrega

**Data:** 2026-10-29 · **Estado:** implementado e verificado no ensaio descartável; **não commitado, não em produção**.
**Base:** worktree `/opt/montese-work/painel-release` sobre `2e3ec5f` (Z + A + B1). **Sem migration e sem permissão nova.** Somente leitura.

## 1. O que foi identificado (auditoria da Etapa 1)
- O dashboard tinha 5 blocos (tarefas, agenda, financeiro, documentos, clientes). Não havia vencimentos da carteira (vencidos/7/15/30), pendências prioritárias nem KPIs com link para lista filtrada.
- Já existiam e foram reaproveitados: `tasks`/`agenda_events`/`client_interactions`, fluxo documental 0096, `EmpresasService.vencimentos` (por empresa), `components/dashboard/*`, padrões de RLS do sócio (Z) e de auditoria.
- Financeiro: 3 rotas, todas GET com `finance.read`; nenhuma rota de escrita financeira acessível ao sócio (VERIFICADO por leitura + teste `socio-controller-sweep` que exige `finance.read` ⇒ GET).
- Lacunas fora do D1 (planejadas): visitas técnicas pelo sócio (RolesGuard nega hoje), Tabela 24, plano de ação (B2), emissão (C), integrações, notificações dentro do sistema, delegação (Évelyn é **sócia**, mesmo papel do Danilo: tarefas já aceitam responsável sócio), status "aguardando cliente/eficácia" (migration), solicitar documentos ao cliente.

## 2. O que foi criado
- **Backend** `backend/src/atuacao/painel/**`: `GET /atuacao/painel` (KPIs por bloco, agenda de hoje com `hoje_total`, ≤20 pendências, `indisponiveis[]`; cada bloco só com a permissão correspondente, isolado por savepoint) e `GET /atuacao/vencimentos?faixa=&tenantId=&page=` (carteira, 100/página, auditado como `company.accessed`).
- **Frontend**: `/atuacao` reescrito (KPIs linkados, Minha agenda, Pendências prioritárias, Financeiro); `/atuacao/vencimentos`; tarefas lê `?vencidas=true` e `?status=`; menu ganha "Vencimentos". Faixas 7/15/30 são **cumulativas** ("vencem em até N dias").
- Blocos antigos duplicados do painel foram removidos (a divisão de clientes por situação segue em `/atuacao/empresas`); testes antigos adaptados sem enfraquecer asserções (explicado no relatório da Task 2).

## 3. Evidências (VERIFICADO no ensaio `montese_prodschema`)
- Unit backend: 1981/1984 (falhas: `r2-get-object` e `tenant-context-callsites` esperadas; `epi-ficha-pdf` por tempo sob carga — 18/18 isolado na segunda execução; flake sem relação com o D1).
- `tsc` e `nest build`: ok. E2E (um por vez): atuacao-painel 15, empresas-rls 18, empresas 33, permissoes 14, documentos 45, financeiro 21, agenda 29, carteira 13, socio-access-matrix 13, tenant-isolation-sweep 10, pgr-matriz 82, pgr-avaliacoes 15, pgr-riscos 21, pgr-rls 53, auth 5.
- Frontend: vitest completo 1381 (91 arquivos), `tsc` ok, build ok; ESLint falha só pelo aviso antigo de `AdminBrand.tsx` (0 erros).
- Revisões independentes: backend aprovado (sem críticos/importantes), frontend aprovado com ressalvas menores — corrigidas (Financeiro linkado, `?status=blocked`, mensagem de documentos parcial, "Atualizando…", clamp de página, rejeição de `..` nos links).
- NÃO VERIFICADO: QA visual (desktop/tablet/celular), integração navegador↔backend reais, desempenho com carteira grande (contagem de empresas carrega todas em memória).

## 4. Pendências e próximos passos
- Decisões do proprietário: ver auditoria — status "aguardando cliente/avaliação técnica/execução/eficácia" (migration), fluxo "solicitar documentos ao cliente", permissão de visitas para o sócio, fonte oficial da Tabela 24, canal e frequência de alertas, regras de emissão/assinatura/retenção do PGR.
- Próximas fatias: D2 (atendimentos/tarefas/delegação), D3 (visitas), D4 (Tabela 24), D5 (B2 plano de ação), D6 (emissão), D7 (integrações) e notificações in-app.
- Commit/liberação: aguardam ordem expressa (o commit autorizado cobriu só o B1).
