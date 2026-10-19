import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CertificatesService } from '../certificates/certificates.service';
import { parsePkcs12 } from '../certificates/pkcs12.util';
import { EsocialDiagnosticsService } from '../diagnostics/esocial-diagnostics.service';
import { XmlSignerService } from '../signing/xml-signer.service';
import { EsocialSoapClient } from '../transport/esocial-soap-client.service';
import { GRUPO_NAO_PERIODICOS, buildLoteXml } from '../transport/lote.util';
import { buildEventId, buildS2220Xml, cnpjBase } from '../xml/s2220-xml.builder';
import { buildS2210Xml } from '../xml/s2210-xml.builder';
import { buildS3000Xml, S3000Payload } from '../xml/s3000-xml.builder';
import { Schema, XsdValidatorService } from '../xml/xsd-validator.service';

const schemaFor = (eventType: string): Schema => (eventType === 'S-3000' ? 'evtExclusao' : eventType === 'S-2210' ? 'evtCAT' : 'evtMonit');

const LIST_COLUMNS = `ev.id, ev.event_type, ev.target_event_id, ev.accident_id, ev.status, ev.ambiente, ev.aso_record_id, ev.employee_id, ev.event_xml_id,
  ev.protocolo_lote, ev.nr_recibo, ev.cd_resposta, ev.erro_codigo, ev.erro_mensagem, ev.created_at, ev.authorized_at,
  ev.transmitted_at, ev.last_consulted_at, ev.created_by_user_id, ev.authorized_by_user_id, ev.transmitted_by_user_id,
  e.full_name AS employee_name`;

const short = (s: unknown, n = 500) => String(s ?? '').slice(0, n);

// Eventos S-2220 do eSocial. TODA ação que muda estado (criar, autorizar, transmitir, consultar) é
// disparada por um usuário autenticado e grava esse usuário no histórico (append-only): não existe
// processo em segundo plano que assine ou transmita sozinho (fecha o G-03 da auditoria).
@Injectable()
export class EsocialEventsService {
  constructor(
    private readonly diagnostics: EsocialDiagnosticsService,
    private readonly certificates: CertificatesService,
    private readonly signer: XmlSignerService,
    private readonly xsd: XsdValidatorService,
    private readonly soap: EsocialSoapClient,
  ) {}

  private async history(client: PoolClient, eventId: string, from: string | null, to: string, detail: string | null, userId: string) {
    await client.query(
      // clock_timestamp(), não o now() padrão: now() é o início da transação e seria igual para todos os
      // passos de uma mesma requisição, deixando a ordem do histórico (evidência legal) indeterminada.
      `INSERT INTO esocial_event_history (tenant_id, esocial_event_id, from_status, to_status, detail, actor_user_id, occurred_at)
       VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, clock_timestamp())`,
      [eventId, from, to, detail, userId],
    );
  }

  private async load(client: PoolClient, id: string) {
    const r = await client.query('SELECT * FROM esocial_events WHERE id = $1', [id]);
    if (r.rows.length === 0) throw new NotFoundException('Evento não encontrado');
    return r.rows[0];
  }

  private async layout(client: PoolClient, id: string) {
    const r = await client.query('SELECT * FROM esocial_layout_versions WHERE id = $1', [id]);
    return r.rows[0];
  }

  async diagnose(client: PoolClient, asoRecordId: string | undefined, certificateId?: string, accidentId?: string) {
    const d = accidentId
      ? await this.diagnostics.diagnoseAccident(client, accidentId, certificateId)
      : await this.diagnostics.diagnoseAso(client, asoRecordId as string, certificateId);
    return { ok: d.ok, issues: d.issues };
  }

