# Plano de Negócios — Montese SST (versão revisada)

Base: plano de 06/10/2026 (@Évelyn). Revisão de 07/10/2026.
Legenda das marcações: **[CONFERIR]** = fato externo ainda não verificado na fonte oficial · **[DECIDIR]** = decisão dos sócios · **[CONTADOR]** / **[ADVOGADO]** = validação profissional necessária.
Todos os valores são estimativas para validar com clientes e com o contador.

## Sumário executivo

A Montese SST vende acompanhamento contínuo de SST depois da consultoria: auditoria da documentação, controle de vencimentos e monitoramento de fiscalização (DET e eSocial), numa plataforma com técnico responsável real. Não emitimos laudos nesta fase.

- **Cliente-alvo:** pequenas e médias empresas com funcionários CLT no Sul de Santa Catarina (Tubarão e região), com PGR/PCMSO já feitos por uma consultoria e ninguém cuidando do pós.
- **Segundo público:** técnicos de segurança autônomos, que assinam a plataforma para gerir a própria carteira.
- **Receita:** mensalidade por plano (empresa e técnico), implantação e serviços avulsos (visitas, diagnósticos, conferência de eSocial, preparação da contestação do FAP). Universidade SST fica para a fase 3.
- **Meta do ano 1 (cenário base):** 40 empresas e 30 técnicos no mês 12, receita recorrente de ~R$ 32.500/mês e sobra operacional de ~R$ 11.000 a ~R$ 14.700/mês no mês 12, conforme o cenário (ver "Projeção"), antes do pró-labore.

## Problema e oportunidade

A empresa pequena paga pelo PGR e pelo PCMSO, recebe os documentos e fica sozinha. Ninguém confere se estão coerentes entre si, se o plano de ação foi executado, se o eSocial bate com o papel ou se chegou notificação do Ministério do Trabalho.

Três riscos concretos sustentam a venda:

- **Documentação desatualizada ou incoerente.** Riscos do PGR que não aparecem no PCMSO ou no S-2240, funções novas sem revisão, plano de ação parado.
- **Notificações do DET perdidas.** O empregador pode cadastrar até 7 e-mails de alerta no DET e, após 15 dias da notificação, a ciência é automática **[CONFERIR na fonte oficial do MTE/gov.br]**.
- **eSocial SST inconsistente.** Eventos S-2210, S-2220 e S-2240 enviados com dados diferentes dos programas, ou não enviados.

Oportunidade: o mercado tradicional vende elaboração de programas + assessoria mensal, a preços altos e com pouca transparência; os softwares grandes são feitos para consultorias e SESMT. O espaço livre é o pós-consultoria para PMEs, com gente de verdade acompanhando.

## O que já existe

Levantamento original feito a partir do PRODUCT.md (set/2026). **O quadro precisa ser reconferido no código antes de virar material comercial**: desde então surgiram, ao que tudo indica, o relatório de auditoria cruzada em PDF e o módulo eSocial S-2220 (Produção Restrita), o que pode alterar itens abaixo.

| Recurso | Situação | Uso no plano |
|---|---|---|
| Cadastro de empresa, filiais e funcionários (manual ou CSV) | Pronto | Onboarding da implantação |
| Upload de documentos (R2) com conformidade calculada | Pronto | Base da auditoria contínua |
| Score de SST e pendências | Pronto | Diagnóstico gratuito e relatório mensal |
| Agenda de vencimentos (inclui CA de EPI) | Pronto | Todos os planos |
| Painel do técnico com carteira de empresas | Pronto | Plano para técnicos |
| Técnico parceiro (acesso presencial) | Pronto | Rede de visitas |
| Inspeções com checklist e plano de ação automático | Pronto | Profissional e Completo |
| Catálogo de EPI (NR-06) com registro de entrega | Pronto | Todos os planos |
| Assistente normativo com IA (fonte oficial) | Pronto | Diferencial |
| Copiloto de extração de checklist | Pronto | Produtividade do técnico |
| Pagamento recorrente (Mercado Pago) | Pronto | Cobrança |
| Painel admin (Montese Control) | Pronto | Operação interna |
| Ata da CIPA por áudio | Construído, inativo | Ativar na fase 2 |
| Minimização de dados pessoais antes da IA | Código pronto, não publicado | **Publicar antes de vender** |
| Funcionalidades diferentes por plano | Não existe | Construir (fase 1) |
| Monitoramento DET | Não existe | Construir (fase 1) |
| Diagnóstico de GILRAT/FAP/FAE | Não existe | Construir ou fazer manual (ver fase 1) |
| Conferência eSocial SST | Não existe | Construir (fase 2) |
| Universidade SST / cursos | Lista de espera | Fase 3, via parceria |
| Envio ao eSocial | Não está no plano | **[DECIDIR]** reconciliar com o módulo S-2220 já existente em worktree |

