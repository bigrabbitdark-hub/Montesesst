import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';
import { R2Service } from '../common/r2/r2.service';
import { IMAGE_MIME_TYPES, verifyFileContent } from '../common/files/file-content.util';

export const EQUIPMENT_TYPES = [
  'extintor', 'hidrante', 'mangueira', 'alarme', 'detector',
  'iluminacao_emergencia', 'saida_emergencia', 'porta_corta_fogo',
  'sprinkler', 'central_alarme', 'outro',
] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export const EQUIPMENT_TYPE_LABEL: Record<EquipmentType, string> = {
  extintor: 'Extintor',
  hidrante: 'Hidrante',
  mangueira: 'Mangueira',
  alarme: 'Alarme',
  detector: 'Detector',
  iluminacao_emergencia: 'Iluminação de emergência',
  saida_emergencia: 'Saída de emergência',
  porta_corta_fogo: 'Porta corta-fogo',
  sprinkler: 'Sprinkler',
  central_alarme: 'Central de alarme',
  outro: 'Outro',
};

export type EquipmentStatus = 'regular' | 'vencendo' | 'vencido';

const EQUIPMENT_VENCENDO_WINDOW_DAYS = 30;

export function getEquipmentStatus(proximaManutencao: string | Date | null): EquipmentStatus {
  if (!proximaManutencao) return 'regular';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(proximaManutencao);
  dueDate.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'vencido';
  if (diffDays <= EQUIPMENT_VENCENDO_WINDOW_DAYS) return 'vencendo';
  return 'regular';
}

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'arquivo';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export interface FireSafetyEquipmentRow {
  id: string;
  tenant_id: string;
  company_unit_id: string | null;
  tipo: EquipmentType;
  codigo: string;
  localizacao: string | null;
  data_instalacao: string | null;
  data_ultima_manutencao: string | null;
  proxima_manutencao: string | null;
  empresa_responsavel: string | null;
  observacoes: string | null;
  foto_r2_key: string | null;
  agente_extintor: string | null;
  capacidade: string | null;
  classe_fogo: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface FireSafetyEquipment extends FireSafetyEquipmentRow {
  status: EquipmentStatus;
}

function withStatus(row: FireSafetyEquipmentRow): FireSafetyEquipment {
  return { ...row, status: getEquipmentStatus(row.proxima_manutencao) };
}

interface CreateEquipmentData {
  tenantId: string;
  tipo: EquipmentType;
  codigo: string;
  companyUnitId?: string;
  localizacao?: string;
  dataInstalacao?: string;
  dataUltimaManutencao?: string;
  proximaManutencao?: string;
  empresaResponsavel?: string;
  observacoes?: string;
  agenteExtintor?: string;
  capacidade?: string;
  classeFogo?: string;
  createdByUserId: string;
}

interface UpdateEquipmentData {
  tipo?: string;
  codigo?: string;
  company_unit_id?: string;
  localizacao?: string;
  data_instalacao?: string;
  data_ultima_manutencao?: string;
  proxima_manutencao?: string;
  empresa_responsavel?: string;
  observacoes?: string;
  agente_extintor?: string | null;
  capacidade?: string | null;
  classe_fogo?: string | null;
}

const UPDATABLE_FIELDS = [
  'tipo', 'codigo', 'company_unit_id', 'localizacao', 'data_instalacao',
  'data_ultima_manutencao', 'proxima_manutencao', 'empresa_responsavel',
  'observacoes', 'agente_extintor', 'capacidade', 'classe_fogo',
] as const;

@Injectable()
export class FireSafetyEquipmentService {
  constructor(private readonly r2: R2Service) {}

  private async assertCompanyUnitBelongsToTenant(
    client: PoolClient,
    companyUnitId: string,
    tenantId: string,
  ): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new BadRequestException('Filial não encontrada');
  }

  async create(client: PoolClient, data: CreateEquipmentData): Promise<FireSafetyEquipment> {
    if (data.companyUnitId) {
      await this.assertCompanyUnitBelongsToTenant(client, data.companyUnitId, data.tenantId);
    }
    // Campos de extintor só fazem sentido pra tipo='extintor' — ignorados
    // silenciosamente pra qualquer outro tipo (spec, Seção 4), já que o
    // cliente pode reenviar o mesmo formulário genérico pra qualquer tipo
    // sem precisar tratar isso como erro de validação.
    const isExtintor = data.tipo === 'extintor';
    try {
      const result = await client.query<FireSafetyEquipmentRow>(
        `INSERT INTO fire_safety_equipment
           (tenant_id, company_unit_id, tipo, codigo, localizacao, data_instalacao,
            data_ultima_manutencao, proxima_manutencao, empresa_responsavel, observacoes,
            agente_extintor, capacidade, classe_fogo, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          data.tenantId,
          data.companyUnitId ?? null,
          data.tipo,
          data.codigo,
          data.localizacao ?? null,
          data.dataInstalacao ?? null,
          data.dataUltimaManutencao ?? null,
          data.proximaManutencao ?? null,
          data.empresaResponsavel ?? null,
          data.observacoes ?? null,
          isExtintor ? (data.agenteExtintor ?? null) : null,
          isExtintor ? (data.capacidade ?? null) : null,
          isExtintor ? (data.classeFogo ?? null) : null,
          data.createdByUserId,
        ],
      );
      return withStatus(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(
    client: PoolClient,
    tenantId?: string,
    filters?: { tipo?: string; status?: EquipmentStatus },
  ): Promise<FireSafetyEquipment[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (tenantId) {
      values.push(tenantId);
      conditions.push(`tenant_id = $${values.length}`);
    }
    if (filters?.tipo) {
      values.push(filters.tipo);
      conditions.push(`tipo = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await client.query<FireSafetyEquipmentRow>(
      `SELECT * FROM fire_safety_equipment ${where} ORDER BY created_at DESC`,
      values,
    );
    const equipment = result.rows.map(withStatus);
    // status é calculado, não persistido — filtro é em memória, depois
    // da query, igual ao resto do cálculo de status (ver getEquipmentStatus).
    return filters?.status ? equipment.filter((eq) => eq.status === filters.status) : equipment;
  }

  async findOne(client: PoolClient, id: string): Promise<FireSafetyEquipment> {
    const result = await client.query<FireSafetyEquipmentRow>(
      'SELECT * FROM fire_safety_equipment WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Equipamento não encontrado');
    return withStatus(row);
  }

  async update(client: PoolClient, id: string, data: UpdateEquipmentData): Promise<FireSafetyEquipment> {
    // Mesma invariante do create() (comentário lá em cima): campos de
    // extintor só valem pra tipo='extintor'. Só precisamos saber o tipo
    // atual da linha quando o PATCH pode alterar essa invariante — ou seja,
    // quando ele muda `tipo` sem repetir os campos de extintor, ou envia
    // campo de extintor sem repetir `tipo` (nesses casos o tipo "efetivo"
    // depende do que já está no banco).
    const touchesExtintorInvariant =
      data.tipo !== undefined ||
      data.agente_extintor !== undefined ||
      data.capacidade !== undefined ||
      data.classe_fogo !== undefined;
    const needsCurrentTipo = touchesExtintorInvariant && data.tipo === undefined;

    let currentRow: { tenant_id: string; tipo: string } | undefined;
    if (data.company_unit_id || needsCurrentTipo) {
      const existing = await client.query<{ tenant_id: string; tipo: string }>(
        'SELECT tenant_id, tipo FROM fire_safety_equipment WHERE id = $1',
        [id],
      );
      if (existing.rowCount === 0) throw new NotFoundException('Equipamento não encontrado');
      currentRow = existing.rows[0];
    }
    if (data.company_unit_id) {
      await this.assertCompanyUnitBelongsToTenant(client, data.company_unit_id, currentRow!.tenant_id);
    }

    const updateData: UpdateEquipmentData = { ...data };
    if (touchesExtintorInvariant) {
      const effectiveTipo = data.tipo ?? currentRow!.tipo;
      if (effectiveTipo !== 'extintor') {
        updateData.agente_extintor = null;
        updateData.capacidade = null;
        updateData.classe_fogo = null;
      }
    }

    const { setClauses, values } = buildSafeSetClause(updateData, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    const result = await client.query<FireSafetyEquipmentRow>(
      `UPDATE fire_safety_equipment SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Equipamento não encontrado');
    return withStatus(row);
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const existing = await client.query<{ foto_r2_key: string | null }>(
      'SELECT foto_r2_key FROM fire_safety_equipment WHERE id = $1',
      [id],
    );
    if (existing.rowCount === 0) throw new NotFoundException('Equipamento não encontrado');
    await client.query('DELETE FROM fire_safety_equipment WHERE id = $1', [id]);
    if (existing.rows[0].foto_r2_key) {
      // Best-effort — não bloqueia a exclusão do registro se o objeto no
      // R2 já não existir ou a chamada falhar.
      await this.r2.deleteObject(existing.rows[0].foto_r2_key).catch(() => undefined);
    }
  }

  async uploadFoto(client: PoolClient, id: string, file: Express.Multer.File): Promise<FireSafetyEquipment> {
    // ITEM 004: este endpoint não validava tipo nenhum — qualquer arquivo era
    // gravado no R2 com o Content-Type que o cliente mandasse.
    if (!IMAGE_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Tipo de arquivo não permitido (só JPG ou PNG)');
    }
    const contentProblem = await verifyFileContent(file.buffer, file.mimetype);
    if (contentProblem) throw new BadRequestException(contentProblem);

    const equipment = await this.findOne(client, id);
    const fileKey = `tenants/${equipment.tenant_id}/fire-safety-equipment/${id}/${sanitizeFileName(file.originalname)}`;
    await this.r2.putObject(fileKey, file.buffer, file.mimetype);
    const result = await client.query<FireSafetyEquipmentRow>(
      'UPDATE fire_safety_equipment SET foto_r2_key = $2 WHERE id = $1 RETURNING *',
      [id, fileKey],
    );
    return withStatus(result.rows[0]);
  }

  async getFotoUrl(client: PoolClient, id: string): Promise<{ url: string }> {
    const equipment = await this.findOne(client, id);
    if (!equipment.foto_r2_key) throw new NotFoundException('Nenhuma foto cadastrada pra esse equipamento');
    const url = await this.r2.getPresignedDownloadUrl(equipment.foto_r2_key);
    return { url };
  }
}
