# Base de Conhecimento SST — Checklist de Documentação (referência para schema, Montese SST)

> **Origem:** anexado pelo fundador em 2026-09-16, derivado da planilha
> interna "Super Checklist Documentação SST — 26/05/2026" já usada pela
> Montese. Preservado aqui como referência — mesmo papel que
> `docs/reference/modelos-relatorios-sst.md` e
> `docs/reference/catalogo-epi-nr06.md` já cumprem para outros
> sub-projetos. **Não implementar nada a partir deste documento sem
> passar pelo ciclo de brainstorm → spec → plano.**

> **Ressalva importante do próprio material, repetida aqui para não se
> perder:** os valores de multa e as referências normativas registrados
> abaixo são os valores/parâmetros do arquivo original — não devem ser
> tratados como automaticamente vigentes. Antes de produção, validar
> contra as NRs e atos oficiais atualmente vigentes. Este documento é a
> curadoria/interpretação interna da Montese, não o texto oficial da
> norma.

## Uso pretendido

Fonte para popular uma tabela de referência (`sst_checklist_items` ou
nome equivalente definido na spec) usada pelo Assistente MonteseSST como
uma 4ª fonte de citação, distinta das normas oficiais já indexadas
(`normative_documents`) — ver
`docs/specs/checklist-sst-conhecimento-assistente.md` (spec formal desta
integração) para o desenho completo.

## Finalidade
Base estruturada a partir da planilha **Super Checklist Documentação SST — 26/05/2026**. Contém os requisitos, documentos, descrições, referências legais, níveis de infração, critérios de conformidade e parâmetros de cálculo de multas existentes na planilha. Use como base de conhecimento do Montese SST, mas **não trate os valores de multas nem referências normativas como automaticamente vigentes**: antes de produção, validar contra as NRs e atos oficiais atualmente vigentes.
## Regras de uso do checklist
- **C (Conforme):** documento existe e está atualizado.
- **NC (Não Conforme):** documento obrigatório ausente ou irregular.
- **NA (Não Aplicável):** requisito/documento não se aplica à realidade da empresa.
- Ao marcar **NA**, registrar justificativa técnica.
- Para **NC**, registrar ação, responsável e prazo, formando um plano de ação.
- A documentação de SST é dinâmica; a planilha recomenda revisão semestral ou sempre que houver mudança relevante no processo ou na legislação.
- O material é uma ferramenta de apoio e não substitui a leitura das Normas Regulamentadoras.
- A planilha permite adicionar documentos extras abaixo dos itens de cada NR.
## Dados esperados para caracterizar a empresa/estabelecimento
Razão social; nome comercial; atividade principal; dados do grupo empresarial; responsável legal/diretor; efetivo SESMT; coordenador do SESMT; técnico de segurança do trabalho; enfermeiro/técnico de enfermagem; engenheiro de segurança; CNAE; grau de risco; número de colaboradores; número de unidades; endereço; CEP; cidade; estado; telefone; CNPJ; mês/ano; data de envio.
## Campos recomendados por item
Documento necessário; descrição; requisito legal; número da infração; status C/NC/NA; ação; justificativa; valor de multa calculado; responsável; data de início; prazo final; status da ação.
## Parâmetros de multa presentes na planilha
A aba Apoio usa faixas de empregados e índices de infração. Os valores abaixo são os valores-base registrados na planilha, antes da aplicação do fator UFIR mostrado no Dashboard de Multas.

| Empregados (mín.) | Empregados (máx.) | i1 | i2 | i3 | i4 |
|---:|---:|---:|---:|---:|---:|
| 0 | 10 | 729 | 1393 | 2091 | 2792 |
| 11 | 25 | 830 | 1664 | 2495 | 3334 |
| 26 | 50 | 936 | 1935 | 2898 | 3876 |
| 51 | 100 | 1104 | 2200 | 3302 | 4418 |
| 101 | 250 | 1241 | 2471 | 3717 | 4948 |
| 251 | 500 | 1374 | 2748 | 4121 | 5490 |
| 501 | 1000 | 1507 | 3020 | 4525 | 6033 |
| 1001 | 999999 | 1646 | 3284 | 4929 | 6304 |

**Índice de infração:** 1, 2, 3 ou 4. A planilha também apresenta valor de UFIR de exemplo `1,0641` no Dashboard de Multas. O Montese deve tratar esse parâmetro como configurável e validar oficialmente o cálculo antes de exibir multa atual ao cliente.

# NR 01 DISPOSIÇÕES GERAIS E GRO (Geral)
**Total de multas registrado no estado da planilha:** 11728.5102
### Itens
#### Ordens de serviço
- **Descrição:** Instruções aos trabalhadores sobre os riscos da sua funão e as precauções para evitar acidentes e doenças.
- **Requisito legal:** 1.4.1, alínea "c"."Cabe ao empregador: elaborar ordens de serviço sobre segurança e saúde no trabalho, dando ciência aos trabalhadores;"
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Inventário de perigos e riscos
- **Descrição:** Levantamento detalhado que identifica todos os perigos no ambiente de trabalho, avalia a probabilidade e a severidade de possíveis danos e classifica o nível de risco de cada atividade
- **Requisito legal:** 1.5.7.1, alínea "a". "O PGR deve conter, no mínimo, os seguintes documentos: inventário de riscos;". Item 1.5.7.3.1: "Os dados da identificação dos perigos e das avaliações dos riscos ocupacionais devem ser consolidados em um inventário de riscos ocupacionais."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Justificativa:** Fazer a justificativa
- **Valor de multa registrado:** -
#### Plano de ação do PGR
- **Descrição:** Indica as medidas de prevenção a serem introduzidas, aprimoradas ou mantidas, com prazo e responsáveis.
- **Requisito legal:** Item 1.5.7.1: "O PGR deve conter, no mínimo, os seguintes documentos: [...] b) plano de ação."   Item 1.5.5.2.1: "A organização deve elaborar plano de ação, indicando as medidas de prevenção a serem introduzidas, aprimoradas ou mantidas, conforme o subitem 1.5.4.4.3."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
#### Análise de acidentes e adoecimentos (incluir eventos perigosos)
- **Descrição:** Processo de identificação das causas raízes de ocorrências indesejadas no ambiente de trabalho.
- **Requisito legal:** Item 1.5.5.5.1: "A organização deve analisar os acidentes e as doenças relacionadas ao trabalho."   Item 1.5.5.5.1.1: "Deve ser realizada a análise de eventos perigosos que poderiam ter consequências graves."   Item 1.5.5.5.2: "As análises de acidentes e doenças relacionadas ao trabalho devem ser documentadas..."
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
#### Plano de resposta a emergência
- **Descrição:** Conjunto de diretrizes e ações detalhadas que uma organização estabelece para lidar com situações inesperadas e perigosas (como incêndios, desastres naturais ou acidentes),
- **Requisito legal:** Item 1.5.6.1: "A organização deve estabelecer, implementar e manter procedimentos de resposta a emergências, de acordo com os riscos, as características e as circunstâncias das atividades."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
#### Comprovação dos treinamentos das NRs
- **Descrição:** Conjunto de evidências documentais que atesta que um trabalhador recebeu a capacitação necessária para exercer suas funções com segurança.
- **Requisito legal:** Item 1.7.1.1: "Ao término dos treinamentos inicial, periódico ou eventual, previstos nas NR, deve ser emitido certificado contendo o nome e assinatura do trabalhador, conteúdo programático, carga horária, data, local de realização do treinamento, nome e qualificação dos instrutores e assinatura do responsável técnico do treinamento."
- **Infração:** 1
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Justificativa:** Fazer a justificativa
- **Valor de multa registrado:** -
#### Projeto pedagógico (no caso de treinamentos na modalidade de ensino a distância ou semipresencial)
- **Descrição:** Define a concepção, a estrutura e a metodologia de uma ação educativa.
- **Requisito legal:** Item 3.1 (Anexo II): "Sempre que a modalidade de ensino a distância ou semipresencial for utilizada, será obrigatória a elaboração de projeto pedagógico..."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Fazer a justificativa
- **Valor de multa registrado:** -

# NR 02 INSPEÇÃO PRÉVIA (REVOGADA) (Geral)
### Itens
#### A NR-02 foi revogada
- **Infração:** False
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não

# NR 03 EMBARGO OU INTERDIÇÃO (Geral)
**Total de multas registrado no estado da planilha:** 0
### Itens
#### Livro de inspeção (Elit)
- **Descrição:** Documento obrigatório (substituído pelo eletrônico, eLIT, no Domicílio Eletrônico Trabalhista - DET) onde Auditores Fiscais do Trabalho registram suas visitas, a data, os problemas encontrados (irregularidades) e os prazos para correção.
- **Requisito legal:** Item 3.5.3: "A imposição de embargo ou interdição não elide a lavratura de autos de infração por descumprimento das normas de segurança e saúde no trabalho ou dos demais dispositivos da legislação trabalhista relacionados à situação analisada.
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro de multas ou embargos
- **Descrição:** Notificação formal (auto de infração) emitida pelo Auditor Fiscal quando detecta uma infração grave à legislação trabalhista.
- **Requisito legal:** Item 3.2.2: "Embargo e interdição são medidas de urgência adotadas a partir da constatação de condição ou situação de trabalho que caracterize grave e iminente risco ao trabalhador."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PENDENTE
#### Plano de ação para correção de não conformidades
- **Descrição:** Documento que detalha as etapas, recursos, responsáveis e prazos para sanar as irregularidades apontadas pelo Auditor Fiscal (ou identificadas internamente) e evitar reincidências.
- **Requisito legal:** Item 3.5.4: "Durante a vigência de embargo ou interdição, podem ser desenvolvidas atividades necessárias à correção da situação de grave e iminente risco, desde que garantidas condições de segurança e saúde aos trabalhadores envolvidos.
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 04 SESMT (Geral)
**Total de multas registrado no estado da planilha:** 0
### Itens
#### Cartão de CNPJ com CNAE
- **Descrição:** Comprova a existência jurídica da empresa e identifica sua atividade principal e secundária. O CNAE é fundamental para determinar o Grau de Risco, que define o dimensionamento do SESMT.
- **Requisito legal:** 4.5.1 O dimensionamento do SESMT vincula-se ao número de empregados da organização e ao maior grau de risco entre a atividade econômica principal e atividade econômica preponderante no estabelecimento, nos termos dos Anexos I e II, observadas as exceções previstas nesta NR.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Memória de cálculo do dimensionamento
- **Descrição:** Documento que detalha o passo a passo lógico (cruzamento do Grau de Risco com o número de funcionários) utilizado para definir a quantidade necessária de profissionais do SESMT.
- **Requisito legal:** 4.5.1 O dimensionamento do SESMT vincula-se ao número de empregados da organização e ao maior grau de risco entre a atividade econômica principal e atividade econômica preponderante no estabelecimento, nos termos dos Anexos I e II, observadas as exceções previstas nesta NR.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Lista dos integrantes do SESMT
- **Descrição:** Relação nominal de todos os profissionais da equipe, especificando o cargo, o tipo de vínculo empregatício e o número de matrícula para fins de fiscalização e gestão interna.
- **Requisito legal:** 4.6.1.1 A organização deve informar e manter atualizados os seguintes dados: a) número de Cadastro de Pessoa Física - CPF dos profissionais integrantes do SESMT; b) qualificação e número de registro dos profissionais; c) grau de risco estabelecido, conforme item 4.5.1 e seus subitens e o número de trabalhadores atendidos, por estabelecimento; e d) horário de trabalho dos profissionais do SESMT.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovação de Formação
- **Descrição:** Cópias de diplomas ou certificados que atestam a especialização dos profissionais (Engenheiro de Segurança, Médico do Trabalho, Técnico de Segurança, etc.).
- **Requisito legal:** 4.3.3 Os profissionais integrantes do SESMT devem possuir formação e registro profissional em conformidade com o disposto na regulamentação da profissão e nos instrumentos normativos emitidos pelo respectivo conselho profissional, quando existente
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro profissional
- **Descrição:** Comprovação de que o profissional está ativo em seu conselho de classe (como CREA, CRM ou COREN) ou possui o registro de Técnico de Segurança do Trabalho junto ao Ministério do Trabalho.
- **Requisito legal:** 4.3.3 Os profissionais integrantes do SESMT devem possuir formação e registro profissional em conformidade com o disposto na regulamentação da profissão e nos instrumentos normativos emitidos pelo respectivo conselho profissional, quando existente
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PROGRAMADA
#### Registro via Portal Gov.br
- **Descrição:** Comprovante de que o SESMT foi formalmente declarado ao Governo Federal por meio do sistema eletrônico oficial, conforme exigido pela legislação vigente.
- **Requisito legal:** 4.6.1 A organização deve registrar os SESMT de que trata esta NR por meio de sistema eletrônico disponível no portal gov.br
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registros de acidentes ou adoecimentos
- **Descrição:** Arquivo de dados brutos sobre ocorrências de acidentes do trabalho e doenças ocupacionais, servindo de base para o histórico de saúde do trabalhador.
- **Requisito legal:** 4.3.1 Compete aos SESMT: [...] j) compartilhar informações relevantes para a prevenção de acidentes e de doenças relacionadas ao trabalho com outros SESMT de uma mesma organização, assim como a CIPA, quando por esta solicitado; e
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PENDENTE
#### Estatística mensal
- **Descrição:** Compilação de dados mensais sobre acidentes (com e sem afastamento) e doenças, incluindo o cálculo de taxas de frequência e gravidade exigidos pela NR-4.
- **Requisito legal:** 4.3.1 Compete aos SESMT: [...] d) elaborar plano de trabalho e monitorar metas, indicadores e resultados de segurança e saúde no trabalho;
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Acordo ou convenção coletiva
- **Descrição:** Documentos sindicais que podem conter cláusulas específicas sobre segurança e saúde, que a empresa é obrigada a cumprir além das Normas Regulamentadoras.
- **Requisito legal:** 4.3.5 O técnico de segurança do trabalho e o auxiliar/técnico de enfermagem do trabalho devem dedicar quarenta e quatro horas por semana para as atividades do SESMT, de acordo com o estabelecido no Anexo II, observadas as disposições, inclusive relativas à duração do trabalho, de legislação pertinente, de acordo ou de convenção coletiva de trabalho.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de Trabalho
- **Descrição:** Documento estratégico que descreve as metas, ações, cronogramas e responsabilidades do SESMT para o ano vigente, visando a prevenção de riscos.
- **Requisito legal:** 4.3.1 Compete aos SESMT: [...] d) elaborar plano de trabalho e monitorar metas, indicadores e resultados de segurança e saúde no trabalho;
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Investigação de acidentes e doenças
- **Descrição:** Relatórios detalhados que analisam as causas raízes de cada ocorrência e propõem medidas corretivas e preventivas para evitar a repetição do evento.
- **Requisito legal:** 4.3.1 Compete aos SESMT: [...] i) conduzir ou acompanhar as investigações dos acidentes e das doenças relacionadas ao trabalho, em conformidade com o previsto no PGR;
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 05 CIPA (GERAL)
**Total de multas registrado no estado da planilha:** 7027.3164
### Itens
#### Acordo ou Convenção Coletiva
- **Descrição:** Documento firmado entre sindicatos que pode conter cláusulas específicas sobre a CIPA, como garantias extras aos cipeiros ou exigências de dimensionamento superiores ao que prevê a NR-5.
- **Requisito legal:** Item 5.4.13: Quando o estabelecimento não se enquadrar no Quadro I e não for atendido por SESMT, nos termos da NR 04, a organização nomeará um representante da organização dentre seus empregados para auxiliar na execução das ações de prevenção em segurança e saúde no trabalho, podendo ser adotados mecanismos de participação dos empregados, por meio de negociação coletiva.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Memória de cálculo do dimensionamento
- **Descrição:** Registro que justifica o número de membros (titulares e suplentes) da CIPA, baseado no cruzamento do CNAE da empresa (Quadro I da NR-4) com o número de empregados do estabelecimento (Quadro I da NR-5).
- **Requisito legal:** Item 5.4.1: A CIPA será constituída por estabelecimento e composta de representantes da organização e dos empregados, de acordo com o dimensionamento previsto no Quadro I desta NR, ressalvadas as disposições para setores econômicos específicos.
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
#### Documentação do processo eleitoral
- **Descrição:** Conjunto de registros que inclui o edital de convocação, a constituição da comissão eleitoral, as fichas de inscrição de candidatos e a lista de votantes, comprovando a transparência da eleição.
- **Requisito legal:** Item 5.4.9: Quando solicitada, a organização encaminhará a documentação referente ao processo eleitoral da CIPA, podendo ser em meio eletrônico, ao sindicato dos trabalhadores da categoria preponderante, no prazo de até 10 (dez) dias.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Atas de eleição e de posse
- **Descrição:** Documentos oficiais que formalizam o resultado da votação (apurado em ata de eleição) e a entrada oficial dos membros eleitos e indicados em seus respectivos cargos (ata de posse).
- **Requisito legal:** Item 5.4.8: A organização deve fornecer cópias das atas de eleição e posse aos membros titulares e suplentes da CIPA.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Calendário anual de reuniões
- **Descrição:** Cronograma com as datas, horários e locais das reuniões ordinárias previstas para todo o mandato. Deve ser fixado em local visível ou disponibilizado aos trabalhadores.
- **Requisito legal:** Item 5.6.1: A CIPA terá reuniões ordinárias mensais, de acordo com o calendário preestabelecido.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PENDENTE
#### Atas das reuniões
- **Descrição:** Registros mensais das discussões, sugestões de melhorias, análises de acidentes e acompanhamento de medidas preventivas discutidas pelos membros da CIPA.
- **Requisito legal:** Item 5.6.3: As reuniões da CIPA terão atas assinadas pelos presentes.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Mapa de riscos (ou técnica alternativa)
- **Descrição:** Representação gráfica (ou outra técnica de percepção de riscos) que identifica os perigos nos locais de trabalho, elaborada pela CIPA em conjunto com o SESMT (quando houver) e os trabalhadores.
- **Requisito legal:** Item 5.3.1, alínea b: Registrar a percepção dos riscos dos trabalhadores, em conformidade com o subitem 1.5.3.3 da NR 01, por meio do mapa de risco ou outra técnica ou ferramenta apropriada à sua escolha, sem ordem de preferência, com assessoria do SESMT, onde houver.
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
#### Plano de trabalho
- **Descrição:** Documento estruturado que define as ações preventivas, metas e cronogramas que a comissão pretende executar ao longo do ano de mandato para melhorar as condições de trabalho.
- **Requisito legal:** 5.3.2, alínea a: Cabe à organização: [...] proporcionar aos membros da CIPA os meios necessários ao desempenho de suas atribuições, garantindo tempo suficiente para a realização das tarefas constantes no plano de trabalho
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovação de treinamento dos cipeiros
- **Descrição:** Certificados ou listas de presença que comprovam que todos os membros (titulares e suplentes) receberam o treinamento obrigatório sobre segurança e saúde no trabalho antes da posse.
- **Requisito legal:** Item 5.7.1: A organização deve promover treinamento para o representante nomeado da NR 05 e para os membros da CIPA, titulares e suplentes, antes da posse.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PROGRAMADA

