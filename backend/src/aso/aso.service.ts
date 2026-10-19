import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CreateAsoRecordDto } from './dto/create-aso-record.dto';
import { CreatePcmsoPhysicianDto } from './dto/create-pcmso-physician.dto';
import { CreateAsoExamDto } from './dto/create-aso-exam.dto';

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
    // E-06: a chave estrangeira do Postgres ignora RLS. Sem esta checagem, o INSERT passaria com o UUID
    // de funcionário/médico de OUTRO tenant. Estas consultas rodam sob RLS: só enxergam o próprio tenant.
    const emp = await client.query('SELECT 1 FROM employees WHERE id = $1', [dto.employeeId]);
    if (emp.rows.length === 0) throw new BadRequestException('Funcionário não encontrado');
    if (dto.pcmsoPhysicianId) {
      const doc = await client.query('SELECT 1 FROM tenant_pcmso_physicians WHERE id = $1 AND active', [dto.pcmsoPhysicianId]);
      if (doc.rows.length === 0) throw new BadRequestException('Médico coordenador do PCMSO não encontrado');
    }
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

  async listPhysicians(client: PoolClient) {
    const result = await client.query(
      'SELECT id, name, crm, crm_uf, active, created_at FROM tenant_pcmso_physicians WHERE active ORDER BY name',
    );
    return result.rows;
  }

  // Exames complementares do ASO (bloco {exame} do S-2220). O ASO precisa ser visível sob RLS.
  async addExam(client: PoolClient, asoRecordId: string, dto: CreateAsoExamDto) {
    const aso = await this.findOne(client, asoRecordId);
    if (new Date(dto.examDate) > new Date(aso.exam_date)) {
      throw new BadRequestException('A data do exame não pode ser posterior à data do ASO (regra do leiaute S-2220)');
    }
    const used = await client.query(
      `SELECT 1 FROM esocial_events WHERE aso_record_id = $1 AND event_type = 'S-2220' AND status NOT IN ($2, $3, $4)`,
      [asoRecordId, 'rejeitado', 'erro_tecnico', 'excluido'],
    );
    if (used.rows.length > 0) {
      throw new BadRequestException('Este ASO já tem evento eSocial em andamento; não é possível alterar os exames');
    }
    const result = await client.query(
      `INSERT INTO aso_exam_details (tenant_id, aso_record_id, procedure_name, procedure_code, order_exam, exam_date, obs_proc)
       VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6)
       RETURNING id, aso_record_id, procedure_name, procedure_code, order_exam, exam_date, obs_proc`,
      [asoRecordId, dto.procedureName, dto.procedureCode, dto.orderExam ?? null, dto.examDate, dto.obsProc ?? null],
    );
    return result.rows[0];
  }

  async listExams(client: PoolClient, asoRecordId: string) {
    await this.findOne(client, asoRecordId);
    const result = await client.query(
      `SELECT id, procedure_name, procedure_code, order_exam, exam_date, obs_proc
         FROM aso_exam_details WHERE aso_record_id = $1 ORDER BY exam_date, created_at`,
      [asoRecordId],
    );
    return result.rows;
  }
}
