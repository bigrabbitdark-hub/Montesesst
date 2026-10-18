# LTCAT, PPP e aposentadoria especial — insumos para o módulo de produto (resumo do material do proprietário)

> **Origem:** texto colado pelo proprietário em 2026-10-09/10 ("LTCAT e PPP: exposição ocupacional e aspectos previdenciários"). Este arquivo é um **resumo em
> palavras próprias**, não a transcrição, e **não é texto normativo nem fonte de regra**. O que tem fundamento literal está nas regras `rascunho` de
> `backend/db/seed-data/normative-rules/previdenciario.json` (cada ligação com o artigo e um fragmento literal conferido). Aqui ficam as ideias de **produto**,
> que exigem projeto próprio (brainstorming → spec → plano) antes de qualquer código.
> Marcadores: VERIFICADO (conferido nos textos oficiais extraídos em 2026-10-09) / NÃO VERIFICADO (afirmação do material sem texto oficial ingerido).

## 1. Conceitos que o módulo deve separar
- **LTCAT** — laudo técnico que fundamenta as informações previdenciárias sobre condições ambientais e exposição a agentes nocivos. **Não é cópia do PGR.**
- **PPP** — histórico laboral individual (dados administrativos, atividades, registros ambientais, responsáveis).
- **eSocial S-2240** — informa condições ambientais e fatores de risco para a finalidade previdenciária; **S-2220** (monitoramento da saúde) e **S-2210** (CAT) são outros eventos.
- **Aposentadoria especial** — benefício cujos requisitos dependem da lei do período e da exposição efetiva.
Status: a existência do laudo técnico e do perfil profissiográfico como instrumentos de comprovação está **VERIFICADA** no art. 58 e §§ da Lei 8.213/1991 (regras
`PREV-*` do seed). A descrição de cada evento do eSocial e do conteúdo do leiaute é do material — **NÃO VERIFICADO** (o MOS, os leiautes e a Tabela 24 não foram ingeridos).

## 2. Insalubridade trabalhista × exposição previdenciária (regra de produto central)
O sistema **não deve** tratar a lista de agentes da NR-15 como lista previdenciária, nem concluir direito ao adicional pela existência de exposição (ou o contrário).
Fundamento literal ligado no seed: arts. 189 e 192 da CLT (insalubridade trabalhista) e arts. 57 e 58 da Lei 8.213/1991 (exposição previdenciária) — regime e finalidade distintos. Os textos não são independentes: o Decreto 3.048 art. 64 § 1º (efetiva exposição pelas "medidas de controle previstas na legislação trabalhista") e § 1º-A, II (limite de tolerância "previsto neste Regulamento ou, na sua ausência, na legislação trabalhista") remetem à legislação trabalhista — ponte literal ligada na regra `PREV-DISTINCAO-INSALUBRIDADE-APOSENTADORIA-ESPECIAL` (VERIFICADO).
O material cita o **Anexo IV do Decreto 3.048/1999** como referência dos agentes nocivos previdenciários: a **remissão** é **VERIFICADA** (Decreto 3.048 art. 68: a relação dos agentes "é aquela constante do Anexo IV"; regra `PREV-AGENTES-NOCIVOS-RELACAO`); o **conteúdo** do Anexo IV (tabela de agentes) **não foi ingerido** — o parser para no cabeçalho `A N E X O I`, depois do art. 382.

## 3. Verificações sugeridas de um LTCAT (estrutura de auditoria da Montese, não formulário legal)
Identificação (empresa, CNPJ, estabelecimento); organização do trabalho (setor, função, atividade real, processo); agentes e caracterização; exposição (forma,
duração, frequência); avaliação (método, medições, critérios); medidas de proteção (EPC/EPI e eficácia); fundamentação; responsável técnico e habilitação;
temporalidade (data, período representado, mudanças); conclusão compatível com as evidências. Gatilhos de revisão sugeridos: mudança de máquinas/processo/substâncias/
jornada; medidas de proteção novas; avaliações novas que contradigam o laudo; divergência entre laudo, PGR e eSocial. **A revisão não é atualização automática de texto**:
quem avalia é o responsável competente. O texto literal ligado: art. 58 §1º–§4º da Lei 8.213 (laudo técnico, informação sobre proteção, laudo atualizado, PPP).

## 4. PPP — o que conferir
Dados cadastrais; admissão/desligamento e períodos; cargo, função e atividades **efetivas**; registros ambientais e agentes; intensidade/concentração; metodologia;
EPC/EPI; responsáveis pelos registros; coerência entre histórico, documentos técnicos e eventos transmitidos. O sistema distingue campo obrigatório, condicional e
aplicável a certas situações, e **não preenche campo ausente por suposição**. PPP eletrônico obrigatório para períodos a partir de **01/01/2023** e baseado nos eventos
de SST do eSocial: afirmação do material e do portal do INSS — **NÃO VERIFICADO** (IN PRES/INSS 128/2022 e o portal não foram ingeridos; a URL do INSS cadastrada hoje
devolve 9 caracteres).