# NR 06 EPI (geral)
**Total de multas registrado no estado da planilha:** 2341.02
### Itens
#### Notas Fiscais e Certificados de Aprovação (CA)
- **Descrição:** Comprovam a aquisição legal dos equipamentos e garantem que o EPI possui o CA válido junto ao Ministério do Trabalho, atestando sua eficiência e qualidade técnica.
- **Requisito legal:** Item 6.5.1, alínea a: adquirir somente o aprovado pelo órgão de âmbito nacional competente em matéria de segurança e saúde no trabalho.  Item 6.9.2.1: O EPI deve ser comercializado com o CA válido.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PENDENTE
#### Registros de entrega do EPI (Ficha de EPI)
- **Descrição:** Documento (físico ou digital) assinado pelo trabalhador que comprova que a empresa forneceu o equipamento gratuitamente e que o empregado recebeu as orientações de uso.
- **Requisito legal:** Item 6.5.1, alínea d: registrar o seu fornecimento ao empregado, podendo ser adotados livros, fichas ou sistema eletrônico, inclusive, por sistema biométrico.
- **Infração:** 2
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 2341.02
#### Comprovação de treinamentos (NR-06)
- **Descrição:** Certificados e listas de presença que provam que o trabalhador foi capacitado sobre o uso adequado, guarda, conservação e limitações do EPI antes de utilizá-lo.
- **Requisito legal:** Item 6.5.1, alínea b: orientar e treinar o empregado.
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Valor de multa registrado:** -
#### Relação de cargos, funções e descrições
- **Descrição:** Documento base que correlaciona cada cargo às suas atividades reais, permitindo identificar os riscos específicos aos quais o trabalhador está exposto.
- **Requisito legal:** 6.5.2.1 A seleção do EPI deve ser registrada, podendo integrar ou ser referenciada no Programa de Gerenciamento de Riscos - PGR. 6.5.2.1.1 Para as organizações dispensadas de elaboração do PGR, deve ser mantido registro que especifique as atividades exercidas e os respectivos EPI.
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Tabela de EPI recomendado por função
- **Descrição:** Também conhecida como Matriz de EPI, é um guia que define  quais equipamentos são obrigatórios para cada função ou setor, evitando erros na entrega.
- **Requisito legal:** 6.5.2 A organização deve selecionar os EPI, considerando: a) a atividade exercida; b) as medidas de prevenção em função dos perigos identificados e dos riscos ocupacionais avaliados;
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PENDENTE
#### Manual de instruções
- **Descrição:** Documentação fornecida pelo fabricante (em português) que detalha as especificações técnicas, prazos de validade e a forma correta de manutenção do equipamento.
- **Requisito legal:** 6.7.2 Quando do fornecimento de EPI, a organização deve assegurar a prestação de informações, observadas as recomendações do manual de instruções fornecidas pelo fabricante ou importador do EPI, em especial sobre: [...]
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Evidência da participação da CIPA/trabalhadores
- **Descrição:** Registros que comprovam que a seleção do EPI considerou a opinião dos usuários ou da CIPA, conforme exigido pela NR-1 e NR-6, visando melhor adaptação e conforto.
- **Requisito legal:** Item 6.5.2.2: A seleção do EPI deve ser realizada pela organização com a participação do Serviço Especializado em Engenharia de Segurança e em Medicina do Trabalho SESMT, quando houver, após ouvidos empregados usuários e a Comissão Interna de Prevenção de Acidentes e de Assédio - CIPA ou nomeado.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PROGRAMADA
#### Procedimento de higienização e manutenção
- **Descrição:** Instruções normatizadas (POPs) que orientam o trabalhador ou a empresa sobre como limpar, armazenar e quando solicitar a substituição do EPI para garantir sua eficácia.
- **Requisito legal:** Item 6.5.1.3: A organização pode estabelecer procedimentos específicos para a higienização, manutenção periódica e substituição de EPI, referidas nas alíneas "f" e "g" do item 6.5.1, com a correspondente informação aos empregados envolvidos.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 07 PCMSO (geral)
**Total de multas registrado no estado da planilha:** 3513.6582
### Itens
#### Prontuário médico individual
- **Descrição:** Arquivo confidencial, mantido sob responsabilidade do médico do trabalho, que contém todo o histórico clínico, resultados de exames e condutas médicas de cada empregado. Deve ser conservado por, no mínimo, 20 anos após o desligamento.
- **Requisito legal:** Item 7.6.1: Os dados dos exames clínicos e complementares deverão ser registrados em prontuário médico individual, sob a responsabilidade do médico responsável pelo PCMSO, ou do médico encarregado pelo exame, quando a organização estiver dispensada de PCMSO.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Relatório analítico anual
- **Descrição:** Documento estatístico que resume as ocorrências de saúde do ano anterior. Ele deve conter o número de exames realizados, percentual de resultados anormais e a análise comparativa com anos anteriores para identificar tendências de adoecimento.
- **Requisito legal:** Item 7.6.2: O médico responsável pelo PCMSO deve elaborar relatório analítico anual, considerando a data do último relatório [...]
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
#### PCMSO (Programa de Controle Médico)
- **Descrição:** Documento base que estabelece as diretrizes de monitoramento da saúde dos trabalhadores, fundamentado nos riscos identificados no PGR. Define quais exames serão feitos, para quem e com qual periodicidade.
- **Requisito legal:** Item 7.3.1: O PCMSO é parte integrante do conjunto mais amplo de iniciativas da organização no campo da saúde dos empregados, devendo estar harmonizado com o disposto nas demais NR.
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registros dos ASO (Atestados)
- **Descrição:** Cópias dos Atestados de Saúde Ocupacional emitidos (Admissional, Periódico, Retorno ao Trabalho, Mudança de Riscos e Demissional), que declaram a aptidão ou inaptidão do colaborador para sua função.
- **Requisito legal:** Item 7.5.19 Para cada exame clínico ocupacional realizado, o médico emitirá Atestado de Saúde Ocupacional - ASO, que deve ser comprovadamente disponibilizado ao empregado, devendo ser fornecido em meio físico quando solicitado.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Controle de prazos (Exames)
- **Descrição:** Planilha ou sistema de gestão utilizado para monitorar o vencimento dos exames de todos os colaboradores, garantindo que nenhum trabalhador realize suas atividades com o ASO vencido.
- **Requisito legal:** Item 7.5.8: O exame clínico deve obedecer aos seguintes prazos: I - no exame admissional: deve ser realizado antes que o empregado assuma suas atividades; II - no exame periódico: deve ser realizado de acordo com os seguintes intervalos....
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### PPR (Programa de Proteção Respiratória)
- **Descrição:** Conjunto de medidas (técnicas, administrativas e de saúde) para controlar riscos de inalação de contaminantes. Inclui a seleção do respirador correto, ensaios de vedação (fit test) e monitoramento pulmonar.
- **Requisito legal:** Anexo III, 3.3 Nas funções com indicação de uso de equipamentos individuais de proteção respiratória, os empregados com histórico de doença respiratória crônica ou sinais e sintomas respiratórios devem ser submetidos a espirometria no exame médico admissional ou no exame de mudança de risco.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### PCA (Programa de Conservação Auditiva)
- **Descrição:** Estratégia voltada à prevenção de perdas auditivas em ambientes ruidosos. Envolve o controle do ruído, a gestão de protetores auriculares e o acompanhamento rigoroso de audiometrias.
- **Requisito legal:** Anexo II - 10. Nos casos em que o exame audiométrico de referência demonstre alterações cuja evolução esteja em desacordo com os moldes definidos neste Anexo para PAINPSE, o médico do trabalho responsável pelo PCMSO deve: [...] d) participar da implantação e aprimoramento de programas que visem à conservação auditiva e prevenção da progressão da perda auditiva do empregado acometido e de outros expostos a riscos ocupacionais à audição, levando-se em consideração, inclusive, a exposição à vibração e a agentes ototóxicos ocupacionais;
- **Infração:** 0
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 0

