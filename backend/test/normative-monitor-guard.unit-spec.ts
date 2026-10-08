// Sem rede: a guarda de URL consulta o DNS; aqui ele devolve sempre um IP público.
jest.mock('dns/promises', () => ({ lookup: jest.fn(async () => [{ address: '200.10.10.10', family: 4 }]) }));

import { NormativeMonitorService } from '../src/normative/normative-monitor.service';

const PAGINA_LONGA = `<html><body><div id="content-core">${'Texto da norma regulamentadora. '.repeat(20)}</div></body></html>`;
const PAGINA_VAZIA = '<html><body>curto</body></html>';

function montar(vigenteChars: number | null) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      if (sql.includes('FROM official_sources')) {
        return { rows: [{ id: 's1', code: 'NR-06', title: 'EPI', official_url: 'https://exemplo.gov.br/nr06.htm' }] };
      }
      if (sql.includes('length(raw_text)')) return { rows: vigenteChars === null ? [] : [{ len: vigenteChars }] };
      if (sql.includes("last_check_status = 'erro'")) return { rows: [{ consecutive_failures: 1 }] };
      return { rows: [] };
    }),
  };
  const db: any = { withoutTenantContext: jest.fn(async (cb: any) => cb(client)) };
  const documents: any = { recordDetectedVersion: jest.fn(async () => null) };
  const email: any = { send: jest.fn(async () => undefined) };
  const service = new NormativeMonitorService(db, documents, email);
  const falhas = () => consultas.filter((c) => c.sql.includes("last_check_status = 'erro'"));
  const sucessos = () => consultas.filter((c) => c.sql.includes("last_check_status = 'ok'"));
  return { service, documents, email, falhas, sucessos };
}

function simularFetch(html: string) {
  return jest
    .spyOn(global, 'fetch' as any)
    .mockImplementation(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }) as any);
}

describe('NormativeMonitorService — cabeçalhos e barreira de extração suspeita', () => {
  afterEach(() => jest.restoreAllMocks());

  it('envia o User-Agent identificado e os cabeçalhos de Accept ao buscar a fonte', async () => {
    const fetchSpy = simularFetch(PAGINA_LONGA);
    const { service } = montar(null);
    await service.runOnce({ onlySourceIds: ['s1'] });
    const init = fetchSpy.mock.calls[0][1] as any;
    expect(init.headers['User-Agent']).toMatch(/^Mozilla\/5\.0 \(compatible; MonteseSSTMonitor\/1\.0;/);
    expect(init.headers['Accept-Language']).toContain('pt-BR');
  });

  it('página em ISO-8859-1 sem charset: o texto enviado mantém os acentos (sem "�")', async () => {
    const html = `<html><body><div>${'Presidência da República. '.repeat(10)}</div></body></html>`;
    jest
      .spyOn(global, 'fetch' as any)
      .mockImplementation(async () => new Response(new Uint8Array(Buffer.from(html, 'latin1')), { status: 200, headers: { 'content-type': 'text/html' } }) as any);
    const { service, documents } = montar(null);
    await service.runOnce({ onlySourceIds: ['s1'] });
    expect(documents.recordDetectedVersion).toHaveBeenCalledTimes(1);
    const texto = (documents.recordDetectedVersion.mock.calls[0] as any[])[2] as string;
    expect(texto).toContain('Presidência');
    expect(texto).not.toContain('\uFFFD');
  });

  it('texto normal: registra a versão e marca a fonte como ok', async () => {
    simularFetch(PAGINA_LONGA);
    const { service, documents, falhas, sucessos } = montar(null);
    await service.runOnce({ onlySourceIds: ['s1'] });
    expect(documents.recordDetectedVersion).toHaveBeenCalledTimes(1);
    expect(sucessos()).toHaveLength(1);
    expect(falhas()).toHaveLength(0);
  });

  it('extração minúscula (caso real "EPI e custeio", 6 caracteres): NÃO cria pendente e registra falha visível', async () => {
    simularFetch(PAGINA_VAZIA);
    const { service, documents, falhas, sucessos } = montar(35754);
    await service.runOnce({ onlySourceIds: ['s1'] });
    expect(documents.recordDetectedVersion).not.toHaveBeenCalled();
    expect(sucessos()).toHaveLength(0);
    expect(falhas()).toHaveLength(1);
    expect(falhas()[0].params[1]).toMatch(/Conteúdo suspeito/);
    expect(falhas()[0].params[1]).toMatch(/confira a fonte/);
  });

  it('queda para menos de 20% da vigente também é barrada', async () => {
    simularFetch(PAGINA_LONGA); // ~640 caracteres de texto
    const { service, documents, falhas } = montar(100000);
    await service.runOnce({ onlySourceIds: ['s1'] });
    expect(documents.recordDetectedVersion).not.toHaveBeenCalled();
    expect(falhas()[0].params[1]).toMatch(/caiu para/);
  });

  it('sem versão vigente, texto pequeno mas acima do mínimo passa', async () => {
    simularFetch(`<html><body>${'x '.repeat(60)}</body></html>`);
    const { service, documents } = montar(null);
    await service.runOnce({ onlySourceIds: ['s1'] });
    expect(documents.recordDetectedVersion).toHaveBeenCalledTimes(1);
  });

  it('a barreira conta como falha da fonte: 1ª falha não envia e-mail', async () => {
    simularFetch(PAGINA_VAZIA);
    const { service, email } = montar(35754);
    await service.runOnce({ onlySourceIds: ['s1'] });
    expect(email.send).not.toHaveBeenCalled();
  });
});
