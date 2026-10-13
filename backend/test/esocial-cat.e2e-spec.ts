import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/common/r2/r2.service';
import { EsocialSoapClient } from '../src/esocial/transport/esocial-soap-client.service';
import { TestDb } from './db-test-helper';

const PFX = readFileSync(join(__dirname, 'fixtures/esocial/test-certificate.pfx'));
const r2Store = new Map<string, Buffer>();
const fakeR2 = { putObject: async (k: string, b: Buffer) => void r2Store.set(k, b), getObject: async (k: string) => r2Store.get(k)! };

class FakeSoap {
  lotes: string[] = [];
  async enviarLote(_u: string, lote: string) { this.lotes.push(lote); return { cdResposta: 201, descResposta: 'ok', protocoloEnvio: '1.2.202610.0000000000000000099', ocorrencias: [] }; }
  recibo = '1.2.0000000000000000555';
  async consultarLote() {
    const id = /<evento Id="([^"]+)"/.exec(this.lotes[this.lotes.length - 1])![1];
    return { cdResposta: 201, descResposta: 'ok', ocorrencias: [], eventos: [{ id, cdResposta: 201, descResposta: 'Sucesso', nrRecibo: this.recibo, ocorrencias: [] }] };
  }
}

// Códigos de tabela FICTÍCIOS (9 dígitos): em uso real vêm das Tabelas 13, 14, 15 e 17 do eSocial.
const dto = (employeeId: string, extra: Record<string, unknown> = {}) => ({
  employeeId, acidDate: '2026-09-10', acidType: 1, acidTime: '0930', hoursWorkedBefore: '0215', catType: 1, death: false,
  policeNotified: false, causingSituationCode: '200012300', catInitiative: 1, lastWorkDay: '2026-09-10', hadLeave: true,
  locationType: 1, locationDescription: 'Pátio', locStreet: 'Rua das Flores', locNumber: '100', locCep: '01001000', locCityCode: '3550308', locUf: 'SP',
  locInscriptionType: 1, locInscriptionNumber: '12345678000195',
  bodyPartCode: '753030000', laterality: 2, causingAgentCode: '302010400',
  attDate: '2026-09-10', attTime: '1100', attHospitalized: false, attTreatmentDays: 7, attLeave: true, attInjuryCode: '702005000',
  attProbableDiagnosis: 'Corte', attCid: 'S61', attIssuerName: 'Dr. Teste', attIssuerCouncil: 1, attIssuerNumber: '12345', attIssuerUf: 'SP', ...extra,
});

