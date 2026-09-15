# Relatório de Visita Técnica — campos novos, Prazo/Responsável e exportação em PDF

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-15.
> O fundador colou o modelo completo de "Relatório de Visita Técnica"
> (Segurança do Trabalho) pedindo, na mesma mensagem, duas coisas: (1)
> esse relatório preenchível + salvar na pasta do cliente + exportar em
> PDF, e (2) agendamento de reunião/visita via Google Calendar/Meet no
> menu lateral. São dois sub-projetos independentes — esta spec cobre só
> o (1). O (2) fica para uma spec própria, futura (§8).
>
> **Achado central do brainstorming**: o modelo colado é,
> quase palavra por palavra, `docs/reference/modelos-relatorios-sst.md`
> (seção 2, "Relatório de Visita Técnica") — o mesmo documento de
> referência que já orientou a construção do módulo **Inspeções**
> (Fases 4/5, em produção). Os 4 blocos de checklist (Documentação/EPIs/
> Instalações/Máquinas), o conceito de DDS, recomendações gerais e
> assinaturas já existem hoje, com os mesmos rótulos. Achado mais
> específico: a tabela `action_plans` **já tem** as colunas `deadline` e
> `responsible` (Prazo/Responsável do modelo) desde a migration
> original (`0010_inspections.sql`) — nunca foram expostas por nenhum
> endpoint nem tela. Isso não é uma feature nova do zero; é fechar um
> gap entre o que o próprio documento de referência do fundador sempre
> pediu e o que realmente foi construído.
>
> **Decisão de escopo que muda o desenho original**: como o Copiloto de
> IA (Fase 8) já monta um rascunho a partir de relato em texto livre e o
> técnico confirma/ajusta cada item, a extração da IA não muda nesta
> fase — os campos novos (filial, horários, prazo/responsável) são
> preenchidos manualmente pelo técnico, sem sugestão automática.

## 1. Objetivo e escopo

Fecha 3 lacunas reais entre o que `inspections`/`action_plans` sempre
deveriam suportar (por `docs/reference/modelos-relatorios-sst.md`) e o
que o produto expõe hoje, e adiciona uma capacidade nova (exportação em
PDF indexada como documento da empresa):

1. **Identificação completa da visita**: vincular a inspeção a uma
   filial (`company_unit_id`) — de onde vêm CNPJ (já no cadastro da
   empresa) e endereço — e capturar horário de início/término da
   visita, além da data que já existe.
2. **Prazo e responsável por não-conformidade**: expor `deadline`/
   `responsible` de `action_plans` (colunas já existentes) por um
   endpoint de atualização e uma tela editável.
3. **Exportação em PDF ao concluir**: ao concluir a inspeção, gerar
   automaticamente um PDF com todas as seções do relatório e indexá-lo
   como um `Document` real da empresa (mesmo pipeline da Fase 24 —
   aparece na lista de documentos, baixável pela empresa e pelo técnico,
   pesquisável pelo Assistente), na filial correspondente.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Filial obrigatória em inspeções NOVAS, coluna nullable pras
  antigas** — `inspections.company_unit_id` é adicionado como coluna
  nullable (não quebra as ~dezenas de inspeções já existentes em
  produção sem esse dado), mas o DTO de criação passa a exigir o campo
  para toda inspeção criada a partir de agora. Mesmo padrão já usado
  pelo checklist de prevenção (Prevenção e Emergência sub-projeto C).
- **Horário sempre digitado pelo técnico, nunca automático** — dois
  campos novos, `started_at`/`ended_at` (tipo `TIME`, sem fuso, mesmo
  padrão de hora "de parede" já usado no projeto, ex.: `cipa_meetings.hora`),
  preenchidos manualmente ao criar/editar a inspeção. Sem captura
  automática de horário do sistema — decisão do fundador, mantém
  simetria com o resto do formulário sendo sempre preenchimento manual
  confirmado pelo técnico.
- **PDF gerado automaticamente ao concluir, sem botão separado** —
  mesmo padrão já em produção pro CIPA (`meetings.service.ts`, aprovar
  ata → gera PDF → indexa como Document, tudo numa ação só). Não existe
  um botão "Gerar PDF"; concluir a inspeção já produz o documento.