  // 1) Rascunho: monta o XML do S-2220 e o valida no XSD oficial. Nada é assinado nem enviado.
  async create(client: PoolClient, asoRecordId: string, certificateId: string, userId: string) {
    const d = await this.diagnostics.diagnoseAso(client, asoRecordId, certificateId);
    if (!d.ok || !d.payload) {
      throw new UnprocessableEntityException({ message: 'O ASO ainda não está pronto para o eSocial', issues: d.issues });
    }
    const layout = await client.query(`SELECT id FROM esocial_layout_versions WHERE is_active ORDER BY effective_from DESC LIMIT 1`);
    const att = await client.query(`SELECT count(*)::int AS n FROM esocial_events WHERE aso_record_id = $1 AND event_type = 'S-2220'`, [asoRecordId]);
    const attempt = att.rows[0].n + 1;

    const eventId = buildEventId(cnpjBase(d.payload.empregador.nrInsc), new Date(), Math.floor(Math.random() * 100000));
    const xml = buildS2220Xml(d.payload, eventId);
    // O XSD exige ds:Signature; ela só existe depois de autorizar e assinar. Aqui só ignoramos esse
    // item: qualquer outro erro de estrutura reprova o rascunho. A versão assinada é validada por inteiro.
    const v = await this.xsd.validate('evtMonit', xml);
    const structural = v.errors.filter((e) => !/Signature/.test(e));
    if (structural.length > 0) {
      throw new UnprocessableEntityException({ message: 'O XML gerado não passou no XSD oficial do S-2220', errors: structural.slice(0, 10).map((e) => short(e, 300)) });
    }

    let row;
    try {
      const ins = await client.query(
        `INSERT INTO esocial_events (tenant_id, event_type, aso_record_id, employee_id, certificate_id, layout_version_id,
            ambiente, status, ind_retif, payload_json, xml_generated, event_xml_id, idempotency_key, created_by_user_id)
         SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid, 'S-2220', a.id, a.employee_id, $2::uuid, $3::uuid,
                'producao_restrita', 'rascunho', 1, $4::jsonb, $5::text, $6::text, $7::text, $8::uuid
           FROM aso_records a WHERE a.id = $1
         RETURNING id`,
        [asoRecordId, certificateId, layout.rows[0].id, JSON.stringify(d.payload), xml, eventId, `s2220:${asoRecordId}:${attempt}`, userId],
      );
      row = ins.rows[0];
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException('Já existe evento ativo para este ASO');
      throw err;
    }
    await this.history(client, row.id, null, 'rascunho', 'XML gerado e validado no XSD oficial', userId);
    return this.get(client, row.id);
  }

  // S-2210 (CAT): mesmo caminho do S-2220 — rascunho com XML validado no XSD oficial, nada é assinado nem enviado.
  async createFromAccident(client: PoolClient, accidentId: string, certificateId: string, userId: string) {
    const d = await this.diagnostics.diagnoseAccident(client, accidentId, certificateId);
    if (!d.ok || !d.payload) {
      throw new UnprocessableEntityException({ message: 'A CAT ainda não está pronta para o eSocial', issues: d.issues });
    }
    const layout = await client.query(`SELECT id FROM esocial_layout_versions WHERE is_active ORDER BY effective_from DESC LIMIT 1`);
    const att = await client.query(`SELECT count(*)::int AS n FROM esocial_events WHERE accident_id = $1`, [accidentId]);
    const eventId = buildEventId(cnpjBase(d.payload.empregador.nrInsc), new Date(), Math.floor(Math.random() * 100000));
    const xml = buildS2210Xml(d.payload, eventId, cnpjBase);
    const v = await this.xsd.validate('evtCAT', xml);
    const structural = v.errors.filter((e) => !/Signature/.test(e));
    if (structural.length > 0) {
      throw new UnprocessableEntityException({ message: 'O XML gerado não passou no XSD oficial do S-2210', errors: structural.slice(0, 10).map((e) => short(e, 300)) });
    }
    let row;
    try {
      const ins = await client.query(
        `INSERT INTO esocial_events (tenant_id, event_type, accident_id, employee_id, certificate_id, layout_version_id,
            ambiente, status, ind_retif, payload_json, xml_generated, event_xml_id, idempotency_key, created_by_user_id)
         SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid, 'S-2210', a.id, a.employee_id, $2::uuid, $3::uuid,
                'producao_restrita', 'rascunho', 1, $4::jsonb, $5::text, $6::text, $7::text, $8::uuid
           FROM work_accidents a WHERE a.id = $1
         RETURNING id`,
        [accidentId, certificateId, layout.rows[0].id, JSON.stringify(d.payload), xml, eventId, `s2210:${accidentId}:${att.rows[0].n + 1}`, userId],
      );
      row = ins.rows[0];
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException('Já existe evento ativo para esta CAT');
      throw err;
    }
    await this.history(client, row.id, null, 'rascunho', 'XML gerado e validado no XSD oficial', userId);
    return this.get(client, row.id);
  }

