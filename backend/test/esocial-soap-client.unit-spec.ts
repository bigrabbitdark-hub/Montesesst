import * as forge from 'node-forge';
import * as https from 'https';
import { AddressInfo } from 'net';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EsocialSoapClient } from '../src/esocial/transport/esocial-soap-client.service';
import {
  buildConsultaSoap, buildConsultaXml, buildEnvioSoap, buildLoteXml, parseConsultaResponse, parseEnvioResponse,
} from '../src/esocial/transport/lote.util';
import { XsdValidatorService } from '../src/esocial/xml/xsd-validator.service';

function makeCert(cn: string, sans: Array<{ type: number; value?: string; ip?: string }>, issuer?: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey }) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = String(Date.now() + Math.floor(Math.random() * 1000));
  cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 86400000 * 30);
  const attrs = [{ name: 'commonName', value: cn }];
  cert.setSubject(attrs); cert.setIssuer(issuer ? issuer.cert.subject.attributes : attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: !issuer }, ...(sans.length ? [{ name: 'subjectAltName', altNames: sans }] : [])]);
  cert.sign((issuer ? issuer.key : keys.privateKey) as any, forge.md.sha256.create());
  return { cert, key: keys.privateKey, certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

const ENVIO_OK = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><EnviarLoteEventosResponse xmlns="http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0"><EnviarLoteEventosResult><eSocial xmlns="http://www.esocial.gov.br/schema/lote/eventos/envio/retornoEnvio/v1_1_0"><retornoEnvioLoteEventos><status><cdResposta>201</cdResposta><descResposta>Lote recebido com sucesso.</descResposta></status><dadosRecepcaoLote><dhRecepcao>2026-10-05T12:00:00</dhRecepcao><versaoAplicativoRecepcao>1</versaoAplicativoRecepcao><protocoloEnvio>1.2.202610.0000000000000000001</protocoloEnvio></dadosRecepcaoLote></retornoEnvioLoteEventos></eSocial></EnviarLoteEventosResult></EnviarLoteEventosResponse></s:Body></s:Envelope>`;

describe('cliente SOAP/mTLS do eSocial', () => {
  const ca = makeCert('CA de teste', []);
  const server = makeCert('localhost', [{ type: 2, value: 'localhost' }], ca);
  const pfxBuf = readFileSync(join(__dirname, 'fixtures/esocial/test-certificate.pfx'));
  const clientCert = { pfx: pfxBuf, passphrase: 'teste1234' };
  let srv: https.Server; let port: number;
  let seen: { action?: string; body?: string; clientCn?: string } = {};

  beforeAll((done) => {
    srv = https.createServer(
      { key: server.keyPem, cert: server.certPem, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.2' },
      (req, res) => {
        const peer = (req.socket as any).getPeerCertificate();
        seen.clientCn = peer?.subject?.CN; seen.action = String(req.headers['soapaction']);
        let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { seen.body = b; res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end(ENVIO_OK); });
      },
    ).listen(0, '127.0.0.1', () => { port = (srv.address() as AddressInfo).port; done(); });
  });
  afterAll((done) => { srv.close(() => done()); });

  const client = new EsocialSoapClient();
  const opts = { ca: ca.certPem, allowedHostSuffixes: ['localhost', '127.0.0.1'] };

  it('apresenta o certificado do cliente, manda SOAPAction e lê o protocolo do lote', async () => {
    const r = await client.enviarLote(`https://localhost:${port}/servicos/x.svc`, '<eSocial/>', clientCert, opts);
    expect(seen.clientCn).toContain('EMPRESA TESTE LTDA');
    expect(seen.action).toBe('"http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0/ServicoEnviarLoteEventos/EnviarLoteEventos"');
    expect(seen.body).toContain('<v1:loteEventos><eSocial/></v1:loteEventos>');
    expect(r).toMatchObject({ cdResposta: 201, protocoloEnvio: '1.2.202610.0000000000000000001' });
  });

  it('RECUSA hostname diferente do certificado do servidor (o TST aceitaria)', async () => {
    await expect(client.enviarLote(`https://127.0.0.1:${port}/x`, '<eSocial/>', clientCert, opts)).rejects.toThrow(/altnames|hostname|IP/i);
  });

  it('RECUSA servidor com CA desconhecida', async () => {
    await expect(client.enviarLote(`https://localhost:${port}/x`, '<eSocial/>', clientCert, { allowedHostSuffixes: ['localhost'] })).rejects.toThrow(/certificate|self.signed|unable/i);
  });

  it('RECUSA http e domínios fora de esocial.gov.br', async () => {
    await expect(client.enviarLote('http://webservices.envio.esocial.gov.br/x', '<eSocial/>', clientCert)).rejects.toThrow(/não permitido/);
    await expect(client.enviarLote('https://evil.example.com/x', '<eSocial/>', clientCert)).rejects.toThrow(/não permitido/);
    await expect(client.enviarLote('https://esocial.gov.br.evil.com/x', '<eSocial/>', clientCert)).rejects.toThrow(/não permitido/);
  });
});