- **PDF indexado como Document real, categoria nova** — decisão
  explícita do fundador (não "só baixável de dentro da tela"): o PDF
  entra no mesmo pipeline de upload/indexação de texto da Fase 24,
  aparece na lista de documentos da empresa (`GET /documents`), e fica
  pesquisável pelo Assistente RAG. Categoria nova em `ALLOWED_CATEGORIES`:
  `'relatorio_visita'`.
- **Prazo/Responsável editáveis a qualquer momento, mesmo depois de
  concluída** — diferente dos campos do checklist em si (travados após
  `concluir`), `action_plans` já é uma entidade "pós-conclusão" no fluxo
  atual (só existe depois que a inspeção termina) — não faz sentido
  travar a edição de prazo/responsável, já que o acompanhamento da
  não-conformidade continua depois do relatório fechado. Mesmo papel já
  autorizado hoje pra marcar `status='resolvido'` (`tecnico`, `parceiro`
  — ver `ActionPlansController` atual, que hoje só tem `GET`) passa a
  poder editar `deadline`/`responsible` também.
- **Assinatura eletrônica real fica de fora** — o próprio documento de
  referência já registrava isso como "fase 2" desde a origem
  (`docs/reference/modelos-relatorios-sst.md`: "assinatura digital ou
  upload de assinatura/foto, para fase 2"); os campos
  `technician_signature_name`/`company_signature_name` continuam sendo
  só texto digitado, sem mudança nesta fase.
- **Sem mudança na extração por IA do Copiloto** — `AiDraftDto`/
  `FieldReportExtractor` (Fase 8) continuam exatamente como estão; os
  campos novos desta fase (filial, horários, prazo/responsável) não
  entram no relato de campo transcrito por IA, são preenchidos à parte.

## 3. Modelo de dados

Migration `0045_inspection_report_fields.sql`:

```sql
-- Fecha o gap entre docs/reference/modelos-relatorios-sst.md (seção 2,
-- "Identificação": empresa, CNPJ, endereço, horário da visita) e o que
-- inspections.visited_at sozinho (só data) suporta hoje. Nullable: não
-- quebra as inspeções já existentes em produção sem esse dado — o DTO
-- de criação exige o campo pra toda inspeção NOVA (ver §4), a coluna em
-- si fica nullable no schema.
ALTER TABLE inspections ADD COLUMN company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL;
ALTER TABLE inspections ADD COLUMN started_at TIME;
ALTER TABLE inspections ADD COLUMN ended_at TIME;

CREATE INDEX inspections_company_unit_id_idx ON inspections (company_unit_id);
```

Nenhuma migration nova pra `action_plans` — `deadline DATE`/
`responsible TEXT` já existem desde `0010_inspections.sql`, só
precisam de um caminho de escrita (ver §4).

## 4. Backend

### 4.1 `company_unit_id`/`started_at`/`ended_at` em `inspections`

`CreateInspectionDto` (`backend/src/inspections/dto/create-inspection.dto.ts`)
ganha:

```typescript
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

export class CreateInspectionDto {
  @IsUUID()
  tenant_id: string;

  @IsISO8601()
  visited_at: string;

  @IsUUID()
  company_unit_id: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'started_at deve estar no formato HH:MM' })
  started_at?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'ended_at deve estar no formato HH:MM' })
  ended_at?: string;
}
```

`InspectionsService.create` (`backend/src/inspections/inspections.service.ts`)
ganha os 3 parâmetros novos, validando a filial contra o tenant (mesmo
padrão de `PreventionChecklistService.assertCompanyUnitBelongsToTenant`
— copiar esse método privado, adaptado, já que `InspectionsService` não
tem um hoje):

```typescript
private async assertCompanyUnitBelongsToTenant(client: PoolClient, companyUnitId: string, tenantId: string): Promise<void> {
  const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
    companyUnitId,
    tenantId,
  ]);
  if (result.rowCount === 0) throw new NotFoundException('Filial não encontrada');
}

async create(
  client: PoolClient,
  tenantId: string,
  technicianUserId: string,
  visitedAt: string,
  companyUnitId: string,
  startedAt: string | undefined,
  endedAt: string | undefined,
): Promise<InspectionDetail> {
  await this.assertCompanyUnitBelongsToTenant(client, companyUnitId, tenantId);
  try {
    const inspectionResult = await client.query<Inspection>(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at, company_unit_id, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, technicianUserId, visitedAt, companyUnitId, startedAt ?? null, endedAt ?? null],
    );
    // ... resto igual (INSERT dos 16 itens de checklist, sem mudança)
  } catch (err) {
    mapPgError(err);
  }
}
```

`Inspection` (interface) ganha os 3 campos: `company_unit_id: string | null`,
`started_at: string | null`, `ended_at: string | null`.

`InspectionsController.create` passa os campos novos do DTO pro
service (mesmo padrão de passagem posicional já usado ali).

`UpdateInspectionDto`/`INSPECTION_UPDATABLE_FIELDS` ganham `started_at`/
`ended_at` (mesma validação `@Matches`) — permite editar o horário
depois de criar, enquanto ainda em rascunho (mesma regra de
`assertDraft` já aplicada aos outros campos de `update`).

### 4.2 `PATCH /action-plans/:id` (prazo/responsável/status)

Novo endpoint em `ActionPlansController`
(`backend/src/inspections/action-plans.controller.ts`), mesmo padrão
de `PreventionCorrectiveActionsController.update`:

```typescript
import { Body, Controller, Get, Param, Patch, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { InspectionsService } from './inspections.service';
import { UpdateActionPlanDto } from './dto/update-action-plan.dto';

@Controller('action-plans')
export class ActionPlansController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if ((req.user.role === 'tecnico' || req.user.role === 'parceiro') && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.inspections.findActionPlans(client, tenantId));
  }

  @Roles('tecnico', 'parceiro', 'empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateActionPlanDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.inspections.updateActionPlan(client, id, dto));
  }
}
```

`@Roles('tecnico', 'parceiro', 'empresa')` — decisão: a empresa também
pode marcar prazo/responsável (ela é quem, na prática, sabe quem na
própria equipe vai resolver a não-conformidade) — mesmo padrão já usado
em `PreventionCorrectiveActionsController` (`@Roles` não restringe pra
só técnico/parceiro nesse endpoint irmão).

`UpdateActionPlanDto` (novo arquivo, `backend/src/inspections/dto/update-action-plan.dto.ts`):

```typescript
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateActionPlanDto {
  @IsOptional()
  @IsISO8601()
  deadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  responsible?: string;

  @IsOptional()
  @IsIn(['pendente', 'resolvido'])
  status?: 'pendente' | 'resolvido';
}
```

`InspectionsService.updateActionPlan` (novo método, mesmo padrão de
`buildSafeSetClause` já usado no resto do arquivo):

```typescript
private readonly ACTION_PLAN_UPDATABLE_FIELDS = ['deadline', 'responsible', 'status'] as const;

async updateActionPlan(client: PoolClient, id: string, data: Partial<ActionPlan>): Promise<ActionPlan> {
  const { setClauses, values } = buildSafeSetClause(data, ACTION_PLAN_UPDATABLE_FIELDS, 2);
  if (setClauses.length === 0) {
    const result = await client.query<ActionPlan>('SELECT * FROM action_plans WHERE id = $1', [id]);
    const plan = result.rows[0];
    if (!plan) throw new NotFoundException('Ação corretiva não encontrada');
    return plan;
  }
  const result = await client.query<ActionPlan>(
    `UPDATE action_plans SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...values],
  );
  const plan = result.rows[0];
  if (!plan) throw new NotFoundException('Ação corretiva não encontrada');
  return plan;
}
```

Sem `assertDraft` aqui — decisão da spec §2, editável mesmo com a
inspeção já concluída (`action_plans` não tem o conceito de "rascunho"
próprio).

### 4.3 Geração de PDF ao concluir

**Novo arquivo** `backend/src/inspections/inspection-pdf.util.ts`, mesmo
padrão exato de `backend/src/cipa/ata-pdf.util.ts` (pdfkit em memória,
sem tocar disco):

```typescript
import PDFDocument from 'pdfkit';
import { InspectionDetail } from './inspections.service';