**Conferência contra o código (07/10/2026, leitura apenas, branch feat/conformidade-por-nr).**

- **VERIFICADO — planos sem gates.** Os preços atuais são R$ 397 / 797 / 1.297 por limite de funcionários, e o PRODUCT.md diz que não há gate de funcionalidade por plano. A busca por gates no backend não achou nada.
- **VERIFICADO — monitoramento DET e FAP/GILRAT/FAE ausentes.** Nenhuma ocorrência no backend.
- **VERIFICADO — teto de IA ausente.** Existem registro de uso e monitor de crédito do OpenRouter, mas nenhum teto mensal por cliente. O PRODUCT.md confirma "não há teto de custo monetário de IA em produção".
- **VERIFICADO — ata da CIPA dormente.** O serviço depende de GROQ_API_KEY, deixada vazia de propósito.
- **VERIFICADO — Mercado Pago presente.** Há checkout, webhook, assinatura recorrente e reconciliação.
- **VERIFICADO no código; NÃO VERIFICADO em produção — minimização de PII.** O redactPii existe e é usado no assistente normativo, no indexador de documentos, na ata da CIPA e na extração de fatos da auditoria. O PRODUCT.md registra que em 28/09 não estava implantada. Não afirmar em superfície pública que já vale.
- **INFERIDO — envio ao eSocial.** O src do backend atual não tem código de eSocial, só documentos em docs/specs. Existe uma pasta esocial em /opt/montese-esocial (branch feat/esocial-transmissao), fora desta branch. A contradição com "não transmitimos" continua para decisão dos sócios.
- **Ausente do plano, existente no código:** a conformidade por NR (migration 0064, nr-conformidade) e a extração de fatos com relatório de auditoria cruzada em PDF (pente-fino/sst-audit-*, ainda não commitado). Ambos reduzem o esforço do "Diagnóstico gratuito em PDF" e da "Conferência de conformidade".
- **NÃO VERIFICADO:** visibilidade pública do repositório no GitHub. O remoto é git@github.com:bigrabbitdark-hub/Montesesst.git, e verificar exigiria consulta externa.

**Alerta de segurança.** Se o repositório está público, torná-lo privado não desfaz a exposição: clones e indexadores podem já ter o conteúdo. Tratar qualquer segredo presente no histórico como comprometido e **rotacionar** (ação sobre produção, a combinar com o proprietário antes de executar). A visibilidade atual do repositório não foi verificada nesta revisão.

## Posicionamento e identidade

- **Frase de posicionamento:** "A consultoria faz o documento. A Montese cuida para que ele continue valendo." (Trocado "garante" por "cuida para que": "garantir" promete resultado, o que conflita com o valor "não prometemos o que ainda não entregamos" e com o fato de não emitirmos laudos.)
- **Tagline:** manter "Tecnologia que organiza. Gestão que protege." Hero com frase de dor: "Sua empresa fez o PGR. E depois?"
- **Quem somos (rascunho):** A maioria das empresas faz o PGR e o PCMSO, guarda numa pasta e só lembra deles numa fiscalização ou num acidente. A Montese SST cuida do depois: confere se a documentação está correta e coerente, avisa o que vence, acompanha o plano de ação e monitora as notificações do Ministério do Trabalho, com técnico de verdade acompanhando. Somos de Tubarão e atendemos o Sul de Santa Catarina. O nome vem de **[CONCLUIR]**. (Removido "engenheiro": nenhum engenheiro consta na equipe nem nos custos — **[DECIDIR]** se haverá um parceiro e como apresentá-lo.)
- **Missão:** garantir que a segurança do trabalho das empresas não termine na entrega do documento, unindo tecnologia e acompanhamento técnico próximo.
- **Visão:** ser, até 2029, a referência em gestão contínua de SST para PMEs do Sul de Santa Catarina e do Brasil.
- **Valores:** falamos a verdade sobre o risco; nenhum documento fica esquecido numa pasta; tecnologia organiza, gente protege; mostramos o que fazemos e quem fez; não prometemos o que ainda não entregamos.
- **O que não fazemos (dizer no site):** não emitimos laudos nem transmitimos o eSocial nesta fase. Trabalhamos junto com a consultoria e a contabilidade do cliente.

