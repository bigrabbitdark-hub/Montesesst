# GRO/PGR — insumos para o módulo de produto (resumo do material do proprietário)

> **Origem:** texto colado pelo proprietário em 2026-10-09 (seções 10–20 de um guia sobre NR-01, GRO e PGR). Este arquivo é um **resumo em palavras próprias**,
> não a transcrição. **Não é texto normativo e não é a fonte de nenhuma regra**: o que tem fundamento literal está nas regras `rascunho` de
> `backend/db/seed-data/normative-rules/gro-pgr.json` (cada ligação com o item da NR-01 e um fragmento literal conferido). Aqui ficam as ideias de
> **produto** (o módulo GRO/PGR), que dependem de projeto próprio (brainstorming → spec → plano) antes de qualquer código.
> Marcadores: VERIFICADO (conferido no texto da NR-01 de 26/05/2026) / NÃO VERIFICADO (afirmação do material sem item literal conferido).

## 1. Fluxo operacional sugerido (6 passos)
Caracterizar a organização → levantar perigos → avaliar riscos → classificar e priorizar → plano de ação → implementar e verificar.
Status: o encadeamento reflete o capítulo 1.5 da NR-01 (levantamento, avaliação, controle, plano de ação, acompanhamento) — **parcialmente VERIFICADO** nos itens
`1.5.4.x`, `1.5.5.x` e `1.5.7.x` (ver as regras do seed); a divisão exata em 6 passos é organização do material, NÃO VERIFICADO como texto da norma.

## 2. Identificação de perigos
O material pede que o inventário **não** use rótulos genéricos ("risco químico"): descrever o que pode causar dano, como o trabalhador é exposto e em que condições.
Grupos de investigação listados: físicos, químicos, biológicos, acidentes, ergonômicos, psicossociais relacionados ao trabalho. A tabela de exemplos e de
evidências possíveis é lista de investigação, **não classificação automática de risco**. NÃO VERIFICADO (exemplos e evidências são do material).

## 3. Registro de risco (conteúdo mínimo sugerido)
Perigo e fonte; evento perigoso/forma de exposição; lesões ou agravos possíveis; trabalhadores/funções/grupos expostos; medidas existentes; dados de exposição e
avaliações quando necessários; critérios de probabilidade e severidade; nível de risco e justificativa; medidas adicionais; responsável, prazo e verificação.
Princípio de produto: o resultado deve ser **reproduzível** (outro profissional entende evidências e critérios). A NR-01 não impõe matriz numérica única: a
ferramenta deve **guardar a metodologia da organização**. Conteúdo do inventário: VERIFICADO em parte (`1.5.7.3.x`, regra `PGR-INVENTARIO-CONTEUDO`); os campos de
metodologia/justificativa são sugestão do material.

## 4. Hierarquia de medidas
Eliminação → proteção coletiva → medidas administrativas/organização do trabalho → proteção individual; EPI não prova eliminação do risco e a **eficácia deve ser
verificada**. VERIFICADO a ordem de prioridade I–IV: **NR-01 item 1.4.1 alínea g** (regra `GRO-HIERARQUIA-MEDIDAS`) e *quando* adotar medidas: `1.5.5.1.1`
(regra `GRO-MEDIDAS-QUANDO-ADOTAR`). A frase "EPI não é prova automática de eliminação" é interpretação do material (NÃO VERIFICADO como item literal).

## 5. Plano de ação (campos sugeridos)
Risco relacionado e justificativa da prioridade; medida e resultado esperado; responsável pela execução e pelo acompanhamento; prazo, recursos, situação;
evidência de conclusão; indicador de eficácia e critério de aceitação; risco residual; data da verificação. Exemplos ilustrativos (máquina com ponto de
esmagamento, ruído sem avaliação representativa, armazenamento de químico, trabalho em altura, sobrecarga de tarefas) vinculam problema → medida → evidência;
**não substituem inspeção nem avaliação técnica**. Conteúdo mínimo do plano: VERIFICADO em parte (`1.5.5.2.x`, regra `PGR-PLANO-ACAO-CONTEUDO`).

## 6. Fatores de risco psicossociais (cap. 1.5, vigência 26/05/2026)
O material descreve fatores de organização do trabalho (demandas excessivas, pouca autonomia, jornada/turnos, violência e assédio, falta de apoio) e adverte:
avaliação **contextualizada**, sem diagnosticar transtornos por questionário genérico e sem concluir doença a partir de um fator. VERIFICADO: a expressão
"fatores de risco psicossociais relacionados ao trabalho" aparece em 3 pontos do texto vigente (itens `1.5.3.1.4`, `1.5.3.2.1`, `1.5.4.4.5.3`; regras
`GRO-PSICOSSOCIAL-*`). Os exemplos de fatores e a advertência sobre questionários vêm do material/Guia 2025 — NÃO VERIFICADO neste repositório (o Guia e o Manual
não foram ingeridos).