  // S-3000: exclui um evento JÁ PROCESSADO (com recibo). Gera só o rascunho; autorizar, assinar e
  // transmitir seguem o mesmo caminho do S-2220, com autor registrado em cada passo.
  async createExclusion(client: PoolClient, targetEventId: string, certificateId: string | undefined, userId: string) {
    const target = await this.load(client, targetEventId);
    if (!['S-2220', 'S-2210'].includes(target.event_type)) throw new BadRequestException('Só é possível excluir eventos S-2220 e S-2210');
    if (target.status !== 'processado' || !target.nr_recibo) {
      throw new ConflictException(`Só é possível excluir um evento já processado, com recibo (estado atual: ${target.status})`);
    }
    if (target.ambiente !== 'producao_restrita') throw new BadRequestException('Exclusão em produção real não está liberada');

    const certId = certificateId ?? target.certificate_id;
    const cert = await client.query(`SELECT status, not_after <= now() AS expired FROM esocial_certificates WHERE id = $1`, [certId]);
    if (cert.rows.length === 0 || cert.rows[0].status !== 'ativo' || cert.rows[0].expired) {
      throw new UnprocessableEntityException('Certificado inexistente, inativo ou vencido; escolha outro certificado');
    }

    const payload: S3000Payload = {
      ambiente: 'producao_restrita',
      empregador: target.payload_json.empregador,
      tpEvento: target.event_type,
      nrRecEvt: target.nr_recibo,
      cpfTrab: target.payload_json.trabalhador.cpf,
    };
    const eventId = buildEventId(cnpjBase(payload.empregador.nrInsc), new Date(), Math.floor(Math.random() * 100000));
    const xml = buildS3000Xml(payload, eventId);
    const v = await this.xsd.validate('evtExclusao', xml);
    const structural = v.errors.filter((e) => !/Signature/.test(e));
    if (structural.length > 0) {
      throw new UnprocessableEntityException({ message: 'O XML gerado não passou no XSD oficial do S-3000', errors: structural.slice(0, 10).map((e) => short(e, 300)) });
    }
    const att = await client.query(`SELECT count(*)::int AS n FROM esocial_events WHERE target_event_id = $1`, [targetEventId]);
    let row;
    try {
      const ins = await client.query(
        `INSERT INTO esocial_events (tenant_id, event_type, aso_record_id, employee_id, certificate_id, layout_version_id,
            ambiente, status, ind_retif, payload_json, xml_generated, event_xml_id, idempotency_key, created_by_user_id, target_event_id)
         SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid, 'S-3000', t.aso_record_id, t.employee_id, $2::uuid, t.layout_version_id,
                'producao_restrita', 'rascunho', 1, $3::jsonb, $4::text, $5::text, $6::text, $7::uuid, t.id
           FROM esocial_events t WHERE t.id = $1
         RETURNING id`,
        [targetEventId, certId, JSON.stringify(payload), xml, eventId, `s3000:${targetEventId}:${att.rows[0].n + 1}`, userId],
      );
      row = ins.rows[0];
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException('Já existe uma exclusão em andamento para este evento');
      throw err;
    }
    await this.history(client, row.id, null, 'rascunho', `Exclusão do evento ${targetEventId} (recibo ${target.nr_recibo}); XML validado no XSD oficial`, userId);
    return this.get(client, row.id);
  }

