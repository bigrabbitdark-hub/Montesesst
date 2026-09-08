# Planos — proposta comercial e reescrita da página `/planos`

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-08.
> Primeiro sub-projeto de uma frente maior que o fundador identificou:
> reposicionar a venda de "quantidade de funcionários por plano" para
> "nível de suporte/acompanhamento humano". O fundador enviou um texto
> extenso já bem desenvolvido nessa direção — esta spec fecha as
> decisões e ajustes de precisão em cima dele, não reinventa a proposta
> do zero.

## 1. Objetivo e escopo

Reescrever a página `/planos` (`frontend/src/app/(site)/planos/page.tsx`)
pra que cada plano comunique o que a empresa realmente recebe — hoje a
página só mostra nome + preço + "Até N funcionários" por card, sem
nenhuma diferenciação de benefício (confirmado lendo o arquivo real
antes desta spec). Preços e `employee_limit` dos planos **não mudam**
nesta fase — só a apresentação.

**Fora de escopo desta fase, decisão explícita do fundador**: qualquer
sistema real de enforcement — bloqueio de limite de funcionário, cota
de atendimento técnico rastreada, limite de uso de IA por plano,
comissão do técnico por visita. Essas 4 coisas viram um projeto
arquitetural separado e futuro (banco de dados, permissões, possível
split de pagamento) — a página descreve um compromisso comercial real,
entregue por processo humano/operacional da equipe Montese até que o
enforcement automatizado exista. Ver Seção 6.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Preço do Enterprise continua "sob consulta"** (`Valores a
  combinar`, já o comportamento atual da página) — o fundador
  confirmou que R$2.997/mês no rascunho dele era só um número
  ilustrativo, não uma mudança de preço real. Nenhum valor fixo de
  Enterprise aparece na página.
- **Nenhum outro preço/`employee_limit` muda** — Start R$397 (10
  funcionários), Premium R$797 (50), Super Premium R$1.297 (200),
  todos já reais no banco hoje.
- **Atendimento técnico avulso do Start não tem preço fixo exposto** —
  não existe uma tabela de preço pra visita avulsa hoje; a página diz
  "consulte disponibilidade", mesmo tratamento do Enterprise.
- **Mapeamento de papel de técnico**: Premium e Super Premium usam o
  mesmo papel já existente no produto, **técnico responsável**
  (atuação remota) — a diferença entre os dois planos é o NÍVEL de
  acompanhamento (sob demanda vs. ativo/contínuo), não um papel de
  técnico diferente. Enterprise adiciona acesso à **rede de técnicos
  parceiros** (atuação presencial, já existente no produto) pra
  operações multiunidade/multi-região. Super Premium já inclui visitas
  presenciais avulsas "conforme modalidade contratada e região", mas
  sem acesso à rede completa — essa é a peça exclusiva do Enterprise.
- **Correção de precisão sobre "monitoramento inteligente"**: o
  dashboard já gera alertas de pendência/vencimento (documento
  vencendo, EPI faltando, treinamento pendente/vencido, ação atrasada)
  pra **todo plano hoje**, sem gate nenhum — confirmado lendo
  `DashboardService.getSummary`. O rascunho original do fundador
  colocava isso como diferencial exclusivo do Super Premium; corrigido
  para: o **alerta em si** é universal (aparece na tabela comparativa
  como incluído em todos os planos), o que o Super Premium acrescenta
  é um **técnico humano acompanhando ativamente** esses alertas e
  agindo sobre eles — não o alerta em si. Essa distinção evita repetir
  o mesmo tipo de imprecisão em "reuniões periódicas"/"gestão ativa"
  (que também são compromisso operacional humano, não uma feature de
  software nova).
