import { EsocialEventsController } from '../src/esocial/events/esocial-events.controller';

// Ligação do mascaramento por papel no controller (o e2e cobre o fluxo real; aqui o texto com CPF é forçado).
const ASO = '11111111-1111-4111-8111-111111111111';
const EV = '22222222-2222-4222-8222-222222222222';
const withCpf = { ok: false, issues: [{ code: 'X', message: 'Trabalhador 529.982.247-25 / 52998224725' }] };

function make() {
  const service = {
    diagnose: jest.fn().mockResolvedValue(withCpf),
    list: jest.fn().mockResolvedValue([{ id: EV, employee_id: ASO, erro_mensagem: 'CPF 52998224725' }]),
    get: jest.fn().mockResolvedValue({ id: EV, retorno_json: { ocorrencias: [{ descricao: 'CPF 52998224725' }] }, history: [] }),
  };
  return { ctl: new EsocialEventsController(service as any), service };
}
const req = (role: string) => ({ user: { role }, withTenantContext: (fn: any) => Promise.resolve(fn({})) });

describe('EsocialEventsController: CPF por papel', () => {
  it('técnico: diagnóstico, lista e detalhe saem mascarados; ids intactos', async () => {
    const { ctl } = make();
    const d: any = await ctl.diagnose(ASO, undefined, undefined, req('tecnico'));
    expect(d.issues[0].message).toBe('Trabalhador ***.982.247-** / ***.982.247-**');
    const l: any = await ctl.list(req('tecnico'));
    expect(l[0]).toEqual({ id: EV, employee_id: ASO, erro_mensagem: 'CPF ***.982.247-**' });
    const g: any = await ctl.get(EV, req('tecnico'));
    expect(JSON.stringify(g)).not.toContain('52998224725');
    expect(g.id).toBe(EV);
  });

  it.each([['empresa'], ['admin']])('%s recebe o conteúdo original', async (role) => {
    const { ctl } = make();
    expect(await ctl.diagnose(ASO, undefined, undefined, req(role))).toEqual(withCpf);
    expect(JSON.stringify(await ctl.get(EV, req(role)))).toContain('52998224725');
  });
});
