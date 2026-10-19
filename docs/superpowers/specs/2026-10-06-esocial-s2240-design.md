# Desenho do S-2240 (Condições Ambientais do Trabalho: Agentes Nocivos)

Data: 2026-10-06. Somente desenho; nenhum código. Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
Fontes: XSD `evtExpRisco` v_S_01_03_00 do pacote "produção em 23/11/2026" (NT 07/2026 rev.) e MOS S-1.3 consolidada até NO 11/2026, ambos do gov.br/esocial (lidos em 2026-10-05).

## 1. O que o leiaute exige (VERIFICADO no XSD)
Um evento por trabalhador e por **condição**, com data de início (`dtIniCondicao`) e fim opcional:
- `infoAmb` (1 a 9): local do ambiente (`dscSetor`, `tpInsc`, `nrInsc` do estabelecimento ou terceiro).
- `infoAtiv`: descrição da atividade desempenhada (`dscAtivDes`, até 999).
- `agNoc` (até 999 agentes): `codAgNoc` (Tabela 24 do eSocial), e, conforme o agente, `tpAval`, `intConc`, `limTol`, `unMed`, `tecMedicao`, `nrProcJud`; e o bloco `epcEpi` (uso e eficácia de EPC e de EPI, até 50 `epi` com documento de avaliação, mais `epiCompl` com os 6 requisitos de uso do EPI).
- `respReg` (até 99): responsável pelos registros ambientais (`cpfResp`, órgão de classe, número, UF).
- `obs` opcional.

## 2. Prazo e regras do MOS (citadas; leitura parcial, NÃO VERIFICADO além disto)
- Envio até o dia 15 do mês seguinte ao início da obrigatoriedade dos eventos de SST ou do ingresso do trabalhador; alterações até o dia 15 do mês seguinte à ocorrência; adia para o primeiro dia útil se cair em dia não útil.
- Pré-requisito: S-2190, S-2200 ou S-2300.
- Após o primeiro S-2240, qualquer alteração da informação exige **novo S-2240** com a data de início correta (MOS, S-2240, item 9.4). Admissão por transferência: o sucessor envia um novo S-2240 (item 14.1).
- Itens do MOS sobre quando enviar sem dado ambiental, agentes que dispensam medição e a Tabela 24 completa **não foram lidos** neste desenho: ler antes de implementar.

## 3. O que o Montese tem hoje (VERIFICADO por leitura do repositório)
- Não existe inventário de risco estruturado por trabalhador, agente ou ambiente.
- A frente "Auditoria Montese" (pente-fino) extrai fatos de PGR, PCMSO, LTCAT e LIP por IA (`sst_audit_document_extractions`, `sst_audit_facts`). Isso é **saída de auditoria, não fonte de verdade**: a IA não é autoridade normativa (AGENTS.md) e a extração tem erro.
- Há o cadastro de EPI e de CA, funcionário e cargo.

## 4. Decisão central (RECOMMENDED, depende do proprietário)
**Não gerar S-2240 a partir da extração por IA.** O evento tem efeito previdenciário (aposentadoria especial). A fonte tem que ser um **inventário confirmado por pessoa habilitada**, que pode ser pré-preenchido pela extração do pente-fino como sugestão, nunca como dado final.

## 5. Plano em fases
1. **Modelo de dados** (migration nova): condição de exposição (trabalhador ou cargo, período), ambientes (até 9), atividade, agentes com código da Tabela 24 informado pelo responsável, medição, EPC e EPI, responsáveis. RLS forçada, mesmo padrão de `work_accidents`. Dado sensível; sem envio a IA.
2. **Confirmação humana:** estado "confirmado por" com autor e data, e histórico de alterações (cada mudança gera novo evento).
3. **Diagnóstico e XML:** regras condicionais do XSD, builder na ordem do `evtExpRisco`, validação no XSD oficial, assinatura e lote reaproveitando o pipeline já pronto (`esocial_events` ganha `S-2240`).
4. **Alteração e fim de condição:** novo evento por mudança (item 9.4 do MOS) e `dtFimCondicao`; S-3000 já cobre exclusão (estender para S-2240).
5. **Pré-preenchimento assistido** a partir do pente-fino (opcional, última fase, sempre como sugestão revisável).

## 6. Riscos
- Responsabilidade legal sobre o dado (aposentadoria especial): a responsabilidade técnica é do profissional que assina o registro ambiental, não do sistema.
- Volume: um evento por trabalhador e por condição; empresas grandes geram muitos eventos. O lote aceita até 50.
- LGPD: exposição a agentes nocivos é dado de saúde ocupacional; exige a validação jurídica ainda pendente (E-16/E-17).
- Tabela 24 e regras de medição mudam por NT; precisa de versionamento como os XSD.

## 7. Perguntas ao proprietário antes de implementar
1. Quem confirma o inventário (técnico autônomo, engenheiro de segurança da empresa, médico)? Isso define papéis e a assinatura de `respReg`.
2. O cliente já tem o inventário em outro formato (planilha, LTCAT em PDF)? Define se o primeiro passo é importação ou formulário.
3. Prioridade frente a aplicar o 2º lote, ao teste do S-2220 e à validação de LGPD.