- **Sem menção a "laudos" como benefício** — decisão explícita do
  fundador (o posicionamento é "gestão operacional de SST + inteligência
  + suporte técnico", não "substitui uma empresa de medicina e
  segurança do trabalho").
- **Sem menção a limite de uso de IA/documentos por plano** — nenhum
  limite desse tipo existe hoje (nem por plano, nem em geral), então a
  página não menciona nenhum.
- **Liberdade editorial**: o texto do fundador é a base; adaptação e
  corte de repetição são permitidos pra caber no layout de card e no
  tom já usado no resto do site, sem precisar confirmar frase por
  frase.

## 3. Estrutura da página (ordem de cima para baixo)

1. **Seção intro** (nova): título "Segurança do Trabalho organizada,
   acompanhada e acessível", parágrafo curto de contexto, lista do que
   **todo plano** já tem (Assistente Montese SST, base normativa,
   gestão operacional, alertas/acompanhamento, histórico e
   rastreabilidade), fechando com "Qual nível de acompanhamento sua
   empresa precisa?".
2. **4 cards** (Start/Premium/Super Premium/Enterprise) — conteúdo
   completo na Seção 4.
3. **Bloco "Assistente Montese SST"** (comum a todos os planos) —
   conteúdo na Seção 5.
4. **Tabela comparativa completa** — conteúdo na Seção 6.
5. **Frase de trial reformulada** + CTAs finais já existentes ("Comece
   grátis" / "Fale com vendas", sem mudança).

## 4. Conteúdo de cada card

### START — R$397/mês
**Posicionamento**: "A base inteligente para organizar sua SST."
**Subtítulo**: Para pequenas empresas que querem estruturar a rotina de
SST sem manter um técnico dedicado internamente.
**Entrega**:
- Assistente Montese SST (dúvidas, análise de documentos, localização
  de pendências, acompanhamento de prazos)
- Central de documentos (upload, organização, histórico)
- Cadastro de funcionários, cargos e filiais
- Gestão de EPIs (registro e entrega)
- Inspeções com checklist e plano de ação
- Calendário SST e central de pendências
- Atendimento técnico avulso sob consulta (online ou presencial,
  conforme disponibilidade e região — sem preço fixo exposto)
**CTA**: "Começar gratuitamente" → `/cadastro` (mesmo destino do CTA
"Ainda não é cliente? Comece grátis" já existente no rodapé).

### PREMIUM — R$797/mês
**Posicionamento**: "Plataforma + técnico SST online."
**Subtítulo**: Para empresas que precisam de acompanhamento
profissional sem manter um técnico de segurança contratado em tempo
integral.
**Entrega** (Tudo do Start, mais):
- Técnico responsável acompanhando sua empresa, atendimento remoto
- Frase de efeito: "A inteligência organiza. O técnico avalia. A
  empresa decide."
- Atendimento online (videochamada, histórico de solicitações)
- Técnico com visão completa de pendências, inspeções, documentos,
  EPIs e treinamentos da empresa
**CTA**: "Quero SST + técnico" → fluxo de assinatura já existente
(`handleSubscribe`, inalterado).

### SUPER PREMIUM — R$1.297/mês
**Posicionamento**: "Acompanhamento contínuo de SST."
**Subtítulo**: Para empresas que precisam de uma atuação mais próxima e
estruturada de Segurança do Trabalho.
**Entrega** (Tudo do Premium, mais):
- O técnico acompanha ativamente os alertas e pendências da plataforma
  — não só responde quando chamado
- Gestão ativa: revisão de ações, acompanhamento de inspeções e
  treinamentos, reuniões periódicas
- Visitas presenciais incluídas conforme modalidade contratada e região
**CTA**: "Quero acompanhamento completo" → fluxo de assinatura já
existente (inalterado).

### ENTERPRISE — sob consulta
**Posicionamento**: "SST estruturada para operações maiores e redes de
empresas."
**Subtítulo**: Para empresas com múltiplas unidades, operações
complexas ou necessidade de estrutura personalizada de SST.
**Entrega** (Tudo do Super Premium, mais):
- Gestão multiunidade (matriz, filiais, obras)
- Acesso à rede de técnicos parceiros da Montese (visitas presenciais
  em múltiplas unidades/regiões)
- Atendimento e relatórios personalizados conforme contrato
**CTA**: "Falar com especialista" → `/contato` (já o comportamento
atual do botão "Fale com vendas" do card Enterprise — só o texto do
botão muda).
**Preço**: continua "Valores a combinar" (já o comportamento atual,
`employee_limit IS NULL`) — nenhuma mudança de código necessária aqui
além do texto do botão.

## 5. Bloco "Assistente Montese SST" (comum, abaixo dos cards)

Título: "O Assistente Montese SST está em todos os planos." Fluxo em 3
passos, sempre verdadeiros pra qualquer plano:

1. **Você envia** — documentos, planilhas, fotos, certificados,
   registros.
2. **Montese organiza** — identifica informações, classifica,
   relaciona funcionário/cargo/setor, encontra pendências.
3. **Montese acompanha** — alertas, tarefas, vencimentos, pontos de
   atenção.

Um 4º passo opcional, **"Técnico analisa e orienta"**, aparece
visualmente distinto (ex.: esmaecido/com selo) com a legenda explícita
"nos planos com técnico incluído (Premium, Super Premium, Enterprise)"
— nunca apresentado como parte incondicional do fluxo, pra não repetir
o erro de precisão já corrigido na Seção 2.

## 6. Tabela comparativa completa

| Recurso | Start | Premium | Super Premium | Enterprise |
|---|---|---|---|---|
| Plataforma + Assistente Montese SST + base normativa | ✓ | ✓ | ✓ | ✓ |
| Documentos, funcionários, EPIs, inspeções | ✓ | ✓ | ✓ | ✓ |
| Calendário SST e alertas de pendência | ✓ | ✓ | ✓ | ✓ |
| Diagnóstico Inicial (upload em lote, importação de funcionários, Mapa SST) | ✓ | ✓ | ✓ | ✓ |
| Atendimento técnico | Avulso, sob consulta | Online incluído | Acompanhamento ativo | Rede completa |
| Técnico acompanha alertas ativamente | — | — | ✓ | ✓ |
| Reuniões periódicas | — | — | ✓ | ✓ |
| Visitas presenciais | Sob consulta | — | Conforme contrato | Multiunidade |
| Gestão multiunidade | — | — | — | ✓ |
| Rede de técnicos parceiros | — | — | — | ✓ |
| Integrações / customização | — | — | — | ✓ |

Cada linha só marca ✓ pra capacidade genuinamente real hoje (Diagnóstico
Inicial = Fases 21-23, já fechadas no roadmap) ou compromisso comercial
que a Montese entrega por processo humano (atendimento técnico,
reuniões, visitas — ver Seção 1, fora de escopo o enforcement
automatizado disso).

## 7. Trial e CTAs finais

**Frase de trial** (substitui "Cada empresa começa com um período de
teste (trial) sem custo. Assine quando fizer sentido pro seu time."):

> "Comece gratuitamente e conheça o Montese SST na prática. Organize
> sua empresa, conheça o Assistente Montese e descubra como a
> tecnologia pode reduzir o trabalho operacional do RH e melhorar o
> acompanhamento de SST. Sem compromisso durante o período de teste."

**CTAs finais** (rodapé, já existentes): "Ainda não é cliente? Comece
grátis" (`/cadastro`) e "Fale com vendas" (`/contato`) — sem mudança.

## 8. Fora de escopo desta fase

- Qualquer sistema de enforcement automatizado: bloqueio de limite de
  funcionário, cota de atendimento técnico rastreada, limite de uso de
  IA/documentos por plano, comissão do técnico por visita presencial
  (split de pagamento). **Fica registrado aqui como a próxima frente
  arquitetural conhecida**, sem spec ainda — precisa de brainstorming
  próprio quando for a vez (decisões de banco de dados, permissões,
  economia).
- Qualquer mudança de preço ou `employee_limit` nos 4 planos.
- Qualquer mudança no fluxo de assinatura (`POST /subscriptions`,
  Mercado Pago) ou no back-end de `plans`/`subscriptions` — só a
  apresentação em `/planos` muda.
- Página `/tecnico/planos` (planos do técnico) — fora do escopo desta
  spec, que trata só da página de planos da empresa.
- Gestão por departamentos (RH/Gestores/Técnicos/Administradores)
  mencionada no rascunho original do Enterprise — já é comportamento
  de acesso baseado em role que o produto já tem (não é uma feature
  nova vendável), removida da lista de entrega pra não soar como
  novidade.