## 5. Aposentadoria especial — tratamento no sistema
Direito adquirido anterior à reforma, regras de transição e regras posteriores à reforma devem ser tratados por período; períodos com agentes diferentes avaliados
separadamente; documentação incompleta gera lacunas e orientação, não conclusão. Idades 55/58/60 anos para 15/20/25 anos de atividade especial: **VERIFICADO** no art. 64, incisos I a III, do Decreto 3.048/1999 (redação do Decreto nº 10.410/2020; regras `PREV-*` do seed) — o material atribuía isso ao portal do INSS, mas o texto literal está no decreto. Pontuação: **VERIFICADO** no Decreto 3.048/1999 **art. 188-P** (incluído pelo Decreto nº 10.410/2020): para os filiados ao RGPS até 13/11/2019, "ressalvado o direito de opção pelas aposentadorias de que tratam os art. 51, art. 64 e art. 188-I ao 188-L", 66/76/86 pontos (idade + tempo de contribuição, apurados em dias, § 1º) com 15/20/25 anos de efetiva exposição (incisos I–III); regra `PREV-APOSENTADORIA-ESPECIAL-TRANSICAO` (correção: a versão anterior deste documento dizia NÃO VERIFICADO). O mesmo artigo, § 5º, limita a conversão de tempo especial em comum ao "trabalho prestado até 13 de novembro de 2019" (a tabela do § 5º é imagem, não ingerida; regra `PREV-CONVERSAO-ESPECIAL-COMUM`), e o § 6º manda caracterizar e comprovar o tempo especial pela "legislação em vigor à época da prestação do serviço" (regra `PREV-CARACTERIZACAO-LEGISLACAO-EPOCA`). **Direito adquirido** e a **EC 103/2019**: **NÃO VERIFICADO** (os termos não constam dos literais ingeridos; EC 103/2019 não ingerida) — o seed não usa esses termos. **O Assistente não declara
direito adquirido nem concessão do benefício sem análise individual** (princípio do Assistente, não norma).

## 6. Matriz de cruzamento documental (ideia de produto)
LTCAT×PGR/inventário; LTCAT×PPP; LTCAT×S-2240; PPP×cadastro funcional; S-2240×histórico de alterações; EPI/EPC×LTCAT; avaliações ambientais×LTCAT. Classificar como
**divergência confirmada, possível inconsistência, documento ausente ou revisão técnica necessária** — nunca concluir fraude, irregularidade ou perda de direito.
Validar localmente um XML **não** significa que o governo o aceitou: registrar protocolo, recibo e retorno oficial. A auditoria assistida por IA cita fonte, versão e evidência.

## 7. Modelo de dados proposto no material (NÃO é afirmação de que as tabelas existam)
`employee_work_history`, `ltcat_documents`, `occupational_exposures`, `ppp_records`, `esocial_s2240_events`, `normative_sources`, `audit_findings`. **Antes de modelar,
verificar o que já existe:** o repositório tem módulo eSocial em worktree separado (`/opt/montese-esocial`; migrations `0065_esocial_layout_versions`, `0066`–`0071` já aplicadas em
produção, incluindo `esocial_events` e `work_accidents`), `normative_provisions` / `normative_rules`, e a auditoria cruzada do pente-fino. AGENTS.md: não duplicar funcionalidade.

## 8. Regras do assistente previdenciário propostas (princípios de comportamento, não norma)
Não confundir insalubridade trabalhista com exposição previdenciária; não presumir que a existência de LTCAT garante benefício; não preencher exposições, medições ou
períodos não documentados; não tratar EPI como prova automática de neutralização; não modificar eventos enviados ao eSocial sem autorização e trilha; não emitir laudo como se
fosse assinado por profissional habilitado; sempre citar dispositivo, versão aplicável e evidência; encaminhar divergências relevantes ao responsável técnico e, se preciso,
à área previdenciária ou jurídica. Candidatos a `docs/assistente-montese-principios.md`; **não alteram prompt, provider ou modelo** nesta entrega (AGENTS.md exige autorização).

## 9. Fontes citadas e o que falta ingerir
Lei 8.213/1991 (arts. 57 e 58), Decreto 3.048/1999 (arts. 64–70, 188-P e Anexo IV), IN PRES/INSS 128/2022 e alterações, documentação técnica e MOS do eSocial, página do INSS sobre
aposentadoria especial. Estado em 2026-10-09 (VERIFICADO): os cadastros da Lei 8.213, do Decreto 3.048 e da CLT têm `fetch failed` em produção por falta de `User-Agent` no
monitor atual e **nenhum documento vigente**; o código novo do monitor corrige o download. **Art. 70 do Decreto 3.048 foi revogado integralmente** (Decreto nº 10.410/2020),
então não há redação vigente para ele. A IN PRES/INSS 128/2022, o **conteúdo** do Anexo IV e o eSocial **não foram ingeridos** (faltam URLs oficiais verificadas; o Anexo IV é tabela; a remissão ao Anexo IV, no art. 68, é literal).
