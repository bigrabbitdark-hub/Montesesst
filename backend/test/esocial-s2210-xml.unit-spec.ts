import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePkcs12 } from '../src/esocial/certificates/pkcs12.util';
import { XmlSignerService } from '../src/esocial/signing/xml-signer.service';
import { buildEventId, cnpjBase } from '../src/esocial/xml/s2220-xml.builder';
import { buildS2210Xml, S2210Payload } from '../src/esocial/xml/s2210-xml.builder';
import { XsdValidatorService } from '../src/esocial/xml/xsd-validator.service';

// Códigos de tabela abaixo são FICTÍCIOS (só precisam ter 9 dígitos para o XSD); em produção vêm
// das Tabelas 13, 14, 15 e 17 do eSocial, informadas por quem emite a CAT.
const base = (): S2210Payload => ({
  ambiente: 'producao_restrita',
  empregador: { tpInsc: 1, nrInsc: '12345678000195' },
  trabalhador: { cpf: '52998224725', matricula: 'M-1', codCateg: '101' },
  indRetif: 1,
  cat: {
    dtAcid: '2026-09-10', tpAcid: 1, hrAcid: '0930', hrsTrabAntesAcid: '0215', tpCat: 1, indCatObito: false,
    indComunPolicia: false, codSitGeradora: '200012300', iniciatCAT: 1, ultDiaTrab: '2026-09-10', houveAfast: true,
    localAcidente: { tpLocal: 1, dscLocal: 'Pátio de carga', dscLograd: 'Rua das Flores', nrLograd: '100', bairro: 'Centro',
      cep: '01001000', codMunic: '3550308', uf: 'SP', ideLocalAcid: { tpInsc: 1, nrInsc: '12345678000195' } },
    parteAtingida: { codParteAting: '753030000', lateralidade: 2 },
    agenteCausador: { codAgntCausador: '302010400' },
    atestado: { dtAtendimento: '2026-09-10', hrAtendimento: '1100', indInternacao: false, durTrat: 7, indAfast: true,
      dscLesao: '702005000', diagProvavel: 'Corte em dedo', codCID: 'S61', emitente: { nmEmit: 'Dr. Teste & Cia', ideOC: 1, nrOC: '12345', ufOC: 'SP' } },
  },
});

describe('S-2210 (CAT): XML contra o XSD oficial evtCAT', () => {
  const xsd = new XsdValidatorService();
  const id = buildEventId('12345678', new Date('2026-10-05T12:00:00Z'), 9);
  const onlySignatureMissing = async (xml: string) => (await xsd.validate('evtCAT', xml)).errors.filter((e) => !/Signature/.test(e));

  it('CAT inicial completa, assinada, passa no XSD inteiro e a assinatura confere', async () => {
    const cert = parsePkcs12(readFileSync(join(__dirname, 'fixtures/esocial/test-certificate.pfx')), 'teste1234');
    const signer = new XmlSignerService();
    const signed = signer.sign(buildS2210Xml(base(), id, cnpjBase), cert.privateKeyPem, cert.certificatePem);
    const r = await xsd.validate('evtCAT', signed);
    expect(r.errors).toEqual([]);
    expect(signer.verify(signed, cert.certificatePem)).toBe(true);
  });

  it('escapa texto livre (& < >) no XML', () => {
    expect(buildS2210Xml(base(), id, cnpjBase)).toContain('Dr. Teste &amp; Cia');
  });

  it('doença (tpAcid 2) sem hora, e CAT de óbito com data e CAT de origem, passam no XSD', async () => {
    const doenca = base(); doenca.cat.tpAcid = 2; delete doenca.cat.hrAcid; delete doenca.cat.hrsTrabAntesAcid;
    expect(await onlySignatureMissing(buildS2210Xml(doenca, id, cnpjBase))).toEqual([]);
    const obito = base();
    Object.assign(obito.cat, { tpCat: 3, indCatObito: true, dtObito: '2026-09-12', catOrigem: { nrRecCatOrig: '1.2.0000000000000000123' } });
    obito.cat.atestado.indAfast = false;
    expect(await onlySignatureMissing(buildS2210Xml(obito, id, cnpjBase))).toEqual([]);
  });

  it('o XSD reprova hora inválida, código de tabela fora de 9 dígitos e recibo de origem malformado', async () => {
    const h = base(); h.cat.hrAcid = '2560';
    expect((await onlySignatureMissing(buildS2210Xml(h, id, cnpjBase))).join()).toMatch(/hrAcid/);
    const c = base(); c.cat.codSitGeradora = '123';
    expect((await onlySignatureMissing(buildS2210Xml(c, id, cnpjBase))).join()).toMatch(/codSitGeradora/);
    const o = base(); o.cat.tpCat = 2; o.cat.catOrigem = { nrRecCatOrig: 'xx' };
    expect((await onlySignatureMissing(buildS2210Xml(o, id, cnpjBase))).join()).toMatch(/nrRecCatOrig/);
  });
});