# NR 08 Edificações (especial)
**Total de multas registrado no estado da planilha:** 0
### Itens
#### Habite-se e Alvará de Funcionamento
- **Descrição:** Documentos emitidos pela Prefeitura. O Habite-se atesta que a construção seguiu o projeto aprovado e é segura para ocupação; o Alvará autoriza o início das atividades comerciais/industriais no local após verificar condições de higiene e zoneamento.
- **Requisito legal:** 8.3.1 Os locais de trabalho devem ter a altura do piso ao teto, pé-direito, de acordo com o código de obras local ou posturas municipais, atendido o previsto em normas técnicas oficiais e as condições de segurança, conforto e salubridade, estabelecidas em Normas Regulamentadoras.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Laudos ou Projetos Estruturais, de Conforto Térmico, Prevenção contra Incêndio e outros
- **Descrição:** Estudos técnicos assinados por engenheiro civil (com ART) que comprovam que a edificação atende a requisitos diversos de resistência e habitabilidade
- **Requisito legal:** 8.3.3.1 As partes externas, bem como todas as que separem unidades autônomas de uma edificação, ainda que não acompanhem sua estrutura, devem, obrigatoriamente, observar as normas técnicas oficiais relativas à resistência ao fogo, isolamento térmico, isolamento e condicionamento acústico, resistência estrutural e impermeabilidade.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Laudos de inspeção predial e Plano de Manutenção Predial
- **Descrição:** Documento que estabelece a periodicidade e os procedimentos de inspeção e reparo de sistemas críticos (elétrico, hidráulico, telhados, fachadas e fundações), visando prevenir acidentes e garantir a conservação do patrimônio. Em alguns municípios, a periodicidade dos laudos de inspeção é regida por Lei. O Plano de Manutenção Predial deve seguir a ABNT NBR 5674, garantindo a segurança e salubridade do prédio em uso.
- **Requisito legal:** 8.3.1 Os locais de trabalho devem ter a altura do piso ao teto, pé-direito, de acordo com o código de obras local ou posturas municipais, atendido o previsto em normas técnicas oficiais e as condições de segurança, conforto e salubridade, estabelecidas em Normas Regulamentadoras
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 09 AVALIAÇÃO E CONTROLE DAS EXPOSIÇÕES OCUPACIONAIS A AGENTES FÍSICOS, QUÍMICOS E BIOLÓGICOS (Geral)
**Total de multas registrado no estado da planilha:** 3513.6582
### Itens
#### Relatório de avaliação preliminar
- **Descrição:** Análise inicial das atividades e dados disponíveis para determinar a necessidade de medidas de prevenção ou avaliações quantitativas.
- **Requisito legal:** 9.4.1 Deve ser realizada análise preliminar das atividades de trabalho e dos dados já disponíveis relativos aos agentes físicos, químicos e biológicos, a fim de determinar a necessidade de adoção direta de medidas de prevenção ou de realização de avaliações qualitativas ou, quando aplicáveis, de avaliações quantitativas.
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
#### Relatório de avaliação quantitativa
- **Descrição:** Registro das medições representativas da exposição (como vibração e calor), utilizado para dimensionar a exposição e comprovar o controle.
- **Requisito legal:** 9.4.2 A avaliação quantitativa das exposições ocupacionais aos agentes físicos, químicos e biológicos, quando necessária, deverá ser realizada para: a) comprovar o controle da exposição ocupacional aos agentes identificados; b) dimensionar a exposição ocupacional dos grupos de trabalhadores; c) subsidiar o equacionamento das medidas de prevenção.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PROGRAMADA
#### Especificações técnicas de ferramentas (vibração)
- **Descrição:** Documento emitido pelo fabricante informando a vibração emitida por ferramentas manuais que produzam acelerações superiores a 2,5 m/s^2.
- **Requisito legal:** Anexo I, 3.3 As ferramentas manuais vibratórias que produzam acelerações superiores a 2,5 m/s² nas mãos dos operadores devem informar junto às suas especificações técnicas a vibração emitida pelas mesmas, indicando as normas de ensaio que foram utilizadas para a medição.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovação de manutenção (vibração)
- **Descrição:** Registros que comprovem a manutenção preventiva e corretiva de veículos e máquinas visando o controle da exposição à vibração.
- **Requisito legal:** Anexo I, 3.2 A organização deve comprovar, no âmbito das ações de manutenção preventiva e corretiva de veículos, máquinas, equipamentos e ferramentas, a adoção de medidas que visem o controle e a redução da exposição a vibrações.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PROGRAMADA
#### Plano de aclimatização (calor)
- **Descrição:** Planejamento elaborado conforme o PCMSO para trabalhadores expostos ao calor acima do nível de ação.
- **Requisito legal:** Anexo III, 5.2 Quando houver a necessidade de elaboração de plano de aclimatização dos trabalhadores, devem ser considerados os parâmetros previstos na NHO 06 da Fundacentro ou outras referências técnicas emitidas por organização competente.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Procedimento de emergência para calor
- **Descrição:** Protocolo específico contendo recursos para primeiro atendimento e encaminhamento em casos de emergências térmicas.
- **Requisito legal:** Anexo III, 6.1 A organização deve possuir procedimento de emergência específico para o calor, contemplando: a) meios e recursos necessários para o primeiro atendimento ou encaminhamento do trabalhador para atendimento; e b) informação a todas as pessoas envolvidas nos cenários de emergências.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PENDENTE
#### Registros de treinamentos periódicos (calor)
- **Descrição:** Documentação que comprove a realização de treinamentos anuais sobre riscos e medidas de prevenção contra o calor.
- **Requisito legal:** Anexo III, 3.1.2 Devem ser realizados treinamentos periódicos anuais específicos, quando indicados nas medidas de prevenção.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 10 ELETRICIDADE (geral)
**Total de multas registrado no estado da planilha:** 2341.02
### Itens
#### Esquemas unifilares
- **Descrição:** Desenhos técnicos atualizados das instalações elétricas, contendo as especificações do sistema de aterramento e dos dispositivos de proteção.
- **Requisito legal:** 10.2.3 As empresas estão obrigadas a manter esquemas unifilares atualizados das instalações elétricas dos seus estabelecimentos com as especificações do sistema de aterramento e demais equipamentos e dispositivos de proteção.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Prontuário de Instalações Elétricas (PIE)
- **Descrição:** Sistema organizado que compõe a memória dinâmica das informações pertinentes às instalações e aos trabalhadores, obrigatório para estabelecimentos com carga instalada superior a 75 kW.
- **Requisito legal:** 10.2.4 e alíneas: Os estabelecimentos com carga instalada superior a 75 kW devem constituir e manter o Prontuário de Instalações Elétricas [...]
- **Infração:** 2
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 2341.02
- **Status:** PROGRAMADA
#### Procedimentos e instruções técnicas
- **Descrição:** Conjunto de instruções técnicas e administrativas de segurança e saúde implantadas pela empresa, com a descrição das medidas de controle existentes.
- **Requisito legal:** 10.2.4 a) conjunto de procedimentos e instruções técnicas e administrativas de segurança e saúde, implantadas e relacionadas a esta NR e descrição das medidas de controle existentes.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Documentação de inspeções e medições (SPDA)
- **Descrição:** Registros das inspeções e medições realizadas no Sistema de Proteção contra Descargas Atmosféricas e nos aterramentos elétricos.
- **Requisito legal:** 10.2.4 b) documentação das inspeções e medições do sistema de proteção contra descargas atmosféricas e aterramentos elétricos.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Especificação de EPI, EPC e ferramental
- **Descrição:** Descritivo detalhado dos equipamentos de proteção coletiva e individual, além do ferramental aplicável conforme a norma.
- **Requisito legal:** 10.2.4 c) especificação dos equipamentos de proteção coletiva e individual e o ferramental, aplicáveis conforme determina esta NR.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PROGRAMADA
#### Dossiê de qualificação e autorização
- **Descrição:** Documentação que comprova a qualificação, habilitação, capacitação e autorização dos trabalhadores, além do registro dos treinamentos realizados.
- **Requisito legal:** 10.2.4 d) documentação comprobatória da qualificação, habilitação, capacitação, autorização dos trabalhadores e dos treinamentos realizados.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Resultados de testes de isolação
- **Descrição:** Registros dos testes de isolação elétrica realizados em equipamentos de proteção individual e coletiva.
- **Requisito legal:** 10.2.4 e) resultados dos testes de isolação elétrica realizados em equipamentos de proteção individual e coletiva.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PROGRAMADA
#### Certificações em áreas classificadas
- **Descrição:** Certificações de conformidade dos equipamentos e materiais elétricos destinados ao uso em locais com potencialidade de atmosfera explosiva.
- **Requisito legal:** 10.2.4 f) certificações dos equipamentos e materiais elétricos em áreas classificadas.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Relatório Técnico das Inspeções (RTI)
- **Descrição:** Relatório atualizado das inspeções nas instalações, contendo recomendações e cronogramas de adequações.
- **Requisito legal:** 10.2.4 g) relatório técnico das inspeções atualizadas com recomendações, cronogramas de adequações, contemplando as alíneas de "a" a "f".
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Procedimentos de emergência
- **Descrição:** Descrição detalhada das ações a serem adotadas em situações de emergência, obrigatório para empresas que operam no Sistema Elétrico de Potência (SEP).
- **Requisito legal:** 10.2.5 a) descrição dos procedimentos para emergências.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PENDENTE
#### Projeto elétrico e memorial descritivo
- **Descrição:** Documentação técnica assinada por profissional habilitado que especifica as características de proteção contra choques e riscos adicionais.
- **Requisito legal:** 10.3.8 O projeto elétrico deve atender ao que dispõem as Normas Regulamentadoras de Saúde e Segurança no Trabalho, as regulamentações técnicas oficiais estabelecidas, e ser assinado por profissional legalmente habilitado.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Ordem de Serviço (OS) Específica
- **Descrição:** Autorização formal para trabalhos em instalações energizadas em alta tensão ou no SEP, detalhando data e local.
- **Requisito legal:** 10.11.2 Os serviços em instalações elétricas devem ser precedidos de ordens de serviço específicas, aprovadas por trabalhador autorizado, contendo, no mínimo, o tipo, a data, o local e as referências aos procedimentos de trabalho a serem adotados
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** PENDENTE
#### Prontuário Médico (Exames de Saúde)
- **Descrição:** Registro de exames de saúde compatíveis com as atividades elétricas, realizados em conformidade com a NR-07.
- **Requisito legal:** 10.8.7 Os trabalhadores autorizados a intervir em instalações elétricas devem ser submetidos a exame de saúde compatível com as atividades a serem desenvolvidas, realizado em conformidade com a NR 7 e registrado em seu prontuário médico.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Permissão para o Trabalho (PT)
- **Descrição:** Liberação formalizada para a realização de serviços em instalações elétricas localizadas em áreas classificadas.
- **Requisito legal:** 10.9.5 Os serviços em instalações elétricas nas áreas classificadas somente poderão ser realizados mediante permissão para o trabalho com liberação formalizada [...]
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Procedimentos de trabalho padronizados
- **Descrição:** Descrição detalhada, passo a passo, de cada tarefa a ser realizada, assinada por profissional habilitado.
- **Requisito legal:** 10.11.1 Os serviços em instalações elétricas devem ser planejados e realizados em conformidade com procedimentos de trabalho específicos, padronizados, com descrição detalhada de cada tarefa, passo a passo, assinados por profissional que atenda ao que estabelece o item 10.8 desta NR
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 11 TRANSPORTE, MOVIMENTAÇÃO, ARMAZENAGEM E MANUSEIO DE MATERIAIS
**Total de multas registrado no estado da planilha:** 27019.6272
### Itens
#### Registro de treinamento específico
- **Descrição:** Comprovação do treinamento dado pela empresa que habilita o operador de equipamentos de transporte com força motriz própria
- **Requisito legal:** 11.1.5 Nos equipamentos de transporte, com força motriz própria, o operador deverá receber treinamento específico, dado pela empresa, que o habilitará nessa função.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Cartão de identificação do operador
- **Descrição:** Documento com nome e fotografia, de porte obrigatório pelo operador durante o horário de trabalho, com validade de um ano
- **Requisito legal:** 11.1.6 Os operadores de equipamentos de transporte motorizado deverão ser habilitados e só poderão dirigir se durante o horário de trabalho portarem um cartão de identificação, com o nome e fotografia, em lugar visível.
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** CANCELADA
#### Prontuário de exame de saúde
- **Descrição:** Registro de exame médico completo realizado pelo empregador para a revalidação anual do cartão de identificação do operador
- **Requisito legal:** 11.1.6.1 O cartão terá a validade de 1 (um) ano, salvo imprevisto, e, para a revalidação, o empregado deverá passar por exame de saúde completo, por conta do empregador
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Livro próprio de equipamentos
- **Descrição:** Registro contendo identificação, carga máxima, fabricante e responsável técnico de cada equipamento (específico para rochas ornamentais)
- **Requisito legal:** Anexo I - 1.2.1.1 As informações indicadas no subitem 1.2.1 e demais pertinentes devem constar em livro próprio.
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** PENDENTE
#### Manual de instrução do equipamento
- **Descrição:** Documento fornecido pelo fabricante com requisitos para operação, manutenção e suporte à capacitação
- **Requisito legal:** Anexo I - 1.2.2 O fabricante do equipamento deve fornecer manual de instrução, atendendo aos requisitos estabelecidos na NR-12, objetivando a correta operação e manutenção, além de subsidiar a capacitação do operador.
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** PENDENTE
#### Registro de inspeção e manutenção
- **Descrição:** Histórico, em meio físico ou eletrônico, das inspeções periódicas e manutenções de equipamentos e elementos de sustentação
- **Requisito legal:** Anexo I - 1.3 A empresa deve manter registro, em meio físico ou eletrônico, de inspeção periódica e de manutenção dos equipamentos e elementos de sustentação utilizados na movimentação, armazenagem e manuseio de chapas de rochas ornamentais.
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Relatório de inspeção anual
- **Descrição:** Documento elaborado por profissional habilitado, acompanhado de ART (Anotação de Responsabilidade Técnica), que integra a documentação do equipamento
- **Requisito legal:** Anexo I - 1.3.1 Após a inspeção do equipamento ou elemento de sustentação, deve ser emitido "Relatório de Inspeção", com periodicidade anual, elaborado por profissional legalmente habilitado com ART (Anotação de Responsabilidade Técnica) recolhida, que passa a fazer parte da documentação do equipamento.
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** PROGRAMADA
#### Projetos e laudos técnicos
- **Descrição:** Documentação técnica, cálculos e especificações obrigatórios para equipamentos de fabricação própria
- **Requisito legal:** Anexo I - 1.3.3 A empresa deve manter no estabelecimento nota fiscal do equipamento adquirido ou, no caso de fabricação própria, os projetos, laudos, cálculos e as especificações técnicas.
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Notas fiscais de aquisição
- **Descrição:** Comprovantes de compra de equipamentos e acessórios (cabos de aço, correntes, cintas), que devem ser mantidos à disposição da fiscalização
- **Requisito legal:** Anexo I - 2.6.2 O empregador deve manter no estabelecimento à disposição da fiscalização as notas fiscais de aquisição dos cabos de aço, correntes, cintas e outros acessórios, com os respectivos certificados.
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** EM ANDAMENTO
#### Certificados de acessórios
- **Descrição:** Documentação técnica que atesta a conformidade e capacidade de carga de cabos de aço, correntes e cintas
- **Requisito legal:** Anexo I - 2.6.2 O empregador deve manter no estabelecimento à disposição da fiscalização as notas fiscais de aquisição dos cabos de aço, correntes, cintas e outros acessórios, com os respectivos certificados.
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** EM ANDAMENTO
#### Procedimentos operacionais de segurança
- **Descrição:** Instruções detalhadas para movimentação de cargas específicas e ações em caso de falta de energia elétrica
- **Requisito legal:** Anexo I - 4.1.1.1 As movimentações de cargas devem seguir instruções definidas em procedimentos específicos para cada tipo de carga, objetivando a segurança da operação para pessoas e materiais.
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Certificado de capacitação
- **Descrição:** Documento que comprova o cumprimento da carga horária e módulos teóricos/práticos pelo trabalhador, assinado por responsável técnico
- **Requisito legal:** Anexo I - 5.4.2.1 O certificado somente será concedido ao participante que cumprir a carga horária total dos módulos e demonstrar habilidade na operação dos equipamentos.
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Material didático impresso
- **Descrição:** Conteúdo instrucional fornecido obrigatoriamente aos participantes dos programas de capacitação
- **Requisito legal:** Anexo I - 5.4.4 Os participantes da capacitação devem receber material didático impresso.
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 12 MÁQUINAS E EQUPAMENTOS (Especial)
**Total de multas registrado no estado da planilha:** 5854.6782
### Itens
#### Relação atualizada das máquinas e equipamentos
- **Descrição:** Lista atualizada que identifica todas as máquinas e equipamentos da organização, incluindo o tipo, capacidade, localização e esquema de segurança adotado
- **Requisito legal:** 12.18.1 O empregador deve manter à disposição da Auditoria-Fiscal do Trabalho relação atualizada das máquinas e equipamento
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Análise de risco (apreciação de riscos)
- **Descrição:** Documento técnico elaborado por profissional habilitado que identifica perigos, estima e avalia os riscos para cada máquina, definindo as medidas de proteção necessárias
- **Requisito legal:** 12.1.9 Na aplicação desta NR e de seus anexos, devem-se considerar as características das máquinas e equipamentos, do processo, a apreciação de riscos e o estado da técnica.
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** CONCLUÍDA
#### Manual de instruções
- **Descrição:** Documento fornecido pelo fabricante ou elaborado pela empresa (em português) contendo informações sobre uso seguro, transporte, instalação, operação e manutenção.
- **Requisito legal:** 12.13.1 As máquinas e equipamentos devem possuir manual de instruções fornecido pelo fabricante ou importador, com informações relativas à segurança em todas as fases de utilização
- **Infração:** 2
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 2341.02
- **Status:** EM ANDAMENTO
#### Registro de manutenção
- **Descrição:** Livro, ficha ou sistema informatizado contendo o histórico das manutenções preventivas, corretivas e preditivas, além de testes realizados nos sistemas de segurança.
- **Requisito legal:** 12.11.2 As manutenções devem ser registradas em livro próprio, ficha ou sistema informatizado interno da empresa, com os seguintes dados: [...]
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Procedimentos de trabalho e segurança
- **Descrição:** Instruções detalhadas, por escrito e passo a passo, baseadas na análise de riscos, destinadas à operação e manutenção segura das máquinas.
- **Requisito legal:** 12.14.1 Devem ser elaborados procedimentos de trabalho e segurança para máquinas e equipamentos, específicos e padronizados, a partir da apreciação de riscos.
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** PENDENTE
#### Registro de treinamento e capacitação
- **Descrição:** Documentação comprobatória da capacitação dos operadores e pessoal de manutenção, contendo conteúdo programático, carga horária, data e assinatura dos instrutores.
- **Requisito legal:** 12.16.5 O material didático fornecido aos trabalhadores, a lista de presença dos participantes ou certificado, o currículo dos ministrantes e a avaliação dos capacitados devem ser disponibilizados à Auditoria Fiscal do Trabalho em meio físico ou digital, quando solicitado.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Projeto e memória de cálculo
- **Descrição:** Documentação técnica dos sistemas de segurança, incluindo diagramas elétricos e lógica de funcionamento, mantida sob responsabilidade de profissional habilitado.
- **Requisito legal:** 12.5.17 Em função do risco, poderá ser exigido projeto, diagrama ou representação esquemática dos sistemas de segurança de máquinas, com respectivas especificações técnicas em língua portuguesa, elaborado por profissional legalmente habilitado.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de manutenção preventiva
- **Descrição:** Cronograma e descrição das intervenções programadas para garantir a integridade e o bom funcionamento dos componentes de segurança.
- **Requisito legal:** 12.11.2.2 As manutenções de itens que influenciem na segurança devem: a) no caso de preventivas, possuir cronograma de execução;
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 13 CALDEIRAS, VASOS DE PRESSÃO E SIMILARES (Especial)
**Total de multas registrado no estado da planilha:** 21130.8978
### Itens
#### Prontuário de caldeira
- **Descrição:** Dossiê detalhado contendo código de construção, memorial de cálculo, especificações de materiais e desenhos do equipamento.
- **Requisito legal:** Item 13.4.1.5, alínea "a": "prontuário da caldeira, fornecido por seu fabricante, contendo as seguintes informações: I - código de construção e ano de edição; II - especificação dos materiais; III - procedimentos utilizados na fabricação, montagem e inspeção final; IV - metodologia para estabelecimento da PMTA; V - registros da execução do teste hidrostático de fabricação; VI conjunto de desenhos e demais dados necessários ao monitoramento da vida útil da caldeira; VII - características funcionais; VIII - dados dos dispositivos de segurança; IX - ano de fabricação; e X - categoria da caldeira;
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro de segurança
- **Descrição:** Livro de páginas numeradas ou sistema eletrônico para registro de ocorrências e histórico de inspeções.
- **Requisito legal:** Item 13.4.1.8: "O registro de segurança deve ser constituído por livro de páginas numeradas, pastas ou sistema informatizado onde serão registradas: a) todas as ocorrências importantes capazes de influir nas condições de segurança da caldeira... b) as ocorrências de inspeções de segurança inicial, periódica e extraordinária..."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Projeto de instalação
- **Descrição:** Planejamento técnico do local de instalação, detalhando ventilação, acessos, saídas de emergência e distâncias seguras.
- **Requisito legal:** Item 13.4.2.1: "A autoria do projeto de instalação de caldeiras é de responsabilidade de PLH, e deve obedecer aos aspectos de segurança, saúde e meio ambiente previstos nas normas regulamentadoras, convenções e disposições legais aplicáveis."
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** CONCLUÍDA
#### Projeto de alteração ou reparo
- **Descrição:** Documento técnico obrigatório para intervenções estruturais, especificando materiais, procedimentos de soldagem e controle de qualidade.
- **Requisito legal:** Item 13.3.7.4: "Os projetos de alteração e os projetos de reparo devem: a) ser concebidos ou aprovados por PLH; b) determinar materiais, procedimentos de execução, controle de qualidade e qualificação de pessoal; e c) ser divulgados para os empregados do estabelecimento que estão envolvidos com o equipamento."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Relatórios de inspeção
- **Descrição:** Parecer técnico emitido por Profissional Habilitado (PH) após inspeções iniciais, periódicas ou extraordinárias, atestando a condição do equipamento.
- **Requisito legal:** Item 13.4.4.12: "O relatório de inspeção de segurança, mencionado na alínea “e” do subitem 13.4.1.5, deve conter no mínimo: a) dados constantes na placa de identificação... b) categoria... c) tipo... d) tipo de inspeção... e) data... f) descrição das inspeções... g) registros fotográficos..." h) resultado das inspeções...; i) relação dos itens...; j) recomendações...; k) parecer conclusivo quanto à integridade...; l) data prevista...; m) nome legível...; e n) número do certificado...
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** PROGRAMADA
#### Certificados de calibração
- **Descrição:** Comprovação técnica da calibração e teste de funcionamento dos dispositivos de segurança, como válvulas de alívio e manômetros.
- **Requisito legal:** Item 13.3.6: "Os instrumentos e sistemas de controle e segurança dos equipamentos abrangidos por esta NR devem ser mantidos em condições adequadas de uso e devidamente inspecionados e testados ou, quando aplicável, calibrados."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Manual de operação
- **Descrição:** Instruções fornecidas em português pelo fabricante, abrangendo procedimentos de acendimento, operação normal e emergências.
- **Requisito legal:** Item 13.4.3.1: "Toda caldeira deve possuir manual de operação atualizado, em língua portuguesa, em local de fácil acesso aos operadores, contendo no mínimo: a) procedimentos de partidas e paradas; b) procedimentos e parâmetros operacionais de rotina; c) procedimentos para situações de emergência; e d) procedimentos gerais de segurança, de saúde e de preservação do meio ambiente."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** PENDENTE
#### Laudo do teste hidrostático
- **Descrição:** Documento que certifica a execução do teste de pressão em fase de fabricação ou após grandes reparos estruturais.
- **Requisito legal:** Item 13.4.4.3: "As caldeiras devem, obrigatoriamente, ser submetidas a Teste Hidrostático - TH em sua fase de fabricação, com comprovação por meio de laudo assinado por PLH."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de inspeção de tubulações
- **Descrição:** Programação técnica que estabelece critérios, metodologias e intervalos para a avaliação da integridade das linhas de interligação.
- **Requisito legal:** 13.6.1.1 As empresas que possuam tubulações enquadradas nesta NR devem elaborar um programa e um plano de inspeção que considere, no mínimo, as variáveis, condições e premissas descritas abaixo: [...]
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** EM ANDAMENTO
#### Plano de manutenção de tubulações
- **Descrição:** Cronograma de intervenções preventivas e corretivas destinadas a garantir a segurança e a operacionalidade dos sistemas de tubulação.
- **Requisito legal:** 13.6.2.6 As tubulações de vapor de água devem ser mantidas em boas condições operacionais, de acordo com um plano de manutenção.
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comunicação de ocorrência grave
- **Descrição:** Informe formal enviado à representação sindical da categoria em até dois dias úteis após acidentes como vazamentos, incêndios ou explosões.
- **Requisito legal:** Item 13.3.11: "O empregador deve comunicar à autoridade regional competente em matéria de trabalho e ao sindicato da categoria profissional predominante do estabelecimento a ocorrência de vazamento, incêndio ou explosão envolvendo equipamentos abrangidos por esta NR que tenha como consequência... a) morte... b) internação... ou c) eventos de grande proporção."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovação de treinamentos
- **Descrição:** Certificados e registros que atestam a capacitação técnica e de segurança dos operadores de caldeira conforme carga horária mínima.
- **Requisito legal:** Anexo I, item 1.1 Para efeito da NR-13, é considerado operador de caldeira aquele que cumprir uma das seguintes condições: a) possuir certificado de treinamento de segurança na operação de caldeiras expedido por instituição competente e comprovação de prática profissional supervisionada, conforme item 1.5 deste Anexo; ou b) possuir certificado de treinamento de segurança na operação de caldeiras previsto na NR-13 aprovada pela Portaria SSMT n° 02, de 08 de maio de 1984 ou na Portaria SSST nº 23, de 27 de dezembro de 1994.
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** CONCLUÍDA