interface InspectionPdfContext {
  tenantName: string;
  tenantCnpj: string;
  companyUnitAddress: string | null;
}

const BLOCK_LABELS: Record<string, string> = {
  documentacao: 'Documentação',
  epis: 'Uso de EPIs',
  instalacoes: 'Inspeção de instalações',
  maquinas: 'Riscos em máquinas e equipamentos',
};

const STATUS_LABELS: Record<string, string> = { C: 'Conforme', NC: 'Não conforme', NA: 'Não se aplica' };

// inspection precisa chegar aqui com visited_at/started_at/ended_at já
// como strings (node-pg devolve DATE/TIME como objeto Date/string
// dependendo do driver — mesma armadilha documentada em ata-pdf.util.ts
// pra colunas DATE; o chamador (InspectionsService.conclude) já lida
// com essa normalização antes de invocar esta função, mesmo padrão de
// `normalizeMeeting`).
export function buildInspectionPdf(inspection: InspectionDetail, ctx: InspectionPdfContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('RELATÓRIO DE VISITA TÉCNICA', { align: 'center' });
    doc.fontSize(12).text('Segurança do Trabalho', { align: 'center' });
    doc.moveDown();

    doc.fontSize(13).text('1. Identificação');
    doc.fontSize(11);
    doc.text(`Empresa: ${ctx.tenantName}`);
    doc.text(`CNPJ: ${ctx.tenantCnpj}`);
    doc.text(`Endereço: ${ctx.companyUnitAddress ?? 'não informado'}`);
    doc.text(`Data da visita: ${inspection.visited_at}`);
    doc.text(`Horário: ${inspection.started_at ?? '—'} às ${inspection.ended_at ?? '—'}`);
    doc.text(`Responsável pela empresa: ${inspection.company_contact ?? 'não informado'}`);
    doc.moveDown();

    for (const block of ['documentacao', 'epis', 'instalacoes', 'maquinas'] as const) {
      doc.fontSize(13).text(`${BLOCK_LABELS[block]}`);
      doc.fontSize(11);
      const items = inspection.items.filter((i) => i.block === block);
      for (const item of items) {
        const status = item.status ? STATUS_LABELS[item.status] : 'não avaliado';
        doc.text(`- ${item.item_label}: ${status}${item.notes ? ` — ${item.notes}` : ''}`);
      }
      doc.moveDown();
    }

    doc.fontSize(13).text('Conscientização (DDS)');
    doc.fontSize(11);
    doc.text(`Tema abordado: ${inspection.dds_topic ?? 'não informado'}`);
    doc.text(`Participantes: ${inspection.dds_participants_count ?? 'não informado'}`);
    doc.text(`Pontos reforçados: ${inspection.dds_notes ?? 'não informados'}`);
    doc.moveDown();

    doc.fontSize(13).text('Não conformidades identificadas');
    doc.fontSize(11);
    if (inspection.action_plans.length === 0) {
      doc.text('Nenhuma não conformidade identificada nesta visita.');
    } else {
      for (const plan of inspection.action_plans) {
        doc.text(
          `- ${plan.description} | Prazo: ${plan.deadline ?? 'não definido'} | Responsável: ${plan.responsible ?? 'não definido'} | Status: ${plan.status}`,
        );
      }
    }
    doc.moveDown();

    doc.fontSize(13).text('Recomendações gerais');
    doc.fontSize(11).text(inspection.general_recommendations || 'Nenhuma recomendação registrada.');
    doc.moveDown();

    doc.fontSize(13).text('Assinaturas');
    doc.fontSize(11);
    doc.text(`Técnico responsável: ${inspection.technician_signature_name ?? 'não assinado'}`);
    doc.text(`Responsável pela empresa: ${inspection.company_signature_name ?? 'não assinado'}`);

    doc.end();
  });
}
```

`InspectionDetail` (interface, `inspections.service.ts`) ganha
`tenant_cnpj: string` e `company_unit_address: string | null`,
resolvidos dentro de `findOne` — usados tanto pela tela de detalhe
(§5) quanto pelo PDF (evita resolver a mesma coisa duas vezes em dois
lugares). Novo método privado compartilhado:

```typescript
private async resolveIdentification(
  client: PoolClient,
  tenantId: string,
  companyUnitId: string | null,
): Promise<{ tenant_cnpj: string; company_unit_address: string | null }> {
  const tenantResult = await client.query<{ cnpj: string }>('SELECT cnpj FROM tenants WHERE id = $1', [tenantId]);

  let companyUnitAddress: string | null = null;
  if (companyUnitId) {
    const unitResult = await client.query<{
      address_street: string;
      address_number: string | null;
      address_city: string;
      address_state: string;
    }>(
      'SELECT address_street, address_number, address_city, address_state FROM company_units WHERE id = $1',
      [companyUnitId],
    );
    const unit = unitResult.rows[0];
    if (unit) {
      companyUnitAddress = `${unit.address_street}${unit.address_number ? `, ${unit.address_number}` : ''} — ${unit.address_city}/${unit.address_state}`;
    }
  }

  return { tenant_cnpj: tenantResult.rows[0].cnpj, company_unit_address: companyUnitAddress };
}

