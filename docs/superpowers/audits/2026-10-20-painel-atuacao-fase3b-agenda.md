# Auditoria da Fase 3B — agenda e reuniões (somente leitura)

Data: 2026-10-20. Nenhum código, banco ou configuração foi alterado. Pergunta: dá para reaproveitar `visit_requests` como agenda dos sócios sem quebrar o que existe?

## O que existe (VERIFICADO)
- `visit_requests` (0022 + 0047): `tenant_id`, `technician_user_id` (FK para `users`, NOT NULL), `requested_by_user_id` (FK para `users`, NOT NULL), `status` (`solicitado|confirmado|concluido|cancelado`), `type` (`reuniao|visita`), datas/horas preferidas e confirmadas, `company_unit_id`, `google_event_id`, `google_meet_link`, `motivo`, `inspection_id`. RLS FORCE com ramos para admin, empresa (por `tenant_id`), técnico e parceiro (por vínculo); **não há ramo para `socio`**.
- Consumidores no código: `visits.service.ts`, `technician-agenda.service.ts`, `visit-reminder.cron.ts`. Nenhum dashboard lê a tabela diretamente.
- Fluxo atual: a empresa solicita a um técnico/parceiro **vinculado** (`isTechnicianLinked`, `visits.service.ts` ~283); o técnico confirma (cria evento no Google Calendar com a conta Google do técnico) e conclui. Rotas de confirmar/concluir são `@Roles('tecnico','parceiro')`; o Google Calendar é `@Roles('tecnico')`.
- Lembrete diário (`visit-reminder.cron.ts`, 08:00, contexto `admin`): para visitas `confirmado` com data = amanhã, envia e-mail a `requested_by_user_id` ("empresa") e a `technician_user_id` ("técnico").
- Listagem da empresa (`findAll`, `SELECT * ... WHERE tenant_id`) devolve `technician_user_id` cru; a tela `empresa/agendamentos` resolve o nome do profissional a partir de `/tenant-technicians/minha-empresa`, isto é, só dos técnicos **vinculados**.

## Se um sócio virasse `technician_user_id` (INFERIDO a partir do código acima)
1. **Funciona sem migration de estrutura:** a FK é para `users`, e o sócio é um `users`.
2. **RLS:** é preciso criar policies para o `socio` (SELECT em tenants Montese; INSERT/UPDATE só com `technician_user_id` = o próprio sócio e `is_montese_tenant`). Os demais ramos continuam intactos.
3. **A empresa passaria a ver as reuniões/visitas do sócio** (RLS por `tenant_id`), mas a tela da empresa **não saberia o nome** do sócio (ele não está na lista de técnicos vinculados) — ficaria em branco ou com id. Resolver exigiria alterar `visits.findAll`/tela da empresa (módulo existente).
4. **Lembretes:** como `requested_by_user_id` seria o próprio sócio, o e-mail "da empresa" iria ao sócio e o cliente **não** seria avisado; o sócio receberia dois e-mails idênticos. Corrigir exige decidir de onde vem o e-mail do cliente (campo novo ou usuário da empresa).
5. **Google Calendar:** só `tecnico` tem integração; reuniões de sócios não teriam evento/Meet nesta fase.
6. **Risco de contaminação:** rotas existentes de técnico não devem enxergar nem alterar agenda de sócio (`technician_user_id = user.id` já isola, mas é preciso teste de regressão).

## Alternativa: tabela interna `agenda_events`
Tabela própria (tenant_id, sócio responsável, tipo, data/hora, local/link, pauta, resultado), RLS só admin + socio Montese. Impacto zero nos módulos de empresa/técnico, sem lembrete ao cliente, sem aparecer no painel da empresa. Duplica parcialmente o conceito de agenda.

## Comparativo
| Critério | Reusar `visit_requests` | Tabela interna |
|---|---|---|
| Duplicação de módulo | Não | Parcial |
| Cliente enxerga o compromisso | Sim (exige ajuste na tela da empresa para o nome) | Não |
| Lembrete ao cliente | Exige decisão do e-mail do cliente | Não existe |
| Risco para fluxos de técnico/empresa | Médio (policies e listagens compartilhadas) | Baixo |
| Esforço | Maior (toca módulo existente) | Menor |

## Reuniões e histórico do cliente (`client_interactions`)
Lacuna comprovada: nada equivalente existe. Independe da decisão da agenda. Proposta: tabela com `tenant_id`, `type`, `occurred_at`, participantes, resumo, decisões, próximos passos, autor; sócio lê/cria em tenants Montese, edita só o próprio registro, sem DELETE; exibida como linha do tempo na ficha do cliente. Anexos exigem R2 e ficam fora.

## Decisão necessária do proprietário
O cliente deve **ver** no próprio painel e ser **avisado por e-mail** das visitas/reuniões marcadas pelos sócios?
- **Sim** → reusar `visit_requests` (RECOMENDADO só se quiser isso), com ajuste na tela da empresa e definição do e-mail do cliente.
- **Não (agenda interna)** → tabela `agenda_events` (RECOMENDADO para a primeira versão: menor risco, sem tocar em módulos de empresa/técnico); a integração com a agenda do cliente pode vir depois, sobre dados já registrados.