# NR 14 Fornos (Especial)
**Total de multas registrado no estado da planilha:** 4701.1938
### Itens
#### Projeto técnico e memorial de cálculo
- **Descrição:** Documento que comprova que o forno foi construído de forma sólida e de acordo com as normas técnicas oficiais vigentes.
- **Requisito legal:** Item 14.3.2, alínea "a": "em conformidade com o disposto em normas técnicas oficiais;"
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Relatórios de inspeção e manutenção
- **Descrição:** Registro das verificações periódicas de integridade estrutural, limpeza e funcionamento dos componentes de aquecimento.
- **Requisito legal:** Item 14.3.1: "Os fornos, para qualquer utilização, devem ser construídos solidamente..."  (Nota: A norma estabelece o requisito de construção sólida, que pressupõe a manutenção dessa condição).
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Certificado de calibração/teste de válvulas
- **Descrição:** Comprovação do bom funcionamento das válvulas de segurança automáticas contra retrocesso de chama e interrupção de combustível.
- **Requisito legal:** Item 14.3.3, alínea "a": "Os fornos que utilizam combustíveis gasosos ou líquidos devem ter sistemas de proteção para evitar: a) explosão por falha da chama de aquecimento e/ou no acionamento do queimador;"
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** EM ANDAMENTO
#### Laudo de isolamento térmico
- **Descrição:** Documento técnico que atesta que o revestimento refratário e o isolamento minimizam o calor radiante para o ambiente de trabalho.
- **Requisito legal:** Item 14.3.1: "...revestidos com material refratário, de forma que o calor radiante não ultrapasse os limites de tolerância estabelecidos pela NR-15 - Atividades e operações insalubres."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 15 INSALUBRIDADE (Especial)
**Total de multas registrado no estado da planilha:** 4701.1938
### Itens
#### Laudo Técnico de Insalubridade (LTI)
- **Descrição:** Documento elaborado por Engenheiro do Trabalho ou Médico do Trabalho que atesta a existência de insalubridade e define o grau (mínimo, médio ou máximo).
- **Requisito legal:** Item 15.4.1.3: "O laudo caracterizador da insalubridade deve estar disponível aos trabalhadores, sindicatos das categorias profissionais e à inspeção do trabalho."
- **Infração:** 0
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 0
#### Relatório de avaliação quantitativa de ruído
- **Descrição:** Registros das medições de ruído contínuo, intermitente ou de impacto para comparação com os limites de tolerância diários.
- **Requisito legal:** Anexo I, Item 2: "Os níveis de ruído contínuo ou intermitente devem ser medidos em decibéis (dB) com instrumento de nível de pressão sonora operando no circuito de compensação "A" e circuito de resposta lenta (SLOW).
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Memória de Cálculo de IBUTG (Calor)
- **Descrição:** Documentação técnica com os cálculos do Índice de Bulbo Úmido Termômetro de Globo para avaliação da exposição ao calor.
- **Requisito legal:** Anexo III, Item 2.1, alínea "d": "medições e cálculos."
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** CONCLUÍDA
#### Relatório de ensaio de agentes químicos
- **Descrição:** Documento que registra as concentrações de substâncias químicas no ar, verificando se ultrapassam os limites de tolerância fixados.
- **Requisito legal:** Anexo n° 11, item 1. Nas atividades ou operações nas quais os trabalhadores ficam expostos a agentes químicos, a caracterização de insalubridade ocorrerá quando forem ultrapassados os limites de tolerância constantes do Quadro n.o 1 deste Anexo.
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Fichas de controle e entrega de epi
- **Descrição:** Comprovação documental de que o trabalhador recebeu equipamentos de proteção adequados que possam eliminar ou neutralizar a insalubridade.
- **Requisito legal:** Item 15.4.1, alínea "b": "A eliminação ou neutralização da insalubridade deverá ocorrer: (...) b) com a utilização de equipamento de proteção individual."
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### PPEB (Programa de Prevenção da Exposição ao Benzeno)
- **Descrição:** Programa obrigatório para empresas que produzem, utilizam ou manipulam benzeno e suas misturas, conforme anexo específico.
- **Requisito legal:** Anexo n° 13-A, item 3.2. As empresas que utilizam benzeno em atividades que não as identificadas nas alíneas do item 3 e que apresentem inviabilidade técnica ou econômica de sua substituição deverão comprová-la quando da elaboração do Programa de Prevenção da Exposição Ocupacional ao Benzeno - PPEOB.
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registros de radiações ionizantes
- **Descrição:** Dossiê contendo os levantamentos radiométricos e o monitoramento individual de dose de radiação dos trabalhadores expostos.
- **Requisito legal:** Anexo n° 5: Nas atividades ou operações onde trabalhadores possam ser expostos a radiações ionizantes, os limites de tolerância, os princípios, as obrigações e controles básicos para a proteção do homem e do seu meio ambiente contra possíveis efeitos indevidos causados pela radiação ionizante, são os constantes da Norma CNEN-NN-3.01: "Diretrizes Básicas de Proteção Radiológica", de março de 2014, aprovada pela Resolução CNEN nº 164/2014, ou daquela que venha a substituí-la. (Atualizado pela Portaria MTb nº 1.084, de 18 de dezembro de 2018)
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Avaliação qualitativa de agentes biológicos
- **Descrição:** Documento que descreve as atividades que envolvem contato permanente com agentes biológicos infectocontagiosos em estabelecimentos de saúde.
- **Requisito legal:** Anexo n° 14: Relação das atividades que envolvem agentes biológicos, cuja insalubridade é caracterizada pela avaliação qualitativa.
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Certificado de calibração de instrumentos
- **Descrição:** Registros que comprovam que os equipamentos de medição (decibelímetros, termômetros, bombas de amostragem) estão calibrados e aptos para uso.
- **Requisito legal:** Anexo nº 3, Item 3.1, alínea "d": "especificação, identificação dos aparelhos de medição utilizados e respectivos certificados de calibração conforme a NHO 06 da Fundacentro, quando utilizado o medidor de IBUTG;"
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 16 PERICULOSIDADE (especial)
**Total de multas registrado no estado da planilha:** 3513.6582
### Itens
#### Laudo Técnico de Periculosidade (LTP)
- **Descrição:** Documento elaborado por Engenheiro de Segurança ou Médico do Trabalho que identifica, caracteriza e classifica as atividades ou operações perigosas na empresa.
- **Requisito legal:** Item 16.3: "É responsabilidade do empregador a caracterização ou a descaracterização da periculosidade, mediante laudo técnico elaborado por Médico do Trabalho ou Engenheiro de Segurança do Trabalho, nos termos do artigo 195 da CLT."
- **Infração:** 1
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Anotação de Responsabilidade Técnica (ART)
- **Descrição:** Registro junto ao conselho de classe (CREA) do profissional habilitado responsável pela elaboração do laudo de periculosidade.
- **Requisito legal:** Item 16.3: "...laudo técnico elaborado por Médico do Trabalho ou Engenheiro de Segurança do Trabalho..." (Nota: A elaboração de laudos por engenheiros de segurança exige a respetiva ART conforme legislação profissional, embora a sigla não apareça no texto literal da NR).
- **Infração:** 1
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Projeto de instalação e armazenamento
- **Descrição:** Memorial descritivo e desenhos técnicos das áreas de armazenamento de inflamáveis e explosivos, delimitando as distâncias de segurança e bacias de contenção.
- **Requisito legal:** Anexo I, Item 3, alínea "e": será obrigatória a existência física de delimitação da área de risco, assim entendido qualquer obstáculo que impeça o ingresso de pessoas não autorizadas.
- **Infração:** 1
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Mapa de setorização de áreas de risco
- **Descrição:** Representação gráfica ou planta baixa indicando os limites das áreas de risco para inflamáveis, explosivos, radiações ionizantes ou energia elétrica.
- **Requisito legal:** Item 16.8: "Todas as áreas de risco previstas nesta NR devem ser delimitadas, sob responsabilidade do empregador."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** EM ANDAMENTO
#### Plano de segurança para radiações ionizantes
- **Descrição:** Conjunto de procedimentos específicos para empresas que operam com radiações, incluindo monitoramento de dose individual e levantamentos radiométricos.
- **Requisito legal:** Feito considerando as áreas de risco listadas no Anexo (*)
- **Infração:** 1
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 17 ERGONOMIA (GERAL)
**Total de multas registrado no estado da planilha:** 8214.852
### Itens
#### Avaliação Ergonômica Preliminar (AEP)
- **Descrição:** Documento obrigatório para todas as organizações visando a identificação de perigos e a avaliação dos riscos ergonômicos das situações de trabalho.
- **Requisito legal:** Item 17.3.1: "A organização deve realizar a avaliação ergonômica preliminar das situações de trabalho que, em decorrência da natureza e conteúdo das atividades requeridas, demandam adaptação às características psicofisiológicas dos trabalhadores, a fim de subsidiar a implementação das medidas de prevenção e adequações necessárias previstas nesta NR."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Análise Ergonômica do Trabalho (AET)
- **Descrição:** Estudo aprofundado exigido em casos específicos, como problemas complexos, reincidência de doenças ou quando a AEP for insuficiente.
- **Requisito legal:** Item 17.3.2: "A organização deve realizar Análise Ergonômica do Trabalho - AET - da situação de trabalho quando: a) observada a necessidade de uma avaliação mais aprofundada da situação; b) identificadas inadequações ou insuficiência das ações adotadas; c) sugerida pelo acompanhamento de saúde dos trabalhadores... ou d) indicada causa relacionada às condições de trabalho na análise de acidentes e doenças relacionadas ao trabalho..."
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** CANCELADA
#### Relatório de medições de conforto
- **Descrição:** Registro das avaliações de iluminação, temperatura e níveis de ruído para garantir o conforto térmico, acústico e visual nos postos de trabalho.
- **Requisito legal:** Item 17.8.4.1.2: "Para os demais casos, o nível de ruído de fundo aceitável para efeito de conforto acústico será de até 65 dB(A), nível de pressão sonora contínuo equivalente ponderado em A e no circuito de resposta Slow (S)."   Item 17.8.4.2: "A organização deve adotar medidas de controle da temperatura, da velocidade do ar e da umidade com a finalidade de proporcionar conforto térmico nas situações de trabalho, observando-se o parâmetro de faixa de temperatura do ar entre 18 e 25 °C para ambientes climatizados."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro de treinamento e capacitação
- **Descrição:** Comprovação de instruções e treinamentos para trabalhadores que realizam levantamento de cargas ou atuam em telemarketing e checkout.
- **Requisito legal:** Anexo I, Item 7.2.1: "Cada trabalhador deve receber treinamento inicial com duração mínima de duas horas, até o trigésimo dia da data da sua admissão, e treinamento periódico anual com duração mínima de duas horas... Anexo II, item 7.1 Todos os trabalhadores de operação e de gestão devem receber capacitação que proporcione conhecer as formas de adoecimento relacionadas à sua atividade, suas causas, efeitos sobre a saúde e medidas de prevenção.
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** CONCLUÍDA
#### Registro de pausas e organização do trabalho
- **Descrição:** Documentação que formaliza os períodos de descanso e recuperação, especialmente para atividades repetitivas ou de teleatendimento.
- **Requisito legal:** Item 17.4.3.1: "As medidas de prevenção devem incluir duas ou mais das seguintes alternativas: a) pausas para propiciar a recuperação psicofisiológica dos trabalhadores, que devem ser computadas como tempo de trabalho efetivo; b) alternância de atividades com outras tarefas..."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Relatório de avaliação de checkout
- **Descrição:** Documentação específica exigida para os anexos da norma, detalhando as condições de trabalho e mobiliário desses setores.
- **Requisito legal:** Anexo I, item 3.1 Em relação ao mobiliário do checkout e às suas dimensões, incluindo distâncias e alturas, no posto de trabalho deve-se: [...]
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não há operador de checkout
- **Valor de multa registrado:** -
#### Relatório de avaliação de  telemarketing
- **Descrição:** Documentação específica exigida para os anexos da norma, detalhando as condições de trabalho e mobiliário desses setores.
- **Requisito legal:** Anexo II, item 4
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 18 INDÚSTRIA DA CONSTRUÇÃO (Setorial)
**Total de multas registrado no estado da planilha:** 33963.9438
### Itens
#### Comunicação Prévia de Obras
- **Descrição:** Registro obrigatório realizado junto ao sistema oficial do governo federal antes do início das atividades de construção.
- **Requisito legal:** Item 18.3.1: "A organização da obra deve: (...) b) fazer a Comunicação Prévia de Obras em sistema informatizado da Subsecretaria de Inspeção do Trabalho - SIT, antes do início das atividades, de acordo com a legislação vigente."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### PGR da NR-18
- **Descrição:** Programa de Gerenciamento de Riscos que consolida o inventário de perigos e o plano de ação específico do canteiro
- **Requisito legal:** Item 18.4.1: "São obrigatórias a elaboração e a implementação do PGR nos canteiros de obras, contemplando os riscos ocupacionais e suas respectivas medidas de prevenção."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** PENDENTE
#### Projeto da área de vivência
- **Descrição:** Planejamento técnico das instalações de apoio, como refeitório, alojamento, vestiário e sanitários da obra.
- **Requisito legal:** Item 18.4.3: "O PGR, além de contemplar as exigências previstas na NR-01, deve conter os seguintes documentos: a) projeto da área de vivência do canteiro de obras e de eventual frente de trabalho, em conformidade com o item 18.5 desta NR, elaborado por profissional legalmente habilitado;"
- **Infração:** 2
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 2341.02
- **Status:** CONCLUÍDA
#### Projeto elétrico das instalações temporárias
- **Descrição:** Memorial descritivo e esquemas unifilares das instalações elétricas provisórias, visando a segurança contra choques e incêndios
- **Requisito legal:** Item 18.4.3: "O PGR (...) deve conter os seguintes documentos: (...) b) projeto elétrico das instalações temporárias, elaborado por profissional legalmente habilitado;"
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Projetos dos sistemas de proteção coletiva
- **Descrição:** Detalhamento técnico de proteções de periferia, redes de segurança e fechamentos de vãos de elevadores.
- **Requisito legal:** Item 18.4.3: "O PGR (...) deve conter os seguintes documentos: (...) c) projetos dos sistemas de proteção coletiva elaborados por profissional legalmente habilitado;"
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Projetos dos Sistemas de SPIQ
- **Descrição:** Projeto do Sistema de Proteção Individual Contra Quedas, especificando pontos de ancoragem e linhas de vida para trabalho em altura.
- **Requisito legal:** Item 18.4.3: "O PGR (...) deve conter os seguintes documentos: (...) d) projetos dos Sistemas de Proteção Individual Contra Quedas (SPIQ), quando aplicável, elaborados por profissional legalmente habilitado;"
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Relação de EPI
- **Descrição:** Listagem dos Equipamentos de Proteção Individual adequados aos riscos de cada função no canteiro
- **Requisito legal:** Item 18.4.3: "O PGR (...) deve conter os seguintes documentos: (...) e) relação dos Equipamentos de Proteção Individual (EPI) e suas respectivas especificações técnicas, de acordo com os riscos ocupacionais existentes."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Projeto do SPDA
- **Descrição:** Documentação das inspeções e medições do sistema de proteção contra descargas atmosféricas para proteção de estruturas e pessoas
- **Requisito legal:** Item 18.6.18: "Os canteiros de obras devem estar protegidos por Sistema de Proteção contra Descargas Atmosféricas SPDA, projetado, construído e mantido conforme normas técnicas nacionais vigentes."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** CANCELADA
#### Documento de monitoração das escavações
- **Descrição:** Registro técnico periódico da estabilidade de taludes, escoramentos e valas durante a fase de fundação.
- **Requisito legal:** Item 18.7.2.9: "As escavações do canteiro de obras próximas de edificações devem ser monitoradas e o resultado documentado."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** CANCELADA
#### Projeto de escavação, fundação e desmonte
- **Descrição:** Memorial de cálculo e desenhos técnicos que estabelecem as contenções e métodos seguros para movimentação de solo e rochas.
- **Requisito legal:** Item 18.7.2.1: "O serviço de escavação, fundação e desmonte de rochas deve ser realizado e supervisionado conforme projeto elaborado por profissional legalmente habilitado."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Projeto das formas e dos escoramentos
- **Descrição:** Dimensionamento estrutural para suportar as cargas de ferragens, concreto e operários durante a fase de estrutura.
- **Requisito legal:** Item 18.7.4.1: "O projeto das fôrmas e dos escoramentos, indicando a sequência de retirada das escoras, deve ser elaborado por profissional legalmente habilitado."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de cargas no canteiro de obras
- **Descrição:** Planejamento detalhado para o içamento e movimentação de materiais, especialmente em operações com gruas ou guindastes
- **Requisito legal:** Item 18.10.1.17: "O plano de carga para movimentação de carga suspensa deve ser elaborado para cada equipamento e conter as seguintes informações: (...)"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Laudo estrutural no canteiro de obras
- **Descrição:** Documento que atesta a integridade e estabilidade de estruturas fixas ou temporárias instaladas na obra, como uma grua.
- **Requisito legal:** Item 18.10.1.40 Deve ser elaborado laudo estrutural e operacional quanto à integridade estrutural e eletromecânica da grua, sob responsabilidade de profissional legalmente habilitado, nas seguintes situações: [...]
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de demolição
- **Descrição:** Estudo prévio que define a sequência de atividades e os isolamentos necessários para a desconstrução segura de estruturas.
- **Requisito legal:** Item 18.7.1.1: "Deve ser elaborado e implementado Plano de Demolição, sob responsabilidade de profissional legalmente habilitado, contemplando os riscos ocupacionais potencialmente existentes em todas as etapas da demolição (...)"
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** PENDENTE
#### Plano de resgate e remoção
- **Descrição:** Procedimento estruturado para o socorro de trabalhadores em situações de emergência, especialmente em altura ou espaços confinados
- **Requisito legal:** Item 18.7.2.18: "A atividade de escavação manual de tubulão deve ser precedida de plano de resgate e remoção."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** CONCLUÍDA
#### Plano de fogo para detonação
- **Descrição:** Documento técnico que detalha o uso planejado de explosivos para desmonte de rochas, garantindo o controle de vibrações e projeções.
- **Requisito legal:** Item 18.7.2.25: "Para a operação de desmonte de rocha a fogo, com a utilização de explosivos, é obrigatória a elaboração de um Plano de Fogo para cada detonação, por profissional legalmente habilitado (...)"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Projeto de instalação de andaime
- **Descrição:** Cálculo estrutural e plano de montagem de andaimes fachadeiros ou plataformas suspensas assinado por profissional habilitado.
- **Requisito legal:** Item 18.12.1 Os andaimes devem atender aos seguintes requisitos: a) ser projetados por profissionais legalmente habilitados, de acordo com as normas técnicas nacionais vigentes;
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro das inspeções de concretagem
- **Descrição:** Relatório de conferência de armaduras e formas realizado imediatamente antes e durante o lançamento do concreto.
- **Requisito legal:** Item 18.7.4.3: "A operação de concretagem deve ser supervisionada por trabalhador capacitado, devendo ser observadas as seguintes medidas: a) inspecionar os equipamentos e os sistemas de alimentação de energia antes e durante a execução dos serviços; (...) c) inspecionar o escoramento e a resistência das fôrmas antes e durante a execução dos serviços;"
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** CANCELADA
#### Análises de riscos para trabalhos a quente
- **Descrição:** Avaliação prévia dos perigos em atividades que envolvam solda, corte ou chamas, visando evitar incêndios e queimaduras
- **Requisito legal:** Item 18.7.6.2 Deve ser elaborada análise de risco específica para trabalhos a quente quando: a) houver materiais combustíveis ou inflamáveis no entorno; b) for realizado em área sem prévio isolamento e não destinada para este fim.
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** EM ANDAMENTO
#### Dimensionamento de transporte vertical
- **Descrição:** Cálculos técnicos que definem a capacidade e o tipo de elevadores necessários para pessoas e materiais na obra
- **Requisito legal:** Item 18.11.4 Os equipamentos de transporte vertical de materiais e de pessoas devem ser dimensionados por profissional legalmente habilitado e atender às normas técnicas nacionais vigentes ou, na sua ausência, às normas técnicas internacionais vigentes.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Programa de manutenção preventiva
- **Descrição:** Cronograma e registro sistemático de revisões em máquinas e equipamentos para evitar falhas mecânicas
- **Requisito legal:** Item 18.11.7 Toda empresa usuária de equipamentos de movimentação e transporte vertical de materiais e/ou pessoas deve possuir os seguintes documentos disponíveis no canteiro de obras: a) programa de manutenção preventiva, conforme recomendação do locador, importador ou fabricante;
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Termo de entrega técnica
- **Descrição:** Documento formal do montador ou fabricante atestando que o equipamento foi instalado conforme as normas e está apto ao uso
- **Requisito legal:** Item 18.11.7 b) termo de entrega técnica de acordo com as normas técnicas nacionais vigentes ou, na sua ausência, de acordo com o determinado pelo profissional legalmente habilitado responsável pelo equipamento;
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Laudo de testes dos freios de emergência
- **Descrição:** Relatório de ensaio funcional dos sistemas de frenagem de segurança em elevadores de obra ou guinchos de carga.
- **Requisito legal:** Item 18.11.7 c) laudo de testes dos freios de emergência a serem realizados, no máximo, a cada 90 (noventa) [...]
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro de vistorias diárias (Checklist)
- **Descrição:** Formulário preenchido pelo operador antes do início de cada turno para conferência dos itens de segurança da máquina
- **Requisito legal:** Item 18.11.7 d) registro, pelo operador, das vistorias diárias realizadas [...]
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Laudos de ensaios não destrutivos (END)
- **Descrição:** Certificados de testes (como ultrassom) realizados nos eixos e componentes críticos dos sistemas de freio de elevadores.
- **Requisito legal:** Item 18.11.7 e) laudos dos ensaios não destrutivos dos eixos dos motofreios [...]
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Manual de orientação do fabricante
- **Descrição:** Instruções originais em português que detalham a operação, limites e manutenção segura de cada máquina
- **Requisito legal:** Item 18.11.7 f) manual de orientação do fabricante [...]
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** CONCLUÍDA
#### Registro das atividades de manutenção
- **Descrição:** Histórico cronológico de todas as intervenções corretivas ou preventivas realizadas nos equipamentos
- **Requisito legal:** Item 18.11.7 g) registro das atividades de manutenção conforme item 12.11 da NR-12;
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** EM ANDAMENTO
#### Laudo de aterramento
- **Descrição:** Certificado de medição da resistência do sistema de terra das carcaças de máquinas e quadros elétricos
- **Requisito legal:** Item 18.11.7 h) laudo de aterramento elaborado por profissional legalmente habilitado.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### FISPQ (ou FDS) de materiais químicos
- **Descrição:** Ficha de informações de segurança para produtos tóxicos, inflamáveis ou corrosivos utilizados nas diversas fases da construção.
- **Requisito legal:** Item 18.16.5 Os locais destinados ao armazenamento de materiais tóxicos, corrosivos, inflamáveis ou explosivos devem: c) dispor de FISPQ.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 19 Título de Registro (TR) emitido pelo Exército Brasileiro
**Total de multas registrado no estado da planilha:** 14103.5814
### Itens
#### Título de Registro (TR) ou Certificado de Registro (CR)
- **Descrição:** Autorização formal expedida pelo Comando do Exército para a fabricação, armazenamento ou manuseio de explosivos
- **Requisito legal:** Item 19.4.1: "A fabricação de explosivos somente é permitida às organizações portadoras de Certificado de Conformidade homologado pelo Exército Brasileiro."
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** CANCELADA
#### Plano de Gerenciamento de Riscos
- **Descrição:** Documento que detalha a análise de riscos das atividades e as medidas de controle para prevenir acidentes com explosivos
- **Requisito legal:** Item 19.3.5: "O Programa de Gerenciamento de Riscos - PGR das organizações que fabricam, armazenam e transportam explosivos deve contemplar além do previsto na NR-1, os fatores de riscos de incêndio e explosão e a implementação das respectivas medidas de prevenção."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de emergência e combate a incêndio
- **Descrição:** Protocolo com procedimentos específicos para situações de explosão, incêndio ou vazamento de materiais perigosos
- **Requisito legal:** Item 5.6 (Anexo I): "Outros procedimentos ou planos específicos devem ser elaborados (...) devendo ser incluídos, no mínimo: a) Plano de Emergência e Combate a Incêndio e Explosão;"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Manual de procedimentos operacionais
- **Descrição:** Instruções técnicas detalhadas para cada etapa da produção, manuseio e movimentação de substâncias explosivas
- **Requisito legal:** Item 8.3 (Anexo I): "As organizações devem instituir e implementar Procedimentos Operacionais para todas as atividades, sob a orientação do Responsável Técnico, especificando detalhadamente os procedimentos seguros para a execução de cada tarefa (...)"
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Projeto das instalações e memorial descritivo
- **Descrição:** Plantas e descritivos técnicos que especificam as distâncias de segurança e as características construtivas dos depósitos e fábricas
- **Requisito legal:** Anexo I, Item 4.1 As instalações físicas dos estabelecimentos devem obedecer ao disposto na Norma Regulamentadora nº 8 (NR-8), assim como no normativo de explosivos da Diretoria de Fiscalização de Produto Controlado do Exército Brasileiro.
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Laudo de inspeção do sistema de proteção contra descargas atmosféricas (SPDA)
- **Descrição:** Registro técnico que certifica a eficiência da proteção contra raios, vital para evitar a ignição acidental de explosivos
- **Requisito legal:** 19.4.4 Os locais de fabricação de explosivos devem ser: d) dotados de equipamentos aterrados e, se necessárias, instalações elétricas especiais de segurança;
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** PENDENTE
#### Comprovação de treinamento e capacitação
- **Descrição:** Registros de treinamentos específicos para trabalhadores que lidam com explosivos, incluindo riscos, medidas de prevenção e emergência
- **Requisito legal:** Anexo I, item 14.1.4 Ao término dos treinamentos inicial, periódico ou eventual, é obrigatório o registro de seu conteúdo, carga horária e frequência, em conformidade com a NR-1
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro de controle de estoque e movimentação
- **Descrição:** Documentação sistemática de entrada e saída de materiais explosivos para garantir o rastreamento e o limite de carga das instalações
- **Requisito legal:** Item 5.5 (Anexo I): "As organizações devem manter à disposição dos órgãos de fiscalização um inventário de todos os produtos por elas utilizados ou fabricados (...) contendo, pelo menos: a) nome do produto (...) d) local de armazenamento;"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Autorização para transporte de produtos perigosos
- **Descrição:** Documento que autoriza e define as rotas e condições para o transporte de cargas explosivas, seguindo normas de trânsito e do Exército
- **Requisito legal:** Item 19.6.1: "O transporte de explosivos deve atender as prescrições gerais de acordo com o meio de transporte a ser utilizado: I - transporte rodoviário: normas da Agência Nacional de Transportes Terrestres - ANTT; (...)"
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** EM ANDAMENTO