## Produtos e serviços

1. **Auditoria contínua de documentação.** Na implantação, o técnico lê PGR, PCMSO, LTCAT e laudos existentes e gera o score inicial com as não conformidades. Depois, revisão periódica (semestral ou mensal) e a cada mudança na empresa. Entregamos apontamentos e recomendações; a correção de documento assinado fica com o responsável técnico do cliente ou com a consultoria.
2. **Monitoramento de fiscalização (DET + eSocial).**
   - Auditoria do cadastro no DET: CNPJs com primeiro acesso, e-mails ativos, procurações em dia.
   - Alerta DET: o cliente cadastra um e-mail exclusivo da Montese **por cliente** entre seus contatos no DET; a plataforma cria a pendência com a contagem de 15 dias e avisa cliente e técnico. Não guardamos senha gov.br nem certificado digital. O processamento do e-mail recebido deve respeitar o isolamento entre tenants.
   - Leitura da notificação: pelo técnico, nomeado procurador pelo cliente via Sistema de Procuração Eletrônica. Notificação que não é de SST vai para o contador ou advogado do cliente.
   - Conferência eSocial SST: o cliente ou o contador envia os XMLs/relatórios dos eventos S-2210, S-2220 e S-2240, e a plataforma cruza com PGR e PCMSO. **S-2220 contém dados de saúde (sensíveis, LGPD art. 11)**: só entra na plataforma após a minimização e a base legal estarem publicadas.
   - Controle de prazos eSocial: avisa quais eventos precisam ser enviados e entrega ao contador um resumo pronto. A Montese não transmite (ver **[DECIDIR]** acima).
3. **Plataforma para técnicos autônomos.** Carteira de empresas, documentos, alertas, DET, assistente de IA e relatórios com a marca do técnico.
4. **Serviços avulsos.** Diagnóstico de documentação, visita técnica presencial pela rede de parceiros, conferência de eSocial avulsa, revisão após mudança na empresa.
5. **Diagnóstico gratuito de GILRAT, FAP e FAE.**

| Contribuição | O que é | O que conferimos | Documentos ligados |
|---|---|---|---|
| GILRAT (RAT) | 1%, 2% ou 3% da folha, conforme o risco da atividade | CNAE preponderante de cada estabelecimento e alíquota aplicada | Grau de risco, PGR |
| FAP | Multiplicador de 0,5 a 2,0 sobre o RAT, por estabelecimento | Se acidentes, CATs e benefícios (B91, B92, B93, B94) do cálculo são da empresa e têm nexo | CAT (S-2210), controle de afastamentos |
| FAE | Adicional de 6%, 9% ou 12% sobre a remuneração dos expostos | Se LTCAT, PPP e S-2240 justificam o adicional | LTCAT, PPP, S-2240 |

Janela: FAP 2027 disponível desde 30/09/2026 e contestação eletrônica de 1º a 30/11/2026, sem efeito suspensivo **[CONFERIR nas fontes oficiais]**. Consultores acessam a contestação pela procuração eletrônica do FAPWeb, outorgada pelo CNPJ raiz **[CONFERIR]**.

Promessa honesta: a maioria dos estabelecimentos ficou na faixa de bônus no FAP 2027 (a cifra de ">92%" citada no plano original está **[CONFERIR]**). A oferta é "conferimos se você paga o valor certo", nunca "você vai economizar". Como a maioria está em bônus, **a receita de contestação deve ser tratada como pequena**; ela não entra na projeção.

