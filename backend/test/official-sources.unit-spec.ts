import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

jest.mock('dns/promises', () => ({ lookup: jest.fn(async () => [{ address: '200.10.10.10', family: 4 }]) }));

import { CreateOfficialSourceDto } from '../src/normative/dto/create-official-source.dto';
import { PreviewSourceDto } from '../src/normative/dto/preview-source.dto';
import { UpdateOfficialSourceDto } from '../src/normative/dto/update-official-source.dto';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { OfficialSourcesController } from '../src/normative/official-sources.controller';
import { OfficialSourcesService } from '../src/normative/official-sources.service';

const erros = async (Classe: any, dados: object) => (await validate(plainToInstance(Classe, dados))).map((e) => e.property);

describe('DTOs de fonte', () => {
  it('cadastro exige http/https', async () => {
    expect(await erros(CreateOfficialSourceDto, { entity: 'MTE', title: 'T', official_url: 'ftp://x.gov.br/a' })).toContain('official_url');
    expect(await erros(CreateOfficialSourceDto, { entity: 'MTE', title: 'T', official_url: 'não é url' })).toContain('official_url');
    expect(await erros(CreateOfficialSourceDto, { entity: 'MTE', title: 'T', official_url: 'https://x.gov.br/a' })).toEqual([]);
  });

  it('edição: tudo opcional, mas o que vier é validado', async () => {
    expect(await erros(UpdateOfficialSourceDto, {})).toEqual([]);
    expect(await erros(UpdateOfficialSourceDto, { active: false })).toEqual([]);
    expect(await erros(UpdateOfficialSourceDto, { official_url: 'ftp://x/a' })).toContain('official_url');
    expect(await erros(UpdateOfficialSourceDto, { title: '' })).toContain('title');
    expect(await erros(UpdateOfficialSourceDto, { active: 'sim' })).toContain('active');
  });

  it('título só com espaços é rejeitado (cadastro e edição)', async () => {
    expect(await erros(CreateOfficialSourceDto, { entity: 'MTE', title: '   ', official_url: 'https://x.gov.br/a' })).toContain('title');
    expect(await erros(UpdateOfficialSourceDto, { title: '   ' })).toContain('title');
  });

  it('mensagens de validação em português', async () => {
    const msgs = async (Classe: any, dados: object) =>
      (await validate(plainToInstance(Classe, dados))).flatMap((e) => Object.values(e.constraints ?? {}));
    expect(await msgs(CreateOfficialSourceDto, { entity: '', title: '', official_url: 'x' })).toEqual(
      expect.arrayContaining([
        'Informe a entidade',
        'Informe o título',
        'Informe uma URL válida começando com http:// ou https://',
      ]),
    );
    expect(await msgs(UpdateOfficialSourceDto, { active: 'sim' })).toContain('O campo ativa deve ser verdadeiro ou falso');
    expect(await msgs(PreviewSourceDto, { official_url: 'x' })).toContain('Informe uma URL válida começando com http:// ou https://');
  });

  it('code: cadastro com vazio/espaços vira undefined; com valor é aparado; edição apara', () => {
    const base = { entity: 'MTE', title: 'T', official_url: 'https://x.gov.br/a' };
    expect(plainToInstance(CreateOfficialSourceDto, { ...base, code: '' }).code).toBeUndefined();
    expect(plainToInstance(CreateOfficialSourceDto, { ...base, code: '   ' }).code).toBeUndefined();
    expect(plainToInstance(CreateOfficialSourceDto, { ...base, code: ' NR-06 ' }).code).toBe('NR-06');
    expect(plainToInstance(UpdateOfficialSourceDto, { code: ' NR-06 ' }).code).toBe('NR-06');
    expect(plainToInstance(UpdateOfficialSourceDto, { code: '   ' }).code).toBe('');
  });

  it('pré-visualização exige http/https', async () => {
    expect(await erros(PreviewSourceDto, { official_url: 'file:///etc/passwd' })).toContain('official_url');
    expect(await erros(PreviewSourceDto, { official_url: 'https://x.gov.br/a' })).toEqual([]);
  });
});