describe('eSocial S-2210 (CAT): e2e com SOAP e R2 simulados', () => {
  let app: INestApplication; let db: TestDb; const soap = new FakeSoap();
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (t: { email: string; password: string }) => (await http().post('/auth/login').send({ email: t.email, password: t.password })).body.access_token as string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(R2Service).useValue(fakeR2).overrideProvider(EsocialSoapClient).useValue(soap).compile();
    app = mod.createNestApplication(); await app.init(); db = new TestDb(); await db.connect();
  });
  afterAll(async () => { await db.cleanup(); await db.disconnect(); await app.close(); });

  async function scenario(prefix: string, confirm = true) {
    const t = await db.createTenantWithUser(prefix);
    await db.rawQuery('UPDATE employees SET cpf = $1 WHERE id = $2', ['52998224725', t.employeeId]);
    const token = await login(t);
    const cert = await http().post('/esocial/certificates').set(auth(token)).field('label', 'A1').field('password', 'teste1234').attach('file', PFX, 'a1.pfx');
    if (confirm) await http().post(`/esocial/employees/${t.employeeId}/confirm-vinculo`).set(auth(token));
    return { t, token, certId: cert.body.id as string };
  }
  const post = (s: { token: string }, path: string, body: object = {}) => http().post(path).set(auth(s.token)).send(body);

  it('valida o corpo, isola por tenant e aplica as regras condicionais do diagnóstico', async () => {
    const s = await scenario('cat-regras', false);
    expect((await post(s, '/esocial/accidents', dto(s.t.employeeId, { causingSituationCode: '123' }))).status).toBe(400);
    expect((await post(s, '/esocial/accidents', { ...dto(s.t.employeeId), campoExtra: 1 })).status).toBe(400);

    const ok = await post(s, '/esocial/accidents', dto(s.t.employeeId));
    expect(ok.status).toBe(201);
    const id = ok.body.id as string;

    const diag = async (extraQuery = '') => (await http().get(`/esocial/events/diagnostics?accidentId=${id}&certificateId=${s.certId}${extraQuery}`).set(auth(s.token))).body;
    expect((await diag()).issues.map((i: any) => i.code)).toContain('VINCULO_NAO_CONFIRMADO');

    // regras: óbito sem marcar, doença com hora, local de estabelecimento sem inscrição, reabertura sem origem
    await http().put(`/esocial/accidents/${id}`).set(auth(s.token)).send(dto(s.t.employeeId, { catType: 3, acidType: 2, locInscriptionType: undefined, locInscriptionNumber: undefined }));
    const codes = (await diag()).issues.map((i: any) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['OBITO_FLAG', 'HORA_DOENCA', 'LOCAL_INSCRICAO', 'CAT_ORIGEM']));

    // outro tenant não vê a CAT, nem usa o funcionário
    const b = await db.createTenantWithUser('cat-regras-b'); const tokenB = await login(b);
    expect((await http().get(`/esocial/accidents/${id}`).set(auth(tokenB))).status).toBe(404);
    expect((await http().get('/esocial/accidents').set(auth(tokenB))).body).toEqual([]);
    expect((await post({ token: tokenB }, '/esocial/accidents', dto(s.t.employeeId))).status).toBe(400);
    expect((await http().get(`/esocial/events/diagnostics?accidentId=${id}`).set(auth(tokenB))).status).toBe(404);
  }, 120000);

  it('ciclo completo: gera, autoriza, transmite, consulta; bloqueia edição; reabertura com origem; exclui via S-3000', async () => {
    const s = await scenario('cat-ciclo');
    const acc = (await post(s, '/esocial/accidents', dto(s.t.employeeId))).body.id as string;
    const mk = async (accidentId: string) => post(s, '/esocial/events', { accidentId, certificateId: s.certId });

    const ev = await mk(acc);
    expect(ev.status).toBe(201);
    expect(ev.body).toMatchObject({ event_type: 'S-2210', status: 'rascunho', accident_id: acc });
    expect((await mk(acc)).status).toBe(422); // já existe evento ativo
    expect((await post(s, '/esocial/events', { accidentId: acc, asoRecordId: acc, certificateId: s.certId })).status).toBe(400); // só um dos dois
    // com evento ativo, a CAT não pode ser editada (a evidência é o que foi enviado)
    expect((await http().put(`/esocial/accidents/${acc}`).set(auth(s.token)).send(dto(s.t.employeeId, { attCid: 'S62' }))).status).toBe(409);

    expect((await post(s, `/esocial/events/${ev.body.id}/transmit`)).status).toBe(409); // sem autorização
    await post(s, `/esocial/events/${ev.body.id}/authorize`);
    const tx = await post(s, `/esocial/events/${ev.body.id}/transmit`);
    expect(tx.body.status).toBe('transmitido');
    const lote = soap.lotes[soap.lotes.length - 1];
    expect(lote).toContain('<evtCAT'); expect(lote).toContain('<SignatureValue>'); expect(lote).toContain('<codCID>S61</codCID>');
    expect((await post(s, `/esocial/events/${ev.body.id}/consult`)).body).toMatchObject({ status: 'processado', nr_recibo: '1.2.0000000000000000555' });

    // reabertura: nova CAT apontando para o evento processado; o recibo de origem vai no XML
    const reab = (await post(s, '/esocial/accidents', dto(s.t.employeeId, { catType: 2, originEventId: ev.body.id, acidTime: '0930', lastWorkDay: '2026-09-20' }))).body.id as string;
    const evR = await mk(reab);
    expect(evR.status).toBe(201);
    const xml = (await http().get(`/esocial/events/${evR.body.id}/xml`).set(auth(s.token))).body.xml as string;
    expect(xml).toContain('<tpCat>2</tpCat>'); expect(xml).toContain('<nrRecCatOrig>1.2.0000000000000000555</nrRecCatOrig>');

    // S-3000 exclui o S-2210 processado
    const ex = await post(s, `/esocial/events/${ev.body.id}/exclusion`);
    expect(ex.status).toBe(201);
    await post(s, `/esocial/events/${ex.body.id}/authorize`); await post(s, `/esocial/events/${ex.body.id}/transmit`);
    expect(soap.lotes[soap.lotes.length - 1]).toContain('<tpEvento>S-2210</tpEvento>');
    soap.recibo = '1.2.0000000000000000556';
    expect((await post(s, `/esocial/events/${ex.body.id}/consult`)).body.status).toBe('processado');
    expect((await http().get(`/esocial/events/${ev.body.id}`).set(auth(s.token))).body.status).toBe('excluido');
  }, 180000);
});
