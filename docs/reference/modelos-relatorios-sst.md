# Resumo dos modelos de relatório — referência para schema (Montese SST)

> **Origem:** anexado pelo fundador durante a sessão de definição da Visão do
> Projeto (docs/vision.md). Preservado aqui como material de referência para
> quando as Fases 4 e 5 do roadmap (Dashboard Empresa, Dashboard Técnico)
> chegarem no desenho de schema de `documents`, `epi_records` e
> `inspections`. Não implementar nada a partir deste documento sem passar
> pelo ciclo de brainstorm → spec → plano daquela fase.

Estes dois documentos são os modelos reais usados hoje pelo técnico da Montese.
Servem de base para derivar as tabelas `documents`, `epi_records` e
`inspections` no banco.

---

## 1. Relatório de EPIs (Certificados de Aprovação — CA)

**Função:** catálogo de EPIs vinculados a uma empresa cliente, com o CA de
cada equipamento.

**Cabeçalho do relatório:**
- Empresa (cliente)
- Técnico responsável
- Empresa de Segurança e Medicina do Trabalho (terceirizada, se houver)
- Data de emissão

**Tabela principal — uma linha por EPI:**
| Campo | Tipo/observação |
|---|---|
| CA (nº do Certificado de Aprovação) | identificador único do equipamento no CAEPI |
| Equipamento | nome/modelo comercial |
| Para que serve / uso | descrição da finalidade e do risco que protege |
| Material | composição do EPI |
| Função do colaborador | campo em aberto no modelo — deve ser vinculado ao `employee`/cargo na hora do cadastro |

**Observações fixas do modelo (regras de negócio a manter no sistema):**
- CA deve ser validado no CAEPI/consultaca.com — sugerir integração ou
  campo de verificação manual no MVP.
- Validade do CA ≠ vida útil do equipamento — o sistema deve alertar
  separadamente sobre inspeção/substituição por desgaste, independente da
  validade do certificado.

**Implicação para o schema:**
- Tabela `epi_catalog` (ou `epi_records`): `ca_number`, `equipment_name`,
  `purpose`, `material`, `tenant_id`.
- Tabela de vínculo `employee_epi`: liga colaborador ↔ EPI ↔ data de entrega
  ↔ assinatura, para gerar a "ficha de EPI" cobrada no checklist de visita
  (ver documento 2).
- Campo de alerta de validade do CA (`ca_valid_until`) e campo separado de
  "última inspeção de desgaste" — são coisas diferentes, não confundir no
  modelo de dados.

---

## 2. Relatório de Visita Técnica

**Função:** checklist estruturado que o técnico preenche durante/após uma
visita presencial à empresa cliente. É o formulário que o **técnico
parceiro** (ou o técnico responsável) preenche em campo — no futuro, via
app/PWA.

**Estrutura em 9 blocos:**

1. **Identificação** — empresa, CNPJ, endereço, data/horário da visita,
   técnico responsável, responsável pela empresa.
2. **Documentação** (checklist C/NC/N.A. + observações) — fichas de EPI,
   Ordem de Serviço, validade do CA, ASO em dia.
3. **Uso de EPIs** (checklist) — uso adequado, estado de conservação,
   compatibilidade com risco do setor, reposição de danificados.
4. **Conscientização/DDS** — tema abordado, nº de participantes, pontos
   reforçados (lista aberta).
5. **Inspeção de instalações** (checklist) — luzes de emergência,
   sinalização, extintores (validade e pressão), rotas de fuga.
6. **Riscos em máquinas e equipamentos** (checklist) — proteções, LOTO
   (bloqueio/travamento), distância de segurança, treinamento do operador.
7. **Não conformidades identificadas** — tabela: nº, descrição, prazo para
   correção, responsável. **Este bloco é a origem direta do `action_plan`.**
8. **Recomendações gerais** — lista aberta.
9. **Assinaturas** — técnico responsável + responsável pela empresa.

**Padrão recorrente:** todo bloco de checklist usa a mesma escala —
**C (Conforme) / NC (Não Conforme) / N.A. (Não Aplicável)** + campo de
observação livre. Vale modelar isso como um componente reutilizável no
frontend e uma estrutura genérica no backend (`checklist_item`:
`category`, `item_label`, `status`, `notes`), em vez de colunas fixas —
facilita adicionar novas categorias de checklist (ex.: NR-12, NR-35) sem
migração de schema.

**Implicação para o schema:**
- Tabela `inspections` (cabeçalho): `tenant_id`, `visited_at`, `technician_id`,
  `company_contact`, `dds_topic`, `dds_participants_count`.
- Tabela `inspection_checklist_items`: `inspection_id`, `category`
  (documentação / uso de epi / instalações / máquinas), `item_label`,
  `status` (C/NC/N.A.), `notes`.
- Toda linha de "Não conformidade" com status NC gera automaticamente um
  registro em `action_plans` (`description`, `deadline`, `responsible`,
  `status`) — é exatamente o fluxo de "plano de ação" já descrito no plano
  geral da plataforma.
- Assinaturas — campo de assinatura digital ou upload de assinatura/foto,
  para fase 2 (assinatura eletrônica simples é suficiente no MVP).

---

## Uso recomendado

Ao desenhar o schema de `documents`, `epi_records` e `inspections` (Fases
4/5 do roadmap), usar este resumo como ponto de partida — ele já traz a
lista de campos reais usados hoje em campo, então o schema nasce alinhado
com o que o técnico realmente preenche, sem precisar reinventar os
formulários depois.
