import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { toDateString } from './committees.service';
import { mapPgError } from '../common/pg-error.util';
import { assertUserInTenant } from './tenant-guards';

export interface CipaPendencia {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  meeting_id: string | null;
  descricao: string;
  responsavel_user_id: string | null;
  prazo: string | null;
  prioridade: 'alta' | 'media' | 'baixa';
  status: 'aberta' | 'andamento' | 'concluida' | 'atrasada';
  created_at: string;
  updated_at: string;
  origem?: 'treinamento';
}

const UPDATABLE_FIELDS = ['descricao', 'responsavel_user_id', 'prazo', 'prioridade', 'status'] as const;

// Mesmo padrão de normalização de colunas DATE usado em
// committees.service.ts / meetings.service.ts / members.service.ts
// (toDateString reexportado de committees.service.ts) — cipa_pendencias
// tem uma coluna DATE (prazo) que o node-pg devolve como objeto Date.
function normalizePendencia(row: CipaPendencia): CipaPendencia {
  return {
    ...row,
    prazo: toDateString(row.prazo),
  };
}

@Injectable()
export class PendenciasService {
  async create(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    meetingId: string | undefined,
    descricao: string,
    responsavelUserId: string | undefined,
    prazo: string | undefined,
    prioridade: string | undefined,
  ): Promise<CipaPendencia> {
    // Mesma checagem de CommitteesService.create / MembersService.create —
    // achado da revisão de Task 4: sem isso, um company_unit_id de outro
    // tenant passa pelo FK-only e a pendência fica vinculada ao
    // estabelecimento errado.
    const unitCheck = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (unitCheck.rowCount === 0) {
      throw new BadRequestException('Estabelecimento inválido para esta empresa');
    }

    // Mesma checagem, mesmo motivo (FK-only não impede cross-tenant sob
    // RLS — a FK verifica só que a linha existe, não que ela pertence ao
    // tenant do caller): meeting_id é opcional (é o que permite esta
    // tabela unificar plano de ação nascido de reunião e pendência
    // avulsa), mas quando informado precisa pertencer ao mesmo tenant.
    if (meetingId) {
      const meetingCheck = await client.query<{ company_unit_id: string }>(
        'SELECT company_unit_id FROM cipa_meetings WHERE id = $1 AND tenant_id = $2',
        [meetingId, tenantId],
      );
      const meetingRow = meetingCheck.rows[0];
      if (!meetingRow) {
        throw new BadRequestException('Reunião inválida para esta empresa');
      }
      // Achado da revisão final (Fix 10a): validar company_unit_id e
      // meeting_id cada um contra o tenant não bastava — os dois podem
      // ser válidos individualmente (mesmo tenant) e ainda assim
      // pertencer a estabelecimentos DIFERENTES do mesmo tenant (ex.:
      // pendência filiada ao estabelecimento B citando reunião do
      // estabelecimento A).
      if (meetingRow.company_unit_id !== companyUnitId) {
        throw new BadRequestException('Reunião não pertence ao estabelecimento informado');
      }
    }

    if (responsavelUserId) {
      await assertUserInTenant(client, responsavelUserId, tenantId);
    }

    try {
      const result = await client.query<CipaPendencia>(
        `INSERT INTO cipa_pendencias (tenant_id, company_unit_id, meeting_id, descricao, responsavel_user_id, prazo, prioridade)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'media')) RETURNING *`,
        [tenantId, companyUnitId, meetingId ?? null, descricao, responsavelUserId ?? null, prazo ?? null, prioridade ?? null],
      );
      return normalizePendencia(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, companyUnitId?: string): Promise<CipaPendencia[]> {
    const manualResult = companyUnitId
      ? await client.query<CipaPendencia>(
          'SELECT * FROM cipa_pendencias WHERE company_unit_id = $1 ORDER BY prazo NULLS LAST, created_at',
          [companyUnitId],
        )
      : await client.query<CipaPendencia>('SELECT * FROM cipa_pendencias ORDER BY prazo NULLS LAST, created_at');

    const computed = await this.computeTrainingPendencias(client);
    return [...manualResult.rows.map(normalizePendencia), ...computed];
  }

  // Fase 15: treinamento vencido/vencendo (janela de 60 dias, mesma de
  // TrainingsService) vira pendência calculada na consulta — sem
  // scheduler novo (decisão da spec). Não filtra por company_unit_id
  // porque cipa_trainings não tem essa coluna (employees é
  // tenant-wide, decisão já registrada na spec) — aparece
  // independente do estabelecimento selecionado. DISTINCT ON pega só
  // o registro MAIS RECENTE por funcionário+tipo (decisão da spec:
  // "o vencimento considerado é sempre o do registro mais recente
  // daquele tipo" — sem isso, um certificado antigo já renovado
  // continuaria gerando pendência pra sempre).
  private async computeTrainingPendencias(client: PoolClient): Promise<CipaPendencia[]> {
    const result = await client.query<{
      id: string;
      tipo: string;
      tipo_outro: string | null;
      data_validade: string | Date;
      employee_full_name: string;
    }>(
      `SELECT DISTINCT ON (t.employee_id, t.tipo) t.id, t.tipo, t.tipo_outro, t.data_validade, e.full_name AS employee_full_name
       FROM cipa_trainings t
       JOIN employees e ON e.id = t.employee_id
       ORDER BY t.employee_id, t.tipo, t.data_realizacao DESC, t.created_at DESC`,
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nowIso = new Date().toISOString();

    const items: CipaPendencia[] = [];
    for (const row of result.rows) {
      const dataValidade = toDateString(row.data_validade) as string;
      const validade = new Date(`${dataValidade}T00:00:00`);
      const diffDays = Math.floor((validade.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 60) continue; // válido, fora da janela — não é pendência

      const tipoLabel = row.tipo === 'outro' ? row.tipo_outro : row.tipo.toUpperCase();
      const descricao = diffDays < 0
        ? `${tipoLabel} de ${row.employee_full_name} venceu há ${Math.abs(diffDays)} dia(s)`
        : `${tipoLabel} de ${row.employee_full_name} vence em ${diffDays} dia(s)`;

      items.push({
        id: `treinamento:${row.id}`,
        tenant_id: '',
        company_unit_id: '',
        meeting_id: null,
        descricao,
        responsavel_user_id: null,
        prazo: dataValidade,
        prioridade: diffDays < 0 ? 'alta' : 'media',
        status: 'aberta',
        created_at: nowIso,
        updated_at: nowIso,
        origem: 'treinamento',
      });
    }
    return items;
  }

  async update(client: PoolClient, id: string, data: Record<string, unknown>): Promise<CipaPendencia> {
    // Achado da revisão final (Fix 6): responsavel_user_id também precisa
    // ser validado contra o tenant aqui, não só em create() — precisa do
    // tenant_id da própria pendência (não é parâmetro deste método).
    if (data.responsavel_user_id !== undefined && data.responsavel_user_id !== null) {
      const tenantResult = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM cipa_pendencias WHERE id = $1',
        [id],
      );
      const tenantRow = tenantResult.rows[0];
      if (!tenantRow) throw new NotFoundException('Pendência não encontrada');
      await assertUserInTenant(client, data.responsavel_user_id as string, tenantRow.tenant_id);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 2;
    for (const field of UPDATABLE_FIELDS) {
      if (data[field] !== undefined) {
        setClauses.push(`${field} = $${i++}`);
        values.push(data[field]);
      }
    }
    if (setClauses.length === 0) {
      const result = await client.query<CipaPendencia>('SELECT * FROM cipa_pendencias WHERE id = $1', [id]);
      const pendencia = result.rows[0];
      if (!pendencia) throw new NotFoundException('Pendência não encontrada');
      return normalizePendencia(pendencia);
    }

    try {
      const result = await client.query<CipaPendencia>(
        `UPDATE cipa_pendencias SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
        [id, ...values],
      );
      if (result.rows.length === 0) throw new NotFoundException('Pendência não encontrada');
      return normalizePendencia(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }
}
