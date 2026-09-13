import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DocumentsService } from '../documents/documents.service';
import { PositionsService } from '../positions/positions.service';
import { EQUIPMENT_TYPE_LABEL, FireSafetyEquipmentService } from '../fire-safety-equipment/fire-safety-equipment.service';
import { FireBrigadeService } from '../fire-brigade/fire-brigade.service';
import { PreventionCorrectiveActionsService } from '../prevention-corrective-actions/prevention-corrective-actions.service';
import { buildFunctionReport, StoredRow } from '../pente-fino/pente-fino-comparison.service';

export type DashboardStatus = 'ok' | 'atencao' | 'critico';
export type AttentionPriority = 'alta' | 'media' | 'baixa';
export type AttentionResponsible = 'empresa' | 'tecnico';

export interface AttentionItem {
  tipo:
    | 'documento'
    | 'epi'
    | 'acao'
    | 'inspecao'
    | 'cargo'
    | 'equipamento_incendio'
    | 'brigada_incendio'
    | 'acao_corretiva_prevencao'
    | 'cipa_pendencia'
    | 'pente_fino';
  titulo: string;
  prioridade: AttentionPriority;
  data: string | null;
  responsavel: AttentionResponsible;
  link: string;
}

// Cada tipo precisa de uma entrada explícita aqui — true = seguro pra
// mandar pro provedor de IA externo (MiniMax/OpenRouter) via o
// Assistente normativo, false = embute PII de funcionário (nome
// completo) e nunca deve sair do produto pra terceiro (LGPD). Usar
// `satisfies` força o TypeScript a recusar a compilação se um tipo
// novo for adicionado à union sem entrar aqui — não depende de alguém
// lembrar de atualizar um filtro separado (achado da revisão final do
// sub-projeto B: isso já vazou PII duas vezes, 'cargo' e
// 'brigada_incendio', porque era um denylist de manutenção manual).
// 'acao_corretiva_prevencao' é seguro: a descrição vem de item_label
// (texto fixo do checklist) ou de um texto gerado (flags do simulado),
// nunca de employee_full_name.
export const ATTENTION_TIPO_AI_SAFE = {
  documento: true,
  epi: true,
  acao: true,
  inspecao: true,
  cargo: false,
  equipamento_incendio: true,
  brigada_incendio: false,
  acao_corretiva_prevencao: true,
  // 'descricao' de cipa_pendencias é texto livre digitado por um humano
  // (CreatePendenciaDto.descricao, sem restrição de conteúdo) — pode
  // conter nome de funcionário ("cobrar do João a ata assinada"), então
  // nunca sai pro provedor de IA externo. 'pente_fino' só referencia
  // position_name/function_text_raw (cargo, não pessoa) e descrições de
  // risco/exame extraídas do PGR/PCMSO — sem campo de nome de
  // funcionário em FunctionReportItem, seguro como os outros tipos
  // técnicos.
  cipa_pendencia: false,
  pente_fino: true,
} satisfies Record<AttentionItem['tipo'], boolean>;

export interface DashboardSummary {
  status: DashboardStatus;
  score: number | null;
  empresa_destaque: boolean;
  updated_at: string;
  resumo: {
    pendencias: number;
    avisos: number;
    acoes_concluidas: number;
    inspecoes_pendentes: number;
  };
  atencao: AttentionItem[];
  proximos_eventos: AttentionItem[];
}

const PRIORITY_ORDER: Record<AttentionPriority, number> = { alta: 0, media: 1, baixa: 2 };

