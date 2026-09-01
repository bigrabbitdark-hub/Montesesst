import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface CipaCommittee {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  ano: number;
  data_inicio: string;
  data_termino: string;
  responsavel_user_id: string;
  status: 'ativa' | 'encerrada';
  created_at: string;
  updated_at: string;
}

export interface CipaMeeting {
  id: string;
  tenant_id: string;
  committee_id: string;
  company_unit_id: string;
  tipo: 'ordinaria' | 'extraordinaria';
  numero: number | null;
  titulo: string | null;
  data: string | null;
  hora: string | null;
  local: string | null;
  modalidade: 'presencial' | 'online' | 'hibrida' | null;
  motivo: string | null;
  responsavel_user_id: string | null;
  status: 'planejada' | 'agendada' | 'realizada' | 'cancelada' | 'reagendada';
  chk_pauta_definida: boolean;
  chk_participantes_convocados: boolean;
  chk_local_confirmado: boolean;
  chk_presenca_registrada: boolean;
  chk_assuntos_discutidos: boolean;
  chk_decisoes_registradas: boolean;
  chk_ata_criada: boolean;
  chk_acoes_distribuidas: boolean;
  chk_pendencias_registradas: boolean;
  pauta: string | null;
  discussoes: string | null;
  deliberacoes: string | null;
  proxima_reuniao_data: string | null;
  status_ata: 'rascunho' | 'aprovada';
  aprovado_por_user_id: string | null;
  aprovado_em: string | null;
  created_at: string;
  updated_at: string;
}

// Colunas `date` do Postgres chegam via node-pg como objeto Date (não
// string); ao passar por JSON.stringify na resposta HTTP, Date.toJSON()
// serializa como datetime UTC completo ('2026-01-05T00:00:00.000Z'), não
// 'YYYY-MM-DD' — e suggestedMeetingDates() abaixo espera receber uma
// string 'YYYY-MM-DD'. Mesmo padrão de normalização usado em
// visits.service.ts / dashboard.service.ts (toDateString). Confirmado
// empiricamente contra o Postgres real deste ambiente durante a
// implementação desta task — não é suposição.
function toDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

function normalizeCommittee(row: CipaCommittee): CipaCommittee {
  return {
    ...row,
    data_inicio: toDateString(row.data_inicio) as string,
    data_termino: toDateString(row.data_termino) as string,
  };
}

function normalizeMeeting(row: CipaMeeting): CipaMeeting {
  return {
    ...row,
    data: toDateString(row.data),
    proxima_reuniao_data: toDateString(row.proxima_reuniao_data),
  };
}

// Primeira ocorrência do dia da semana (0=domingo..6=sábado, convenção
// de Date.getUTCDay()) em cada um dos 12 meses a partir do mês de
// dataInicio — regra de "toda primeira segunda do mês", por exemplo.
// Sugestão, nunca definitiva (o usuário edita cada reunião depois).
export function suggestedMeetingDates(dataInicio: string, diaSemana: number): string[] {
  const start = new Date(`${dataInicio}T00:00:00Z`);
  const dates: string[] = [];
  for (let i = 0; i < 12; i++) {
    const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const diff = (diaSemana - monthStart.getUTCDay() + 7) % 7;
    monthStart.setUTCDate(monthStart.getUTCDate() + diff);
    dates.push(monthStart.toISOString().slice(0, 10));
  }
  return dates;
}

@Injectable()
export class CommitteesService {
  async create(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    ano: number,
    dataInicio: string,
    dataTermino: string,
    responsavelUserId: string,
  ): Promise<CipaCommittee> {
    const unitCheck = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (unitCheck.rowCount === 0) {
      throw new BadRequestException('Estabelecimento inválido para esta empresa');
    }

    const result = await client.query<CipaCommittee>(
      `INSERT INTO cipa_committees (tenant_id, company_unit_id, ano, data_inicio, data_termino, responsavel_user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, companyUnitId, ano, dataInicio, dataTermino, responsavelUserId],
    );
    return normalizeCommittee(result.rows[0]);
  }

  async generateMeetings(
    client: PoolClient,
    committeeId: string,
    diaSemanaPreferido: number | undefined,
    horario: string | undefined,
    local: string | undefined,
  ): Promise<CipaMeeting[]> {
    const committeeResult = await client.query<CipaCommittee>(
      'SELECT * FROM cipa_committees WHERE id = $1',
      [committeeId],
    );
    const committeeRow = committeeResult.rows[0];
    if (!committeeRow) throw new NotFoundException('Gestão da CIPA não encontrada');
    const committee = normalizeCommittee(committeeRow);

    const existing = await client.query(
      `SELECT 1 FROM cipa_meetings WHERE committee_id = $1 AND tipo = 'ordinaria' LIMIT 1`,
      [committeeId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new ConflictException('Esta gestão já tem reuniões ordinárias geradas');
    }

    const dates =
      diaSemanaPreferido !== undefined ? suggestedMeetingDates(committee.data_inicio, diaSemanaPreferido) : null;

    const values: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (let numero = 1; numero <= 12; numero++) {
      values.push(`($${i++}, $${i++}, $${i++}, 'ordinaria', $${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(
        committee.tenant_id,
        committeeId,
        committee.company_unit_id,
        numero,
        dates ? dates[numero - 1] : null,
        horario ?? null,
        local ?? null,
      );
    }

    const result = await client.query<CipaMeeting>(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, company_unit_id, tipo, numero, data, hora, local)
       VALUES ${values.join(', ')} RETURNING *`,
      params,
    );
    return result.rows.map(normalizeMeeting);
  }
}