function clienteFalso(respostas: (sql: string, params: any[]) => any) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      return respostas(sql, params) ?? { rows: [] };
    }),
  };
  return { client, consultas };
}

describe('OfficialSourcesService.update', () => {
  const service = new OfficialSourcesService();
  const fonte = { id: 'f1', entity: 'MTE', code: 'NR-06', title: 'EPI', official_url: 'https://a.gov.br/x', active: true };

  it('sem campos: devolve a fonte atual sem UPDATE', async () => {
    const { client, consultas } = clienteFalso((sql) => (sql.startsWith('SELECT') ? { rows: [fonte] } : undefined));
    expect(await service.update(client, 'f1', {})).toEqual(fonte);
    expect(consultas.some((c) => c.sql.includes('UPDATE'))).toBe(false);
  });

  it('só os campos enviados entram no UPDATE; código vazio limpa (NULL)', async () => {
    const { client, consultas } = clienteFalso((sql) => (sql.includes('UPDATE') ? { rows: [fonte] } : undefined));
    await service.update(client, 'f1', { title: 'Novo', code: '  ', active: false });
    const upd = consultas.find((c) => c.sql.includes('UPDATE'))!;
    expect(upd.sql).toContain('title = $2');
    expect(upd.sql).toContain('code = $3');
    expect(upd.sql).toContain('active = $4');
    expect(upd.sql).not.toContain('official_url');
    expect(upd.params).toEqual(['f1', 'Novo', null, false]);
  });

  it('trocar a URL zera o estado da última verificação (só se a URL de fato mudou)', async () => {
    const { client, consultas } = clienteFalso((sql) => (sql.includes('UPDATE') ? { rows: [fonte] } : undefined));
    await service.update(client, 'f1', { official_url: 'https://b.gov.br/y' });
    const upd = consultas.find((c) => c.sql.includes('UPDATE'))!;
    expect(upd.sql).toMatch(/consecutive_failures = CASE WHEN official_url IS DISTINCT FROM \$2 THEN 0/);
    expect(upd.sql).toMatch(/last_error = CASE WHEN official_url IS DISTINCT FROM \$2 THEN NULL/);
    expect(upd.sql).toMatch(/last_check_status = CASE/);
    expect(upd.sql).toMatch(/last_checked_at = CASE/);
    expect(upd.sql).toContain('official_url = $2');
    expect(upd.params).toEqual(['f1', 'https://b.gov.br/y']);
  });

  it('fonte inexistente: devolve null', async () => {
    const { client } = clienteFalso(() => ({ rows: [] }));
    expect(await service.update(client, 'x', { title: 'a' })).toBeNull();
  });
});

describe('OfficialSourcesService.findByUrl', () => {
  it('compara a URL normalizada (minúsculas, sem # e sem barra final)', async () => {
    const service = new OfficialSourcesService();
    const { client, consultas } = clienteFalso(() => ({ rows: [{ id: 'f9', title: 'Outra', code: null }] }));
    const achou = await service.findByUrl(client, 'HTTPS://Exemplo.GOV.br/Norma/#topo');
    expect(achou).toEqual({ id: 'f9', title: 'Outra', code: null });
    expect(consultas[0].params).toEqual(['https://exemplo.gov.br/norma']);
  });
});