// Colunas `date` do Postgres chegam via node-pg como objeto Date (não
// string) quando lidas fora de um contexto que passa por JSON.stringify
// (que chamaria Date.toJSON() automaticamente). Normaliza para
// 'YYYY-MM-DD' aqui, antes de qualquer comparação/ordenação de string.
function toDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly documents: DocumentsService,
    private readonly positionsService: PositionsService,
    private readonly fireSafetyEquipmentService: FireSafetyEquipmentService,
    private readonly fireBrigadeService: FireBrigadeService,
    private readonly preventionCorrectiveActionsService: PreventionCorrectiveActionsService,
  ) {}

  async getSummary(client: PoolClient, tenantId: string): Promise<DashboardSummary> {
    const [
      compliance,
      epis,
      actionPlans,
      inspecoesPendentes,
      positionDivergences,
      fireSafetyEquipment,
      fireBrigade,
      preventionCorrectiveActions,
      cipaPendencias,
      penteFino,
    ] = await Promise.all([
      this.documents.getCompliance(client, tenantId),
      this.getEpiStatus(client, tenantId),
      this.getActionPlans(client, tenantId),
      this.countInspecoesPendentes(client, tenantId),
      this.positionsService.getDivergences(client, tenantId),
      this.getFireSafetyEquipmentStatus(client, tenantId),
      this.getFireBrigadeStatus(client, tenantId),
      this.preventionCorrectiveActionsService.getStatusSummary(client, tenantId),
      this.getCipaPendenciasStatus(client, tenantId),
      this.getPenteFinoFindings(client, tenantId),
    ]);

    const atencao: AttentionItem[] = [
      ...compliance.pendencias.map((doc): AttentionItem => ({
        tipo: 'documento',
        titulo: `Documento vencido: ${doc.title}`,
        prioridade: 'alta',
        data: toDateString(doc.expires_at),
        responsavel: 'empresa',
        link: '/empresa/documentos',
      })),
      ...compliance.avisos.map((doc): AttentionItem => ({
        tipo: 'documento',
        titulo: `Documento vencendo: ${doc.title}`,
        prioridade: 'media',
        data: toDateString(doc.expires_at),
        responsavel: 'empresa',
        link: '/empresa/documentos',
      })),
      ...epis.pendencias.map((epi): AttentionItem => ({
        tipo: 'epi',
        titulo: `CA vencido: ${epi.description} (CA ${epi.ca_number})`,
        prioridade: 'alta',
        data: toDateString(epi.ca_valid_until),
        responsavel: 'empresa',
        link: '/empresa/epis',
      })),
      ...epis.avisos.map((epi): AttentionItem => ({
        tipo: 'epi',
        titulo: `CA vencendo: ${epi.description} (CA ${epi.ca_number})`,
        prioridade: 'media',
        data: toDateString(epi.ca_valid_until),
        responsavel: 'empresa',
        link: '/empresa/epis',
      })),
      ...actionPlans.map((plan): AttentionItem => ({
        tipo: 'acao',
        titulo: plan.description,
        prioridade: plan.overdue ? 'alta' : 'media',
        data: toDateString(plan.deadline),
        responsavel: 'empresa',
        link: '/empresa/inspecoes',
      })),
      ...positionDivergences.map((divergence): AttentionItem => ({
        tipo: 'cargo',
        titulo:
          divergence.categoria === 'epi'
            ? `EPI ${divergence.empresa_tem_no_catalogo ? 'não entregue' : 'não cadastrado no catálogo'}: ${divergence.requisito} — ${divergence.employee_name} (${divergence.position_name})`
            : `Treinamento pendente/vencido: ${divergence.requisito} — ${divergence.employee_name} (${divergence.position_name})`,
        prioridade: 'alta',
        data: null,
        responsavel: 'empresa',
        link: '/empresa/mapa-sst',
      })),
      ...fireSafetyEquipment.pendencias.map((eq): AttentionItem => ({
        tipo: 'equipamento_incendio',
        titulo: `Equipamento vencido: ${EQUIPMENT_TYPE_LABEL[eq.tipo]} (${eq.codigo})`,
        prioridade: 'alta',
        data: toDateString(eq.proxima_manutencao),
        responsavel: 'empresa',
        link: '/empresa/equipamentos-incendio',
      })),
      ...fireSafetyEquipment.avisos.map((eq): AttentionItem => ({
        tipo: 'equipamento_incendio',
        titulo: `Equipamento vencendo: ${EQUIPMENT_TYPE_LABEL[eq.tipo]} (${eq.codigo})`,
        prioridade: 'media',
        data: toDateString(eq.proxima_manutencao),
        responsavel: 'empresa',
        link: '/empresa/equipamentos-incendio',
      })),
      ...fireBrigade.pendencias.map((m): AttentionItem => ({
        tipo: 'brigada_incendio',
        titulo: `Brigadista sem treinamento válido: ${m.employee_full_name}`,
        prioridade: 'alta',
        data: null,
        responsavel: 'empresa',
        link: '/empresa/brigada',
      })),
      ...fireBrigade.avisos.map((m): AttentionItem => ({
        tipo: 'brigada_incendio',
        titulo: `Treinamento de brigada vencendo: ${m.employee_full_name}`,
        prioridade: 'media',
        data: null,
        responsavel: 'empresa',
        link: '/empresa/brigada',
      })),
      ...preventionCorrectiveActions.pendencias.map((a): AttentionItem => ({
        tipo: 'acao_corretiva_prevencao',
        titulo: `Ação corretiva pendente: ${a.description}`,
        prioridade: 'alta',
        data: toDateString(a.deadline),
        responsavel: 'empresa',
        link: a.checklist_item_id ? '/empresa/checklist-prevencao' : '/empresa/simulados',
      })),
      ...preventionCorrectiveActions.avisos.map((a): AttentionItem => ({
        tipo: 'acao_corretiva_prevencao',
        titulo: `Ação corretiva vencendo: ${a.description}`,
        prioridade: 'media',
        data: toDateString(a.deadline),
        responsavel: 'empresa',
        link: a.checklist_item_id ? '/empresa/checklist-prevencao' : '/empresa/simulados',
      })),
      ...cipaPendencias.pendencias.map((p): AttentionItem => ({
        tipo: 'cipa_pendencia',
        titulo: `Pendência da CIPA atrasada: ${p.descricao}`,
        prioridade: 'alta',
        data: toDateString(p.prazo),
        responsavel: 'empresa',
        link: '/empresa/cipa/pendencias',
      })),
      ...cipaPendencias.avisos.map((p): AttentionItem => ({
        tipo: 'cipa_pendencia',
        titulo: `Pendência da CIPA vencendo: ${p.descricao}`,
        prioridade: 'media',
        data: toDateString(p.prazo),
        responsavel: 'empresa',
        link: '/empresa/cipa/pendencias',
      })),
      ...penteFino.map((item): AttentionItem => ({
        tipo: 'pente_fino',
        titulo:
          item.status === 'risco_sem_exame'
            ? `Pente-Fino: risco sem exame correspondente — ${item.position_name ?? item.function_text_raw}`
            : `Pente-Fino: exame sem risco correspondente — ${item.position_name ?? item.function_text_raw}`,
        prioridade: item.status === 'risco_sem_exame' ? 'alta' : 'media',
        data: null,
        responsavel: 'empresa',
        link: '/empresa/pente-fino',
      })),
    ];

    atencao.sort((a, b) => {
      const byPriority = PRIORITY_ORDER[a.prioridade] - PRIORITY_ORDER[b.prioridade];
      if (byPriority !== 0) return byPriority;
      if (!a.data) return 1;
      if (!b.data) return -1;
      return a.data.localeCompare(b.data);
    });

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const em7Dias = new Date(hoje);
    em7Dias.setDate(em7Dias.getDate() + 7);
    const proximos_eventos = atencao.filter((item) => {
      if (!item.data) return false;
      const data = new Date(item.data);
      data.setHours(0, 0, 0, 0);
      return data >= hoje && data <= em7Dias;
    });

    const penteFinoPendencias = penteFino.filter((item) => item.status === 'risco_sem_exame').length;
    const penteFinoAvisos = penteFino.filter((item) => item.status === 'exame_sem_risco').length;

    const pendencias =
      compliance.pendencias.length +
      epis.pendencias.length +
      positionDivergences.length +
      fireSafetyEquipment.pendencias.length +
      fireBrigade.pendencias.length +
      preventionCorrectiveActions.pendencias.length +
      cipaPendencias.pendencias.length +
      penteFinoPendencias;
    const avisos =
      compliance.avisos.length +
      epis.avisos.length +
      fireSafetyEquipment.avisos.length +
      fireBrigade.avisos.length +
      preventionCorrectiveActions.avisos.length +
      cipaPendencias.avisos.length +
      penteFinoAvisos;

    let status: DashboardStatus = 'ok';
    if (pendencias > 0) status = 'critico';
    else if (avisos > 0 || actionPlans.some((p) => !p.overdue)) status = 'atencao';

    return {
      status,
      score: compliance.score,
      // Fase 16, revisão final: score === 100 sozinho não bastava — a
      // fórmula de score conta documento "vencendo" (≤30 dias) como
      // emDia, então dava pra ter score 100 com status 'atencao' ao
      // mesmo tempo (mesma empresa, documento vencendo). O selo
      // promete "todos os documentos em dia", então precisa checar
      // avisos/pendencias explicitamente também — um score 100
      // genuíno já implica isso, esta checagem só fecha o caso de
      // arredondamento e o caso de avisos contados como emDia.
      empresa_destaque: compliance.score === 100 && compliance.pendencias.length === 0 && compliance.avisos.length === 0,
      updated_at: new Date().toISOString(),
      resumo: {
        pendencias,
        avisos,
        acoes_concluidas: await this.countAcoesConcluidas(client, tenantId),
        inspecoes_pendentes: inspecoesPendentes,
      },
      atencao: atencao.slice(0, 10),
      proximos_eventos,
    };
  }

  private async getEpiStatus(client: PoolClient, tenantId: string) {
    const { rows } = await client.query<{
      ca_number: string;
      ca_valid_until: string | null;
      description: string;
    }>(
      `SELECT te.ca_number, te.ca_valid_until, eci.description
       FROM tenant_epis te
       JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
       WHERE te.tenant_id = $1 AND te.ca_valid_until IS NOT NULL
       ORDER BY te.ca_valid_until ASC`,
      [tenantId],
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pendencias: typeof rows = [];
    const avisos: typeof rows = [];
    for (const row of rows) {
      const validUntil = new Date(row.ca_valid_until as string);
      validUntil.setHours(0, 0, 0, 0);
      const diffDays = Math.round((validUntil.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) pendencias.push(row);
      else if (diffDays <= 30) avisos.push(row);
    }
    return { pendencias, avisos };
  }

  private async getFireSafetyEquipmentStatus(client: PoolClient, tenantId: string) {
    const equipment = await this.fireSafetyEquipmentService.findAll(client, tenantId);
    const pendencias = equipment.filter((eq) => eq.status === 'vencido');
    const avisos = equipment.filter((eq) => eq.status === 'vencendo');
    return { pendencias, avisos };
  }

  private async getFireBrigadeStatus(client: PoolClient, tenantId: string) {
    const members = await this.fireBrigadeService.getMembersWithTrainingStatus(client, { tenantId });
    const pendencias = members.filter((m) => m.status === 'vencido');
    const avisos = members.filter((m) => m.status === 'vencendo');
    return { pendencias, avisos };
  }

  private async getActionPlans(client: PoolClient, tenantId: string) {
    const { rows } = await client.query<{
      description: string;
      deadline: string | null;
    }>(
      `SELECT description, deadline FROM action_plans
       WHERE tenant_id = $1 AND status = 'pendente'
       ORDER BY deadline ASC NULLS LAST`,
      [tenantId],
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return rows.map((row) => ({
      ...row,
      overdue: !!row.deadline && new Date(row.deadline) < today,
    }));
  }

  private async countAcoesConcluidas(client: PoolClient, tenantId: string): Promise<number> {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM action_plans WHERE tenant_id = $1 AND status = 'resolvido'`,
      [tenantId],
    );
    return Number(rows[0].count);
  }

  private async countInspecoesPendentes(client: PoolClient, tenantId: string): Promise<number> {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM inspections WHERE tenant_id = $1 AND status = 'rascunho'`,
      [tenantId],
    );
    return Number(rows[0].count);
  }

  // Nenhum job hoje muda cipa_pendencias.status pra 'atrasada'
  // automaticamente (só um humano via PATCH) — calcula atraso pelo
  // `prazo` aqui, mesmo padrão de `getActionPlans`. Mas se um humano
  // já marcou 'atrasada' manualmente, isso conta como pendência mesmo
  // sem `prazo` cadastrado — não é seguro assumir que falta de data
  // signifique falta de atraso quando alguém já afirmou o atraso.
  private async getCipaPendenciasStatus(client: PoolClient, tenantId: string) {
    const { rows } = await client.query<{
      descricao: string;
      prazo: string | null;
      status: 'aberta' | 'andamento' | 'atrasada';
    }>(
      `SELECT descricao, prazo, status FROM cipa_pendencias
       WHERE tenant_id = $1 AND status IN ('aberta', 'andamento', 'atrasada')`,
      [tenantId],
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const em7Dias = new Date(today);
    em7Dias.setDate(em7Dias.getDate() + 7);

    const pendencias: typeof rows = [];
    const avisos: typeof rows = [];
    for (const row of rows) {
      if (row.status === 'atrasada') {
        pendencias.push(row);
        continue;
      }
      if (!row.prazo) continue;
      const prazo = new Date(row.prazo);
      prazo.setHours(0, 0, 0, 0);
      if (prazo < today) pendencias.push(row);
      else if (prazo <= em7Dias) avisos.push(row);
    }
    return { pendencias, avisos };
  }

  // Reaproveita a extração já cacheada do Pente-Fino (Fase 25) — nunca
  // dispara uma extração nova aqui (custaria chamada de LLM numa rota
  // de dashboard). Se a empresa nunca rodou o Pente-Fino pra um dos dois
  // documentos (ou pros dois), `buildFunctionReport` recebendo um lado
  // vazio marcaria toda função do outro lado como risco/exame "sem
  // par" — falso positivo, não um achado real. Só considera achado
  // quando os dois lados já têm pelo menos uma linha cacheada.
  private async getPenteFinoFindings(client: PoolClient, tenantId: string) {
    const [pgrResult, pcmsoResult, positionsResult] = await Promise.all([
      client.query<StoredRow>(
        `SELECT position_id, function_text_raw, risk_description AS description, source_excerpt
         FROM pgr_function_risks WHERE tenant_id = $1`,
        [tenantId],
      ),
      client.query<StoredRow>(
        `SELECT position_id, function_text_raw, exam_description AS description, source_excerpt
         FROM pcmso_function_exams WHERE tenant_id = $1`,
        [tenantId],
      ),
      client.query<{ id: string; name: string }>(`SELECT id, name FROM positions WHERE tenant_id = $1`, [tenantId]),
    ]);

    if (pgrResult.rows.length === 0 || pcmsoResult.rows.length === 0) return [];

    return buildFunctionReport(pgrResult.rows, pcmsoResult.rows, positionsResult.rows).filter(
      (item) => item.status === 'risco_sem_exame' || item.status === 'exame_sem_risco',
    );
  }
}