Monetização (diagnóstico gratuito; o que vem depois é pago):

- Preparação técnica da contestação do FAP: R$ 490 a R$ 1.490 por CNPJ; casos complexos com advogado parceiro.
- Recuperação de valores pagos a mais (RAT/FAE): trabalho tributário, por contador ou advogado parceiro. **[ADVOGADO]**: validar a estrutura de remuneração da Montese. A partilha de honorários de êxito com advogado, e comissões de referência a médicos, podem ser vedadas por normas éticas das profissões. Não prometer isso em contrato antes da validação.
- Correção de LTCAT e PPP: fora do escopo; indicação de engenheiro ou médico parceiro (mesma ressalva ética).
- Conferência anual incluída nos planos Profissional e Completo (revisão em outubro).
- Toda empresa que faz o diagnóstico recebe a proposta de plano.

## Planos e preços

Hoje os planos são R$ 397 / 797 / 1.297 e não diferem em funcionalidades. A proposta passa a diferenciar por nível de serviço. **[DECIDIR]** como migrar os clientes atuais. Valores abaixo são hipótese a validar em 10 conversas com empresas e 5 com técnicos antes de publicar.

Referência de mercado: cotação pública de prefeitura (elaboração de programas + assessoria mensal com 2 visitas + eSocial SST) entre R$ 18.900 e R$ 26.950 por ano (TCE-RN). Técnico de segurança contratado: ~R$ 3.500 de salário antes dos encargos (CAGED via Guia da Carreira).

### Empresas

| | Essencial | Profissional (recomendado) | Completo |
|---|---|---|---|
| Funcionários | até 20 | até 50 | até 100 |
| Mensalidade | R$ 347 | R$ 747 | R$ 1.297 |
| Implantação | R$ 490 | R$ 890 | R$ 1.490 |
| Plataforma completa | sim | sim | sim |
| Revisão de conformidade | semestral | mensal | mensal + relatório para diretoria |
| Técnico responsável remoto | por chamado (2/mês) | dedicado | dedicado |
| Acompanhamento do plano de ação | não | sim | sim |
| Monitoramento (DET + eSocial) | adicional R$ 97/mês | incluso | incluso |
| Visita presencial | avulsa | avulsa | 1 por trimestre inclusa |

Acima de 100 funcionários ou várias filiais: sob consulta. Contrato anual à vista: 10% de desconto e isenção da implantação. Profissional e Completo incluem a conferência anual de GILRAT/FAP/FAE.
**[DECIDIR]** a garantia de 30 dias: devolve só a mensalidade ou também a implantação? E vale para o contrato anual à vista?

### Técnicos

| Plano | Empresas | Usuários | Mensalidade |
|---|---|---|---|
| Técnico Start | até 5 | 1 | R$ 127 |
| Técnico Pro | até 15 | 1 | R$ 267 |
| Técnico Escritório | até 40 | até 3 | R$ 547 |

Todos incluem DET, assistente de IA e relatórios com a marca do técnico. Teste gratuito de **14 dias** (o plano original citava "14/7 dias" sem definir o 7; **[DECIDIR]**).

### Avulsos

| Serviço | Preço sugerido |
|---|---|
| Diagnóstico de documentação completo (sem assinatura) | R$ 390 a R$ 790 |
| Visita técnica presencial | R$ 350 a R$ 600 |
| Conferência eSocial SST avulsa | R$ 290 |
| Revisão após mudança na empresa | R$ 250 a R$ 490 |

Período gratuito: empresas não têm mês grátis (há trabalho humano); recebem diagnóstico resumido (score + 3 principais falhas) e garantia de 30 dias. Técnicos têm teste gratuito (autosserviço).

## Abordagem comercial

Teste "Sua empresa passaria numa fiscalização amanhã?", 8 a 10 perguntas sim/não/não sei, terminando em nota e convite ao diagnóstico gratuito. Só riscos e valores reais, com fonte, sem exagerar o medo. Na campanha FAP, ganha duas perguntas: "Você sabe qual é o FAP da sua empresa para 2027?" e "Sua empresa paga adicional de aposentadoria especial? Sabe por quê?".

## Melhorias no site