async findOne(client: PoolClient, id: string): Promise<InspectionDetail> {
  // ... busca inspection/items/action_plans, lógica atual sem mudança ...
  const identification = await this.resolveIdentification(client, inspection.tenant_id, inspection.company_unit_id);
  return { ...inspection, ...identification, items: itemsResult.rows, action_plans: actionPlansResult.rows };
}
```

`InspectionsService.conclude` (extensão do método já existente):
depois de gerar os `action_plans` (lógica atual, sem mudança), busca
`tenants.name` (só o nome — CNPJ/endereço já vêm de `findOne`, que
`conclude` já chama no fim), monta o PDF, e chama `DocumentsService.upload`:

```typescript
async conclude(
  client: PoolClient,
  id: string,
  documents: DocumentsService,
  userId: string,
  userRole: string,
): Promise<InspectionDetail> {
  await this.assertDraft(client, id);
  // ... UPDATE status + geração de action_plans (lógica atual, sem mudança)

  const detail = await this.findOne(client, id); // já traz tenant_cnpj/company_unit_address

  try {
    const tenantResult = await client.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [
      detail.tenant_id,
    ]);
    const pdfBuffer = await buildInspectionPdf(detail, {
      tenantName: tenantResult.rows[0].name,
      tenantCnpj: detail.tenant_cnpj,
      companyUnitAddress: detail.company_unit_address,
    });
    await documents.upload(client, {
      tenantId: detail.tenant_id,
      category: 'relatorio_visita',
      title: `Relatório de Visita — ${detail.visited_at}`,
      file: {
        buffer: pdfBuffer,
        mimetype: 'application/pdf',
        originalname: `relatorio-visita-${detail.id.slice(0, 8)}.pdf`,
        size: pdfBuffer.length,
      },
      uploadedByUserId: userId,
      uploadedByRole: userRole,
      companyUnitId: detail.company_unit_id ?? undefined,
    });
  } catch (err) {
    // Nunca derruba a conclusão da inspeção por causa do PDF — ver §6.
    this.logger.warn(`Falha ao gerar/indexar PDF da inspeção ${id}: ${(err as Error).message}`);
  }

  return detail;
}
```

`InspectionsController.conclude` passa `req.user.id`/`req.user.role`
(já disponíveis em `req.user` em todo o resto do controller) pros 2
parâmetros novos. `InspectionsService` ganha um `Logger` próprio
(`private readonly logger = new Logger(InspectionsService.name)`),
mesmo padrão do resto do projeto.

`InspectionsService` precisa de `DocumentsService` injetado no
construtor (`backend/src/inspections/inspections.module.ts` ganha
`DocumentsModule` nos imports, mesmo padrão de outro módulo que já
consome `DocumentsService` entre módulos — conferir como
`cipa.module.ts` importa o que precisa de `documents` pra seguir o
mesmo padrão exato).

### 4.4 Categoria nova de documento

`backend/src/documents/documents.service.ts`, `ALLOWED_CATEGORIES`
ganha `'relatorio_visita'`:

```typescript
const ALLOWED_CATEGORIES = [
  'pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento',
  'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo',
  'ltcat', 'lip',
  'relatorio_visita',
];
```

Confirmar se `ATTENTION_TIPO_AI_SAFE`/qualquer outra lista fechada de
categorias de documento (`dashboard.service.ts`, frontend) precisa da
entrada nova — provavelmente não (documento já concluído/gerado pelo
sistema, não é um "achado" que o dashboard precisa reportar como
pendência), mas conferir contra o código real antes de assumir.

## 5. Frontend

`frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`
(`handleNovaInspecao`): ganha os campos novos no formulário/payload de
criação — filial (mesmo `<select>` já usado na seção de checklist de
prevenção desta mesma página, reaproveitando `units`/`loadUnits` já
existentes ali) e dois inputs `type="time"` pra horário início/término.

`frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx`:

- Seção "Identificação" (nova, antes da seção que já existe com só
  "Responsável pela empresa"): mostra CNPJ e endereço, ambos já vindo
  prontos de `GET /inspections/:id` (`tenant_cnpj`/`company_unit_address`,
  resolvidos no backend — ver §4.3), sem chamada extra do frontend.
  Campos de horário (`started_at`/`ended_at`, `type="time"`, mesmo
  padrão `disabled={!isDraft}` + `onBlur` já usado nos outros campos de
  texto desta página).
- Seção "Planos de ação gerados" (já existe, hoje só lista
  `plan.description` em vermelho): cada item ganha inputs de Prazo
  (`type="date"`) e Responsável (`type="text"`), com `onBlur` chamando
  `PATCH /action-plans/:id` — SEMPRE editável, mesmo com
  `inspection.status === 'concluida'` (decisão §2, diferente do resto
  do formulário).
- Depois de concluir: nenhuma mudança de UI adicional necessária além
  do que já existe — o PDF gerado aparece na lista de documentos da
  empresa através do fluxo já existente (`DocumentsPanel`), sem
  precisar de um link direto nesta página (mantém a página de inspeção
  focada, evita duplicar a lista de documentos aqui).

## 6. Casos de borda

- **Inspeção antiga sem `company_unit_id`** (criada antes desta fase):
  PDF mostra "Endereço: não informado"; nenhum erro, nenhuma migração
  de dado retroativa necessária.
- **Falha ao gerar o PDF ou fazer upload**: `conclude()` não deve
  quebrar a conclusão da inspeção por causa disso — a mudança de status
  e a geração de `action_plans` já são a parte crítica do fluxo. Decisão:
  envolver a geração de PDF/upload num `try/catch` que loga e segue
  (mesmo princípio "nunca lança" já usado no resto do projeto pra
  passos auxiliares) — a inspeção fica concluída mesmo se o PDF falhar,
  só sem o documento indexado. Registrar isso explicitamente no
  relatório de qualquer implementador futuro, já que é uma decisão
  vinculante, não um detalhe livre.
- **Filial apagada depois da inspeção criada**: `ON DELETE SET NULL`
  (não `CASCADE`) — a inspeção continua existindo, só perde a referência
  de filial (mesmo raciocínio de não destruir histórico já usado em
  outras tabelas do projeto).

## 7. Testes

Mesmo padrão de rigor do resto do projeto: unit-spec pro `buildInspectionPdf`
(gera um PDF real, parseia de volta com `pdf-parse` — mesma técnica já
usada em vários testes deste projeto — e confirma que os textos
esperados aparecem: nome da empresa, CNPJ, cada bloco, prazo/responsável
de cada não-conformidade); unit-spec pra `updateActionPlan`; e2e real
cobrindo: criar inspeção exige `company_unit_id` (400 sem ele); concluir
gera um Document real com categoria `relatorio_visita` (confirmar via
`GET /documents?tenant_id=...`); PATCH de `action_plans` funciona mesmo
com a inspeção já concluída; RLS (técnico não vinculado não vê nem
action_plans nem o documento gerado de outra empresa).

## 8. Fora de escopo

- **Google Calendar/Google Meet** (agendamento de reunião/visita,
  item novo no menu lateral) — sub-projeto totalmente independente,
  integração OAuth nova, sem nenhuma sobreposição de código com esta
  spec. Vira uma spec própria depois que esta fechar.
- **Assinatura eletrônica real** (upload de assinatura/foto ou captura
  gráfica) — já registrado como "fase 2" desde o documento de
  referência original; os campos de assinatura continuam texto simples.
- **Sugestão automática por IA dos campos novos** (filial, horários,
  prazo/responsável) — o Copiloto de IA (Fase 8) continua limitado aos
  campos que já sugeria (status/notes dos itens de checklist).
- **Edição do PDF já gerado** — uma vez concluída a inspeção e gerado o
  documento, reabrir a inspeção pra corrigir algo e regenerar o PDF não
  está no escopo (a inspeção já fica travada por `assertDraft`, mesmo
  comportamento de hoje).
