import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { CreateNormativeRuleDto } from '../src/normative/dto/create-normative-rule.dto';
import { ReviewNormativeRuleDto } from '../src/normative/dto/review-normative-rule.dto';
import { SetRuleProvisionsDto } from '../src/normative/dto/set-rule-provisions.dto';
import { UpdateNormativeRuleDto } from '../src/normative/dto/update-normative-rule.dto';
import { NormativeRulesController } from '../src/normative/normative-rules.controller';
import { ProvisionsController } from '../src/normative/provisions.controller';
import { Reflector } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';

const erros = async (Classe: any, dados: object) => (await validate(plainToInstance(Classe, dados))).map((e) => e.property);

const valida = {
  rule_key: 'NR15-A1-RUIDO',
  area: 'lip',
  categoria: 'insalubridade',
  agente_ou_atividade: 'Ruído',
  metodo_avaliacao: 'quantitativo',
  criterio: 'Ver dispositivo.',
  interpretacao: 'Rascunho.',
};

describe('DTOs de regra normativa (lip | gro_pgr | previdenciario | saude_ocupacional)', () => {
  it('cadastro válido não tem erros', async () => expect(await erros(CreateNormativeRuleDto, valida)).toEqual([]));

  it('rejeita categoria, método e rule_key inválidos', async () => {
    expect(await erros(CreateNormativeRuleDto, { ...valida, categoria: 'outra' })).toContain('categoria');
    expect(await erros(CreateNormativeRuleDto, { ...valida, metodo_avaliacao: 'chute' })).toContain('metodo_avaliacao');
    expect(await erros(CreateNormativeRuleDto, { ...valida, rule_key: 'minúscula com espaço' })).toContain('rule_key');
  });

  it('cadastro: area é obrigatória e só aceita as áreas conhecidas', async () => {
    const { area: _omitida, ...semArea } = valida;
    expect(await erros(CreateNormativeRuleDto, semArea)).toContain('area');
    expect(await erros(CreateNormativeRuleDto, { ...valida, area: 'outra' })).toContain('area');
    expect(await erros(CreateNormativeRuleDto, { ...valida, rule_key: 'PGR-INVENTARIO', area: 'gro_pgr', categoria: 'inventario' })).toEqual([]);
  });

  it('cadastro: area previdenciario e suas 7 categorias são valores conhecidos', async () => {
    for (const categoria of ['aposentadoria_especial', 'ltcat', 'ppp', 'agentes_nocivos', 'esocial', 'cruzamento_documental', 'exposicao']) {
      expect(await erros(CreateNormativeRuleDto, { ...valida, rule_key: 'PREV-X', area: 'previdenciario', categoria })).toEqual([]);
    }
  });

  it('cadastro: area saude_ocupacional e suas 7 categorias são valores conhecidos', async () => {
    for (const categoria of ['pcmso', 'exames_ocupacionais', 'aso', 'relatorio_analitico', 'excecao', 'privacidade_dados', 'cruzamento_documental_saude']) {
      expect(await erros(CreateNormativeRuleDto, { ...valida, rule_key: 'SAUDE-X', area: 'saude_ocupacional', categoria })).toEqual([]);
    }
    // A área não é categoria.
    expect(await erros(CreateNormativeRuleDto, { ...valida, categoria: 'saude_ocupacional' })).toContain('categoria');
  });

  it('cadastro: categorias GRO/PGR são valores conhecidos (a coerência com a área é validada no serviço e no banco)', async () => {
    for (const categoria of ['identificacao_perigos', 'avaliacao_riscos', 'controle_riscos', 'plano_acao', 'inventario', 'revisao', 'excecao', 'psicossocial', 'estrutura_pgr']) {
      expect(await erros(CreateNormativeRuleDto, { ...valida, area: 'gro_pgr', categoria })).toEqual([]);
    }
  });

  it('edição: tudo opcional e o que vier é validado', async () => {
    expect(await erros(UpdateNormativeRuleDto, {})).toEqual([]);
    expect(await erros(UpdateNormativeRuleDto, { categoria: 'x' })).toContain('categoria');
  });

  // Mesmo pipe que o controller usa: campo fora do DTO é rejeitado (não só ignorado).
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const corpo = (Classe: any, dados: object) => pipe.transform(dados, { type: 'body', metatype: Classe });

  it.each([{ status: 'revisada' }, { rule_key: 'X' }, { reviewed_by_user_id: 'u' }, { area: 'gro_pgr' }, { area: 'lip' }, { area: 'previdenciario' }, { area: 'saude_ocupacional' }])(
    'edição: %p não existe no DTO → 400',
    async (dados) => {
      await expect(corpo(UpdateNormativeRuleDto, dados)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each(['categoria', 'agente_ou_atividade', 'metodo_avaliacao', 'criterio', 'interpretacao', 'exige_revisao_profissional', 'dependencias'])(
    'edição: %s = null (coluna NOT NULL) → 400',
    async (campo) => {
      await expect(corpo(UpdateNormativeRuleDto, { [campo]: null })).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('edição: unidade/excecoes/vigência podem ser null (colunas anuláveis); campo válido passa', async () => {
    await expect(corpo(UpdateNormativeRuleDto, { unidade: null, excecoes: null, vigencia_inicio: null, vigencia_fim: null })).resolves.toBeDefined();
    await expect(corpo(UpdateNormativeRuleDto, { criterio: 'Novo critério.' })).resolves.toMatchObject({ criterio: 'Novo critério.' });
  });

  it('dependencias: null → 400 no cadastro; no máximo 50 itens nos dois DTOs', async () => {
    await expect(corpo(CreateNormativeRuleDto, { ...valida, dependencias: null })).rejects.toBeInstanceOf(BadRequestException);
    const muitas = Array.from({ length: 51 }, (_, i) => `D${i}`);
    expect(await erros(CreateNormativeRuleDto, { ...valida, dependencias: muitas })).toContain('dependencias');
    expect(await erros(UpdateNormativeRuleDto, { dependencias: muitas })).toContain('dependencias');
    expect(await erros(CreateNormativeRuleDto, { ...valida, dependencias: muitas.slice(0, 50) })).toEqual([]);
  });

  it('vínculos: papel válido, uuid, lista não vazia', async () => {
    const ok = { links: [{ provision_id: '3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b', papel: 'fundamento' }] };
    expect(await erros(SetRuleProvisionsDto, ok)).toEqual([]);
    expect(await erros(SetRuleProvisionsDto, { links: [] })).toContain('links');
    expect(await erros(SetRuleProvisionsDto, { links: [{ provision_id: 'x', papel: 'fundamento' }] })).toContain('links');
  });

  it('revisão exige registro profissional', async () => {
    expect(await erros(ReviewNormativeRuleDto, {})).toContain('registro');
    expect(await erros(ReviewNormativeRuleDto, { registro: 'CREA 0000' })).toEqual([]);
  });
});

describe('NormativeRulesController — rota e filtro', () => {
  it('fica em /normative-rules e repassa ?area= ao serviço', async () => {
    expect(Reflect.getMetadata('path', NormativeRulesController)).toBe('normative-rules');
    const list = jest.fn(async () => []);
    const ctrl = new NormativeRulesController({ list } as any);
    const req = { withTenantContext: (fn: (c: unknown) => unknown) => fn('cliente') };
    await ctrl.list('gro_pgr', 'inventario', 'rascunho', req);
    expect(list).toHaveBeenCalledWith('cliente', { area: 'gro_pgr', categoria: 'inventario', status: 'rascunho' });
  });
});

describe('controllers — somente admin', () => {
  const reflector = new Reflector();
  const rotas = (Classe: any) =>
    Object.getOwnPropertyNames(Classe.prototype).filter((n) => n !== 'constructor');

  it.each([ProvisionsController, NormativeRulesController])('%p: toda rota é @Roles("admin")', (Classe: any) => {
    expect(rotas(Classe).length).toBeGreaterThan(0);
    for (const nome of rotas(Classe)) {
      expect(reflector.get(ROLES_KEY, Classe.prototype[nome])).toEqual(['admin']);
    }
  });
});
