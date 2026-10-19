import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/common/r2/r2.service';
import { EsocialSoapClient } from '../src/esocial/transport/esocial-soap-client.service';
import { TestDb, TestTenantFixture } from './db-test-helper';

const PFX = readFileSync(join(__dirname, 'fixtures/esocial/test-certificate.pfx'));
const VALID_CPF = '52998224725';
const PROTOCOLO = '1.2.202610.0000000000000000042';

// R2 simulado em memória: o ciclo upload → uso do certificado roda sem rede e sem tocar bucket real.
function fakeR2() {
  const store = new Map<string, Buffer>();
  return { putObject: async (k: string, b: Buffer) => void store.set(k, b), getObject: async (k: string) => store.get(k)! };
}

// SOAP simulado: registra o que seria enviado e devolve respostas programadas.
class FakeSoap {
  lotes: string[] = [];
  envio: any = { cdResposta: 201, descResposta: 'Lote recebido com sucesso.', protocoloEnvio: PROTOCOLO, ocorrencias: [] };
  consulta: any = null;
  async enviarLote(_url: string, lote: string) { this.lotes.push(lote); return this.envio; }
  async consultarLote() {
    const id = /<evento Id="([^"]+)"/.exec(this.lotes[this.lotes.length - 1])![1];
    return typeof this.consulta === 'function' ? this.consulta(id) : this.consulta;
  }
}

