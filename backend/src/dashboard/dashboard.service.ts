import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DocumentsService } from '../documents/documents.service';

export type DashboardStatus = 'ok' | 'atencao' | 'critico';
export type AttentionPriority = 'alta' | 'media' | 'baixa';
export type AttentionResponsible = 'empresa' | 'tecnico';

export interface AttentionItem {
  tipo: 'documento' | 'epi' | 'acao' | 'inspecao';
  titulo: string;
  prioridade: AttentionPriority;
  data: string | null;
  responsavel: AttentionResponsible;
  link: string;
}

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
  constructor(private readonly documents: DocumentsService) {}

  async getSummary(client: PoolClient, tenantId: string): Promise<DashboardSummary> {
    const [compliance, epis, actionPlans, inspecoesPendentes] = await Promise.all([
      this.documents.getCompliance(client, tenantId),
      this.getEpiStatus(client, tenantId),
      this.getActionPlans(client, tenantId),
      this.countInspecoesPendentes(client, tenantId),
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

    const pendencias = compliance.pendencias.length + epis.pendencias.length;
    const avisos = compliance.avisos.length + epis.avisos.length;

    let status: DashboardStatus = 'ok';
    if (pendencias > 0) status = 'critico';
    else if (avisos > 0 || actionPlans.some((p) => !p.overdue)) status = 'atencao';

    return {
      status,
      score: compliance.score,
      // Fase 16: selo "Empresa Destaque" — só quando o score de
      // documentos é exatamente 100 (nunca quando é null, i.e. tenant
      // sem nenhum documento com expires_at — não é "destaque
      // vacuamente", é ausência de dado).
      empresa_destaque: compliance.score === 100,
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
}