Ordem: dor, solução, como funciona, quem faz, quanto custa, próximo passo.

1. Hero: "Sua empresa fez o PGR. E depois?" + botões "Fazer o teste de fiscalização" e "Ver planos".
2. Dores: documento esquecido, notificação do DET perdida, eSocial que não bate com o papel.
3. Como funciona: diagnóstico, organização na plataforma, acompanhamento do técnico, visitas quando necessário.
4. Monitoramento de fiscalização (DET + eSocial).
5. Teste de fiscalização com nota.
6. Nossa equipe: foto padronizada, nome, função, registro profissional, anos de atuação, frase; faixa de parceiros com cidade.
7. Planos: tabela comparativa, Profissional destacado, implantação explícita e garantia.
8. Para técnicos: página própria, teste de 14 dias, marca do técnico e cláusula de não aliciamento em destaque.
9. Quem somos, missão, visão, valores, história do nome.
10. Rodapé: CNPJ, contato, privacidade e termos.

Ajustes: trocar a foto de banco (tecnico-tablet.jpg) por foto real; rotular ou retirar o que não existe (Universidade SST, ata por áudio, envio ao eSocial); sem depoimentos até haver clientes reais (usar relatório de exemplo com dados fictícios marcados); botão de WhatsApp fixo; página de privacidade explicando os dados que vão para a IA, **só depois da minimização publicada**; SEO local (Tubarão, Criciúma, Laguna, Braço do Norte) e Google Meu Negócio.

## Melhorias na plataforma

Esforço em semanas de uma pessoa desenvolvendo.

| Melhoria | Fase | Esforço | Por quê |
|---|---|---|---|
| Repositório privado + rotação de segredos | 0 | 1 dia | Exposição de dados internos |
| Publicar a minimização de dados pessoais antes da IA | 0 | 1 semana | LGPD, dados de saúde |
| Teto de custo mensal de IA por cliente | 0 | 1 semana | Sem limite em produção. O teto de R$ 250–350/mês para ~70 contas dá ~R$ 5 por conta: validar contra o custo real por documento |
| Funcionalidades por plano (gates) | 1 | 2 semanas | Planos precisam se diferenciar |
| Diagnóstico gratuito: upload + PDF resumido | 1 | 2 a 2,5 semanas | Principal gerador de leads. Reaproveita extração de fatos, minimização de PII e esqueleto do PDF, mas o custo real está no fluxo de captação (ver "Reaproveitamento") |
| Diagnóstico GILRAT/FAP/FAE | 1 | 1 a 2 semanas (INFERIDO) | Exige campos estruturados de CNAE e grau de risco no cadastro, que hoje não existem. Dados do FAP vêm do FAPWeb (procuração) e entram à mão. Na campanha de outubro/novembro o processo é manual |
| Teste de fiscalização (questionário com nota) | 1 | 1 semana | Captação |
| Alerta DET por e-mail + contagem de 15 dias | 1 | 2 semanas | Diferencial de venda |
| Item "cadastro DET" no score e no onboarding | 1 | 3 dias | Achado concreto |
| Avisos por WhatsApp | 1 | 2 semanas | Canal que o cliente lê |
| Relatório mensal automático | 1 | 1 semana (talvez menos) | Prova de valor. Score, pendências e conformidade por NR já existem; o esqueleto do PDF pode ser reaproveitado |
| Relatórios com a marca do técnico | 1 | 1 semana | Atrai técnicos. O build Docker do backend não inclui assets do frontend, então o logo do técnico precisa vir do R2 |
| Planos de técnico em 3 faixas + teste | 1 | 1 semana | Hoje só existe um plano |
| Leitor de XML do eSocial | 2 | 3 a 4 semanas | Conferência eSocial |
| Cruzamento eSocial × PGR/PCMSO | 2 | 3 semanas | Auditoria automática |
| Controle de prazos eSocial + resumo ao contador | 2 | 2 semanas | Evita envio esquecido |
| Vencimento de treinamentos por funcionário | 2 | 1 semana | Prepara a Universidade |
| Ativar ata da CIPA por áudio | 2 | 2 dias | Já construída |
| Programa de indicação | 2 | 1 semana | Canal de aquisição |
| Integração com EAD parceiro | 3 | 3 semanas | Universidade SST |