# NR 20 INFLAMÁVEIS E COMBUSTÍVEIS (Especial)
**Total de multas registrado no estado da planilha:** 4701.1938
### Itens
#### Projeto de instalação da NR-20
- **Descrição:** Documentação técnica assinada por profissional habilitado, contendo plantas, memorial descritivo, distâncias de segurança e classificação de áreas.
- **Requisito legal:** Item 20.5.2: "No projeto das instalações classes I, II e III devem constar, no mínimo, e em língua portuguesa: a) descrição das instalações e seus respectivos processos através do manual de operações; b) planta geral de locação das instalações; c) características e informações de segurança, saúde e meio ambiente relativas aos inflamáveis e líquidos combustíveis (...) d) especificação técnica dos equipamentos (...) e) plantas, desenhos e especificações técnicas dos sistemas de segurança da instalação; f) identificação das áreas classificadas da instalação (...)"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de Inspeção e Manutenção
- **Descrição:** Cronograma sistemático para verificar a integridade de tanques, tubulações, bombas e sistemas de segurança, visando evitar falhas estruturais.
- **Requisito legal:** Item 20.10.1: "As instalações classes I, II e III para extração, produção, armazenamento, transferência, manuseio e manipulação de inflamáveis e líquidos combustíveis devem possuir plano de inspeção e manutenção devidamente documentado, em formulário próprio ou sistema informatizado."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Análise de riscos
- **Descrição:** Estudo detalhado (APR, HAZOP ou "What-if") que identifica perigos e avalia cenários acidentais para implementar medidas de controle.
- **Requisito legal:** Item 20.7.1: "Nas instalações classes I, II e III, o empregador deve elaborar e documentar as análises de riscos das operações que envolvam processo ou processamento nas atividades de extração, produção, armazenamento, transferência, manuseio e manipulação de inflamáveis e de líquidos combustíveis."
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** PROGRAMADA
#### Plano de prevenção e controle de vazamentos
- **Descrição:** Conjunto de medidas e sistemas de contenção (como bacias e drenagens) para evitar o espalhamento de inflamáveis e a contaminação ambiental.
- **Requisito legal:** Item 20.14.1: "O empregador deve elaborar plano que contemple a prevenção e controle de vazamentos, derramamentos, incêndios e explosões e, nos locais sujeitos à atividade de trabalhadores, a identificação e controle das fontes de emissões fugitivas."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de procedimentos operacionais
- **Descrição:** Instruções de trabalho padronizadas para as rotinas de operação segura, incluindo partida, parada e operação normal da instalação.
- **Requisito legal:** Item 20.9.1: "O empregador deve elaborar, documentar, implementar, divulgar e manter atualizados procedimentos operacionais que contemplem aspectos de segurança e saúde no trabalho, em conformidade com as especificações do projeto das instalações classes I, II e III e com as recomendações das análises de riscos."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de respostas a emergências (PRE)
- **Descrição:** Estratégia completa que define as ações de combate a incêndio, abandono de área, isolamento e primeiros socorros.
- **Requisito legal:** Item 20.15.1: "O empregador deve elaborar e implementar plano de resposta a emergências que contemple ações específicas a serem adotadas na ocorrência de vazamentos ou derramamentos de inflamáveis e líquidos combustíveis, incêndios ou explosões."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Procedimentos básicos em emergência
- **Descrição:** Orientações diretas e simplificadas para ações imediatas de controle e comunicação logo após a detecção de um incidente.
- **Requisito legal:** Item 20.12.4: "Os trabalhadores que laboram em instalações classes I, II ou III e não adentram na área (...) devem receber informações sobre os perigos, riscos e sobre procedimentos para situações de emergências."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Procedimentos para abastecimento de tanques
- **Descrição:** Regras críticas para a transferência de combustíveis, focando no aterramento elétrico, vedação de conexões e monitoramento de níveis.
- **Requisito legal:** Anexo III, item 2.2 O responsável pela segurança do edifício deve designar responsável técnico pela instalação, operação, inspeção e manutenção, bem como pela supervisão dos procedimentos de segurança no processo de abastecimento do tanque.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovação de treinamentos da NR-20
- **Descrição:** Registros e certificados de capacitação dos trabalhadores, variando entre os níveis Básico, Intermediário, Avançado e Específico.
- **Requisito legal:** Item 20.12.15: "O empregador deve estabelecer e manter sistema de identificação que permita conhecer a capacitação de cada trabalhador."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 21 TRABALHO A CÉU ABERTO (Especial)
**Total de multas registrado no estado da planilha:** 0
### Itens
#### Relatório de inspeção de abrigos
- **Descrição:** Registro que comprova a existência e a adequação de abrigos, fixos ou móveis, que protejam os trabalhadores contra intempéries (sol, chuva e ventos).
- **Requisito legal:** 21.1. Nos trabalhos realizados a céu aberto, é obrigatória a existência de abrigos, ainda que rústicos, capazes de proteger os trabalhadores contra intempéries.
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não há trabalho a céu aberto
- **Valor de multa registrado:** -
#### Comprovação de fornecimento de água potável
- **Descrição:** Documentação que atesta o fornecimento de água potável, filtrada e fresca em condições higiênicas nos locais de trabalho.
- **Requisito legal:** 21.10. O poço de água será protegido contra a contaminação.
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não há trabalho a céu aberto
- **Valor de multa registrado:** -
#### Registro de manutenção de fossas sépticas
- **Descrição:** Documento que registra a limpeza e manutenção de fossas sépticas em locais onde não existe rede de esgoto, garantindo as condições sanitárias.
- **Requisito legal:** 21.13. As fossas negras deverão estar, no mínimo, 15,00m (quinze metros) do poço; 10,00m (dez metros) da casa, em lugar livre de enchentes e à jusante do poço.
- **Infração:** 2
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não há trabalho a céu aberto
- **Valor de multa registrado:** -
#### Dossiê de alojamentos e moradias
- **Descrição:** Conjunto de documentos (plantas ou descritivos) que comprovam que as habitações fornecidas atendem aos requisitos de higiene e proteção contra o clima.
- **Requisito legal:** 21.7. A moradia deverá ter: a) capacidade dimensionada de acordo com o número de moradores; b) ventilação e luz direta suficiente; c) as paredes caiadas e os pisos construídos de material impermeável.
- **Infração:** 2
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não há trabalho a céu aberto
- **Valor de multa registrado:** -
#### Laudo de proteção térmica/solar
- **Descrição:** Parte integrante do PGR que descreve as medidas adotadas (como coberturas ou EPIs) para mitigar a exposição excessiva ao calor e radiação solar.
- **Requisito legal:** 21.11. A cobertura será sempre feita de material impermeável, imputrecível, não combustível.
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não há trabalho a céu aberto
- **Valor de multa registrado:** -

