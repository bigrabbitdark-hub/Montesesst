import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { EXAM_TYPE_TO_TP_EXAME_OCUP, S2220Payload } from '../xml/s2220.types';
import { UF_LIST, isCnpjFormat, isValidCpf } from '../common/validators';
import { S2210Payload } from '../xml/s2210-xml.builder';

export interface DiagnosticIssue {
  code: string;
  message: string;
  blocking: boolean;
}

export interface DiagnosticResult<P = S2220Payload> {
  ok: boolean; // sem nenhum item bloqueante
  issues: DiagnosticIssue[];
  payload: P | null; // só vem preenchido quando ok
}

// Próximo dia útil (sábado e domingo; feriados NÃO são considerados).
function nextBusinessDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

// "O que falta antes de transmitir" para um ASO → S-2220. Só lê (nunca grava) e sempre sob o
// contexto do tenant do usuário autenticado (RLS): o ASO, o funcionário, o médico e o certificado
// de outro tenant simplesmente não aparecem, e viram "não encontrado".
@Injectable()
export class EsocialDiagnosticsService {
  async diagnoseAso(client: PoolClient, asoRecordId: string, certificateId?: string): Promise<DiagnosticResult> {
    const issues: DiagnosticIssue[] = [];
    const block = (code: string, message: string) => issues.push({ code, message, blocking: true });
    const warn = (code: string, message: string) => issues.push({ code, message, blocking: false });

    const asoQ = await client.query(
      `SELECT a.id, a.exam_type, a.result, a.doctor_name, a.doctor_crm, a.doctor_crm_uf,
              to_char(a.exam_date, 'YYYY-MM-DD') AS exam_date, a.exam_date > CURRENT_DATE AS future,
              e.id AS employee_id, e.cpf, e.registration_number, e.esocial_category_code, e.esocial_vinculo_confirmed_at,
              p.cpf AS p_cpf, p.name AS p_name, p.crm AS p_crm, p.crm_uf AS p_uf, p.active AS p_active
         FROM aso_records a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN tenant_pcmso_physicians p ON p.id = a.pcmso_physician_id
        WHERE a.id = $1`,
      [asoRecordId],
    );
    if (asoQ.rows.length === 0) throw new NotFoundException('ASO não encontrado');
    const a = asoQ.rows[0];

    const tenantQ = await client.query(
      `SELECT cnpj FROM tenants WHERE id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`,
    );
    const cnpj: string | undefined = tenantQ.rows[0]?.cnpj;
    if (!cnpj || !isCnpjFormat(cnpj)) block('EMPREGADOR_CNPJ', 'O CNPJ da empresa não está em formato válido para o eSocial.');

    if (!isValidCpf(a.cpf)) block('TRABALHADOR_CPF', 'O CPF do trabalhador é inválido. Corrija o cadastro do funcionário.');
    if (!a.esocial_vinculo_confirmed_at) {
      block(
        'VINCULO_NAO_CONFIRMADO',
        'Confirme que o vínculo deste trabalhador já foi enviado ao eSocial (S-2200, S-2190 ou S-2300). O S-2220 só é aceito depois disso.',
      );
    }
    if (!a.registration_number) warn('MATRICULA_AUSENTE', 'Matrícula do trabalhador não informada; confira se o eSocial exige para este vínculo.');
    if (!a.esocial_category_code) warn('CATEGORIA_AUSENTE', 'Categoria eSocial do trabalhador não informada; confira se o eSocial exige para este vínculo.');
    if (a.esocial_category_code && !/^\d{3}$/.test(a.esocial_category_code)) block('CATEGORIA_FORMATO', 'A categoria eSocial deve ter 3 dígitos.');
    if (a.registration_number && String(a.registration_number).length > 30) block('MATRICULA_FORMATO', 'A matrícula tem no máximo 30 caracteres.');

    const tp = EXAM_TYPE_TO_TP_EXAME_OCUP[a.exam_type];
    if (tp === undefined) block('ASO_TIPO', 'Tipo de exame do ASO sem correspondência no eSocial.');
    if (a.future) block('ASO_DATA_FUTURA', 'A data do ASO é futura.');

    if (!a.doctor_crm || a.doctor_crm.length > 10) block('MEDICO_CRM', 'O CRM do médico do ASO é obrigatório e tem no máximo 10 caracteres.');
    if (!UF_LIST.includes(String(a.doctor_crm_uf).toUpperCase())) block('MEDICO_UF', 'A UF do CRM do médico do ASO é inválida.');
    if (!a.doctor_name || a.doctor_name.trim().length < 2 || a.doctor_name.length > 70) block('MEDICO_NOME', 'O nome do médico do ASO deve ter de 2 a 70 caracteres.');

    const exams = await client.query(
      `SELECT procedure_code, order_exam, obs_proc, to_char(exam_date, 'YYYY-MM-DD') AS exam_date
         FROM aso_exam_details WHERE aso_record_id = $1 ORDER BY exam_date, created_at`,
      [asoRecordId],
    );
    const withCode = exams.rows.filter((x) => x.procedure_code);
    if (withCode.length === 0) {
      block('SEM_EXAMES', 'Cadastre ao menos um exame do ASO com o código da Tabela 27 do eSocial (inclua a avaliação clínica).');
    }
    if (exams.rows.length > withCode.length) block('EXAME_SEM_CODIGO', 'Há exame sem código da Tabela 27; informe o código ou remova o exame.');
    if (withCode.length > 99) block('EXAMES_EXCESSO', 'O S-2220 aceita no máximo 99 exames.');
    for (const x of withCode) {
      if (x.procedure_code === '0281' && !x.order_exam) block('ORDEM_EXAME', 'O exame de código 0281 exige a ordem (inicial ou sequencial).');
      if (x.procedure_code === '9999' && !x.obs_proc) block('OBS_PROC', 'O código 9999 exige a descrição do procedimento.');
      if (x.exam_date > a.exam_date) block('EXAME_APOS_ASO', 'A data de um exame é posterior à data do ASO.');
    }

    if (!a.p_name) {
      warn('SEM_COORDENADOR', 'Nenhum médico coordenador do PCMSO vinculado ao ASO. O manual exige o grupo respMonit sempre que houver coordenador.');
    } else {
      if (!a.p_active) block('COORDENADOR_INATIVO', 'O médico coordenador do PCMSO está inativo.');
      if (!isValidCpf(a.p_cpf)) block('COORDENADOR_CPF', 'O CPF do médico coordenador do PCMSO é inválido.');
      if (!UF_LIST.includes(String(a.p_uf).toUpperCase()) || !a.p_crm || a.p_crm.length > 10) block('COORDENADOR_CRM', 'CRM/UF do médico coordenador inválidos.');
    }

    const dup = await client.query(
      `SELECT 1 FROM esocial_events WHERE aso_record_id = $1 AND event_type = 'S-2220' AND status NOT IN ('rejeitado', 'erro_tecnico', 'excluido')`,
      [asoRecordId],
    );
    if (dup.rows.length > 0) block('EVENTO_JA_EXISTE', 'Este ASO já tem um evento eSocial em andamento ou concluído.');

    const layout = await client.query(
      `SELECT id, producao_restrita_envio_url, producao_restrita_consulta_url
         FROM esocial_layout_versions WHERE is_active ORDER BY effective_from DESC LIMIT 1`,
    );
    if (layout.rows.length === 0) block('LAYOUT', 'Nenhuma versão de leiaute ativa.');

    if (!certificateId) {
      block('CERTIFICADO', 'Selecione o certificado digital A1 que será usado.');
    } else {
      const c = await client.query(
        `SELECT status, subject_document, subject_cn, not_after, not_after <= now() AS expired
           FROM esocial_certificates WHERE id = $1`,
        [certificateId],
      );
      if (c.rows.length === 0 || c.rows[0].status !== 'ativo') block('CERTIFICADO', 'Certificado não encontrado ou inativo.');
      else {
        const cert = c.rows[0];
        if (cert.expired) block('CERTIFICADO_VENCIDO', 'O certificado digital está vencido.');
        if (!cert.subject_document) block('CERTIFICADO_DOC', 'Não foi possível identificar o CNPJ/CPF do titular no certificado.');
        else if (cnpj && !cert.subject_document.toUpperCase().startsWith(cnpj.slice(0, 8).toUpperCase())) {
          warn('CERTIFICADO_OUTRO_TITULAR', 'O titular do certificado é de outro CNPJ-raiz que o da empresa. Confirme com o contador se o eSocial aceitará este certificado para o empregador.');
        }
      }
    }

    const ok = !issues.some((i) => i.blocking);
    const payload: S2220Payload | null = ok
      ? {
          ambiente: 'producao_restrita',
          empregador: { tpInsc: 1, nrInsc: cnpj!.toUpperCase() },
          trabalhador: {
            cpf: String(a.cpf),
            ...(a.registration_number ? { matricula: a.registration_number } : {}),
            ...(a.esocial_category_code ? { codCateg: a.esocial_category_code } : {}),
          },
          tpExameOcup: tp,
          aso: {
            dtAso: a.exam_date,
            resAso: a.result === 'apto' ? 1 : 2,
            exames: withCode.map((x) => ({
              dtExm: x.exam_date,
              procRealizado: x.procedure_code,
              ...(x.obs_proc ? { obsProc: x.obs_proc } : {}),
              ...(x.order_exam ? { ordExame: x.order_exam } : {}),
            })),
            medico: { nmMed: a.doctor_name.trim(), nrCRM: a.doctor_crm, ufCRM: String(a.doctor_crm_uf).toUpperCase() },
          },
          ...(a.p_name ? { respMonit: { cpfResp: a.p_cpf, nmResp: a.p_name.trim(), nrCRM: a.p_crm, ufCRM: String(a.p_uf).toUpperCase() } } : {}),
          indRetif: 1,
        }
      : null;
    return { ok, issues, payload };
  }