### Reaproveitamento dos módulos existentes (leitura do código em 07/10/2026)

- **Pronto e reutilizável (VERIFICADO por leitura):** extração de fatos por página com minimização de PII (sst-audit-facts.service, ~320 linhas) e provider MiniMax, com migration e teste de RLS para a tabela de fatos (0063); catálogo e avaliação de NR com status por evidência (nr-conformidade, migration 0064, testes unit e e2e); esqueleto de PDF com pdfkit.
- **Parcial ou casca (VERIFICADO por leitura):**
  - O PDF atual é texto corrido de 38 linhas, sem logo, sem tabelas e sem a estrutura do modelo.
  - O montador do relatório devolve listas vazias para funções, agentes e cobertura, e gera audit_id só com a data.
  - O catálogo de regras tem uma única regra concreta, que compara medições de ruído.
- **Não ligado ao fluxo (INFERIDO por busca):** não achei chamada de SstAuditFactsService, das regras ou do montador no serviço de comparação. O controller passa o resultado do comparador direto ao PDF, e os campos podem não casar. Confirmar rodando o fluxo antes de fechar a estimativa.
- **Efeito nas estimativas:**
  - O diagnóstico em PDF economiza ~3 a 4 dias de PDF e extração.
  - Esse ganho é compensado pelo que nenhum módulo cobre: captação do lead (upload sem cadastro completo, consentimento LGPD, limites anti-abuso e isolamento por tenant). Resultado: ~2 a 2,5 semanas, sem redução relevante.
  - A economia maior aparece na Fase 2. O cruzamento eSocial × PGR/PCMSO (3 semanas) pode cair para ~2 a 2,5 semanas, porque fatos, regras e cobertura já têm base. INFERIDO; só confirmar depois que o fluxo estiver ligado.
- Nenhuma dessas estimativas foi medida. São julgamento a partir da leitura, para revisar com quem vai desenvolver.

Observação: a Fase 0 soma ~2,5 semanas e a Fase 1 mais de 10 para um desenvolvedor. As datas do roadmap original (teste e diagnóstico em 6/11) só se sustentam com o diagnóstico feito à mão. Por isso o roadmap vale por **critério de passagem**, não por data.

## Estratégia comercial e marketing

Funil: teste de fiscalização e diagnóstico gratuito, que mostram o problema antes do preço.
Canais, em ordem: (1) contadores da região, com comissão de indicação (sugestão 10% por 12 meses) e o resumo de eventos eSocial pronto; (2) técnicos autônomos, com selo "Técnico Parceiro Montese"; (3) venda direta e associações (ACI, CDL, sindicatos, polos industriais); (4) conteúdo mensal com fonte; (5) tráfego pago local.

Processo: teste → diagnóstico gratuito → reunião de 30 minutos com o relatório → proposta (implantação + plano) → onboarding em até 7 dias.

**Campanha imediata (FAP 2027):** diagnóstico gratuito de GILRAT, FAP e FAE para empresas da região, com a chamada "O FAP da sua empresa para 2027 já saiu. Você sabe se está certo?". Depois de 30/11, vira conferência anual de outubro. Como o software não estará pronto, o diagnóstico da campanha é manual e limitado em volume pela capacidade de quem faz.

**Metas de funil (por mês, a partir do mês 4):** 60 testes, 15 diagnósticos, 5 reuniões, 4 a 5 contratos. Ressalvas: a taxa reunião→contrato implícita (~90%) é otimista; as vendas dos meses 1 a 3 não têm meta de funil, mas a projeção supõe ~10 empresas no mês 3; e 4–5 contratos/mês só levam a 40 empresas sem nenhum cancelamento.

Validação antes de publicar preços: 10 entrevistas com empresas e 5 com técnicos.
Regra para técnicos: cláusula de não aliciamento nos termos de uso; a Montese nunca aborda clientes cadastrados por um técnico para vender o plano empresarial.

## Custos

Valores aproximados, sem cotação formal. Confirmar com fornecedores e contador.

### Investimento inicial (uma vez)