describe('OfficialSourcesController', () => {
  function montar() {
    const sources: any = {
      create: jest.fn(async (_c: any, dto: any) => ({ id: 'novo', ...dto })),
      update: jest.fn(async () => ({ id: 'f1', title: 'ok' })),
      findByUrl: jest.fn(async () => null),
      findAll: jest.fn(async () => []),
    };
    const monitor: any = {
      checkSource: jest.fn(async () => ({ outcome: 'sem_mudanca', message: 'm' })),
      previewUrl: jest.fn(async () => ({ ok: true, status_code: 200, mime_type: 'text/html', chars: 500, meaningful_chars: 500, sample: 's', suspicious: null })),
    };
    const req: any = { withTenantContext: (fn: any) => fn({}) };
    return { controller: new OfficialSourcesController(sources, monitor), sources, monitor, req };
  }
  const ID = '123e4567-e89b-42d3-a456-426614174000';

  it('POST: bloqueia URL interna ANTES de gravar (400)', async () => {
    const { controller, sources, req } = montar();
    await expect(controller.create({ entity: 'MTE', title: 'T', official_url: 'http://127.0.0.1/x' } as any, req)).rejects.toThrow(BadRequestException);
    expect(sources.create).not.toHaveBeenCalled();
  });

  it('POST: URL pública grava normalmente', async () => {
    const { controller, sources, req } = montar();
    await controller.create({ entity: 'MTE', title: 'T', official_url: 'https://www.gov.br/x' } as any, req);
    expect(sources.create).toHaveBeenCalledTimes(1);
  });

  it('PATCH: bloqueia URL interna (400) e não grava', async () => {
    const { controller, sources, req } = montar();
    await expect(controller.update(ID, { official_url: 'http://169.254.169.254/x' } as any, req)).rejects.toThrow(/não público/);
    expect(sources.update).not.toHaveBeenCalled();
  });

  it('PATCH sem URL (ex.: desativar) não consulta a guarda e grava', async () => {
    const { controller, sources, req } = montar();
    await controller.update(ID, { active: false } as any, req);
    expect(sources.update).toHaveBeenCalledWith({}, ID, { active: false });
  });

  it('PATCH de fonte inexistente: 404', async () => {
    const { controller, sources, req } = montar();
    sources.update.mockResolvedValue(null);
    await expect(controller.update(ID, { active: true } as any, req)).rejects.toThrow(NotFoundException);
  });

  it('POST/PATCH: código duplicado (23505) vira 409; outros erros são relançados', async () => {
    const { controller, sources, req } = montar();
    sources.create.mockRejectedValue({ code: '23505' });
    await expect(controller.create({ entity: 'MTE', title: 'T', official_url: 'https://www.gov.br/x' } as any, req)).rejects.toThrow(ConflictException);
    sources.update.mockRejectedValue({ code: '23505' });
    await expect(controller.update(ID, { code: 'NR-06' } as any, req)).rejects.toThrow('Já existe uma fonte com este código');
    sources.update.mockRejectedValue(new Error('boom'));
    await expect(controller.update(ID, { code: 'NR-06' } as any, req)).rejects.toThrow('boom');
  });

  it('check-now delega ao monitor', async () => {
    const { controller, monitor } = montar();
    expect(await controller.checkNow(ID)).toEqual({ outcome: 'sem_mudanca', message: 'm' });
    expect(monitor.checkSource).toHaveBeenCalledWith(ID);
  });

  it('preview devolve o resultado do monitor + a fonte duplicada, se houver', async () => {
    const { controller, sources, monitor, req } = montar();
    sources.findByUrl.mockResolvedValue({ id: 'f2', title: 'Já existe', code: 'NR-06' });
    const r: any = await controller.preview({ official_url: 'https://www.gov.br/x' } as any, req);
    expect(monitor.previewUrl).toHaveBeenCalledWith('https://www.gov.br/x');
    expect(r.ok).toBe(true);
    expect(r.duplicate_of).toEqual({ id: 'f2', title: 'Já existe', code: 'NR-06' });
  });

  it('preview de URL interna: 400 e nenhuma leitura', async () => {
    const { controller, monitor, req } = montar();
    await expect(controller.preview({ official_url: 'http://localhost/x' } as any, req)).rejects.toThrow(BadRequestException);
    expect(monitor.previewUrl).not.toHaveBeenCalled();
  });
});

describe('OfficialSourcesController: autorização', () => {
  it.each(['create', 'findAll', 'preview', 'update', 'checkNow'])('rota %s exige o papel admin', (nome) => {
    const roles = new Reflector().get<string[]>(ROLES_KEY, (OfficialSourcesController.prototype as any)[nome]);
    expect(roles).toContain('admin');
  });
});