# NR 22 MINERAÇÃO (Setorial)
**Total de multas registrado no estado da planilha:** 0
### Itens
#### PGR da mineração
- **Descrição:** Programa de Gerenciamento de Riscos específico que contempla riscos físicos, químicos, biológicos, ergonômicos e de acidentes, incluindo estabilidade de taludes e ventilação.
- **Requisito legal:** Item 22.4.1.1: "O Programa de Gerenciamento de Riscos Ocupacionais (PGR) deve ser elaborado, preferencialmente, por equipe multidisciplinar e implementado sob responsabilidade da organização."
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Documentação da CIPAMIN
- **Descrição:** Registros da Comissão Interna de Prevenção de Acidentes na Mineração, contendo atas de reunião, documentos de eleição, treinamentos e mapas de riscos.
- **Requisito legal:** Item 22.35.2: "A organização deve manter os indicadores de acidentes e doenças relacionadas ao trabalho atualizado, assegurando pleno acesso a essa documentação à CIPAMIN e ao SESMT, quando houver."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de trânsito
- **Descrição:** Documento que estabelece as regras de circulação, sinalização, prioridades de movimentação e limites de velocidade para veículos, equipamentos e pedestres na mina.
- **Requisito legal:** Item 22.7.1: "Toda mina deve possuir plano de trânsito estabelecendo regras de preferência de movimentação, distâncias mínimas entre máquinas, equipamentos e veículos compatíveis com a segurança, velocidades permitidas, de acordo com as condições das pistas de rolamento."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Instalações elétricas e manutenções
- **Descrição:** Conjunto de esquemas unifilares, prontuários e registros de manutenção dos sistemas elétricos, adaptados às condições de umidade e abrasividade do ambiente mineiro.
- **Requisito legal:** Item 22.18.1: "A organização deve atender o disposto na NR-10 e as demais disposições deste capítulo."
- **Infração:** 0
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 0
- **Status:** PENDENTE
#### Plano de Atendimento a Emergências (PAE)
- **Descrição:** Planejamento estratégico que define procedimentos de resgate, abandono de área, combate a incêndio e primeiros socorros para cenários críticos na mineração.
- **Requisito legal:** Item 22.30.1: "Toda mina deve elaborar, implementar e manter atualizado um Plano de Atendimento a Emergências que inclua, no mínimo, os seguintes requisitos e, quando aplicáveis, os seguintes cenários: a) identificação de seus riscos maiores; b) procedimentos para operações em caso de: I - incêndios; II - inundações; III - explosões; IV - desabamentos; V - paralisação do fornecimento de energia para o sistema de ventilação principal da mina; VI - acidentes maiores; (...) VIII - outras situações de emergência em função das características da mina, dos produtos e dos insumos utilizados;" [...]
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovação dos treinamentos da NR-22
- **Descrição:** Certificados e registros que atestam a realização da integração (mínimo de 24h para céu aberto ou 40h para subsolo) e dos treinamentos periódicos anuais.
- **Requisito legal:** Anexo II, item 2.3.3.2.1 A etapa prática deve ser supervisionada e documentada, podendo ser realizada na própria máquina ou equipamento que será operado
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 23 PROTEÇÃO CONTRA INCÊNDIOS (Especial)
**Total de multas registrado no estado da planilha:** 0
### Itens
#### Registro de orientações de segurança
- **Descrição:** Documento que comprova que os trabalhadores receberam informações sobre a utilização dos equipamentos de combate, procedimentos de alarme e evacuação.
- **Requisito legal:** Item 23.3.2: "A organização deve providenciar para todos os trabalhadores informações sobre: a) utilização dos equipamentos de combate ao incêndio; b) procedimentos de resposta aos cenários de emergências e para evacuação dos locais de trabalho com segurança; e c) dispositivos de alarme existentes."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Certificado de treinamento e capacitação
- **Descrição:** Registro que atesta a realização de treinamentos específicos para a utilização de equipamentos de combate a incêndio e procedimentos de saída de emergência.
- **Requisito legal:** Documento não consta de forma explícita na NR. Exigido pelo Corpo de Bombeiros, para brigada de incêndio.
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Relatório de inspeção visual e manutenção
- **Descrição:** Registro periódico das condições de conservação e validade de extintores, hidrantes, mangueiras e demais dispositivos de combate.
- **Requisito legal:** Sugerido. Documento não exigido pela NR.
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro de teste do alarme de incêndio
- **Descrição:** Documentação que comprova a funcionalidade do sistema de alerta sonoro e visual em todo o estabelecimento.
- **Requisito legal:** Sugerido. Documento não exigido pela NR.
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Projeto de saídas de emergência e sinalização
- **Descrição:** Desenhos técnicos ou plantas que indicam a localização das saídas, iluminação de emergência e rotas de fuga desobstruídas.
- **Requisito legal:** Item 23.3.4: "As aberturas, saídas e vias de passagem de emergência devem ser identificadas e sinalizadas de acordo com a legislação estadual e, quando aplicável, de forma complementar, com as normas técnicas oficiais, indicando a direção da saída."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de emergência contra incêndio
- **Descrição:** Documento (frequentemente integrado ao PGR) que define a estratégia de abandono, pontos de encontro e responsabilidades em caso de sinistro.
- **Requisito legal:** Item 23.3.1 Toda organização deve adotar medidas de prevenção contra incêndios em conformidade com a legislação estadual e, quando aplicável, de forma complementar, com as normas técnicas oficiais.
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Ficha de controle de equipamentos de combate
- **Descrição:** Dossiê individual ou coletivo que detalha a data de fabricação, última carga e testes hidrostáticos dos extintores.
- **Requisito legal:** Sugerido. Documento não exigido pela NR.
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 24 CONDIÇÕES SANITÁRIAS E DE CONFORTO NOS LOCAIS DE TRABALHO (Especial)
**Total de multas registrado no estado da planilha:** 0
### Itens
#### Memorial de cálculo de dimensionamento das instalações
- **Descrição:** Documento técnico que justifica a quantidade de vasos sanitários, mictórios, lavatórios e chuveiros com base no número de trabalhadores por turno.
- **Requisito legal:** Item 24.1.1: "Esta norma estabelece as condições mínimas de higiene e de conforto a serem observadas pelas organizações, devendo o dimensionamento de todas as instalações regulamentadas por esta NR ter como base o número de trabalhadores usuários do turno com maior contingente."
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de limpeza e higienização
- **Descrição:** Registro formal que estabelece a periodicidade e os métodos de limpeza das instalações sanitárias, refeitórios e áreas de vivência.
- **Requisito legal:** Item 24.9.6: "Os locais de trabalho serão mantidos em estado de higiene compatível com o gênero de atividade."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Certificado de potabilidade da água
- **Descrição:** Laudo laboratorial que comprova que a água fornecida para consumo é potável, filtrada e fresca.
- **Requisito legal:** Item 24.9.3: "Deve ser realizada periodicamente análise de potabilidade da água dos reservatórios para verificar sua qualidade, em conformidade com a legislação."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Memorial descritivo de refeitórios e cozinhas
- **Descrição:** Documento que atesta que as áreas de refeição possuem ventilação adequada, iluminação conforme normas técnicas e metragem quadrada mínima por usuário.
- **Requisito legal:** Item 24.9.7 Todos os ambientes previstos nesta norma devem ser construídos de acordo com o código de obras local, devendo [...]
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Projeto de vestiários e armários
- **Descrição:** Planta ou descritivo que detalha a área mínima por trabalhador e o tipo de armário (simples ou duplo) exigido pela natureza da atividade.
- **Requisito legal:** Item 24.4.6: "Os armários simples devem ter tamanho suficiente para que o trabalhador guarde suas roupas e acessórios de uso pessoal, não sendo admitidas dimensões inferiores a: 0,40m (quarenta centímetros) de altura, 0,30m (trinta centímetros) de largura e 0,40m (quarenta centímetros) de profundidade."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Dossiê de alojamentos e dormitórios
- **Descrição:** Conjunto de documentos que comprovam que as moradias coletivas atendem aos requisitos de cubagem de ar, dimensões de camas e isolamento térmico/acústico.
- **Requisito legal:** Item 24.7.3: "Os quartos dos dormitórios devem: (...) e) possuir capacidade máxima para 8 (oito) trabalhadores; (...) g) ter, no mínimo, a relação de 3,00 m² (três metros quadrados) por cama simples ou 4,50 m2 (quatro metros e cinquenta centímetros quadrados) por beliche (...)"
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 25 RESÍDUOS INDUSTRIAIS (Especial)
**Total de multas registrado no estado da planilha:** 0
### Itens
#### Comprovação de aprovação de medidas de controle
- **Descrição:** Documentação técnica que atesta o exame e a aprovação, pelos órgãos competentes, das medidas e equipamentos destinados ao controle de lançamento de contaminantes
- **Requisito legal:** Item 25.3.3: "As medidas, métodos, equipamentos ou dispositivos de controle do lançamento ou liberação de contaminantes gasosos, líquidos ou sólidos devem ser submetidos ao exame e à aprovação dos órgãos competentes."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro de capacitação e treinamento
- **Descrição:** Comprovação documental de que os trabalhadores envolvidos na coleta, transporte e tratamento de resíduos receberam treinamento contínuo sobre riscos e prevenção
- **Requisito legal:** Item 25.3.7: "Os trabalhadores envolvidos em atividades de coleta, manipulação, acondicionamento, armazenamento, transporte, tratamento e disposição de resíduos industriais devem ser capacitados pela empresa, de forma continuada, sobre os riscos ocupacionais envolvidos e as medidas de prevenção adequadas."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de gerenciamento de resíduos (PGRS)
- **Descrição:** Documento que detalha as etapas de coleta, acondicionamento, armazenamento, transporte e tratamento dos resíduos industriais gerados
- **Requisito legal:** Item 25.3.4: "Os resíduos sólidos e efluentes líquidos produzidos por processos e operações industriais devem ser coletados, acondicionados, armazenados, transportados, tratados e encaminhados à disposição final pela organização na forma estabelecida em lei ou regulamento específico."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovantes de destinação final
- **Descrição:** Registros e manifestos que atestam o encaminhamento adequado de resíduos sólidos e efluentes líquidos para disposição final, conforme a lei
- **Requisito legal:** Item 25.3.4: "Os resíduos sólidos e efluentes líquidos produzidos por processos e operações industriais devem ser coletados, acondicionados, armazenados, transportados, tratados e encaminhados à disposição final pela organização na forma estabelecida em lei ou regulamento específico."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 26 SINALIZAÇÃO DE SEGURANÇA (Especial)
**Total de multas registrado no estado da planilha:** 0
### Itens
#### Padrão de cores de segurança
- **Descrição:** Definição das cores utilizadas para identificar equipamentos, delimitar áreas e sinalizar tubulações, seguindo as normas técnicas oficiais.
- **Requisito legal:** Item 26.3.2: "As cores utilizadas para identificar os equipamentos de segurança, delimitar áreas, identificar tubulações empregadas para a condução de líquidos e gases e advertir contra riscos devem atender ao disposto nas normas técnicas oficiais."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Rotulagem preventiva
- **Descrição:** Conjunto de informações (nome, pictograma de perigo, palavras de advertência e frases de precaução) que deve ser afixado às embalagens de produtos químicos.
- **Requisito legal:** Item 26.4.2.2: "A rotulagem preventiva do produto químico classificado como perigoso à segurança e à saúde dos trabalhadores deve utilizar procedimentos definidos pelo GHS, contendo os seguintes elementos: a) identificação e composição do produto químico; b) pictograma(s) de perigo; c) palavra de advertência; d) frase(s) de perigo; e) frase(s) de precaução; e f) informações suplementares."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Ficha com dados de segurança (FDS)
- **Descrição:** Documento elaborado pelo fabricante ou fornecedor contendo informações detalhadas sobre perigos, riscos e medidas de segurança para produtos químicos perigosos.
- **Requisito legal:** Item 26.4.3.1: "O fabricante ou, no caso de importação, o fornecedor no mercado nacional, deve elaborar e tornar disponível ficha com dados de segurança do produto químico para todo produto químico classificado como perigoso."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro de treinamento e capacitação
- **Descrição:** Comprovação documental de que os trabalhadores foram treinados para compreender a rotulagem e a ficha de segurança, além dos riscos e procedimentos de emergência.
- **Requisito legal:** Item 26.5.2: "Os trabalhadores devem receber treinamento: a) para compreender a rotulagem preventiva e a ficha com dados de segurança do produto químico; e b) sobre os perigos, os riscos, as medidas preventivas para o uso seguro e os procedimentos para atuação em situações de emergência com o produto químico."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Lista de classificação de produtos químicos
- **Descrição:** Registro da classificação de perigos dos produtos utilizados no local de trabalho, baseada no Sistema Globalmente Harmonizado (GHS).
- **Requisito legal:** Item 26.4.1.1: "O produto químico utilizado no local de trabalho deve ser classificado quanto aos perigos para a segurança e a saúde dos trabalhadores, de acordo com os critérios estabelecidos pelo Sistema Globalmente Harmonizado de Classificação e Rotulagem de Produtos Químicos - GHS, da Organização das Nações Unidas."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 27 REGISTRO PROFISSIONAL DO TST (REVOGADA)
### Itens
#### A NR-27 foi revogada.
- **Infração:** False
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não

