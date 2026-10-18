import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { NormativeRulesService } from '../src/normative/normative-rules.service';

type Call = { sql: string; params: any[] };

function montar(opts: { rule?: object | null; ativos?: number; provisoesValidas?: string[] } = {}) {
  const calls: Call[] = [];
  const rule = opts.rule === undefined ? { id: 'r1', status: 'rascunho', area: 'lip' } : opts.rule;
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM normative_rules WHERE id')) return { rows: rule ? [rule] : [] };
      if (sql.includes('COUNT(*)')) return { rows: [{ n: String(opts.ativos ?? 0) }] };
      if (sql.includes('FROM normative_provisions WHERE id = ANY')) {
        return { rows: (opts.provisoesValidas ?? []).map((id) => ({ id })) };
      }
      if (sql.includes('UPDATE normative_rules') || sql.includes('INSERT INTO normative_rules')) return { rows: [{ id: 'r1', status: 'x' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  };
  const com = (t: string) => calls.filter((c) => c.sql.includes(t));
  return { client, calls, com, service: new NormativeRulesService() };
}

const NOVA = {
  rule_key: 'NR15-A1-RUIDO',
  area: 'lip',
  categoria: 'insalubridade',
  agente_ou_atividade: 'Ruído contínuo ou intermitente',
  metodo_avaliacao: 'quantitativo',
  criterio: 'Ver dispositivo vinculado do Anexo 1.',
  interpretacao: 'Rascunho de interpretação.',
} as const;

describe('NormativeRulesService.create', () => {
  it('sempre nasce como rascunho, com exige_revisao_profissional true por padrão', async () => {
    const { service, client, com } = montar();
    await service.create(client, { ...NOVA });
    const ins = com('INSERT INTO normative_rules')[0];
    expect(ins.sql).toMatch(/'rascunho'/);
    expect(ins.params).toContain('NR15-A1-RUIDO');
    expect(ins.params).toContain(true);
  });

  it('grava a área informada (lip e gro_pgr)', async () => {
    const a = montar();
    await a.service.create(a.client, { ...NOVA });
    expect(a.com('INSERT INTO normative_rules')[0].sql).toMatch(/\(rule_key, area, categoria,/);
    expect(a.com('INSERT INTO normative_rules')[0].params.slice(0, 3)).toEqual(['NR15-A1-RUIDO', 'lip', 'insalubridade']);
    const g = montar();
    await g.service.create(g.client, { ...NOVA, rule_key: 'PGR-COMPOSICAO', area: 'gro_pgr', categoria: 'inventario' });
    expect(g.com('INSERT INTO normative_rules')[0].params.slice(0, 3)).toEqual(['PGR-COMPOSICAO', 'gro_pgr', 'inventario']);
  });

  it.each(['aposentadoria_especial', 'ltcat', 'ppp', 'agentes_nocivos', 'esocial', 'cruzamento_documental', 'exposicao'])(
    'área previdenciario aceita a categoria %s',
    async (categoria) => {
      const p = montar();
      await p.service.create(p.client, { ...NOVA, rule_key: 'PREV-X', area: 'previdenciario' as any, categoria: categoria as any });
      expect(p.com('INSERT INTO normative_rules')[0].params.slice(0, 3)).toEqual(['PREV-X', 'previdenciario', categoria]);
    },
  );

  it.each(['pcmso', 'exames_ocupacionais', 'aso', 'relatorio_analitico', 'excecao', 'privacidade_dados', 'cruzamento_documental_saude'])(
    'área saude_ocupacional aceita a categoria %s',
    async (categoria) => {
      const s = montar();
      await s.service.create(s.client, { ...NOVA, rule_key: 'SAUDE-X', area: 'saude_ocupacional' as any, categoria: categoria as any });
      expect(s.com('INSERT INTO normative_rules')[0].params.slice(0, 3)).toEqual(['SAUDE-X', 'saude_ocupacional', categoria]);
    },
  );

  it.each([
    ['gro_pgr', 'insalubridade'],
    ['gro_pgr', 'previdenciario'],
    ['lip', 'psicossocial'],
    ['lip', 'inventario'],
    ['lip', 'estrutura_pgr'],
    ['outra', 'insalubridade'],
    ['previdenciario', 'insalubridade'],
    ['previdenciario', 'previdenciario'],
    ['previdenciario', 'inventario'],
    ['lip', 'ltcat'],
    ['lip', 'aposentadoria_especial'],
    ['gro_pgr', 'ppp'],
    ['gro_pgr', 'exposicao'],
    ['saude_ocupacional', 'ltcat'],
    ['saude_ocupacional', 'insalubridade'],
    ['saude_ocupacional', 'inventario'],
    ['saude_ocupacional', 'saude_ocupacional'],
    ['previdenciario', 'aso'],
    ['previdenciario', 'cruzamento_documental_saude'],
    ['lip', 'aso'],
    ['lip', 'pcmso'],
    ['gro_pgr', 'aso'],
    ['gro_pgr', 'privacidade_dados'],
  ])('area %s × categoria %s incoerente → 400 ANTES de tocar o banco', async (area, categoria) => {
    const { service, client } = montar();
    const err = await service.create(client, { ...NOVA, area: area as any, categoria: categoria as any }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/categoria|area inválida/);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('rule_key duplicada (23505) → 409 com mensagem clara; outros erros sobem intactos', async () => {
    const dup: any = { query: jest.fn(async () => Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }))) };
    const err = await new NormativeRulesService().create(dup, { ...NOVA }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('Já existe uma regra com esta rule_key');
    const outro = new Error('conexão caiu');
    const falha: any = { query: jest.fn(async () => Promise.reject(outro)) };
    await expect(new NormativeRulesService().create(falha, { ...NOVA })).rejects.toBe(outro);
  });
});

describe('NormativeRulesService.update', () => {
  it('regra inexistente → 404; retirada → 409', async () => {
    const vazio = montar({ rule: null });
    await expect(vazio.service.update(vazio.client, 'x', { criterio: 'a' })).rejects.toBeInstanceOf(NotFoundException);
    const m = montar({ rule: { id: 'r1', status: 'retirada' } });
    await expect(m.service.update(m.client, 'r1', { criterio: 'a' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('editar uma regra revisada a devolve para "revisar"; rascunho continua rascunho', async () => {
    const a = montar({ rule: { id: 'r1', status: 'revisada' } });
    await a.service.update(a.client, 'r1', { criterio: 'novo' });
    expect(a.com('UPDATE normative_rules')[0].sql).toMatch(/status = 'revisar'/);
    const b = montar({ rule: { id: 'r1', status: 'rascunho' } });
    await b.service.update(b.client, 'r1', { criterio: 'novo' });
    expect(b.com('UPDATE normative_rules')[0].sql).not.toMatch(/status = 'revisar'/);
  });

  it('categoria só pode mudar dentro da área da regra (400 antes do UPDATE); área nunca entra no UPDATE', async () => {
    const lip = montar({ rule: { id: 'r1', status: 'rascunho', area: 'lip' } });
    await expect(lip.service.update(lip.client, 'r1', { categoria: 'psicossocial' as any })).rejects.toBeInstanceOf(BadRequestException);
    expect(lip.com('UPDATE normative_rules')).toHaveLength(0);
    const gro = montar({ rule: { id: 'r1', status: 'rascunho', area: 'gro_pgr' } });
    await expect(gro.service.update(gro.client, 'r1', { categoria: 'insalubridade' as any })).rejects.toBeInstanceOf(BadRequestException);
    expect(gro.com('UPDATE normative_rules')).toHaveLength(0);
    const prev = montar({ rule: { id: 'r1', status: 'rascunho', area: 'previdenciario' } });
    await expect(prev.service.update(prev.client, 'r1', { categoria: 'insalubridade' as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(prev.service.update(prev.client, 'r1', { categoria: 'inventario' as any })).rejects.toBeInstanceOf(BadRequestException);
    expect(prev.com('UPDATE normative_rules')).toHaveLength(0);
    const prevOk = montar({ rule: { id: 'r1', status: 'rascunho', area: 'previdenciario' } });
    await prevOk.service.update(prevOk.client, 'r1', { categoria: 'ppp' as any });
    expect(prevOk.com('UPDATE normative_rules')[0].params).toContain('ppp');
    const saude = montar({ rule: { id: 'r1', status: 'rascunho', area: 'saude_ocupacional' } });
    await expect(saude.service.update(saude.client, 'r1', { categoria: 'ltcat' as any })).rejects.toBeInstanceOf(BadRequestException);
    expect(saude.com('UPDATE normative_rules')).toHaveLength(0);
    const saudeOk = montar({ rule: { id: 'r1', status: 'rascunho', area: 'saude_ocupacional' } });
    await saudeOk.service.update(saudeOk.client, 'r1', { categoria: 'aso' as any });
    expect(saudeOk.com('UPDATE normative_rules')[0].params).toContain('aso');
    const ok = montar({ rule: { id: 'r1', status: 'rascunho', area: 'gro_pgr' } });
    await ok.service.update(ok.client, 'r1', { categoria: 'plano_acao' as any, ['area' as any]: 'lip' });
    const sql = ok.com('UPDATE normative_rules')[0].sql;
    expect(sql).toMatch(/categoria = \$/);
    expect(sql).not.toMatch(/area = \$/);
    expect(ok.com('UPDATE normative_rules')[0].params).not.toContain('lip');
  });

  it('só colunas da lista branca entram no UPDATE', async () => {
    const { service, client, com } = montar();
    await service.update(client, 'r1', { criterio: 'x', ['status' as any]: 'revisada', ['reviewed_by_user_id' as any]: 'u' });
    const sql = com('UPDATE normative_rules')[0].sql;
    expect(sql).toMatch(/criterio = \$/);
    expect(sql).not.toMatch(/reviewed_by_user_id = \$/);
    expect(sql).not.toMatch(/status = \$/);
    expect(com('UPDATE normative_rules')[0].params).not.toContain('revisada');
  });
});

describe('NormativeRulesService.list', () => {
  it('filtra por área, categoria e status (parametrizado)', async () => {
    const { service, client, calls } = montar();
    await service.list(client, { area: 'gro_pgr', categoria: 'inventario', status: 'rascunho' });
    expect(calls[0].sql).toMatch(/FROM normative_rules WHERE area = \$1 AND categoria = \$2 AND status = \$3/);
    expect(calls[0].params).toEqual(['gro_pgr', 'inventario', 'rascunho']);
  });

  it('sem filtro lista tudo; área inválida → 400 sem consultar', async () => {
    const a = montar();
    await a.service.list(a.client, {});
    expect(a.calls[0].sql).not.toMatch(/WHERE/);
    const b = montar();
    await expect(b.service.list(b.client, { area: 'xpto' })).rejects.toBeInstanceOf(BadRequestException);
    expect(b.client.query).not.toHaveBeenCalled();
  });
});

describe('NormativeRulesService.setProvisions', () => {
  it('rejeita dispositivo inexistente/obsoleto (só ativos valem)', async () => {
    const { service, client } = montar({ provisoesValidas: ['p1'] });
    await expect(
      service.setProvisions(client, 'r1', [
        { provision_id: 'p1', papel: 'fundamento' },
        { provision_id: 'p2', papel: 'criterio' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('substitui os vínculos; em regra revisada devolve para "revisar"', async () => {
    const { service, client, com } = montar({ rule: { id: 'r1', status: 'revisada' }, provisoesValidas: ['p1'] });
    await service.setProvisions(client, 'r1', [{ provision_id: 'p1', papel: 'fundamento' }]);
    expect(com('DELETE FROM normative_rule_provisions')).toHaveLength(1);
    expect(com('INSERT INTO normative_rule_provisions')).toHaveLength(1);
    expect(com('UPDATE normative_rules')[0].sql).toMatch(/status = 'revisar'/);
  });
});

describe('NormativeRulesService.review', () => {
  it('a leitura da regra trava a linha (FOR UPDATE)', async () => {
    const { service, client, calls } = montar({ ativos: 1 });
    await service.review(client, 'r1', 'u1', 'CREA 0000');
    expect(calls[0].sql).toMatch(/FOR UPDATE/);
  });

  it('sem dispositivo ativo vinculado → 400 e nada é atualizado', async () => {
    const { service, client, com } = montar({ ativos: 0 });
    await expect(service.review(client, 'r1', 'u1', 'CREA 0000')).rejects.toBeInstanceOf(BadRequestException);
    expect(com('UPDATE normative_rules')).toHaveLength(0);
  });

  it('registro profissional vazio → 400', async () => {
    const { service, client } = montar({ ativos: 2 });
    await expect(service.review(client, 'r1', 'u1', '   ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('só rascunho ou revisar podem ser revisadas', async () => {
    for (const status of ['revisada', 'retirada']) {
      const m = montar({ rule: { id: 'r1', status }, ativos: 1 });
      await expect(m.service.review(m.client, 'r1', 'u1', 'CREA 0000')).rejects.toBeInstanceOf(ConflictException);
    }
  });

  it('caminho feliz: grava revisor, data e registro', async () => {
    const { service, client, com } = montar({ ativos: 1 });
    await service.review(client, 'r1', 'u1', ' CREA 0000 ');
    const up = com('UPDATE normative_rules')[0];
    expect(up.sql).toMatch(/status = 'revisada'/);
    expect(up.params).toEqual(['r1', 'u1', 'CREA 0000']);
  });
});

describe('NormativeRulesService.retire', () => {
  it('retira; retirar de novo → 409', async () => {
    const a = montar();
    await a.service.retire(a.client, 'r1');
    expect(a.com('UPDATE normative_rules')[0].sql).toMatch(/status = 'retirada'/);
    const b = montar({ rule: { id: 'r1', status: 'retirada' } });
    await expect(b.service.retire(b.client, 'r1')).rejects.toBeInstanceOf(ConflictException);
  });
});
