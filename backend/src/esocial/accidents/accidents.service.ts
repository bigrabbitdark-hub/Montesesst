import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AccidentDto } from './accident.dto';

// [chave do DTO, coluna]. Fonte única do mapeamento: insert e update usam a mesma lista.
const FIELDS: Array<[keyof AccidentDto, string]> = [
  ['employeeId', 'employee_id'], ['acidDate', 'acid_date'], ['acidType', 'acid_type'], ['acidTime', 'acid_time'],
  ['hoursWorkedBefore', 'hours_worked_before'], ['catType', 'cat_type'], ['death', 'death'], ['deathDate', 'death_date'],
  ['policeNotified', 'police_notified'], ['causingSituationCode', 'causing_situation_code'], ['catInitiative', 'cat_initiative'],
  ['catNotes', 'cat_notes'], ['lastWorkDay', 'last_work_day'], ['hadLeave', 'had_leave'], ['locationType', 'location_type'],
  ['locationDescription', 'location_description'], ['locStreetType', 'loc_street_type'], ['locStreet', 'loc_street'],
  ['locNumber', 'loc_number'], ['locComplement', 'loc_complement'], ['locDistrict', 'loc_district'], ['locCep', 'loc_cep'],
  ['locCityCode', 'loc_city_code'], ['locUf', 'loc_uf'], ['locCountry', 'loc_country'], ['locPostalCode', 'loc_postal_code'],
  ['locInscriptionType', 'loc_inscription_type'], ['locInscriptionNumber', 'loc_inscription_number'],
  ['bodyPartCode', 'body_part_code'], ['laterality', 'laterality'], ['causingAgentCode', 'causing_agent_code'],
  ['attDate', 'att_date'], ['attTime', 'att_time'], ['attHospitalized', 'att_hospitalized'], ['attTreatmentDays', 'att_treatment_days'],
  ['attLeave', 'att_leave'], ['attInjuryCode', 'att_injury_code'], ['attInjuryDetail', 'att_injury_detail'],
  ['attProbableDiagnosis', 'att_probable_diagnosis'], ['attCid', 'att_cid'], ['attNotes', 'att_notes'],
  ['attIssuerName', 'att_issuer_name'], ['attIssuerCouncil', 'att_issuer_council'], ['attIssuerNumber', 'att_issuer_number'],
  ['attIssuerUf', 'att_issuer_uf'], ['originEventId', 'origin_event_id'],
];

// Lista sem os campos de saúde mais sensíveis (CID, lesão, observações): a listagem só identifica a CAT.
const LIST_COLS = `a.id, a.employee_id, e.full_name AS employee_name, to_char(a.acid_date, 'YYYY-MM-DD') AS acid_date,
  a.acid_type, a.cat_type, a.death, a.created_at`;

@Injectable()
export class AccidentsService {
  private async assertRefs(client: PoolClient, dto: AccidentDto) {
    // A chave estrangeira do Postgres ignora RLS: confere sob RLS que o funcionário e o evento de origem são do tenant.
    const emp = await client.query('SELECT 1 FROM employees WHERE id = $1', [dto.employeeId]);
    if (emp.rows.length === 0) throw new BadRequestException('Funcionário não encontrado');
    if (dto.originEventId) {
      const o = await client.query(`SELECT 1 FROM esocial_events WHERE id = $1 AND event_type = 'S-2210' AND employee_id = $2`, [dto.originEventId, dto.employeeId]);
      if (o.rows.length === 0) throw new BadRequestException('CAT de origem não encontrada para este funcionário');
    }
  }

  private values(dto: AccidentDto): unknown[] {
    return FIELDS.map(([k]) => {
      const v = (dto as any)[k];
      if (v === undefined || v === '') return null;
      if ((k === 'locUf' || k === 'attIssuerUf' || k === 'locInscriptionNumber') && typeof v === 'string') return v.toUpperCase();
      return v;
    });
  }

  async create(client: PoolClient, dto: AccidentDto, userId: string) {
    await this.assertRefs(client, dto);
    const cols = FIELDS.map(([, c]) => c);
    const r = await client.query(
      `INSERT INTO work_accidents (tenant_id, ${cols.join(', ')}, created_by_user_id)
       VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid, ${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1})
       RETURNING id`,
      [...this.values(dto), userId],
    );
    return this.get(client, r.rows[0].id);
  }

  // Só edita enquanto não há evento ativo: depois de gerado o XML, o que foi enviado é a evidência.
  async update(client: PoolClient, id: string, dto: AccidentDto) {
    await this.get(client, id);
    const active = await client.query(
      `SELECT 1 FROM esocial_events WHERE accident_id = $1 AND status NOT IN ('rejeitado', 'erro_tecnico', 'excluido')`, [id]);
    if (active.rows.length > 0) throw new ConflictException('Esta CAT já tem evento eSocial em andamento; exclua o evento (S-3000) antes de alterar');
    await this.assertRefs(client, dto);
    const cols = FIELDS.map(([, c]) => c);
    await client.query(`UPDATE work_accidents SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1}`, [...this.values(dto), id]);
    return this.get(client, id);
  }

  async list(client: PoolClient) {
    const r = await client.query(`SELECT ${LIST_COLS} FROM work_accidents a JOIN employees e ON e.id = a.employee_id ORDER BY a.acid_date DESC, a.created_at DESC LIMIT 200`);
    return r.rows;
  }

  async get(client: PoolClient, id: string) {
    const r = await client.query(
      `SELECT a.*, to_char(a.acid_date, 'YYYY-MM-DD') AS acid_date_s, e.full_name AS employee_name
         FROM work_accidents a JOIN employees e ON e.id = a.employee_id WHERE a.id = $1`, [id]);
    if (r.rows.length === 0) throw new NotFoundException('Acidente não encontrado');
    return r.rows[0];
  }
}