describe('eSocial S-2220: fluxo completo (e2e, SOAP e R2 simulados)', () => {
  let app: INestApplication; let db: TestDb; const soap = new FakeSoap();
  const http = () => request(app.getHttpServer());
  const login = async (t: { email: string; password: string }) =>
    (await http().post('/auth/login').send({ email: t.email, password: t.password })).body.access_token as string;
  const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2Service).useValue(fakeR2())
      .overrideProvider(EsocialSoapClient).useValue(soap)
      .compile();
    app = mod.createNestApplication(); await app.init();
    db = new TestDb(); await db.connect();
  });
  afterAll(async () => { await db.cleanup(); await db.disconnect(); await app.close(); });

  async function scenario(prefix: string) {
    const t = await db.createTenantWithUser(prefix);
    await db.rawQuery('UPDATE employees SET cpf = $1 WHERE id = $2', [VALID_CPF, t.employeeId]);
    const token = await login(t);
    const cert = await http().post('/esocial/certificates').set(auth(token)).field('label', 'A1 teste').field('password', 'teste1234').attach('file', PFX, 'a1.pfx');
    expect(cert.status).toBe(201);
    const aso = await http().post('/aso/records').set(auth(token)).send({
      employeeId: t.employeeId, examType: 'periodico', examDate: '2026-09-01', result: 'apto', resultDisclosureAuthorized: false,
      doctorName: 'Dra. Fulana', doctorCrm: '54321', doctorCrmUf: 'SP',
    });
    expect(aso.status).toBe(201);
    return { t, token, certificateId: cert.body.id as string, asoId: aso.body.id as string };
  }
  const makeReady = async (s: Awaited<ReturnType<typeof scenario>>) => {
    expect((await http().patch(`/esocial/employees/${s.t.employeeId}/prerequisites`).set(auth(s.token)).send({ registrationNumber: 'M-77', esocialCategoryCode: '101' })).status).toBe(200);
    expect((await http().post(`/esocial/employees/${s.t.employeeId}/confirm-vinculo`).set(auth(s.token))).status).toBe(201);
    const ex = await http().post(`/aso/records/${s.asoId}/exams`).set(auth(s.token)).send({ procedureCode: '0281', procedureName: 'Avaliação clínica', examDate: '2026-09-01', orderExam: 2 });
    expect(ex.status).toBe(201);
  };

  it('diagnóstico lista o que falta; depois cria, autoriza, transmite e consulta até o recibo', async () => {
    const s = await scenario('esocial-fluxo');
    const d1 = await http().get(`/esocial/events/diagnostics?asoRecordId=${s.asoId}&certificateId=${s.certificateId}`).set(auth(s.token));
    expect(d1.status).toBe(200);
    expect(d1.body.ok).toBe(false);
    expect(d1.body.issues.map((i: any) => i.code)).toEqual(expect.arrayContaining(['VINCULO_NAO_CONFIRMADO', 'SEM_EXAMES']));
    // sem pré-requisitos, criar é recusado com a lista (422)
    expect((await http().post('/esocial/events').set(auth(s.token)).send({ asoRecordId: s.asoId, certificateId: s.certificateId })).status).toBe(422);

    await makeReady(s);
    const d2 = await http().get(`/esocial/events/diagnostics?asoRecordId=${s.asoId}&certificateId=${s.certificateId}`).set(auth(s.token));
    expect(d2.body.ok).toBe(true);

    const created = await http().post('/esocial/events').set(auth(s.token)).send({ asoRecordId: s.asoId, certificateId: s.certificateId });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('rascunho');
    const id = created.body.id;
    // não existe corpo com tenantId nem resposta com XML/certificado
    expect(JSON.stringify(created.body)).not.toMatch(/xml_signed|PRIVATE KEY|teste1234/);

    // sem autorização humana, transmitir é impossível
    expect((await http().post(`/esocial/events/${id}/transmit`).set(auth(s.token))).status).toBe(409);
    expect(soap.lotes).toHaveLength(0);

    const authd = await http().post(`/esocial/events/${id}/authorize`).set(auth(s.token));
    expect(authd.status).toBe(201);
    expect(authd.body.status).toBe('aguardando_transmissao');
    expect(authd.body.authorized_by_user_id).toBe(s.t.userId);

    const tx = await http().post(`/esocial/events/${id}/transmit`).set(auth(s.token));
    expect(tx.status).toBe(201);
    expect(tx.body.status).toBe('transmitido');
    expect(tx.body.protocolo_lote).toBe(PROTOCOLO);
    expect(soap.lotes).toHaveLength(1);
    expect(soap.lotes[0]).toContain('<SignatureValue>');
    expect(soap.lotes[0]).toMatch(/<envioLoteEventos grupo="2">/);
    // duplo clique / reenvio: segunda transmissão não envia de novo
    expect((await http().post(`/esocial/events/${id}/transmit`).set(auth(s.token))).status).toBe(409);
    expect(soap.lotes).toHaveLength(1);

    soap.consulta = { cdResposta: 101, descResposta: 'Aguardando', eventos: [], ocorrencias: [] };
    const c1 = await http().post(`/esocial/events/${id}/consult`).set(auth(s.token));
    expect(c1.body.status).toBe('processando');
    soap.consulta = (evId: string) => ({ cdResposta: 201, descResposta: 'ok', ocorrencias: [], eventos: [{ id: evId, cdResposta: 201, descResposta: 'Sucesso', nrRecibo: '1.2.0000000000000000077', ocorrencias: [] }] });
    const c2 = await http().post(`/esocial/events/${id}/consult`).set(auth(s.token));
    expect(c2.body.status).toBe('processado');
    expect(c2.body.nr_recibo).toBe('1.2.0000000000000000077');

    const hist = (await http().get(`/esocial/events/${id}`).set(auth(s.token))).body.history;
    expect(hist.map((h: any) => h.to_status)).toEqual(['rascunho', 'aguardando_transmissao', 'transmitindo', 'transmitido', 'processando', 'processado']);
    expect(hist.every((h: any) => h.actor_user_id === s.t.userId)).toBe(true);
    // evidência: o XML assinado fica guardado e é o mesmo que foi no lote
    const xml = (await http().get(`/esocial/events/${id}/xml`).set(auth(s.token))).body;
    expect(xml.signed).toBe(true);
    expect(soap.lotes[0]).toContain(xml.xml.replace(/^<\?xml[^>]*\?>\s*/, ''));
  }, 120000);

  it('rejeição do lote: fica "rejeitado" com código e mensagem, e dá para recriar o evento depois', async () => {
    const s = await scenario('esocial-rejeicao'); await makeReady(s);
    const mk = async () => (await http().post('/esocial/events').set(auth(s.token)).send({ asoRecordId: s.asoId, certificateId: s.certificateId })).body.id as string;
    const id = await mk();
    // um ASO não pode ter dois eventos ativos
    expect((await http().post('/esocial/events').set(auth(s.token)).send({ asoRecordId: s.asoId, certificateId: s.certificateId })).status).toBe(422);
    await http().post(`/esocial/events/${id}/authorize`).set(auth(s.token));
    soap.envio = { cdResposta: 401, descResposta: 'Lote incorreto', protocoloEnvio: undefined, ocorrencias: [{ codigo: 'MS0001', descricao: 'Campo obrigatório', tipo: '1' }] };
    const tx = await http().post(`/esocial/events/${id}/transmit`).set(auth(s.token));
    expect(tx.body.status).toBe('rejeitado');
    expect(tx.body.erro_codigo).toBe('401');
    expect(tx.body.erro_mensagem).toContain('MS0001');
    soap.envio = { cdResposta: 201, descResposta: 'ok', protocoloEnvio: PROTOCOLO, ocorrencias: [] };
    expect(await mk()).toBeTruthy();
  }, 120000);

  it('tenant B não enxerga nem aciona evento do tenant A (404)', async () => {
    const a = await scenario('esocial-iso-a'); await makeReady(a);
    const b = await db.createTenantWithUser('esocial-iso-b'); const tokenB = await login(b);
    const id = (await http().post('/esocial/events').set(auth(a.token)).send({ asoRecordId: a.asoId, certificateId: a.certificateId })).body.id;
    for (const [m, p] of [['get', ''], ['get', '/xml'], ['post', '/authorize'], ['post', '/transmit'], ['post', '/consult']] as const) {
      expect([404, 409]).toContain((await (http() as any)[m](`/esocial/events/${id}${p}`).set(auth(tokenB))).status);
    }
    expect((await http().get(`/esocial/events/${id}`).set(auth(tokenB))).status).toBe(404);
    // criar evento usando ASO e certificado do tenant A, estando logado no B
    expect((await http().post('/esocial/events').set(auth(tokenB)).send({ asoRecordId: a.asoId, certificateId: a.certificateId })).status).toBe(404);
    // E-06: ASO com funcionário de outro tenant
    const r = await http().post('/aso/records').set(auth(tokenB)).send({ employeeId: a.t.employeeId, examType: 'periodico', examDate: '2026-09-01', result: 'apto', resultDisclosureAuthorized: false, doctorName: 'X Y', doctorCrm: '1', doctorCrmUf: 'SP' });
    expect(r.status).toBe(400);
    // a lista do B está vazia
    expect((await http().get('/esocial/events').set(auth(tokenB))).body).toEqual([]);
  }, 120000);

  it('técnico (sem papel de empresa) lê mas não autoriza nem transmite; produção real é barrada', async () => {
    const s = await scenario('esocial-papeis'); await makeReady(s);
    const id = (await http().post('/esocial/events').set(auth(s.token)).send({ asoRecordId: s.asoId, certificateId: s.certificateId })).body.id;
    const tec = await db.createUserWithRole('tecnico', 'tecnico-esocial'); const tokenT = await login(tec);
    for (const p of ['/authorize', '/transmit', '/consult']) {
      expect([401, 403, 404]).toContain((await http().post(`/esocial/events/${id}${p}`).set(auth(tokenT))).status);
    }
    await http().post(`/esocial/events/${id}/authorize`).set(auth(s.token));
    await db.rawQuery(`UPDATE esocial_events SET ambiente = 'producao' WHERE id = $1`, [id]);
    const before = soap.lotes.length;
    expect((await http().post(`/esocial/events/${id}/transmit`).set(auth(s.token))).status).toBe(400);
    expect(soap.lotes.length).toBe(before);
  }, 120000);
  it('S-3000: exclui só evento processado, transmite o evtExclusao, marca o original como excluído e libera o ASO', async () => {
    const s = await scenario('esocial-s3000'); await makeReady(s);
    const post = (path: string, tok = s.token, body?: object) => http().post(path).set(auth(tok)).send(body ?? {});
    const id = (await post('/esocial/events', s.token, { asoRecordId: s.asoId, certificateId: s.certificateId })).body.id as string;
    // evento ainda em rascunho: não pode ser excluído
    expect((await post(`/esocial/events/${id}/exclusion`)).status).toBe(409);

    await post(`/esocial/events/${id}/authorize`); await post(`/esocial/events/${id}/transmit`);
    soap.consulta = (evId: string) => ({ cdResposta: 201, descResposta: 'ok', ocorrencias: [], eventos: [{ id: evId, cdResposta: 201, descResposta: 'Sucesso', nrRecibo: '1.2.0000000000000000077', ocorrencias: [] }] });
    expect((await post(`/esocial/events/${id}/consult`)).body.status).toBe('processado');

    // outro tenant não enxerga o evento
    const b = await db.createTenantWithUser('esocial-s3000-b'); const tokenB = await login(b);
    expect((await post(`/esocial/events/${id}/exclusion`, tokenB)).status).toBe(404);

    const ex = await post(`/esocial/events/${id}/exclusion`);
    expect(ex.status).toBe(201);
    expect(ex.body).toMatchObject({ event_type: 'S-3000', status: 'rascunho', target_event_id: id });
    const exId = ex.body.id as string;
    expect((await post(`/esocial/events/${id}/exclusion`)).status).toBe(409); // exclusão duplicada

    expect((await post(`/esocial/events/${exId}/transmit`)).status).toBe(409); // sem autorização humana
    await post(`/esocial/events/${exId}/authorize`);
    const tx = await post(`/esocial/events/${exId}/transmit`);
    expect(tx.body.status).toBe('transmitido');
    const lote = soap.lotes[soap.lotes.length - 1];
    expect(lote).toContain('<evtExclusao');
    expect(lote).toContain('<tpEvento>S-2220</tpEvento>');
    expect(lote).toContain('<nrRecEvt>1.2.0000000000000000077</nrRecEvt>');
    expect(lote).toContain('<SignatureValue>');

    // enquanto o S-3000 não volta com recibo, o original continua processado
    expect((await http().get(`/esocial/events/${id}`).set(auth(s.token))).body.status).toBe('processado');
    soap.consulta = (evId: string) => ({ cdResposta: 201, descResposta: 'ok', ocorrencias: [], eventos: [{ id: evId, cdResposta: 201, descResposta: 'Sucesso', nrRecibo: '1.2.0000000000000000088', ocorrencias: [] }] });
    const done = await post(`/esocial/events/${exId}/consult`);
    expect(done.body).toMatchObject({ status: 'processado', nr_recibo: '1.2.0000000000000000088' });

    const orig = (await http().get(`/esocial/events/${id}`).set(auth(s.token))).body;
    expect(orig.status).toBe('excluido');
    expect(orig.history.map((h: any) => h.to_status)).toContain('excluido');
    // excluído o evento, o ASO pode ser enviado de novo
    expect((await post('/esocial/events', s.token, { asoRecordId: s.asoId, certificateId: s.certificateId })).status).toBe(201);
  }, 120000);
  it('código 203 (lote já recebido e na fila) é tratado como transmitido, com o protocolo', async () => {
    const s = await scenario('esocial-203'); await makeReady(s);
    const id = (await http().post('/esocial/events').set(auth(s.token)).send({ asoRecordId: s.asoId, certificateId: s.certificateId })).body.id as string;
    await http().post(`/esocial/events/${id}/authorize`).set(auth(s.token));
    soap.envio = { cdResposta: 203, descResposta: 'Lote já recebido e na fila', protocoloEnvio: PROTOCOLO, ocorrencias: [] };
    const tx = await http().post(`/esocial/events/${id}/transmit`).set(auth(s.token));
    soap.envio = { cdResposta: 201, descResposta: 'ok', protocoloEnvio: PROTOCOLO, ocorrencias: [] };
    expect(tx.body).toMatchObject({ status: 'transmitido', protocolo_lote: PROTOCOLO, cd_resposta: '203' });
  }, 120000);
});