| Item | Faixa |
|---|---|
| Jurídico: termos, privacidade (LGPD), contrato de serviço, não aliciamento | R$ 3.000 a R$ 8.000 |
| Fotos profissionais da equipe e em campo | R$ 1.500 a R$ 3.000 |
| Materiais comerciais | R$ 500 a R$ 1.500 |
| **Subtotal** | **R$ 5.000 a R$ 12.500** |
| Reserva de marketing dos 6 primeiros meses | R$ 9.000 a R$ 15.000 **[DECIDIR]**: esta reserva se sobrepõe ao marketing de R$ 1.500/mês dos meses 1–5 (R$ 7.500) na tabela abaixo. Escolher um dos dois ou definir o que a reserva cobre além disso |
| Total original | R$ 14.000 a R$ 27.500 (se a reserva for contada) |

### Custos mensais fixos

| Item | Mês 1 a 5 | A partir do mês 6 |
|---|---|---|
| Servidor (VPS), backups e monitoramento | R$ 400 | R$ 600 |
| Armazenamento R2, e-mail, domínio | R$ 150 | R$ 250 |
| APIs de IA (com teto) | R$ 250 | R$ 350 |
| Contabilidade | R$ 500 | R$ 600 |
| Marketing | R$ 1.500 | R$ 2.500 |
| Seguro de responsabilidade civil profissional | R$ 200 | R$ 200 |
| **Subtotal fixo** | **R$ 3.000** | **R$ 4.500** |
| Técnico responsável remoto | — | R$ 6.000 |
| Segundo técnico (meio período), a partir de ~35 empresas | — | R$ 2.000 a R$ 3.000 |

Um técnico dedicado atende ~30 empresas nos planos Profissional e Completo.

### Variáveis

- Impostos (Simples Nacional, serviços): ~10% **[CONTADOR]**. Sem fator R favorável (Anexo V), pode partir de 15,5%.
- Taxa do Mercado Pago: ~4,5% **[CONFERIR]**.
- Visitas do plano Completo pagas ao parceiro: ~R$ 250 por visita.
- Comissões de indicação: 10% da mensalidade indicada, por 12 meses.

Pró-labore dos sócios **não** está incluído. **[DECIDIR]** quanto cada sócio precisa retirar e a partir de quando.

## Projeção financeira e ponto de equilíbrio

Premissas: crescimento linear de 2 para 40 empresas e de 0 para 30 técnicos em 12 meses; mix de planos 40% Essencial / 45% Profissional / 15% Completo (ticket médio ~R$ 670); ticket médio de técnico R$ 190; implantação e avulsos ficam fora; segundo técnico entra com 35 empresas ou mais.

| Cenário | Sobra no mês 12 | Sobra acumulada em 12 meses | Pior mês |
|---|---|---|---|
| A. Plano original (sem churn, imposto 10%) | ~R$ 14.750 | ~R$ 79.900 | −R$ 1.854 (mês 1) |
| B. Churn de 3% ao mês | ~R$ 14.750 | ~R$ 88.000 | −R$ 1.854 |
| C. B + comissão sobre metade das empresas + visitas do Completo | ~R$ 12.900 | ~R$ 75.900 | −R$ 1.946 |
| D. C com imposto de 15,5% | ~R$ 11.100 | ~R$ 64.200 | −R$ 2.020 |

Leitura:
- Em B, o alvo de 40 empresas no mês 12 foi mantido; o churn de 3% exige ~4,1 vendas/mês em vez de ~3,5 (o funil previsto do plano é de 4–5 a partir do mês 4).
- O negócio permanece positivo a partir do mês 2 em todos os cenários, mas a folga cai ~25% de A para D.
- Ponto de aperto: mês 6, com a contratação do técnico (sobra de ~R$ 7.800 cai para ~R$ 2.000 no cenário D). Preferir o gatilho por número de empresas (~18) a contratar por data.
- Equilíbrio com técnico contratado: cerca de 18 empresas com imposto de 10% e cerca de 20 com 15,5%, sem contar técnicos assinantes.
- Pessimista (20 empresas, 15 técnicos no mês 12): receita ~R$ 16.250 contra ~R$ 13.000 de custo. Paga-se, sem folga para pró-labore; adiar a contratação até ~18 empresas.
- Fora do modelo: pró-labore, implantação, avulsos, o trabalho humano dos diagnósticos gratuitos e o investimento inicial. A projeção é um modelo linear simples, não uma previsão.

