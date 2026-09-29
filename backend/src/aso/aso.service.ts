import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CreateAsoRecordDto } from './dto/create-aso-record.dto';
import { CreatePcmsoPhysicianDto } from './dto/create-pcmso-physician.dto';

export interface AsoRecord {
  id: string;
  tenant_id: string;
  employee_id: string;
  exam_type: string;
  exam_date: string;
  result: string;
  result_disclosure_authorized: boolean;
  doctor_name: string;
  doctor_crm: string;
  doctor_crm_uf: string;
  pcmso_physician_id: string | null;
  created_by_user_id: string;
  created_at: string;
}

@Injectable()
export class AsoService {
  async createRecord(
    client: PoolClient,
    dto: CreateAsoRecordDto,
    userId: string,
  ): Promise<AsoRecord> {
    // Sem WHERE tenant_id explícito no INSERT: RLS exige que o tenant_id gravado
    // bata com app.tenant_id do contexto — usamos current_setting diretamente,
    // igual ao padrão já usado no resto do projeto, nunca um tenantId vindo do DTO.
    const result = await client.query<AsoRecord>(
      `INSERT INTO aso_records (
        tenant_id, employee_id, exam_type, exam_date, result,
        result_disclosure_authorized, doctor_name, doctor_crm, doctor_crm_uf,
        pcmso_physician_id, created_by_user_id
      ) VALUES (
        NULLIF(current_setting('app.tenant_id', true), '')::uuid,
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) RETURNING *`,
      [
        dto.employeeId, dto.examType, dto.examDate, dto.result,
        dto.resultDisclosureAuthorized, dto.doctorName, dto.doctorCrm, dto.doctorCrmUf,
        dto.pcmsoPhysicianId ?? null, userId,
      ],
    );
    return result.rows[0];
  }

  async findByEmployee(client: PoolClient, employeeId: string): Promise<AsoRecord[]> {
    const result = await client.query<AsoRecord>(
      'SELECT * FROM aso_records WHERE employee_id = $1 ORDER BY exam_date DESC',
      [employeeId],
    );
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<AsoRecord> {
    const result = await client.query<AsoRecord>('SELECT * FROM aso_records WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new NotFoundException('Registro de ASO não encontrado');
    return result.rows[0];
  }

  async createPhysician(client: PoolClient, dto: CreatePcmsoPhysicianDto) {
    const result = await client.query(
      `INSERT INTO tenant_pcmso_physicians (tenant_id, cpf, name, crm, crm_uf)
       VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid, $1, $2, $3, $4)
       RETURNING *`,
      [dto.cpf, dto.name, dto.crm, dto.crmUf],
    );
    return result.rows[0];
  }
}
