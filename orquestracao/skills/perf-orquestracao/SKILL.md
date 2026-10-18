---
name: perf-orquestracao
description: Eficiência da orquestração de agentes no Montese SST. Use no agente orquestrador para dividir tarefas, delegar com briefings curtos, paralelizar com segurança e economizar contexto, tempo e custo.
---

# Performance da orquestração

## Princípio
O custo de um agente é contexto + tempo + tokens. Boa orquestração entrega o mesmo resultado com menos releitura e menos retrabalho.

## Regras
1. **Planeje antes de delegar.** Uma tarefa mal definida multiplica o desperdício por cada agente.
2. **Briefing autossuficiente e curto**: objetivo, arquivos já identificados, restrições (AGENTS.md), comando de validação, formato de retorno. O subagente não vê a conversa.
3. **Peça retorno resumido** (decisões, arquivos alterados, evidência, pendências), nunca o conteúdo de arquivos inteiros. Isso poupa o contexto do orquestrador.
4. **Não releia** o que um agente já mapeou: use o resumo dele. Releia só para verificar um ponto crítico.
5. **Paralelismo só sem conflito**: fatias que tocam arquivos/tabelas diferentes rodam juntas; mesmas pastas ou mesma migration, em série. Cada fatia paralela em **worktree própria** (o Orca faz isso) para não colidir.
6. **Limite de concorrência**: a VPS é uma só (RAM ~15 GB, também roda produção). Evite mais de 2–3 agentes que façam build/teste ao mesmo tempo.
7. **Modelo certo por tarefa**: planejamento, segurança e decisões de arquitetura no modelo mais forte; implementação mecânica no modelo mais rápido.
8. **Verifique por evidência**, não por confiança: comando rodado + resultado. Reprove retorno sem evidência em vez de "rodar de novo por precaução".
9. **Fatias pequenas e reversíveis**: falha barata, revisão rápida, nada de plano gigante.
10. **Aprendizado**: ao fim, registre em `docs/` (ou proponha ao proprietário) decisões duradouras, para o próximo agente não redescobrir.

## Ordem típica de uma funcionalidade
`planejador` → `banco-rls` (se houver schema) → `backend` ∥ `frontend` → `normativo-ia` (se houver) → `qa` → `seguranca` → `performance` (se houver risco) → relatório ao proprietário (sem commit).