## Riscos, jurídico e LGPD

O maior risco de curto prazo é de segurança e dados. Resolver isso vem antes de vender.

| Risco | Impacto | Como reduzir |
|---|---|---|
| Repositório público expondo documentação interna | Alto | Tornar privado, tratar segredos do histórico como comprometidos e rotacionar |
| Dados de saúde (PCMSO, ASO, S-2220) enviados a provedores de IA sem minimização | Alto | Publicar a minimização; política de privacidade; contrato de tratamento de dados com o cliente |
| Transferência internacional de dados (provedor de IA fora do Brasil) | Alto | **[ADVOGADO]**: base legal (LGPD art. 33), cláusulas contratuais e informação ao titular; não enviar dados de saúde desnecessários |
| Responsabilidade técnica ao "corrigir" documento assinado por outro profissional | Alto | Entregar apontamentos; correção só por técnico habilitado que assina |
| Partilha de honorários/comissões com advogados e médicos | Alto | **[ADVOGADO]**: validar antes de contratar |
| Cliente achar que a Montese responde por autuação não SST vinda do DET | Médio | Escopo escrito no contrato: alertamos tudo, atuamos só em SST |
| Custo de IA sem teto | Médio | Limite mensal por cliente e alerta no admin |
| Técnicos com medo de aliciamento | Médio | Cláusula de não aliciamento em destaque |
| Atrito com contadores por causa do eSocial | Médio | Não transmitir; resumo pronto e comissão |
| Preço acima do que a microempresa aceita | Médio | Validar em entrevistas; Essencial com adicional de monitoramento |
| Dependência de poucas pessoas | Médio | Processos documentados no admin; rede de parceiros |
| Treinamentos EAD fora das regras da NR-01 | Médio (fase 3) | Parceiro EAD regularizado; prática presencial quando a NR exigir |

GILRAT, FAP e FAE: recuperação de tributo e defesa administrativa complexa ficam com contador ou advogado parceiro. A Montese faz o diagnóstico técnico de SST e não promete economia antes de conferir os dados.

## Roadmap e próximos passos

Cada fase só começa quando o critério de passagem da anterior for cumprido. Os três critérios do roadmap original estão só na figura e **precisam ser transcritos aqui** **[DECIDIR]**. Datas são sugestões.

- ☐ Tornar o repositório privado, revisar e rotacionar segredos (meta: 09/10/2026)
- ☐ Publicar a minimização de dados pessoais e definir o teto de custo de IA
- ☐ Definir pró-labore de cada sócio e o investimento inicial disponível
- ☐ Validar com o contador o anexo do Simples, o fator R e a alíquota real
- ☐ Contratar advogado: termos, privacidade, contrato, não aliciamento, estrutura de comissões e honorários
- ☐ Fazer 10 entrevistas com empresas e 5 com técnicos (meta: 23/10/2026)
- ☐ Fotografar a equipe e escrever as apresentações
- ☐ Évelyn: revisar planos e preços com base nas entrevistas e montar o material comercial
- ☐ Lançar a campanha de diagnóstico gratuito de GILRAT/FAP/FAE (manual) e fechar parceria com um contador ou advogado tributário antes de 1º/11
- ☐ Lançar o teste de fiscalização e o diagnóstico gratuito em software (data realista: após a Fase 0; 06/11 só se mantido manual)
- ☐ Conferir "O que já existe" contra o código e atualizar o quadro

## Fontes

Fontes do plano original, **ainda não conferidas** nesta revisão: DET — Perguntas frequentes (MTE e gov.br); Mapa de pesquisa de preços, Prefeitura de Bom Jesus/RN (TCE-RN); Salário de técnico de segurança, CAGED (Guia da Carreira); vaga de técnico autônomo em Curitibanos/SC (BNE); PRODUCT.md do repositório; FAP 2027: consulta e contestação (Contábeis), procuração eletrônica no FAPWeb (Sincovaga), faixa de bônus (Carmelitas).
