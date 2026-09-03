import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { toDateString } from './committees.service';
import { DocumentsService } from '../documents/documents.service';

export const TRAINING_TYPES = [
  'nr-05', 'nr-06', 'nr-10', 'nr-11', 'nr-12', 'nr-18', 'nr-20', 'nr-33', 'nr-35', 'outro',
] as const;
export type TrainingType = (typeof TRAINING_TYPES)[number];

export const TRAINING_TYPE_LABEL: Record<TrainingType, string> = {
  'nr-05': 'NR-05 — Membro da CIPA',
  'nr-06': 'NR-06 — Uso de EPI',
  'nr-10': 'NR-10 — Segurança em eletricidade',
  'nr-11': 'NR-11 — Transporte/movimentação de materiais',
  'nr-12': 'NR-12 — Segurança em máquinas e equipamentos',
  'nr-18': 'NR-18 — Condições de segurança na construção civil',
  'nr-20': 'NR-20 — Inflamáveis e combustíveis',
  'nr-33': 'NR-33 — Espaço confinado',
  'nr-35': 'NR-35 — Trabalho em altura',
  outro: 'Outro',
};

// Validade padrão sugerida, em meses — sempre editável pela empresa
// antes de salvar (decisão da spec, seção 2). 'outro' não tem
// sugestão (o próprio TRAINING_TYPE_LABEL cobre a exibição, mas não
// existe aqui porque não há um número universal pra "outro").
export const TRAINING_VALIDITY_MONTHS: Record<Exclude<TrainingType, 'outro'>, number> = {
  'nr-05': 24,
  'nr-06': 12,
  'nr-10': 24,
  'nr-11': 12,
  'nr-12': 24,
  'nr-18': 12,
  'nr-20': 12,
  'nr-33': 12,
  'nr-35': 24,
};

const VENCENDO_WINDOW_DAYS = 60;

export interface CipaTraining {
  id: string;
  tenant_id: string;
  employee_id: string;
  tipo: TrainingType;
  tipo_outro: string | null;
  data_realizacao: string;
  data_validade: string;
  carga_horaria: number | null;
  certificado_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CipaTrainingWithStatus extends CipaTraining {
  employee_full_name: string;
  status: 'valido' | 'vencendo' | 'vencido';
}

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

function normalizeTraining(row: CipaTraining): CipaTraining {
  return {
    ...row,
    data_realizacao: toDateString(row.data_realizacao) as string,
    data_validade: toDateString(row.data_validade) as string,
  };
}

// Mesmo cálculo usado tanto na listagem quanto no merge de pendências
// (pendencias.service.ts) — cada um decide separadamente SE aplica o
// filtro de "só o registro mais recente por funcionário+tipo" (a
// listagem mostra todo o histórico, o merge de pendências não).
export function computeTrainingStatus(dataValidade: string, today: Date = new Date()): 'valido' | 'vencendo' | 'vencido' {
  const todayMidnight = new Date(today);
  todayMidnight.setHours(0, 0, 0, 0);
  const validade = new Date(`${dataValidade}T00:00:00`);
  const diffDays = Math.floor((validade.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'vencido';
  if (diffDays <= VENCENDO_WINDOW_DAYS) return 'vencendo';
  return 'valido';
}

@Injectable()
export class TrainingsService {
  constructor(private readonly documents: DocumentsService) {}

  async create(
    client: PoolClient,
    tenantId: string,
    userId: string,
    data: {
      employeeId: string;
      tipo: TrainingType;
      tipoOutro?: string;
      dataRealizacao: string;
      dataValidade: string;
      cargaHoraria?: number;
      file?: UploadFile;
    },
  ): Promise<CipaTraining> {
    // Achado da revisão final da Fase 14 (ElectionsService.addCandidate):
    // employee_id é client-supplied e o FK sozinho não impede um id de
    // outro tenant (checagem de FK roda com RLS bypassada por design do
    // Postgres). Mesma checagem, mesmo motivo.
    const empCheck = await client.query<{ full_name: string }>(
      'SELECT full_name FROM employees WHERE id = $1 AND tenant_id = $2',
      [data.employeeId, tenantId],
    );
    const employee = empCheck.rows[0];
    if (!employee) {
      throw new BadRequestException('Funcionário informado não pertence a este tenant');
    }

    let certificadoDocumentId: string | null = null;
    if (data.file) {
      const document = await this.documents.upload(client, {
        tenantId,
        category: 'treinamento',
        title: `Certificado — ${TRAINING_TYPE_LABEL[data.tipo]} — ${employee.full_name}`,
        file: data.file,
        uploadedByUserId: userId,
        uploadedByRole: 'empresa',
      });
      certificadoDocumentId = document.id;
    }

    try {
      const result = await client.query<CipaTraining>(
        `INSERT INTO cipa_trainings (tenant_id, employee_id, tipo, tipo_outro, data_realizacao, data_validade, carga_horaria, certificado_document_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          tenantId,
          data.employeeId,
          data.tipo,
          data.tipoOutro ?? null,
          data.dataRealizacao,
          data.dataValidade,
          data.cargaHoraria ?? null,
          certificadoDocumentId,
        ],
      );
      return normalizeTraining(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(
    client: PoolClient,
    filters: { employeeId?: string; tipo?: string; status?: string },
  ): Promise<CipaTrainingWithStatus[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (filters.employeeId) {
      conditions.push(`t.employee_id = $${i++}`);
      values.push(filters.employeeId);
    }
    if (filters.tipo) {
      conditions.push(`t.tipo = $${i++}`);
      values.push(filters.tipo);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await client.query<CipaTraining & { employee_full_name: string }>(
      `SELECT t.*, e.full_name AS employee_full_name
       FROM cipa_trainings t
       JOIN employees e ON e.id = t.employee_id
       ${where}
       ORDER BY t.data_validade`,
      values,
    );

    // Status é por-registro, não "só o mais recente" — a listagem
    // mostra o histórico completo, e um certificado antigo mostrando
    // "vencido" é só um fato histórico verdadeiro, não uma ação
    // pendente (essa distinção é exclusiva do merge de pendências, ver
    // pendencias.service.ts).
    const withStatus: CipaTrainingWithStatus[] = result.rows.map((row) => {
      const normalized = normalizeTraining(row);
      return {
        ...normalized,
        employee_full_name: row.employee_full_name,
        status: computeTrainingStatus(normalized.data_validade),
      };
    });

    if (filters.status) {
      return withStatus.filter((t) => t.status === filters.status);
    }
    return withStatus;
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const result = await client.query('DELETE FROM cipa_trainings WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Registro de treinamento não encontrado');
  }
}