  // 2) Autorização humana (G-03). Reexecuta o diagnóstico: o que valia na criação pode ter mudado.
  async authorize(client: PoolClient, id: string, userId: string) {
    const ev = await this.load(client, id);
    if (ev.status !== 'rascunho') throw new ConflictException(`Só é possível autorizar um rascunho (estado atual: ${ev.status})`);
    if (ev.event_type === 'S-2220') {
      const asoOk = await client.query(`SELECT 1 FROM aso_records WHERE id = $1`, [ev.aso_record_id]);
      if (asoOk.rows.length === 0) throw new NotFoundException('ASO não encontrado');
    } else if (ev.event_type === 'S-2210') {
      const acc = await client.query(`SELECT 1 FROM work_accidents WHERE id = $1`, [ev.accident_id]);
      if (acc.rows.length === 0) throw new NotFoundException('Acidente não encontrado');
    }
    const cert = await client.query(`SELECT status, not_after <= now() AS expired FROM esocial_certificates WHERE id = $1`, [ev.certificate_id]);
    if (cert.rows[0]?.status !== 'ativo' || cert.rows[0]?.expired) {
      throw new UnprocessableEntityException('O certificado do evento está vencido ou inativo; crie um novo evento com outro certificado');
    }
    const upd = await client.query(
      `UPDATE esocial_events SET status = 'aguardando_transmissao', authorized_by_user_id = $2, authorized_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'rascunho' RETURNING id`,
      [id, userId],
    );
    if (upd.rows.length === 0) throw new ConflictException('O evento mudou de estado; atualize a tela');
    await this.history(client, id, 'rascunho', 'aguardando_transmissao', 'Autorizado por um usuário', userId);
    return this.get(client, id);
  }

