import { Test } from '@nestjs/testing';
import {
  PenteFinoComparisonService,
  buildFunctionReport,
  StoredRow,
} from '../src/pente-fino/pente-fino-comparison.service';
import { PenteFinoExtractorService } from '../src/pente-fino/pente-fino-extractor.service';
import { FUNCTION_EXTRACTION_PROVIDER } from '../src/pente-fino/function-extraction-provider.interface';
import { R2Service } from '../src/common/r2/r2.service';
import { DatabaseService } from '../src/common/database/database.service';

describe('buildFunctionReport', () => {
  const positions = [{ id: 'pos-1', name: 'Soldador' }];

  function risk(overrides: Partial<StoredRow> = {}): StoredRow {
    return { position_id: 'pos-1', function_text_raw: 'Soldador', description: 'Fumos metálicos', source_excerpt: 'trecho', ...overrides };
  }
  function exam(overrides: Partial<StoredRow> = {}): StoredRow {
    return { position_id: 'pos-1', function_text_raw: 'Soldador', description: 'Exame respiratório', source_excerpt: 'trecho', ...overrides };
  }

  it('função com risco e exame casados por position_id vira status ok', () => {
    const report = buildFunctionReport([risk()], [exam()], positions);
    expect(report).toEqual([
      expect.objectContaining({ position_id: 'pos-1', position_name: 'Soldador', status: 'ok' }),
    ]);
  });

  it('função só com risco vira risco_sem_exame', () => {
    const report = buildFunctionReport([risk()], [], positions);
    expect(report[0].status).toBe('risco_sem_exame');
  });

  it('função só com exame vira exame_sem_risco', () => {
    const report = buildFunctionReport([], [exam()], positions);
    expect(report[0].status).toBe('exame_sem_risco');
  });

  it('função sem position_id (não bateu com cargo cadastrado) vira nome_sem_correspondencia, mesmo com risco e exame', () => {
    const report = buildFunctionReport(
      [risk({ position_id: null, function_text_raw: 'Ajudante' })],
      [exam({ position_id: null, function_text_raw: 'Ajudante' })],
      [],
    );
    expect(report[0].status).toBe('nome_sem_correspondencia');
  });

  it('duas funções sem position_id mas com texto normalizado diferente viram grupos separados', () => {
    const report = buildFunctionReport(
      [risk({ position_id: null, function_text_raw: 'Ajudante Geral' })],
      [exam({ position_id: null, function_text_raw: 'Auxiliar de Limpeza' })],
      [],
    );
    expect(report).toHaveLength(2);
  });

  it('duas funções sem position_id mas com texto normalizado IGUAL viram um grupo só', () => {
    const report = buildFunctionReport(
      [risk({ position_id: null, function_text_raw: 'AJUDANTE GERAL' })],
      [exam({ position_id: null, function_text_raw: 'ajudante geral' })],
      [],
    );
    expect(report).toHaveLength(1);
    expect(report[0].status).toBe('nome_sem_correspondencia');
  });
});

// Mesmo padrão de fakes por DI de pente-fino-extractor.unit-spec.ts, só que
// aqui o PenteFinoExtractorService entra de VERDADE (é a lógica real de
// matchPosition que está sob teste) e quem é fakeado é o DatabaseService —
// assim dá pra exercitar ensureExtracted inteiro sem Postgres.
describe('PenteFinoComparisonService — reaproveitamento de extração já persistida', () => {
  const pgrDoc = {
    id: 'doc-pgr',
    tenant_id: 'tenant-1',
    title: 'PGR Teste',
    file_key: 'key-pgr',
    mime_type: 'application/pdf',
  };

  async function buildService(options: {
    positions: { id: string; name: string }[];
    cachedRows: StoredRow[];
  }): Promise<{ service: PenteFinoComparisonService; extractRows: jest.Mock }> {
    const fakeClient = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("category = 'pgr'")) return { rows: [pgrDoc] };
        if (sql.includes("category = 'pcmso'")) return { rows: [] };
        if (sql.includes('FROM positions')) return { rows: options.positions };
        if (sql.includes('FROM pgr_function_risks')) return { rows: options.cachedRows };
        throw new Error(`query inesperada no fake: ${sql}`);
      }),
    };
    const fakeDb = { withTenantContext: jest.fn((_ctx: unknown, fn: any) => fn(fakeClient)) };
    const extractRows = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PenteFinoComparisonService,
        PenteFinoExtractorService,
        { provide: DatabaseService, useValue: fakeDb },
        { provide: R2Service, useValue: { getObject: jest.fn() } },
        { provide: FUNCTION_EXTRACTION_PROVIDER, useValue: { extract: jest.fn() } },
      ],
    }).compile();

    const extractor = moduleRef.get(PenteFinoExtractorService);
    // Se o caminho de cache falhar e cair na extração de verdade, o teste
    // quebra aqui em vez de passar silenciosamente por outro motivo.
    extractor.extractRows = extractRows.mockRejectedValue(
      new Error('extractRows não deveria ser chamado quando já existe extração persistida'),
    );

    return { service: moduleRef.get(PenteFinoComparisonService), extractRows };
  }

  const empresaUser = { id: 'user-1', tenantId: 'tenant-1', role: 'empresa' };

  function cachedRow(overrides: Partial<StoredRow> = {}): StoredRow {
    return {
      position_id: null,
      function_text_raw: 'Soldador',
      description: 'Fumos metálicos',
      source_excerpt: 'trecho pgr',
      ...overrides,
    };
  }

  // O caso que o Finding #3 descreve: a extração rodou quando o cargo
  // "Soldador" ainda não existia (position_id gravado como NULL), o técnico
  // cadastrou o cargo depois e rodou o Pente-Fino de novo.
  it('re-casa position_id da linha em cache contra a lista de cargos ATUAL, saindo de nome_sem_correspondencia', async () => {
    const { service, extractRows } = await buildService({
      positions: [{ id: 'pos-1', name: 'Soldador' }],
      cachedRows: [cachedRow({ position_id: null })],
    });

    const report = await service.run('tenant-1', empresaUser);

    expect(extractRows).not.toHaveBeenCalled();
    expect(report.functions).toEqual([
      expect.objectContaining({ position_id: 'pos-1', position_name: 'Soldador', status: 'risco_sem_exame' }),
    ]);
  });

  // Contraprova de que o valor gravado não é mais a fonte da verdade: aqui ele
  // aponta pra um cargo que não existe mais, e mesmo assim o relatório resolve
  // pro cargo atual em vez de repetir o id obsoleto.
  it('ignora o position_id gravado quando ele não corresponde mais a nenhum cargo atual', async () => {
    const { service } = await buildService({
      positions: [{ id: 'pos-novo', name: 'Soldador' }],
      cachedRows: [cachedRow({ position_id: 'pos-apagado' })],
    });

    const report = await service.run('tenant-1', empresaUser);

    expect(report.functions[0].position_id).toBe('pos-novo');
  });

  it('cargo apagado sem substituto volta a ser nome_sem_correspondencia', async () => {
    const { service } = await buildService({
      positions: [],
      cachedRows: [cachedRow({ position_id: 'pos-apagado' })],
    });

    const report = await service.run('tenant-1', empresaUser);

    expect(report.functions[0].position_id).toBeNull();
    expect(report.functions[0].status).toBe('nome_sem_correspondencia');
  });
});
