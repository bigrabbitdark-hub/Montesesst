import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { PreventionCorrectiveActionsService } from '../prevention-corrective-actions/prevention-corrective-actions.service';

export interface EmergencyDrill {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  data_realizacao: string;
  horario: string | null;
  tempo_evacuacao_segundos: number | null;
  ponto_encontro_adequado: boolean | null;
  falhas_sinalizacao: boolean;
  falhas_iluminacao: boolean;
  portas_bloqueadas: boolean;
  extintores_obstruidos: boolean;
  observacoes: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface EmergencyDrillParticipant {
  id: string;
  drill_id: string;
  employee_id: string;
  presente: boolean;
  employee_full_name: string;
}

export interface EmergencyDrillReport extends EmergencyDrill {
  participants: EmergencyDrillParticipant[];
  participantes_total: number;
  participantes_ausentes: number;
  brigadistas_presentes: number;
  nao_conformidades: number;
}

interface CreateDrillData {
  tenantId: string;
  companyUnitId: string;
  dataRealizacao: string;
  horario?: string;
  tempoEvacuacaoSegundos?: number;
  pontoEncontroAdequado?: boolean;
  falhasSinalizacao?: boolean;
  falhasIluminacao?: boolean;
  portasBloqueadas?: boolean;
  extintoresObstruidos?: boolean;
  observacoes?: string;
  createdByUserId: string;
  participants: { employeeId: string; presente: boolean }[];
}

// Colunas `date` do Postgres chegam via node-pg como objeto Date (não
// string), não 'YYYY-MM-DD' — String.prototype.replace() coagiria isso via
// Date.prototype.toString() (ex.: "Sun Mar 01 2026 00:00:00 GMT+0000...")
// dentro da descrição da ação corretiva. Mesmo padrão de normalização
// usado em committees.service.ts (toDateString).
function toDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

const PROBLEM_FLAG_DESCRIPTIONS: Record<
  'falhas_sinalizacao' | 'falhas_iluminacao' | 'portas_bloqueadas' | 'extintores_obstruidos',
  string
> = {
  falhas_sinalizacao: 'Falha de sinalização identificada no simulado de {data}',
  falhas_iluminacao: 'Falha de iluminação de emergência identificada no simulado de {data}',
  portas_bloqueadas: 'Porta de emergência bloqueada identificada no simulado de {data}',
  extintores_obstruidos: 'Extintor obstruído identificado no simulado de {data}',
};

@Injectable()
export class EmergencyDrillService {
  constructor(private readonly correctiveActions: PreventionCorrectiveActionsService) {}

  private async assertCompanyUnitBelongsToTenant(client: PoolClient, companyUnitId: string, tenantId: string): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new BadRequestException('Filial não encontrada');
  }

  // Mesmo raciocínio de FireBrigadeService.createMember (fire-brigade.service.ts:133-139):
  // participants vem do corpo da requisição, então precisa ser validado contra o
  // tenant ANTES de qualquer INSERT — senão um employee_id de outro tenant entraria
  // em emergency_drill_participants (a FK employees(id) não impede isso, só garante
  // que o funcionário existe em algum tenant). Uma única query cobre todos os
  // participantes de uma vez em vez de checar um por um.
  private async assertParticipantsBelongToTenant(
    client: PoolClient,
    participants: { employeeId: string; presente: boolean }[],
    tenantId: string,
  ): Promise<void> {
    if (participants.length === 0) return;
    const uniqueIds = [...new Set(participants.map((p) => p.employeeId))];
    const result = await client.query<{ id: string }>(
      `SELECT id FROM employees WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
      [uniqueIds, tenantId],
    );
    if (result.rowCount !== uniqueIds.length) {
      throw new BadRequestException('Um ou mais funcionários da lista de presença não pertencem a este tenant');
    }
  }

  async create(client: PoolClient, data: CreateDrillData): Promise<EmergencyDrillReport> {
    await this.assertCompanyUnitBelongsToTenant(client, data.companyUnitId, data.tenantId);
    await this.assertParticipantsBelongToTenant(client, data.participants, data.tenantId);

    try {
      const drillResult = await client.query<EmergencyDrill>(
        `INSERT INTO emergency_drills
           (tenant_id, company_unit_id, data_realizacao, horario, tempo_evacuacao_segundos,
            ponto_encontro_adequado, falhas_sinalizacao, falhas_iluminacao, portas_bloqueadas,
            extintores_obstruidos, observacoes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [
          data.tenantId,
          data.companyUnitId,
          data.dataRealizacao,
          data.horario ?? null,
          data.tempoEvacuacaoSegundos ?? null,
          data.pontoEncontroAdequado ?? null,
          data.falhasSinalizacao ?? false,
          data.falhasIluminacao ?? false,
          data.portasBloqueadas ?? false,
          data.extintoresObstruidos ?? false,
          data.observacoes ?? null,
          data.createdByUserId,
        ],
      );
      const drill = drillResult.rows[0];

      const values: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const participant of data.participants) {
        values.push(`($${i++}, $${i++}, $${i++})`);
        params.push(drill.id, participant.employeeId, participant.presente);
      }
      if (values.length > 0) {
        await client.query(
          `INSERT INTO emergency_drill_participants (drill_id, employee_id, presente) VALUES ${values.join(', ')}`,
          params,
        );
      }

      for (const [flag, template] of Object.entries(PROBLEM_FLAG_DESCRIPTIONS) as [
        keyof typeof PROBLEM_FLAG_DESCRIPTIONS,
        string,
      ][]) {
        if (drill[flag]) {
          await this.correctiveActions.create(client, {
            tenantId: data.tenantId,
            drillId: drill.id,
            description: template.replace('{data}', toDateString(drill.data_realizacao) as string),
          });
        }
      }

      return this.findOne(client, drill.id);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<EmergencyDrill[]> {
    if (tenantId) {
      const result = await client.query<EmergencyDrill>(
        'SELECT * FROM emergency_drills WHERE tenant_id = $1 ORDER BY data_realizacao DESC',
        [tenantId],
      );
      return result.rows;
    }
    const result = await client.query<EmergencyDrill>('SELECT * FROM emergency_drills ORDER BY data_realizacao DESC');
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<EmergencyDrillReport> {
    const drillResult = await client.query<EmergencyDrill>('SELECT * FROM emergency_drills WHERE id = $1', [id]);
    const drill = drillResult.rows[0];
    if (!drill) throw new NotFoundException('Simulado não encontrado');

    const participantsResult = await client.query<EmergencyDrillParticipant>(
      `SELECT p.*, e.full_name AS employee_full_name
       FROM emergency_drill_participants p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.drill_id = $1
       ORDER BY e.full_name`,
      [id],
    );
    const participants = participantsResult.rows;

    const brigadeResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) FROM emergency_drill_participants p
       JOIN fire_brigade_members m ON m.employee_id = p.employee_id AND m.status = 'ativo'
       WHERE p.drill_id = $1 AND p.presente = true`,
      [id],
    );

    const participantesAusentes = participants.filter((p) => !p.presente).length;
    const flagsAtivas = [
      drill.falhas_sinalizacao,
      drill.falhas_iluminacao,
      drill.portas_bloqueadas,
      drill.extintores_obstruidos,
    ].filter(Boolean).length;

    return {
      ...drill,
      participants,
      participantes_total: participants.length,
      participantes_ausentes: participantesAusentes,
      brigadistas_presentes: Number(brigadeResult.rows[0].count),
      nao_conformidades: flagsAtivas + (participantesAusentes > 0 ? 1 : 0),
    };
  }
}
