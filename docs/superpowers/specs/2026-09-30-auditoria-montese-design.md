# Auditoria Montese — Especificação de Design

**Status:** proposta para revisão do usuário  
**Data:** 2026-09-30

## Objetivo

Renomear a experiência Pente-Fino para Auditoria Montese e evoluir o relatório existente para comunicar cruzamentos e evidências com rastreabilidade. A mesma auditoria deve poder ser iniciada tanto pela página própria quanto pela página do Assistente, sem manter dois motores nem transformar o chat normativo em autoridade de auditoria.

## Contexto atual

- `POST /pente-fino/run` usa `PenteFinoComparisonService` e as extrações persistidas por tenant.
- Há cruzamentos de função/risco do PGR com função/exame do PCMSO, checklist documental e cobertura de agentes entre LIP e LTCAT.
- As evidências estruturadas incluem trechos, mas não número de página. Agentes de LIP/LTCAT podem ter valor quantitativo bruto; os riscos do PGR não são fatos quantitativos normalizados.
- A tela atual é acionada manualmente. Os resultados da execução não são persistidos.
- O Assistente aceita pergunta normativa e anexo pontual; não oferece uma execução de auditoria compartilhada.

## Abordagem

Evoluir o serviço e o contrato atuais numa fatia vertical. A camada de comparação produz achados tipados; página e Assistente chamam o mesmo fluxo e exibem esses achados. Não criar nesta fase um grafo canônico, nova persistência de relatórios, novo provider de IA ou motor normativo.

## Escopo funcional

1. Renomear os rótulos visíveis de Pente-Fino para **Auditoria Montese** nas entradas e telas relacionadas, incluindo a área técnica quando ela apresenta essa funcionalidade.
2. Preservar `/empresa/pente-fino` e `/pente-fino/run`, evitando quebra de links e integração existentes.
3. Expandir o relatório para classificar resultados sustentados pelos dados disponíveis: lacuna de correspondência função/risco/exame; cobertura de agente presente em somente um entre LIP e LTCAT, como item a confirmar; e divergência quantitativa a esclarecer quando o mesmo agente normalizado tiver valores e unidades comparáveis.
4. Representar cada achado com tipo, estado, resumo, confiança, documentos relacionados, trechos disponíveis, o que não pode ser concluído e verificação recomendada. A página de origem é informada somente quando disponível na extração; nesta fase, em geral, será marcada como não capturada.
5. Distinguir `inconsistência`, `evidência insuficiente` e `a confirmar`. Ausência de arquivo do conjunto recebido significa “não localizado nos documentos disponíveis”, nunca prova de inexistência. Dados não extraídos significam “não capturados”.
6. Adicionar à página do Assistente uma ação manual **Executar Auditoria Montese**. Ela mostra o resumo/achados na própria página e oferece acesso à página completa. A auditoria não é executada ao carregar a página e não é convertida em resposta conversacional nesta fase.

## Limites e linguagem

- A cobertura inicial fica limitada às extrações existentes de PGR, PCMSO, LTCAT e LIP e ao catálogo de funções da empresa.
- A comparação numérica usa somente valores e unidades que possam ser normalizados com segurança. Uma diferença é “a esclarecer”; não é automaticamente erro ou não conformidade. Não inventar tolerância, método, período, calibração ou página.
- Cobertura de agente em somente um documento é uma lacuna a verificar, não contradição por si só. Confiança é determinística: alta quando ambos os lados têm evidência direta e entidade/unidade comparáveis; média quando a evidência direta sustenta apenas uma lacuna de cobertura; baixa somente para possibilidade inferida, sempre rotulada como tal e nunca como NC.
- Os achados de agente devem manter seu `source_excerpt` também na leitura do cache, e não apenas logo após uma extração nova.
- Os extratores atuais não oferecem medição quantitativa estruturada do PGR nem evidências completas de entrega, uso e eficácia de EPI. Esses cruzamentos não podem ser afirmados nesta entrega.
- O relatório não emitirá NC legal automática, conclusão clínica/previdenciária, risco inferido de atividade, ou prioridade normativa. Regras oficiais versionadas, eSocial/PPP, plano de ação, atividades e grafo canônico são fases posteriores.
- A confiança, se exibida, deve refletir a evidência documental disponível e ser determinística; inferências devem aparecer explicitamente como inferências. Não usar confiança para disfarçar ausência de evidência.

## Segurança e falhas

- Manter autenticação, verificação de vínculo técnico/parceiro e `TenantContext` oriundo do JWT conforme o fluxo existente. `tenant_id` alvo não pode se tornar contexto RLS.
- Respeitar RLS/FORCE RLS e não consultar documentos de outros tenants.
- Reutilizar limite de execução e tratamento de falha existentes; exibir estados de carregamento, limite, falha e avisos sem converter falha de extração em achado factual.
- Não incluir PII ou dados clínicos individuais desnecessários no relatório ou no contexto enviado ao modelo. Esta etapa não altera provider/modelo.

## Validação e critérios de aceite

- Testes unitários cobrem normalização/comparação de valor e unidade, impossibilidade de comparação, classificações e ausência de conclusões quando a evidência não sustenta o achado.
- Testes de integração cobrem a execução compartilhada pela página e Assistente, autorização/vínculo e isolamento por tenant.
- Verificação frontend cobre rótulos renomeados, disparo manual, estados de erro/limite e apresentação de evidências/avisos sem páginas inventadas.
- O relatório preserva compatibilidade do endpoint e deixa explícito quais documentos foram analisados e quais evidências não foram capturadas.
- Nenhum achado é chamado de não conformidade normativa sem regra aplicável verificada e cadeia de evidência suficiente.

## Não objetivos desta fase

Grafo SST persistente, modelo canônico abrangente, histórico de auditorias, extração de todos os fatos descritos no briefing, regras normativas temporais, consulta nova ao RAG oficial, PPP/eSocial, leitura de anexos novos na auditoria, edição/correção de documentos e priorização P1/P2/P3.