  // "O que falta antes de transmitir" para uma CAT → S-2210. Mesmas garantias do ASO: só lê, sob RLS.
  // As regras condicionais vêm dos comentários de validação do XSD evtCAT (NT 07/2026 rev.).
  async diagnoseAccident(client: PoolClient, accidentId: string, certificateId?: string): Promise<DiagnosticResult<S2210Payload>> {
    const issues: DiagnosticIssue[] = [];
    const block = (code: string, message: string) => issues.push({ code, message, blocking: true });
    const warn = (code: string, message: string) => issues.push({ code, message, blocking: false });

    const q = await client.query(
      `SELECT a.*, to_char(a.acid_date,'YYYY-MM-DD') AS d_acid, to_char(a.death_date,'YYYY-MM-DD') AS d_death,
              to_char(a.last_work_day,'YYYY-MM-DD') AS d_last, to_char(a.att_date,'YYYY-MM-DD') AS d_att,
              to_char(CURRENT_DATE,'YYYY-MM-DD') AS today,
              e.cpf, e.registration_number, e.esocial_category_code, e.esocial_vinculo_confirmed_at,
              to_char(e.admission_date,'YYYY-MM-DD') AS d_admission
         FROM work_accidents a JOIN employees e ON e.id = a.employee_id WHERE a.id = $1`, [accidentId]);
    if (q.rows.length === 0) throw new NotFoundException('Acidente não encontrado');
    const a = q.rows[0];

    const tenantQ = await client.query(`SELECT cnpj FROM tenants WHERE id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`);
    const cnpj: string | undefined = tenantQ.rows[0]?.cnpj;
    if (!cnpj || !isCnpjFormat(cnpj)) block('EMPREGADOR_CNPJ', 'O CNPJ da empresa não está em formato válido para o eSocial.');
    if (!isValidCpf(a.cpf)) block('TRABALHADOR_CPF', 'O CPF do trabalhador é inválido. Corrija o cadastro do funcionário.');
    if (!a.esocial_vinculo_confirmed_at) block('VINCULO_NAO_CONFIRMADO', 'Confirme que o vínculo deste trabalhador já foi enviado ao eSocial (S-2200, S-2190 ou S-2300). O S-2210 só é aceito depois disso.');
    if (a.esocial_category_code && !/^\d{3}$/.test(a.esocial_category_code)) block('CATEGORIA_FORMATO', 'A categoria eSocial deve ter 3 dígitos.');

    // Datas
    if (a.d_acid > a.today) block('ACID_DATA_FUTURA', 'A data do acidente é futura.');
    if (a.d_att < a.d_acid) block('ATEND_ANTES_ACID', 'A data do atendimento é anterior à data do acidente.');
    if (a.d_att > a.today) block('ATEND_FUTURO', 'A data do atendimento é futura.');

    // Hora do acidente e horas trabalhadas antes (regras por tipo e por data do acidente, conforme o XSD)
    const tipico = a.acid_type === 1;
    const trajeto = a.acid_type === 3;
    const doenca = a.acid_type === 2;
    if ((tipico || (trajeto && a.d_acid >= '2022-01-26')) && !a.acid_time) block('HORA_ACIDENTE', 'Informe a hora do acidente (obrigatória para acidente típico e para trajeto a partir de 26/01/2022).');
    if ((tipico || (trajeto && a.d_acid >= '2022-07-20')) && !a.hours_worked_before) block('HORAS_ANTES', 'Informe as horas trabalhadas antes do acidente (obrigatória para acidente típico e para trajeto a partir de 20/07/2022).');
    if (doenca && (a.acid_time || a.hours_worked_before)) block('HORA_DOENCA', 'Em caso de doença, a hora do acidente e as horas trabalhadas antes não devem ser informadas.');

    // Óbito
    if (a.cat_type === 3 && !a.death) block('OBITO_FLAG', 'Em CAT de comunicação de óbito, marque "houve óbito".');
    if (a.cat_type === 2 && a.death) block('OBITO_REABERTURA', 'Em CAT de reabertura, "houve óbito" deve ser não.');
    if (a.death && !a.d_death) block('OBITO_DATA', 'Informe a data do óbito.');
    if (!a.death && a.d_death) block('OBITO_DATA_INDEVIDA', 'A data do óbito só pode ser informada se houve óbito.');
    if (a.death && a.d_death && (a.d_death < a.d_acid || a.d_death > a.today)) block('OBITO_DATA_INVALIDA', 'A data do óbito deve ser igual ou posterior ao acidente e não pode ser futura.');
    if (a.death && a.att_leave) block('AFASTAMENTO_OBITO', 'Havendo óbito, o indicativo de afastamento do atestado deve ser não.');

    // Datas exigidas a partir de 16/01/2023
    if (a.d_acid >= '2023-01-16') {
      if (!a.d_last) block('ULT_DIA_TRAB', 'Informe o último dia trabalhado (obrigatório para acidentes a partir de 16/01/2023).');
      if (a.had_leave === null) block('HOUVE_AFAST', 'Informe se houve afastamento (obrigatório para acidentes a partir de 16/01/2023).');
    }
    if (a.d_last && a.d_last > a.today) block('ULT_DIA_FUTURO', 'O último dia trabalhado é futuro.');
    if (a.d_last && a.d_admission && a.d_last < a.d_admission) block('ULT_DIA_ANTES_ADMISSAO', 'O último dia trabalhado é anterior à admissão do trabalhador.');

    // Local: identificação obrigatória em estabelecimento do empregador (1) ou de terceiros (3)
    if ([1, 3].includes(a.location_type) && (!a.loc_inscription_type || !a.loc_inscription_number)) block('LOCAL_INSCRICAO', 'Em estabelecimento do empregador ou de terceiros, informe o tipo e o número de inscrição (CNPJ/CAEPF/CNO) do local.');
    if (a.location_type === 2 && !a.loc_country) warn('LOCAL_PAIS', 'Acidente no exterior: informe o código do país.');
    if (a.loc_uf && !UF_LIST.includes(String(a.loc_uf).toUpperCase())) block('LOCAL_UF', 'A UF do local é inválida.');
    if (a.att_issuer_uf && !UF_LIST.includes(String(a.att_issuer_uf).toUpperCase())) block('EMITENTE_UF', 'A UF do órgão de classe do emitente é inválida.');
    if (a.att_issuer_council === 1 && !a.att_issuer_uf) warn('EMITENTE_UF_AUSENTE', 'Informe a UF do CRM do emitente do atestado.');

    // CAT de origem (reabertura e óbito)
    let origin: string | undefined;
    if (a.cat_type === 1 && a.origin_event_id) warn('ORIGEM_INDEVIDA', 'CAT inicial não leva CAT de origem; ela será ignorada.');
    if (a.cat_type !== 1) {
      if (!a.origin_event_id) block('CAT_ORIGEM', 'CAT de reabertura ou de óbito exige a CAT de origem (evento S-2210 já processado, com recibo).');
      else {
        const o = await client.query(`SELECT nr_recibo, status FROM esocial_events WHERE id = $1 AND event_type = 'S-2210' AND employee_id = $2`, [a.origin_event_id, a.employee_id]);
        if (o.rows.length === 0) block('CAT_ORIGEM', 'A CAT de origem não foi encontrada para este trabalhador.');
        else if (o.rows[0].status !== 'processado' || !o.rows[0].nr_recibo) block('CAT_ORIGEM_NAO_PROCESSADA', 'A CAT de origem ainda não foi processada pelo eSocial (sem recibo).');
        else origin = o.rows[0].nr_recibo;
      }
    }

    // Prazo (MOS S-1.3, S-2210): até o 1º dia útil seguinte ao acidente; em caso de morte, de imediato.
    // É só aviso: a CAT deve ser enviada mesmo fora do prazo. Feriados não são considerados.
    if (a.cat_type === 1) {
      if (a.death) warn('PRAZO_OBITO', 'Em caso de morte, o MOS exige a comunicação de imediato.');
      else if (a.today > nextBusinessDay(a.d_acid)) warn('PRAZO', `O MOS prevê o registro até o primeiro dia útil seguinte ao acidente (${nextBusinessDay(a.d_acid)}, sem considerar feriados). Envie assim mesmo e confira com o contador.`);
    }

    // Duplicidade e certificado
    const dup = await client.query(`SELECT 1 FROM esocial_events WHERE accident_id = $1 AND event_type = 'S-2210' AND status NOT IN ('rejeitado', 'erro_tecnico', 'excluido')`, [accidentId]);
    if (dup.rows.length > 0) block('EVENTO_JA_EXISTE', 'Esta CAT já tem um evento eSocial em andamento ou concluído.');
    const layout = await client.query(`SELECT id FROM esocial_layout_versions WHERE is_active LIMIT 1`);
    if (layout.rows.length === 0) block('LAYOUT', 'Nenhuma versão de leiaute ativa.');
    if (!certificateId) block('CERTIFICADO', 'Selecione o certificado digital A1 que será usado.');
    else {
      const c = await client.query(`SELECT status, subject_document, not_after <= now() AS expired FROM esocial_certificates WHERE id = $1`, [certificateId]);
      if (c.rows.length === 0 || c.rows[0].status !== 'ativo') block('CERTIFICADO', 'Certificado não encontrado ou inativo.');
      else {
        if (c.rows[0].expired) block('CERTIFICADO_VENCIDO', 'O certificado digital está vencido.');
        if (!c.rows[0].subject_document) block('CERTIFICADO_DOC', 'Não foi possível identificar o CNPJ/CPF do titular no certificado.');
      }
    }

    const ok = !issues.some((i) => i.blocking);
    const nz = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : (v as any));
    const payload: S2210Payload | null = ok ? {
      ambiente: 'producao_restrita',
      empregador: { tpInsc: 1, nrInsc: cnpj!.toUpperCase() },
      trabalhador: { cpf: String(a.cpf), ...(a.registration_number ? { matricula: a.registration_number } : {}), ...(a.esocial_category_code ? { codCateg: a.esocial_category_code } : {}) },
      indRetif: 1,
      cat: {
        dtAcid: a.d_acid, tpAcid: a.acid_type, hrAcid: nz(a.acid_time), hrsTrabAntesAcid: nz(a.hours_worked_before), tpCat: a.cat_type,
        indCatObito: a.death, dtObito: nz(a.d_death), indComunPolicia: a.police_notified, codSitGeradora: a.causing_situation_code,
        iniciatCAT: a.cat_initiative, obsCAT: nz(a.cat_notes), ultDiaTrab: nz(a.d_last), houveAfast: a.had_leave === null ? undefined : a.had_leave,
        localAcidente: {
          tpLocal: a.location_type, dscLocal: nz(a.location_description), tpLograd: nz(a.loc_street_type), dscLograd: a.loc_street, nrLograd: a.loc_number,
          complemento: nz(a.loc_complement), bairro: nz(a.loc_district), cep: nz(a.loc_cep), codMunic: nz(a.loc_city_code),
          uf: a.loc_uf ? String(a.loc_uf).toUpperCase() : undefined, pais: nz(a.loc_country), codPostal: nz(a.loc_postal_code),
          ...(a.loc_inscription_type && a.loc_inscription_number ? { ideLocalAcid: { tpInsc: a.loc_inscription_type, nrInsc: String(a.loc_inscription_number).toUpperCase() } } : {}),
        },
        parteAtingida: { codParteAting: a.body_part_code, lateralidade: a.laterality },
        agenteCausador: { codAgntCausador: a.causing_agent_code },
        atestado: {
          dtAtendimento: a.d_att, hrAtendimento: a.att_time, indInternacao: a.att_hospitalized, durTrat: a.att_treatment_days, indAfast: a.att_leave,
          dscLesao: a.att_injury_code, dscCompLesao: nz(a.att_injury_detail), diagProvavel: nz(a.att_probable_diagnosis), codCID: String(a.att_cid).toUpperCase(),
          observacao: nz(a.att_notes), emitente: { nmEmit: a.att_issuer_name.trim(), ideOC: a.att_issuer_council, nrOC: a.att_issuer_number, ufOC: a.att_issuer_uf ? String(a.att_issuer_uf).toUpperCase() : undefined },
        },
        ...(origin ? { catOrigem: { nrRecCatOrig: origin } } : {}),
      },
    } : null;
    return { ok, issues, payload };
  }
}