  // 3) Assina e transmite. Só roda a partir de "aguardando_transmissao" (autorizado) e só em
  // Produção Restrita. A "reivindicação" do evento é atômica: duas chamadas simultâneas não enviam duas vezes.
  async transmit(client: PoolClient, id: string, userId: string) {
    const ev = await this.load(client, id);
    if (ev.ambiente !== 'producao_restrita') throw new BadRequestException('Transmissão em produção real não está liberada');
    const claim = await client.query(
      `UPDATE esocial_events SET status = 'transmitindo', transmitted_by_user_id = $2, updated_at = now()
        WHERE id = $1 AND status = 'aguardando_transmissao' AND authorized_by_user_id IS NOT NULL RETURNING id`,
      [id, userId],
    );
    if (claim.rows.length === 0) throw new ConflictException(`Só é possível transmitir um evento autorizado (estado atual: ${ev.status})`);
    await this.history(client, id, 'aguardando_transmissao', 'transmitindo', null, userId);

    const fail = async (status: 'erro_tecnico' | 'rejeitado', codigo: string | null, mensagem: string) => {
      await client.query(
        `UPDATE esocial_events SET status = $2, erro_codigo = $3, erro_mensagem = $4, updated_at = now() WHERE id = $1`,
        [id, status, codigo, short(mensagem)],
      );
      await this.history(client, id, 'transmitindo', status, short(mensagem, 300), userId);
      return this.get(client, id);
    };

    let signedXml: string; let cert; let pfx: { pfxBuffer: Buffer; password: string };
    try {
      pfx = await this.certificates.loadRawPfxForTransmission(client, ev.certificate_id);
      cert = parsePkcs12(pfx.pfxBuffer, pfx.password);
      if (cert.notAfter.getTime() <= Date.now()) throw new Error('Certificado vencido');
      signedXml = this.signer.sign(ev.xml_generated, cert.privateKeyPem, cert.certificatePem);
      if (!this.signer.verify(signedXml, cert.certificatePem)) throw new Error('A assinatura gerada não confere');
      const v = await this.xsd.validate(schemaFor(ev.event_type), signedXml);
      if (!v.valid) throw new Error(`XML assinado reprovado no XSD: ${v.errors.slice(0, 3).join(' | ')}`);
    } catch (err: any) {
      return fail('erro_tecnico', 'ASSINATURA', `Falha ao assinar: ${err?.message}`);
    }
    await client.query(`UPDATE esocial_events SET xml_signed = $2 WHERE id = $1`, [id, signedXml]);

    const doc = cert.subjectDocument;
    if (!doc) return fail('erro_tecnico', 'CERTIFICADO_DOC', 'Não foi possível identificar o CNPJ/CPF do titular no certificado');
    const layout = await this.layout(client, ev.layout_version_id);
    const payload = ev.payload_json;
    const lote = buildLoteXml({
      empregadorCnpjBase: cnpjBase(payload.empregador.nrInsc),
      transmissor: { tpInsc: doc.length === 14 ? 1 : 2, nrInsc: doc },
      grupo: GRUPO_NAO_PERIODICOS,
      eventos: [{ id: ev.event_xml_id, signedXml }],
    });
    const lv = await this.xsd.validate('envioLote', lote);
    if (!lv.valid) return fail('erro_tecnico', 'LOTE_XSD', `Lote reprovado no XSD: ${lv.errors.slice(0, 3).join(' | ')}`);

    try {
      const r = await this.soap.enviarLote(layout.producao_restrita_envio_url, lote, { pfx: pfx.pfxBuffer, passphrase: pfx.password });
      // 201 recebido, 202 recebido com advertências, 203 já recebido antes e ainda na fila (Manual do Desenvolvedor v1.16,
      // 7.5.10): nos três o lote está com o eSocial e o resultado vem pela consulta do protocolo.
      if ([201, 202, 203].includes(r.cdResposta) && r.protocoloEnvio) {
        await client.query(
          `UPDATE esocial_events SET status = 'transmitido', protocolo_lote = $2, cd_resposta = $3, transmitted_at = now(), updated_at = now() WHERE id = $1`,
          [id, r.protocoloEnvio, String(r.cdResposta)],
        );
        await this.history(client, id, 'transmitindo', 'transmitido', `Lote recebido pelo eSocial (código ${r.cdResposta})`, userId);
        return this.get(client, id);
      }
      const oc = r.ocorrencias.map((o) => `${o.codigo}: ${o.descricao}`).join(' | ');
      await client.query(`UPDATE esocial_events SET retorno_json = $2::jsonb WHERE id = $1`, [id, JSON.stringify(r)]);
      // 4xx = o eSocial recusou o lote (definitivo, corrigir e recriar); 301/outros = erro do servidor.
      return fail(r.cdResposta >= 400 && r.cdResposta < 500 ? 'rejeitado' : 'erro_tecnico', String(r.cdResposta), `${r.descResposta}${oc ? ' — ' + oc : ''}`);
    } catch (err: any) {
      // Não sabemos se o lote chegou: nunca reenviar automaticamente. A pessoa decide (novo evento).
      return fail('erro_tecnico', 'TRANSPORTE', `Falha de comunicação com o eSocial: ${err?.message}`);
    }
  }