describe('mensagens de lote e consulta', () => {
  it('o lote gerado passa no XSD oficial EnvioLoteEventos v1_1_1', async () => {
    const xml = buildLoteXml({ empregadorCnpjBase: '12345678', transmissor: { tpInsc: 1, nrInsc: '12345678000195' }, grupo: 2, eventos: [{ id: 'ID11234567800000020261005120000' + '00001', signedXml: '<eSocial xmlns="urn:x"><evtMonit/></eSocial>' }] });
    const r = await new XsdValidatorService().validate('envioLote', xml);
    expect(r.errors).toEqual([]);
    expect(buildEnvioSoap(xml)).toContain('<v1:EnviarLoteEventos');
  });

  it('a consulta passa no XSD oficial ConsultaLoteEventos v1_0_0', async () => {
    const r = await new XsdValidatorService().validate('consultaLote', buildConsultaXml('1.2.202610.0000000000000000001'));
    expect(r.errors).toEqual([]);
    expect(buildConsultaSoap(buildConsultaXml('p'))).toContain('<v1:consulta>');
  });

  it('lote com 51 eventos é recusado', () => {
    const eventos = Array.from({ length: 51 }, (_, i) => ({ id: `ID${i}`, signedXml: '<e/>' }));
    expect(() => buildLoteXml({ empregadorCnpjBase: '12345678', transmissor: { tpInsc: 1, nrInsc: '1' }, grupo: 2, eventos })).toThrow(/1 a 50/);
  });

  it('interpreta envio com erro, SOAP Fault e consulta com recibo e com rejeição', () => {
    expect(parseEnvioResponse(ENVIO_OK).cdResposta).toBe(201);
    const erro = ENVIO_OK.replace('<cdResposta>201</cdResposta><descResposta>Lote recebido com sucesso.</descResposta>', '<cdResposta>401</cdResposta><descResposta>Lote incorreto</descResposta><ocorrencias><ocorrencia><codigo>MS0001</codigo><descricao>Campo obrigatório</descricao><tipo>1</tipo></ocorrencia></ocorrencias>');
    expect(parseEnvioResponse(erro)).toMatchObject({ cdResposta: 401, ocorrencias: [{ codigo: 'MS0001' }] });
    expect(() => parseEnvioResponse('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultstring>falhou</faultstring></s:Fault></s:Body></s:Envelope>')).toThrow(/falhou/);
    expect(() => parseEnvioResponse('não é xml <')).toThrow();

    const consulta = (ev: string) => `<s:Envelope xmlns:s="x"><s:Body><R><ConsultarLoteEventosResult><eSocial xmlns="http://www.esocial.gov.br/schema/lote/eventos/envio/retornoProcessamento/v1_3_0"><retornoProcessamentoLoteEventos><status><cdResposta>201</cdResposta><descResposta>Lote processado</descResposta></status><retornoEventos>${ev}</retornoEventos></retornoProcessamentoLoteEventos></eSocial></ConsultarLoteEventosResult></R></s:Body></s:Envelope>`;
    const ok = parseConsultaResponse(consulta('<evento Id="ID1"><retornoEvento><eSocial xmlns="y"><retornoEvento Id="ID1"><processamento><cdResposta>201</cdResposta><descResposta>Sucesso</descResposta></processamento><recibo><nrRecibo>1.2.0000000000000000001</nrRecibo></recibo></retornoEvento></eSocial></retornoEvento></evento>'));
    expect(ok.eventos[0]).toMatchObject({ id: 'ID1', cdResposta: 201, nrRecibo: '1.2.0000000000000000001' });
    const rej = parseConsultaResponse(consulta('<evento Id="ID2"><retornoEvento><eSocial xmlns="y"><retornoEvento Id="ID2"><processamento><cdResposta>402</cdResposta><descResposta>Erro</descResposta><ocorrencias><ocorrencia><codigo>MS1234</codigo><descricao>Regra violada</descricao><tipo>1</tipo></ocorrencia></ocorrencias></processamento></retornoEvento></eSocial></retornoEvento></evento>'));
    expect(rej.eventos[0]).toMatchObject({ cdResposta: 402, nrRecibo: undefined, ocorrencias: [{ codigo: 'MS1234' }] });
  });
});

describe('CNPJ alfanumérico no lote (pacote de comunicação v1.6-Alfa)', () => {
  it('o lote com empregador e transmissor alfanuméricos passa no XSD de envio', async () => {
    const xml = buildLoteXml({
      empregadorCnpjBase: '12ABC345', transmissor: { tpInsc: 1, nrInsc: '12ABC34501DE35' }, grupo: 2,
      eventos: [{ id: 'ID1', signedXml: '<eSocial xmlns="urn:x"><evtMonit/></eSocial>' }],
    });
    const r = await new XsdValidatorService().validate('envioLote', xml);
    expect(r.errors).toEqual([]);
  });

  it('o XSD recusa letra minúscula no CNPJ (o eSocial só aceita maiúsculas)', async () => {
    const xml = buildLoteXml({
      empregadorCnpjBase: '12abc345', transmissor: { tpInsc: 1, nrInsc: '12ABC34501DE35' }, grupo: 2,
      eventos: [{ id: 'ID1', signedXml: '<e/>' }],
    });
    const r = await new XsdValidatorService().validate('envioLote', xml);
    expect(r.valid).toBe(false);
  });

  it('continua aceitando CNPJ numérico (o Alfa é superset do v1.6)', async () => {
    const xml = buildLoteXml({ empregadorCnpjBase: '12345678', transmissor: { tpInsc: 1, nrInsc: '12345678000195' }, grupo: 2, eventos: [{ id: 'ID1', signedXml: '<e/>' }] });
    expect((await new XsdValidatorService().validate('envioLote', xml)).errors).toEqual([]);
  });
});
