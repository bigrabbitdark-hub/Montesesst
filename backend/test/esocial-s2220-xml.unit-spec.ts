import { buildEventId, buildS2220Xml, cnpjBase } from '../src/esocial/xml/s2220-xml.builder';
import { XsdValidatorService } from '../src/esocial/xml/xsd-validator.service';
import { S2220Payload } from '../src/esocial/xml/s2220.types';

const payload: S2220Payload = {
  ambiente: 'producao_restrita',
  empregador: { tpInsc: 1, nrInsc: '12345678000195' },
  trabalhador: { cpf: '12345678909', matricula: 'M-001', codCateg: '101' },
  tpExameOcup: 1,
  aso: {
    dtAso: '2026-09-15',
    resAso: 1,
    exames: [{ dtExm: '2026-09-15', procRealizado: '0281', ordExame: 2 }],
    medico: { nmMed: 'Dra. Ana & Filhos <teste>', nrCRM: '12345', ufCRM: 'SP' },
  },
  respMonit: { cpfResp: '98765432100', nmResp: 'Dr. Coordenador PCMSO', nrCRM: '54321', ufCRM: 'SP' },
  indRetif: 1,
};

describe('S-2220: XML contra o XSD oficial', () => {
  const validator = new XsdValidatorService();
  const id = buildEventId(cnpjBase(payload.empregador.nrInsc), new Date('2026-10-05T12:30:45Z'), 1);

  it('gera Id de 36 posições no padrão TS_Id', () => {
    expect(id).toBe('ID11234567800000020261005123045' + '00001');
    expect(id).toHaveLength(36);
  });

  it('XML válido passa no XSD evtMonit (inclui escape de & e <)', async () => {
    const xml = buildS2220Xml(payload, id);
    expect(xml).toContain('Dra. Ana &amp; Filhos &lt;teste&gt;');
    // Sem Signature o XSD reprova (ds:Signature é obrigatório); o erro tem de ser só esse.
    const r = await validator.validate('evtMonit', xml);
    expect(r.valid).toBe(false);
    expect(r.errors.join('\n')).toMatch(/Signature/);
    expect(r.errors.filter((e) => !/Signature/.test(e))).toEqual([]);
  });

  it('XML com campo fora do leiaute é reprovado', async () => {
    const xml = buildS2220Xml({ ...payload, trabalhador: { cpf: '123' } }, id);
    const r = await validator.validate('evtMonit', xml);
    expect(r.valid).toBe(false);
    expect(r.errors.join('\n')).toMatch(/cpfTrab|pattern/i);
  });
});