# NR 28 FISCALIZAÇÃO E PENALIDADES (geral)
**Total de multas registrado no estado da planilha:** 0
### Itens
#### Auto de infração
- **Descrição:** Documento oficial lavrado pelo Auditor Fiscal do Trabalho quando constatado o descumprimento de preceitos legais ou regulamentares de SST
- **Requisito legal:** Item 28.1.3: "O agente da inspeção do trabalho deverá lavrar o respectivo auto de infração à vista de descumprimento dos preceitos legais e/ou regulamentares contidos nas Normas Regulamentadoras urbanas e rurais, considerando o critério da dupla visita, elencados no Decreto nº 55.841, de 15/03/65, no Título VII da CLT e no § 3º do art. 6º da Lei nº 7.855, de 24/10/89."
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Termo de notificação
- **Descrição:** Registro emitido pela fiscalização que fixa prazos técnicos (geralmente até 60 dias) para que o empregador corrija as irregularidades encontradas
- **Requisito legal:** Documento citado na NR, mas sem item descritivo.
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Laudo técnico (fiscalização)
- **Descrição:** Parecer técnico emitido por engenheiro de segurança ou médico do trabalho da inspeção para fundamentar autos de infração ou propostas de paralisação
- **Requisito legal:** Item 28.1.5: "Poderão ainda os agentes da inspeção do trabalho lavrar auto de infração pelo descumprimento dos preceitos legais e/ou regulamentares sobre segurança e saúde do trabalhador, à vista de laudo técnico emitido por engenheiro de segurança do trabalho ou médico do trabalho, devidamente habilitado."
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Termo de embargo
- **Descrição:** Documento que formaliza a paralisação imediata, parcial ou total, de uma obra quando caracterizada situação de risco grave e iminente
- **Requisito legal:** Item 28.2.1: "Quando o agente da inspeção do trabalho constatar situação de grave e iminente risco à saúde e/ou integridade física do trabalhador, com base em critérios técnicos, deverá propor de imediato à autoridade regional competente a interdição do estabelecimento, setor de serviço, máquina ou equipamento, ou o embargo parcial ou total da obra, determinando as medidas que deverão ser adotadas para a correção das situações de risco."
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Termo de interdição
- **Descrição:** Documento que formaliza a paralisação de estabelecimento, setor de serviço, máquina ou equipamento por risco iminente à saúde ou integridade do trabalhador
- **Requisito legal:** Item 28.2.2: "A autoridade regional competente, à vista de novo laudo técnico do agente da inspeção do trabalho, procederá à suspensão ou não da interdição ou embargo."
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Relatório circunstanciado
- **Descrição:** Documento detalhado elaborado pelo agente da inspeção que registra o descumprimento reiterado de normas para subsidiar convocações legais da empresa
- **Requisito legal:** Item 28.2.3: "A autoridade regional competente, à vista de relatório circunstanciado, elaborado por agente da inspeção do trabalho que comprove o descumprimento reiterado das disposições legais e/ou regulamentares sobre segurança e saúde do trabalhador, poderá convocar representante legal da empresa para apurar o motivo da irregularidade e propor solução para corrigir as situações que estejam em desacordo com exigências legais."
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Solicitação de prorrogação de prazo
- **Descrição:** Documento formal da empresa, com exposição de motivos relevantes, enviado à autoridade regional para estender o tempo de correção de itens notificados
- **Requisito legal:** Item 28.1.4.4: "A empresa poderá recorrer ou solicitar prorrogação de prazo de cada item notificado até no máximo 10 (dez) dias a contar da data de emissão da notificação."
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 29 TRABALHO PORTUÁRIO SETORIAL
**Total de multas registrado no estado da planilha:** 3513.6582
### Itens
#### PGR (Programa de Gerenciamento de Riscos)
- **Descrição:** Documento que identifica perigos e avalia riscos nas operações portuárias, estabelecendo medidas de prevenção e plano de ação.
- **Requisito legal:** Item 29.4.1: "O operador portuário, o tomador de serviço e o empregador devem: a) elaborar e implementar o Programa de Gerenciamento de Riscos, nos termos da NR-01 na instalação portuária em que atuem;"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de controle de emergência (PCE)
- **Descrição:** Planejamento técnico que define as ações a serem adotadas em casos de incêndio, explosão, vazamento de carga ou queda de homem ao mar.
- **Requisito legal:** Item 29.28.1: "Compete à administração do Porto Organizado e aos titulares das instalações portuárias autorizadas e arrendadas a elaboração e implementação do PCE..."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** EM ANDAMENTO
#### Plano de ajuda mútua (PAM)
- **Descrição:** Documento formalizando a cooperação entre diferentes operadores portuários e órgãos públicos para resposta conjunta a grandes emergências.
- **Requisito legal:** Item 29.29.1: "Os Terminais Portuários, as Administrações Portuárias e os Órgãos Gestores de Mão de Obra - OGMO devem estabelecer e manter um Plano de Ajuda Mútua - PAM..."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registros de inspeção de acessórios de carga
- **Descrição:** Registro das vistorias e testes de carga realizados em cabos de aço, correntes, manilhas, cintas e outros acessórios de içamento.
- **Requisito legal:** Item 29.13.19: "O responsável pelo equipamento deverá disponibilizar ao OGMO e aos trabalhadores capacitados o manual da máquina ou equipamento, o relatório das inspeções realizadas e os registros de checagem prévia."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Certificado de teste de máquinas e equipamentos
- **Descrição:** Documentação técnica que atesta a conformidade e a capacidade de carga de guindastes, pórticos e demais equipamentos de movimentação.
- **Requisito legal:** Item 29.14.1: "A operação portuária de movimentação de carga somente poderá ser iniciada após o operador portuário ou o titular da instalação portuária se certificar junto ao comandante da embarcação (...) as funcionalidades e a segurança dos equipamentos de guindar de bordo e seus acessórios de estivagem, devendo observar: a) a última certificação dos últimos cinco anos;"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro de treinamento e capacitação
- **Descrição:** Comprovação documental de que os trabalhadores portuários receberam treinamento específico para as funções e riscos da operação.
- **Requisito legal:** item 29.27.12 Cabe ao OGMO, tomador de serviço ou empregador: b) promover a capacitação dos trabalhadores em operações com cargas perigosas.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de trânsito interno
- **Descrição:** Documento que estabelece regras de circulação, sinalização e prioridades para veículos e pedestres dentro da área do porto.
- **Requisito legal:** Item 29.18.1: "As instalações portuárias devem dispor de um regulamento próprio que discipline a rota de tráfego de veículos, equipamentos, ciclistas e pedestres, bem como a movimentação de cargas no cais, plataformas, pátios, estacionamentos, armazéns e demais espaços operacionais."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Dossiê de mercadorias perigosas
- **Descrição:** Documentação contendo a ficha com dados de segurança (FDS) e as instruções de manuseio e emergência para cargas químicas ou explosivas.
- **Requisito legal:** Item 29.27.28 No projeto de armazenamento de cargas perigosas, devem constar: c) características e informações de segurança, saúde e do ambiente de trabalho relativas às mercadorias armazenadas, constantes nas fichas com dados de segurança das cargas perigosas
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Prontuário de instalações elétricas
- **Descrição:** Sistema organizado contendo a memória técnica das instalações elétricas do porto, em conformidade com a NR-10.
- **Requisito legal:** Item 29.27.28: "No projeto de armazenamento de cargas perigosas, devem constar: (...) e) identificação das áreas classificadas nas áreas de armazenagem, para efeito de especificação dos equipamentos e instalações elétricas;"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 30 TRABALHO AQUAVIÁRIO (Setorial)
**Total de multas registrado no estado da planilha:** 5854.6782
### Itens
#### Comprovação de treinamentos da NR-30
- **Descrição:** Registros e certificados que atestam a capacitação da tripulação em segurança, saúde e preservação do meio ambiente.
- **Requisito legal:** Item 30.17.1.1 O tomador de serviços de profissionais não tripulantes deverá exigir do prestador de serviços o(s) certificado(s) de capacitação para o exercício das atividades que irão realizar.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Documento de componentes do GSSTB
- **Descrição:** Lista formal identificando os tripulantes que integram o grupo de segurança, como o Comandante e o Oficial de Segurança.
- **Requisito legal:** Item 30.7.3.1: "O GSSTB fica sob a responsabilidade do comandante da embarcação e deve ser integrado pelos seguintes tripulantes: a) encarregado da segurança; b) chefe de máquinas; c) representante do nível técnico de subalterno da seção de convés; d) responsável pela seção de saúde, se existente; e e) representante do nível técnico de subalterno da seção de máquinas."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** PENDENTE
#### Dimensionamento e componentes da CIPA
- **Descrição:** Registro da constituição da comissão interna, adaptada para o setor aquaviário conforme as regras da NR-5 e NR-30.
- **Requisito legal:** Item 30.6.1.1: "Os aquaviários serão representados na CIPA do estabelecimento com maior número de trabalhadores, na razão de um membro titular para cada dez embarcações da organização, ou fração, e de um suplente para cada vinte embarcações da organização, ou fração."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Procedimentos de SST e Meio Ambiente
- **Descrição:** Guias escritos com as instruções operacionais para a execução segura das tarefas e proteção do ecossistema marinho.
- **Requisito legal:** Item 30.4.2 A organização deve elaborar e manter na embarcação os seguintes procedimentos operacionais: a) procedimentos de segurança nas atividades de manutenção em embarcação em operação; b) orientação aos trabalhadores quanto aos procedimentos a serem adotados na ocorrência de condições climáticas extremas e interrupção das atividades nessas situações; c) procedimentos de acesso seguro à embarcação atracada e fundeada; d) procedimentos seguros de movimentação de carga; e) procedimentos de segurança nas atividades que envolvam outras embarcações, balsas, plataformas de petróleo e demais unidades marítimas; e f) procedimentos de segurança nas manobras de atracação e fundeio.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Análise das causas de acidentes a bordo
- **Descrição:** Relatório de investigação técnica que identifica as origens dos acidentes para evitar sua repetição.
- **Requisito legal:** Item 30.7.6.1.1: "As reuniões do GSSTB devem contemplar, no mínimo, os seguintes temas: (...) f) apresentação de resultados de investigação de acidentes e ocorrências perigosas ocorridos no último mês e ações corretivas adotadas e propostas;"
- **Infração:** 2
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 2341.02
- **Status:** EM ANDAMENTO
#### Quadro estatístico (Quadro I)
- **Descrição:** Formulário padronizado pela norma para a compilação e controle das estatísticas de acidentes e doenças.
- **Requisito legal:** Item 30.7.5: "São atribuições do GSSTB: (...) e) preencher o quadro estatístico de acidentes, conforme modelo constante no Quadro I, e elaborar relatório, encaminhando-os ao empregador;"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovação de palestras e debates
- **Descrição:** Evidências de atividades educativas e de conscientização realizadas com a tripulação sobre temas de prevenção.
- **Requisito legal:** Item 30.7.5: "São atribuições do GSSTB: (...) g) promover, a bordo, palestras e debates de caráter educativo, assim como a distribuição de publicações e/ou recursos audiovisuais relacionados com os propósitos do grupo;"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Planejamento de simulados
- **Descrição:** Cronograma de exercícios de emergência (abandono, incêndio, resgate) para garantir a prontidão da resposta.
- **Requisito legal:** Item 30.7.5: "São atribuições do GSSTB: (...) f) participar do planejamento para a execução dos exercícios regulamentares de segurança (...) avaliando os resultados e propondo medidas corretivas;"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Atas de reuniões (GSSTB)
- **Descrição:** Registros formais das discussões mensais obrigatórias sobre riscos, avaliações e melhorias na segurança de bordo.
- **Requisito legal:** Item 30.7.6.5: "Ao final de cada reunião será elaborada uma ata referente às questões discutidas."
- **Infração:** 1
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 31 RURAL (SETORIAL)
**Total de multas registrado no estado da planilha:** 3513.6582
### Itens
#### PGRTR (Programa de Gerenciamento de Riscos no Trabalho Rural)
- **Descrição:** Programa que consolida o gerenciamento dos riscos químicos, físicos, biológicos, de acidentes e ergonômicos em todas as etapas da atividade rural.
- **Requisito legal:** Item 31.3.1: "O empregador rural ou equiparado deve elaborar, implementar e custear o PGRTR, por estabelecimento rural, por meio de ações de segurança e saúde que visem à prevenção de acidentes e doenças decorrentes do trabalho nas atividades rurais."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Inventário de riscos ocupacionais
- **Descrição:** Documento técnico que detalha a identificação dos perigos e a avaliação dos riscos para cada atividade desempenhada pelos trabalhadores.
- **Requisito legal:** Item 31.3.3.2: "O PGRTR deve conter, no mínimo, os seguintes documentos: a) inventário de riscos ocupacionais;
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** CONCLUÍDA
#### Plano de ação da NR-31
- **Descrição:** Cronograma que estabelece as medidas de prevenção a serem implementadas, definindo prioridades, prazos e responsáveis pelo controle dos riscos.
- **Requisito legal:** Item 31.3.3.2: "O PGRTR deve conter, no mínimo, os seguintes documentos: (...) b) plano de ação."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Análise de acidentes de trabalho
- **Descrição:** Relatório de investigação técnica das causas de acidentes e doenças ocupacionais, visando eliminar fatores de risco e evitar recorrências.
- **Requisito legal:** Item 31.2.3: "Cabe ao empregador rural ou equiparado: (...) b) adotar os procedimentos necessários quando da ocorrência de acidentes e doenças do trabalho, incluindo a análise de suas causas;"
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovação dos treinamentos
- **Descrição:** Registros e certificados que atestam a capacitação dos trabalhadores sobre os riscos das atividades, uso de máquinas e medidas de segurança.
- **Requisito legal:** Item 31.2.6.1.1: "Ao término dos treinamentos ou capacitações, deve ser emitido certificado contendo o nome do trabalhador, o conteúdo programático, a carga horária, a data, o local de realização do treinamento, o nome e a qualificação dos instrutores e a assinatura do responsável técnico, devendo a assinatura do trabalhador constar em lista de presença ou certificado."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Documentação da CIPATR
- **Descrição:** Conjunto de atas de eleição, posse e reuniões da Comissão Interna de Prevenção de Acidentes no Trabalho Rural.
- **Requisito legal:** 31.5.8 Organizada a CIPATR, as atas de eleição e posse e o calendário das reuniões devem ser mantidos no estabelecimento à disposição da fiscalização do trabalho.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Dimensionamento do SESTR
- **Descrição:** Documento que justifica o quantitativo e a modalidade (próprio, externo ou coletivo) do serviço especializado em segurança rural da empresa.
- **Requisito legal:** Item 31.4.9: "O dimensionamento do SESTR coletivo deve ser realizado pelo somatório de trabalhadores de todos os estabelecimentos assistidos, observado o Quadro 1 desta NR."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 32 PROFISSIONAIS DE SAÚDE (setorial)
**Total de multas registrado no estado da planilha:** 11728.5102
### Itens
#### PGR (com observações da NR-32)
- **Descrição:** Programa que, além dos riscos gerais, deve conter o inventário detalhado de todos os produtos químicos (incluindo intermediários e resíduos) e a análise dos riscos biológicos prováveis, considerando fontes, vias de transmissão e patogenicidade.
- **Requisito legal:** Item 32.2.2.1: "O PGR, além do previsto na NR-01, na etapa de identificação de perigos, deve conter: I. Identificação dos riscos biológicos mais prováveis [...] II. Avaliação do local de trabalho e do trabalhador".
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** CONCLUÍDA
#### PCMSO (com observações da NR-32)
- **Descrição:** Plano que deve incluir a vigilância ativa da saúde ocupacional, o controle rigoroso da imunização dos trabalhadores e a autorização formal para gestantes atuarem em áreas com gases anestésicos.
- **Requisito legal:** Item 32.2.3.1: "O PCMSO, além do previsto na NR-07, e observando o disposto no inciso I do item 32.2.2.1, deve contemplar: a) o reconhecimento e a avaliação dos riscos biológicos; b) a localização das áreas de risco [...] c) a relação contendo a identificação nominal dos trabalhadores [...] d) a vigilância médica [...] e) o programa de vacinação".
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** PENDENTE
#### Plano de Proteção Radiológica (PPR)
- **Descrição:** Documento aprovado pela CNEN que estabelece as diretrizes de proteção para instalações radiativas, identificando responsáveis e integrando-se ao PGR e ao PCMSO do estabelecimento.
- **Requisito legal:** Item 32.4.2: "É obrigatório manter no local de trabalho e à disposição da inspeção do trabalho o Plano de Proteção Radiológica - PPR, aprovado pela CNEN, e para os serviços de radiodiagnóstico aprovado pela Vigilância Sanitária".
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Valor de multa registrado:** -
#### Programa de garantia de qualidade
- **Descrição:** Conjunto de ações planejadas e sistemáticas para garantir que os equipamentos de radiodiagnóstico operem dentro dos padrões de segurança e qualidade de imagem, reduzindo doses desnecessárias.
- **Requisito legal:** 32.4.15.1 É obrigatório manter no local de trabalho e à disposição da inspeção do trabalho o Alvará de Funcionamento vigente concedido pela autoridade sanitária local e o Programa de Garantia da Qualidade.
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Valor de multa registrado:** -
#### Alvará de funcionamento
- **Descrição:** Documento vigente concedido pela autoridade sanitária local que atesta que o estabelecimento de saúde cumpre as condições higiênico-sanitárias mínimas para operar.
- **Requisito legal:** 32.4.15.1 É obrigatório manter no local de trabalho e à disposição da inspeção do trabalho o Alvará de Funcionamento vigente concedido pela autoridade sanitária local e o Programa de Garantia da Qualidade.
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** PENDENTE
#### Plano de prevenção de riscos com perfurocortantes
- **Descrição:** Planejamento exigido pelo Anexo III da NR-32 para reduzir acidentes com agulhas e bisturis, priorizando a substituição de materiais por modelos com dispositivos de segurança.
- **Requisito legal:** Item 32.2.4.16: "O empregador deve elaborar e implementar Plano de Prevenção de Riscos de Acidentes com Materiais Perfurocortantes, conforme as diretrizes estabelecidas no Anexo III desta Norma Regulamentadora".
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Valor de multa registrado:** -
#### PGRSS (plano de gerenciamento de resíduos de serviços de saúde)
- **Descrição:** Documento que normatiza a segregação, acondicionamento, transporte, tratamento e disposição final dos resíduos de saúde, visando a biossegurança e a preservação ambiental.
- **Requisito legal:** Anexo III, Item 2.2: "A comissão deve ser constituída, sempre que aplicável, pelos seguintes membros: [...] g) responsável pela elaboração e implementação do PGRSS - Plano de Gerenciamento de Resíduos de Serviço de Saúde".
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Normas e procedimentos de higiene
- **Descrição:** Manuais de procedimentos relativos à limpeza, descontaminação e desinfecção de todas as áreas, equipamentos, mobiliários e EPIs do estabelecimento.
- **Requisito legal:** 32.3.9.4.3 Devem ser elaborados manuais de procedimentos relativos a limpeza, descontaminação e desinfecção de todas as áreas, incluindo superfícies, instalações, equipamentos, mobiliário, vestimentas, EPI e materiais.
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Procedimentos em situações de emergências
- **Descrição:** Protocolos de ação imediata para cenários críticos, como exposição acidental a material biológico, derramamento de quimioterápicos ou incidentes radiológicos.
- **Requisito legal:** 32.8.1 Os trabalhadores que realizam a limpeza dos serviços de saúde devem ser capacitados, inicialmente e de forma continuada, quanto aos princípios de higiene pessoal, risco biológico, risco químico, sinalização, rotulagem, EPI, EPC e procedimentos em situações de emergência.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Análises de acidentes
- **Descrição:** Relatórios de investigação técnica de cada acidente ocorrido (especialmente perfurocortantes e biológicos), identificando as causas raiz e propondo medidas corretivas.
- **Requisito legal:** Anexo III, item 3.3 A Comissão Gestora deve elaborar e implantar procedimentos de registro e investigação de acidentes e situações de risco envolvendo materiais perfurocortantes.
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovação dos treinamentos da NR-32
- **Descrição:** Registros contendo data, carga horária, conteúdo programático e qualificação dos instrutores para capacitações sobre riscos biológicos, químicos e radiológicos.
- **Requisito legal:** Item 32.2.4.9.2: "O empregador deve comprovar para a inspeção do trabalho a realização da capacitação através de documentos que informem a data, o horário, a carga horária, o conteúdo ministrado, o nome e a formação ou capacitação profissional do instrutor e dos trabalhadores envolvidos".
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 33 ESPAÇOS CONFINADOS (Especial)
**Total de multas registrado no estado da planilha:** 14069.5302
### Itens
#### Inventário de espaços confinados
- **Descrição:** Cadastro completo e atualizado de todos os espaços confinados da empresa, contendo identificação, volume, perigos e medidas de controle.
- **Requisito legal:** Item 33.5.21.1: "A organização que possui espaços confinados deve manter no estabelecimento: a) cadastro dos espaços confinados;"
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
#### Comprovação de treinamentos
- **Descrição:** Certificados de capacitação (inicial e reciclagem) para supervisores de entrada, vigias e trabalhadores autorizados.
- **Requisito legal:** Item 33.6.5: "A capacitação deve considerar o tipo de espaço confinado e as atividades desenvolvidas, devendo estas informações e a anuência do responsável técnico [...] constarem no certificado do trabalhador..."
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
- **Status:** CONCLUÍDA
#### Registros de PET
- **Descrição:** Permissões de Entrada e Trabalho preenchidas, assinadas e arquivadas para cada acesso, contendo os testes atmosféricos realizados.
- **Requisito legal:** Item 33.5.9: "As PETs emitidas devem ser arquivadas pelo período de 5 (cinco) anos."
- **Infração:** 2
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 2341.02
- **Status:** CANCELADA
#### Análise Preliminar de Riscos (APR)
- **Descrição:** Documento que identifica os riscos específicos do espaço confinado e estabelece as medidas de segurança antes de qualquer entrada.
- **Requisito legal:** Item 33.4.1.1 e alíneas: "A etapa de levantamento preliminar de perigos deve considerar a [...]
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** PENDENTE
#### Registros de calibração de instrumentos
- **Descrição:** Certificados de calibração anual e registros de testes de resposta (bump tests) realizados nos detectores de gases e outros sensores.
- **Requisito legal:** Item 33.5.15.6: "A calibração do equipamento de avaliação deve ser realizada por laboratório de calibração acreditado pelo Instituto Nacional de Metrologia, Qualidade e Tecnologia - Inmetro."
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
#### Procedimentos de trabalho
- **Descrição:** Instruções escritas padronizadas que descrevem as etapas seguras para isolamento, sinalização, ventilação e comunicação.
- **Requisito legal:** 33.3.5 Compete aos trabalhadores autorizados: a) cumprir as orientações recebidas nos treinamentos e os procedimentos de trabalho previstos na PET;
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Exames médicos específicos
- **Descrição:** Atestados de Saúde Ocupacional (ASO) que atestam explicitamente a aptidão psicofísica do trabalhador para atuar em espaços confinados.
- **Requisito legal:** Item 33.5.19.2: "A aptidão para trabalhos em espaços confinados deve estar consignada no Atestado de Saúde Ocupacional ASO, nos termos da NR-07..."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Procedimentos de emergência e resgate
- **Descrição:** Planejamento detalhado com os recursos, equipamentos e etapas para o socorro imediato e remoção de trabalhadores em caso de incidente.
- **Requisito legal:** Item 33.5.20.1: "A organização deve [...] elaborar um Plano de Resgate para espaços confinados, podendo estar integrado ao plano de emergência."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 34 INDÚSTRIA DA CONSTRUÇÃO, REPARAÇÃO E DESMONTE NAVAL (Setorial)
**Total de multas registrado no estado da planilha:** 4701.1938
### Itens
#### Designação formal do responsável
- **Descrição:** Documento em que o empregador nomeia formalmente a pessoa encarregada de implementar e fiscalizar a norma na empresa
- **Requisito legal:** Item 34.2.1: "Cabe ao empregador garantir a efetiva implementação das medidas de proteção estabelecidas nesta Norma, devendo: a) designar formalmente um responsável pela implementação desta Norma;"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Análise preliminar de risco (APR)
- **Descrição:** Avaliação inicial detalhada dos riscos potenciais, suas causas e as medidas de controle para cada atividade
- **Requisito legal:** Item 34.2.1: "Cabe ao empregador [...] devendo: d) providenciar a realização da Análise Preliminar de Risco - APR e, quando aplicável, a emissão da Permissão de Trabalho - PT;"
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Permissão de trabalho (PT)
- **Descrição:** Documento escrito com medidas de segurança, controle, emergência e resgate, necessário para liberar a execução de serviços específicos
- **Requisito legal:** Item 34.2.1: "Cabe ao empregador [...] devendo: d) providenciar a realização da Análise Preliminar de Risco - APR e, quando aplicável, a emissão da Permissão de Trabalho - PT;"
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro de diálogo diário de segurança (DDS)
- **Descrição:** Documentação diária que registra o tema tratado e a presença dos trabalhadores em orientações antes do início das operações
- **Requisito legal:** Item 34.2.1: "Cabe ao empregador [...] devendo: e) realizar, antes do início das atividades operacionais, Diálogo Diário de Segurança - DDS, contemplando as atividades que serão desenvolvidas, o processo de trabalho, os riscos e as medidas de proteção, consignando o tema tratado em um documento, rubricado pelos participantes e arquivado, juntamente com a lista de presença;"
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de proteção radiológica
- **Descrição:** Planejamento técnico aprovado pela CNEN para garantir a segurança em serviços envolvendo radiações ionizantes
- **Requisito legal:** Item 34.7.5: "Os seguintes documentos devem ser elaborados e mantidos atualizados no estabelecimento: a) Plano de Proteção Radiológica, aprovado pela Comissão Nacional de Energia Nuclear - CNEN;"
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de respostas às emergências (PRE)
- **Descrição:** Estratégia detalhada para lidar com cenários acidentais identificados, definindo recursos e ações de socorro
- **Requisito legal:** item 34.17.1 A empresa deve elaborar e implementar o PRE
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 4701.1938
- **Status:** PENDENTE
#### Prontuário dos equipamentos de movimentação
- **Descrição:** Dossiê contendo manuais de operação, especificações técnicas, cronogramas e registros de inspeções e certificações
- **Requisito legal:** Item 34.10.3 e alíneas: Deve ser elaborado o Prontuário dos Equipamentos contendo, no mínimo, as seguintes informações: [...]
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Listas de verificação (check-lists) de pré-uso
- **Descrição:** Registros diários de inspeção realizados por operadores e sinaleiros em máquinas, acessórios de carga e equipamentos portáteis
- **Requisito legal:** 34.10.4 Antes de iniciar a jornada de trabalho, o operador deve inspecionar e registrar em lista de verificação (check-list), no mínimo, os seguintes itens: [...]
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Ficha de liberação de andaime
- **Descrição:** Formulário de verificação de segurança que deve ser preenchido, assinado e afixado no andaime após a aprovação técnica
- **Requisito legal:** 34.11.30.1 A aprovação deve ser consignada na “Ficha de Liberação de Andaime” que será preenchida, assinada e afixada no andaime.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Memórias de cálculo de projetos
- **Descrição:** Cálculos estruturais de  plataformas e sistemas de teste de estanqueidade que devem permanecer arquivados na empresa
- **Requisito legal:** Item 34.6.4.3: "A memória de cálculo do projeto de plataformas deve ser mantida no estabelecimento."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Memórias de cálculo de projetos
- **Descrição:** Cálculos estruturais de andaimes e sistemas de teste de estanqueidade que devem permanecer arquivados na empresa
- **Requisito legal:** 34.11.4 A memória de cálculo do projeto dos andaimes deve ser mantida no estabelecimento.
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Valor de multa registrado:** -
#### Relatório de exercícios simulados
- **Descrição:** Documento que analisa o desempenho das equipes em treinamentos de emergência para propor melhorias e ajustes no PRE
- **Requisito legal:** Item 34.17.4.2: "Após a realização dos exercícios simulados ou na ocorrência de situações reais, deve ser elaborado relatório, com o objetivo de verificar a eficácia do PRE, detectar possíveis falhas e subsidiar os ajustes necessários."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Procedimentos técnicos de estabilidade
- **Descrição:** Instruções específicas para a fixação e estabilização temporária de blocos e elementos estruturais navais
- **Requisito legal:** 34.15.1.4 A classificação do elemento estrutural, considerando seu peso e área vélica, deve atender à situação mais crítica para selecionar o tipo de procedimento de estabilização (geral - G ou específico - E, citados nas tabelas do Anexo II) a ser adotado durante a fixação e estabilização.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 35 TRABALHO EM ALTURA (Especial)
**Total de multas registrado no estado da planilha:** 0
### Itens
#### Análise Preliminar de Risco (APR)
- **Descrição:** Avaliação detalhada realizada antes do início de qualquer atividade em altura para identificar perigos e estabelecer medidas preventivas.
- **Requisito legal:** Item 35.5.5: "Todo trabalho em altura deve ser precedido de AR."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Permissão de Trabalho (PT)
- **Descrição:** Documento escrito que autoriza a execução de atividades não rotineiras, contendo as medidas de controle e os procedimentos de emergência.
- **Requisito legal:** Item 35.5.7: "As atividades de trabalho em altura não rotineiras devem ser previamente autorizadas mediante PT."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Procedimento operacional
- **Descrição:** Instrução técnica detalhada que descreve a metodologia segura para a execução de atividades rotineiras em altura.
- **Requisito legal:** Item 35.3.1: "Cabe à organização: (...) c) elaborar procedimento operacional para as atividades rotineiras de trabalho em altura;"
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovação de treinamentos
- **Descrição:** Certificados que atestam a capacitação teórica e prática dos trabalhadores, com carga horária mínima de 8 horas.
- **Requisito legal:** Item 35.4.2.2 O treinamento periódico deve ser realizado a cada dois anos, com carga horária mínima de oito horas, conforme conteúdo programático definido pelo empregador.
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Exames clínicos específicos
- **Descrição:** Registros médicos consolidados no ASO que comprovam a aptidão do trabalhador para atividades em altura (incluindo riscos psicossociais e de saúde).
- **Requisito legal:** Item 35.4.4.1: "A aptidão para trabalho em altura deve ser consignada no atestado de saúde ocupacional do trabalhador."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registros de inspeção de ancoragem
- **Descrição:** Documentação das inspeções iniciais e periódicas realizadas nos sistemas de ancoragem para garantir sua integridade e resistência.
- **Requisito legal:** Anexo II, Item 4.1: "Os sistemas de ancoragem devem: (...) b) ser submetidos à inspeção inicial e periódica."
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 36 FRIGORÍFICOS (Setorial)
**Total de multas registrado no estado da planilha:** 0
### Itens
#### Análise Ergonômica do Trabalho (AET)
- **Descrição:** Estudo técnico detalhado que identifica e avalia os riscos ergonômicos (repetitividade, posturas e esforços), propondo adequações nos postos e na organização do trabalho.
- **Requisito legal:** 36.15.1 Deve ser realizada Avaliação Ergonômica Preliminar (AEP) e/ou Análise Ergonômica do Trabalho (AET), nos termos da NR-17, para avaliar a adaptação das condições de trabalho às características psicofisiológicas dos trabalhadores e subsidiar a implementação das medidas de prevenção e adequações necessárias previstas na NR-36.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registros da Organização Temporal (Frio)
- **Descrição:** Documentação que comprova o cumprimento dos regimes de trabalho e repouso, garantindo o usufruto das pausas térmicas obrigatórias para recuperação do organismo.
- **Requisito legal:** 36.13.2.4.1 Caso a organização não registre o tempo indicado nos documentos citados no subitem 36.13.2.4 desta NR, presume-se, para fins de aplicação da tabela prevista no Quadro 1 do item 36.13.2 desta NR, os registros de ponto do trabalhador.
- **Infração:** 0
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Programa de Conservação Auditiva (PCA)
- **Descrição:** Conjunto de medidas coordenadas que visam prevenir a perda auditiva ocupacional em setores com elevados níveis de ruído, comuns em áreas de máquinas e processamento.
- **Requisito legal:** Item 36.12.5: "Deve ser implementado um Programa de Conservação Auditiva, para os trabalhadores expostos a níveis de pressão sonora acima dos níveis de ação, conforme informado no PGR, e contendo no mínimo: a) controles técnicos e administrativos da exposição ao ruído; b) monitoramento periódico da exposição e das medidas de controle; c) treinamento e informação aos trabalhadores, de acordo com NR-01; d) determinação dos EPI; e) audiometrias conforme Anexo II da NR-07; e f) histórico clínico e ocupacional do trabalhador."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovação de Treinamentos da NR-36
- **Descrição:** Registros e certificados que atestam a capacitação inicial e periódica dos trabalhadores sobre riscos biológicos, químicos, ergonômicos e operação segura de máquinas.
- **Requisito legal:** Item 36.16.6.1 A organização deve disponibilizar material contendo, no mínimo, o conteúdo dos principais tópicos abordados nos treinamentos aos trabalhadores e, quando solicitado, disponibilizar ao representante sindical.
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de Resposta a Emergências
- **Descrição:** Protocolo detalhado com as ações de evacuação, resgate e controle de vazamentos, com foco crítico em situações envolvendo amônia e outros gases refrigerantes.
- **Requisito legal:** Item 36.9.3.3: "A organização deve elaborar Plano de Resposta a Emergências que contemple ações específicas a serem adotadas na ocorrência de vazamentos de amônia."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registro de Exercícios Simulados
- **Descrição:** Relatório técnico que documenta a realização de testes práticos anuais do plano de emergência, avaliando a eficácia das ações e o tempo de resposta das equipes.
- **Requisito legal:** Item 36.9.3.3.1 (alínea i): "O Plano de Resposta a Emergências deve conter, no mínimo: (...) i) registro dos exercícios simulados realizados com periodicidade mínima anual envolvendo todos os empregados da área."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 37 PLATAFORMAS DE PETRÓLEO (Setorial)
**Total de multas registrado no estado da planilha:** 7027.3164
### Itens
#### Declaração da Instalação Marítima (DIM)
- **Descrição:** Documento elaborado pela operadora que regulariza a plataforma, contendo informações básicas sobre a instalação e garantindo sua conformidade para operação.
- **Requisito legal:** Item 37.30.1: "A operadora da instalação deve protocolizar a Declaração da Instalação Marítima - DIM da plataforma por meio de sistema eletrônico indicado pela inspeção do trabalho."
- **Infração:** 3
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Análises de risco
- **Descrição:** Estudos técnicos (como a APR) que identificam perigos potenciais em tarefas específicas, avaliam suas consequências e definem as medidas de controle preventivas.
- **Requisito legal:** Item 37.5.6: "As organizações, em conformidade com PGR da plataforma, devem indicar e registrar as atividades e serviços que exijam: a) análise preliminar de risco da tarefa; [...]"
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Comprovação dos treinamentos
- **Descrição:** Registros e certificados que atestam a participação dos trabalhadores em capacitações obrigatórias, como o CBSP, HUET e treinamentos avançados de segurança.
- **Requisito legal:** Item 37.9.4: "Para cada treinamento presencial, deve ser elaborada lista de presença contendo: a) o título do curso ministrado; b) conteúdo ministrado, data, local e carga horária; c) nomes e assinaturas dos participantes, e d) identificação e qualificação do instrutor."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Plano de Resposta de Emergências (PRE)
- **Descrição:** Protocolo disponível a bordo que detalha as ações para cenários acidentais (incêndios, vazamentos), meios de comunicação, alarmes e procedimentos de evacuação.
- **Requisito legal:** Item 37.28.1: "A operadora da instalação deve, a partir dos cenários das análises de riscos e das informações constantes no PGR, elaborar, implementar e disponibilizar a bordo o Plano de Resposta a Emergências - PRE, que contemple ações específicas a serem adotadas na ocorrência de eventos que configurem situações de riscos grave e iminente à segurança e à saúde dos trabalhadores."
- **Infração:** 4
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -
#### Registros dos DDS
- **Descrição:** Documentação assinada que comprova a realização do Diálogo Diário de Segurança antes do início das atividades operacionais para orientar sobre riscos e prevenção.
- **Requisito legal:** Item 37.9.6 O operador da instalação deve implementar programa de capacitação em segurança e saúde no trabalho em plataforma, compreendendo as seguintes modalidades: [...] e) Diálogo Diário de Segurança - DDS
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** CANCELADA
#### Documentação de SESMT (terra e bordo)
- **Descrição:** Registros que comprovam o dimensionamento de técnicos de segurança a bordo e sua atuação integrada ao SESMT da operadora localizado em terra.
- **Requisito legal:** Item 37.7.1: "A operadora da instalação e as empresas que prestam serviços a bordo da plataforma devem constituir SESMT em terra e a bordo de cada plataforma, de acordo com o estabelecido nesta NR e na NR-04 [...]."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** sim; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** ESTABELECER AÇÃO
- **Valor de multa registrado:** 3513.6582
- **Status:** CONCLUÍDA
#### Documentação da CIPLAT
- **Descrição:** Atas, registros de eleição e treinamentos da Comissão Interna de Prevenção de Acidentes em Plataformas, responsável por zelar pela segurança offshore.
- **Requisito legal:** Item 37.8.8.4: "As deliberações e encaminhamentos das reuniões das CIPLAT devem ser disponibilizadas a todos os trabalhadores no local onde é realizado o briefing referido no item 37.9.6 ou por meio eletrônico [...]."
- **Infração:** 2
- **Conforme (C):** sim; **Não conforme (NC):** não; **Não aplicável (NA):** não
- **Ação/avaliação na planilha:** OK
- **Valor de multa registrado:** -