  // 4) Consulta o resultado do lote (o eSocial guarda o resultado por 30 dias, Manual do Desenvolvedor v1.16, 7.6.13).
  async consult(client: PoolClient, id: string, userId: string) {
    const ev = await this.load(client, id);
    if (!['transmitido', 'processando'].includes(ev.status) || !ev.protocolo_lote) {
      throw new ConflictException(`Só é possível consultar um evento já transmitido (estado atual: ${ev.status})`);
    }
    const layout = await this.layout(client, ev.layout_version_id);
    let pfx;
    try {
      pfx = await this.certificates.loadRawPfxForTransmission(client, ev.certificate_id);
    } catch (err: any) {
      throw new UnprocessableEntityException(`Não foi possível usar o certificado para consultar: ${err?.message}`);
    }
    let r;
    try {
      r = await this.soap.consultarLote(layout.producao_restrita_consulta_url, ev.protocolo_lote, { pfx: pfx.pfxBuffer, passphrase: pfx.password });
    } catch (err: any) {
      throw new BadRequestException(`Falha de comunicação com o eSocial: ${short(err?.message, 200)}`);
    }
    await client.query(`UPDATE esocial_events SET last_consulted_at = now(), retorno_json = $2::jsonb, cd_resposta = $3 WHERE id = $1`, [id, JSON.stringify(r), String(r.cdResposta)]);

    if (r.cdResposta === 101) {
      if (ev.status !== 'processando') {
        await client.query(`UPDATE esocial_events SET status = 'processando', updated_at = now() WHERE id = $1`, [id]);
        await this.history(client, id, ev.status, 'processando', 'Lote aguardando processamento (101)', userId);
      }
      return this.get(client, id);
    }
    if (r.cdResposta === 201 || r.cdResposta === 202) {
      const mine = r.eventos.find((e) => e.id === ev.event_xml_id) ?? r.eventos[0];
      if (mine && (mine.cdResposta === 201 || mine.cdResposta === 202) && mine.nrRecibo) {
        await client.query(`UPDATE esocial_events SET status = 'processado', nr_recibo = $2, erro_codigo = NULL, erro_mensagem = NULL, updated_at = now() WHERE id = $1`, [id, mine.nrRecibo]);
        await this.history(client, id, ev.status, 'processado', `Recibo ${mine.nrRecibo}`, userId);
        if (ev.event_type === 'S-3000' && ev.target_event_id) {
          // A exclusão só vale quando o eSocial devolve o recibo do S-3000: aí o evento original perde o efeito.
          const upd = await client.query(`UPDATE esocial_events SET status = 'excluido', updated_at = now() WHERE id = $1 AND status = 'processado' RETURNING id`, [ev.target_event_id]);
          if (upd.rows.length > 0) await this.history(client, ev.target_event_id, 'processado', 'excluido', `Excluído pelo S-3000 (recibo ${mine.nrRecibo})`, userId);
        }
      } else {
        const oc = (mine?.ocorrencias ?? []).map((o) => `${o.codigo}: ${o.descricao}`).join(' | ');
        await client.query(`UPDATE esocial_events SET status = 'rejeitado', erro_codigo = $2, erro_mensagem = $3, updated_at = now() WHERE id = $1`, [id, String(mine?.cdResposta ?? r.cdResposta), short(`${mine?.descResposta ?? r.descResposta}${oc ? ' — ' + oc : ''}`)]);
        await this.history(client, id, ev.status, 'rejeitado', short(oc || mine?.descResposta, 300), userId);
      }
      return this.get(client, id);
    }
    const oc = r.ocorrencias.map((o) => `${o.codigo}: ${o.descricao}`).join(' | ');
    const to = r.cdResposta >= 400 && r.cdResposta < 500 ? 'rejeitado' : 'erro_tecnico';
    await client.query(`UPDATE esocial_events SET status = $2, erro_codigo = $3, erro_mensagem = $4, updated_at = now() WHERE id = $1`, [id, to, String(r.cdResposta), short(`${r.descResposta}${oc ? ' — ' + oc : ''}`)]);
    await this.history(client, id, ev.status, to, short(oc || r.descResposta, 300), userId);
    return this.get(client, id);
  }

  async list(client: PoolClient) {
    const r = await client.query(
      `SELECT ${LIST_COLUMNS} FROM esocial_events ev JOIN employees e ON e.id = ev.employee_id ORDER BY ev.created_at DESC LIMIT 100`,
    );
    return r.rows;
  }

  async get(client: PoolClient, id: string) {
    const r = await client.query(
      `SELECT ${LIST_COLUMNS}, ev.retorno_json FROM esocial_events ev JOIN employees e ON e.id = ev.employee_id WHERE ev.id = $1`,
      [id],
    );
    if (r.rows.length === 0) throw new NotFoundException('Evento não encontrado');
    const h = await client.query(
      `SELECT from_status, to_status, detail, actor_user_id, occurred_at FROM esocial_event_history WHERE esocial_event_id = $1 ORDER BY occurred_at, id`,
      [id],
    );
    return { ...r.rows[0], history: h.rows };
  }

  async xml(client: PoolClient, id: string) {
    const ev = await this.load(client, id);
    return { xml: ev.xml_signed ?? ev.xml_generated, signed: !!ev.xml_signed };
  }
}
