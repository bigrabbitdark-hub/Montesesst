# Painel da Evelyn — E1, E2 e E3 (relatório de entrega)

**Data:** 2026-11-01 · **Estado:** implementado e verificado no ensaio descartável; **não commitado, não em produção**.
**Base:** worktree `/opt/montese-work/painel-release` (HEAD `2ceb4f4` + D0/D3 não commitados). Migrations novas: **0102** (correções) e **0103** (checklists), depois da 0101 (carteira explícita, não commitada).

## Decisões do proprietário (2026-11-01)
- Danilo sai da equipe; sem backup dedicado; roteiro de desativação em `docs/operations/desativar-socio-danilo-2026-11-01.md` (NÃO executado: exige acesso ao banco de produção).
- Évelyn é a principal: elabora, revisa, aprova, assina e executa. **Separação de funções desligada** (`SEPARACAO_PADRAO` = false; modo estrito mantido em `SEPARACAO_ESTRITA`).
- E3: assumidas as opções recomendadas (só a Évelyn aprova modelos via `checklists.approve`; item obrigatório com `bloqueia envio` barra o envio à revisão; respostas guardadas com o documento; itens cadastrados por ela na tela; lista de serviços fechada, ver CHECK).

## O que foi entregue
- **E1** painel: filas "Aguardando minha revisão / assinatura / Prontos para entregar" com link para a lista filtrada (`?status=`).
- **E2** correções estruturadas (0102): "Devolver para correção" com descrição, responsável (sócio ativo) e prazo; correções do cliente ou internas; aberta → corrigida → verificada | cancelada; aprovar/assinar/publicar bloqueados com correção aberta ou não verificada; seção "Correções" no documento.
- **E3** checklists (0103): modelos globais versionados (rascunho → aprovado → substituído, imutáveis depois de aprovados, **nascem vazios**), instâncias por documento, respostas validadas por tipo (sim/não/NA, texto, número, data), completude, bloqueio no `enviar-revisao`; 3 permissões novas (`checklists.read|write|approve`, esta sensível; total 21); telas `/atuacao/checklists`, editor de versão e seção "Checklists" no documento; item no menu.

## Evidências (VERIFICADO no ensaio `montese_prodschema`, migrations 0102/0103 aplicadas só lá)
- e2e novos: `documento-correcoes-rls` 7/7, `checklists-rls` 7/7, `checklists.e2e` (HTTP) 5/5.
- e2e de regressão: `atuacao-documentos` 45/45, `atuacao-permissoes` 14/14, `socio-access-matrix` 13/13, `atuacao-painel` 16/16.
- Unit backend 2029/2031 (falhas conhecidas: `r2-get-object`, `tenant-context-callsites`); `tsc` ok.
- Frontend: vitest completo 1350 passando; 5 suítes de EPI não rodam por falta do `qrcode` no `node_modules` emprestado (ambiente, não código); `tsc` limpo nos arquivos tocados.

## NÃO VERIFICADO
- QA visual no navegador; revisão de segurança independente (`montese-seguranca`) da 0102/0103 (RLS, permissões novas); desempenho com muitos itens; fluxo com a conta real da Évelyn (matriz de documentos e registro profissional ainda por cadastrar).
- Migrations em produção: colisão de numeração com outras linhagens (0079 já duplicada) e ordem 0101 → 0102 → 0103.

## Pendências do proprietário
- Executar o roteiro de desativação do Danilo; conceder à Évelyn as 21 permissões (tela `/admin/permissoes-socios`) e as 5 ações na matriz dos tipos de documento; cadastrar/confirmar o registro profissional dela.
- Fornecer os itens dos checklists (ela cadastra na tela) e confirmar a lista de serviços.
- Autorizar: commit, revisão de segurança, backup/aplicação das migrations e release.