## 7. Inventário (estrutura de dados sugerida)
Empresa/estabelecimento; processo e atividade; setor e função; perigo; possível agravo; exposição; trabalhadores expostos; controles existentes; avaliação
(método, evidências, probabilidade, severidade, nível); classificação; medidas adicionais; referência normativa (NR, item, anexo, **versão**); rastreabilidade
(responsável, data, documentos, histórico). O PGR pode ser implementado por estabelecimento, unidade, setor ou atividade. Um PGR antigo **não** prova que o
inventário descreve o ambiente atual.

## 8. Revisão e alertas
Revisão da avaliação, em regra, a cada **2 anos**; até **3 anos** com certificação em sistema de gestão de SST — VERIFICADO (`1.5.4.4.6` e `1.5.4.4.6.1`, regra
`GRO-REVISAO-AVALIACAO`). Alertas sugeridos: mudanças em máquinas/processos/organização; medidas inadequadas ou ineficazes; acidentes e doenças; mudança de
requisitos legais; ações vencidas; inventário em desacordo com as condições atuais. A lista de gatilhos do material é sugestão de produto (cruzar com o item
literal antes de virar regra de alerta). O prazo de revisão **não** dispensa o acompanhamento contínuo do plano.

## 9. Exceções
O alerta de descumprimento só pode sair depois de verificar dispensas: MEI dispensado de elaborar o PGR (`1.8.1`, ressalva do contratante em `1.8.1.1`); hipóteses
para ME e EPP (`1.8.x`) — VERIFICADO nas regras `PGR-DISPENSA-MEI` e `PGR-DISPENSA-ME-EPP`. A dispensa do PGR **não** dispensa as demais obrigações de SST.
Verificar: enquadramento e grau de risco, existência de empregados, condições e declarações da dispensa, obrigações específicas da atividade.

## 10. Escopo funcional sugerido para o módulo (projeto de produto)
Cadastro organizacional; identificação de perigos; avaliação com metodologia configurável; inventário versionado; plano de ação com evidências e eficácia;
monitoramento e alertas; auditoria assistida por IA (comparar documentos, achar lacunas, citar o fundamento exato); validação e assinatura pelo profissional
competente. **O que já existe** (VERIFICADO em 2026-10-09): a tabela `action_plans` (`backend/db/migrations/0010_inspections.sql:59`; colunas `id`, `tenant_id`,
`inspection_id`, `checklist_item_id`, `description`, `deadline`, `responsible`, `status` `'pendente'|'resolvido'`, `created_at`; com RLS/FORCE RLS por tenant),
ligada às inspeções e usada em `src/inspections/inspections.service.ts`, `src/dashboard/dashboard.service.ts`, `src/overview/overview.service.ts` e
`src/inspections/inspection-pdf.util.ts`. O futuro plano de ação do módulo GRO/PGR deve **partir dessa tabela e desse fluxo** (AGENTS.md: não duplicar
funcionalidade), estendendo-os em vez de criar outro. **O que não existe:** tabelas/módulo de inventário de riscos (identificação de perigos, avaliação,
inventário versionado); fora disso, GRO/PGR aparecem só na auditoria de documentos enviados e no Assistente. É um projeto próprio; não faz parte desta entrega
da base normativa.

## 11. Regra central proposta para o Assistente (princípio, não norma)
"Nunca concluir que uma empresa está regular apenas porque possui um PGR": verificar se o inventário representa as condições reais, se a avaliação segue critérios
pertinentes, se as medidas foram implementadas e se a eficácia é acompanhada; **sem evidência, indicar a pendência e o que verificar, sem inventar medições nem
conclusões**. Isto é um princípio de comportamento do Assistente (candidato a `docs/assistente-montese-principios.md`); **não** altera prompt, provider ou modelo
nesta entrega (AGENTS.md exige autorização).

## 12. Fontes oficiais citadas (todas orientação ou norma — conferir antes de ingerir)
NR-01 vigente a partir de 26/05/2026 (PDF `…/normas-regulamentadoras-vigentes/nr-01-atualizada-2025-i-3.pdf`, VERIFICADO 200/PDF em 2026-10-09); Manual de
Interpretação e Aplicação do Cap. 1.5 (2026); Perguntas e Respostas do Cap. 1.5 (maio/2026); Guia de Fatores de Riscos Psicossociais (2025); portal do PGR;
Fundacentro (NHOs); documentação técnica do eSocial. Manual, P&R e Guia são **orientações, não norma**: entram como fontes inativas até existir o tipo de fonte
(`docs/superpowers/specs/2026-10-08-catalogo-fontes-por-tipo-e-tema-design.md`, E2). Afirmações do material sobre datas ("vigência a partir de 26 de maio de
2026", "modificação da NR-09 em janeiro de 2026") só valem com a página/texto oficial: a de 26/05/2026 foi VERIFICADA; a da NR-09 não foi conferida aqui.