# NR 38 LIMPEZA URBANA E MANEJO DE RESÍDUOS SÓLIDOS
**Total de multas registrado no estado da planilha:** 0
### Itens
#### Programa de Gerenciamento de Riscos (PGR)
- **Descrição:** Documento que deve contemplar, além dos riscos gerais, os perigos específicos da limpeza urbana, como atropelamentos, ataques de animais, agentes biológicos e fatores ergonômicos.
- **Requisito legal:** Itens específicos são citados na NR, sem indicar todos os requisitos do PGR em um item, abordado em outras NRs
- **Infração:** 0
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não se aplica a NR38.
- **Valor de multa registrado:** -
#### PCMSO
- **Descrição:** Programa médico que, para a NR-38, deve obrigatoriamente incluir o controle de imunização (Tétano e Hepatite B) e o protocolo para acidentes com perfurocortantes.
- **Requisito legal:** Item 38.4.2: "Devem ser previstos no PCMSO os protocolos de saúde de acordo com a identificação dos perigos e avaliação dos riscos do PGR."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não se aplica a NR38.
- **Valor de multa registrado:** -
#### Procedimento para veículo coletor
- **Descrição:** Instrução técnica que define regras de segurança para o uso de coletores-compactadores, incluindo limites de velocidade (10 km/h no setor) e uso de sinais sonoros.
- **Requisito legal:** Item 38.6.2.2: "A plataforma operacional somente poderá ser utilizada pelos coletores nas áreas de trabalho (setores) de coleta desde que sejam observados os seguintes procedimentos de segurança: a) subida e descida da plataforma apenas com o veículo parado; b) limitação da velocidade do caminhão a 10 km/h..."
- **Infração:** 4
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não se aplica a NR38.
- **Valor de multa registrado:** -
#### Procedimento para acidentes com perfurocortantes
- **Descrição:** Protocolo específico detalhando as ações imediatas de primeiros socorros e o acompanhamento clínico necessário após exposição a agulhas ou lâminas no lixo.
- **Requisito legal:** Item 38.4.3: "O PCMSO, caso haja risco avaliado no PGR, deve estabelecer procedimento específico para o caso de acidente de trabalho envolvendo perfurocortantes, com ou sem afastamento do trabalhador, incluindo acompanhamento da evolução clínica do quadro do trabalhador."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não se aplica a NR38.
- **Valor de multa registrado:** -
#### Planilha para registro de logradouro
- **Descrição:** Cadastro atualizado contendo rotas, frentes de serviço, distâncias percorridas, características da área e localização dos pontos de apoio para os trabalhadores.
- **Requisito legal:** Item 38.3.1: "A organização deve manter registro atualizado de todos os logradouros em que desenvolve suas atividades, por rota, frente de serviço ou pontos de coleta, com identificação dos pontos de apoio, suas características e definição do tipo de atendimento prestado aos trabalhadores."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não se aplica a NR38.
- **Valor de multa registrado:** -
#### Permissão de Trabalho (PT)
- **Descrição:** Documento de liberação obrigatório para atividades de alto risco, como a poda de árvores, baseado nas medidas de controle da análise de risco.
- **Requisito legal:** Item 38.8.3: "A PT deve conter: a) as disposições e medidas estabelecidas na AR; b) os requisitos a serem atendidos para a execução segura das atividades; c) os participantes da equipe de trabalho e as atividades autorizadas; e d) a forma de comunicação entre o podador e os trabalhadores auxiliares da retirada de galhos."
- **Infração:** 2
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não se aplica a NR38.
- **Valor de multa registrado:** -
#### Análise Preliminar de Risco (APR)
- **Descrição:** Avaliação realizada antes do início das atividades para identificar perigos locais e operacionais, servindo de base para a emissão da PT e definição de EPIs.
- **Requisito legal:** Item 38.8.1: "Todo trabalho de poda de árvores deve ser precedido de Análise de Riscos - AR."
- **Infração:** 3
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não se aplica a NR38.
- **Valor de multa registrado:** -
#### Plano de Contingência
- **Descrição:** Planejamento estratégico que estabelece os procedimentos para resposta a eventos adversos ou emergências durante as operações de limpeza e manejo.
- **Requisito legal:** Item 38.3.7: "A organização deve estabelecer plano de contingência para a recuperação de evento adverso durante a execução das operações, considerando riscos adicionais e sobrecarga para os trabalhadores."
- **Infração:** 2
- **Conforme (C):** não; **Não conforme (NC):** não; **Não aplicável (NA):** sim
- **Ação/avaliação na planilha:** JUSTIFICAR
- **Justificativa:** Não se aplica a NR38.
- **Valor de multa registrado:** -
