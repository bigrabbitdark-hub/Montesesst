import { Test } from '@nestjs/testing';
import PDFDocument from 'pdfkit';
import {
  FunctionReportItem,
  PenteFinoComparisonService,
  buildFunctionReport,
  buildLipAgentFindings,
  buildAgentCoverageFindings,
  buildMeasurementDivergenceFindings,
  PenteFinoDocumentRef,
  sortFunctionsByPriority,
  StoredRow,
} from '../src/pente-fino/pente-fino-comparison.service';
import { PenteFinoExtractorService } from '../src/pente-fino/pente-fino-extractor.service';
import { FUNCTION_EXTRACTION_PROVIDER } from '../src/pente-fino/function-extraction-provider.interface';
import { DocumentChecklistExtractorService, DocumentChecklistRow } from '../src/pente-fino/document-checklist-extractor.service';
import { LipAgentExtractorService, LipAgentRow } from '../src/pente-fino/lip-agent-extractor.service';
import { R2Service } from '../src/common/r2/r2.service';
import { DatabaseService } from '../src/common/database/database.service';

// Fixture do checklist preliminar (Fase 27) — este spec testa
// ensureExtracted/buildFunctionReport (PGR/PCMSO), não a extração do
// checklist em si (já coberta pelos 12 testes de
// document-checklist-extractor.unit-spec.ts), então o serviço entra
// aqui como fake devolvendo sempre "nada encontrado".
const EMPTY_CHECKLIST_ROW: DocumentChecklistRow = {
  elaborationDate: null,
  elaborationDateSourceExcerpt: null,
  professionalName: null,
  professionalRegistro: null,
  professionalPapel: null,
  professionalSourceExcerpt: null,
};

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

describe('buildLipAgentFindings', () => {
  function agent(overrides: Partial<{ agentNameRaw: string; agentCategory: string; measuredValueRaw: string | null; insalubre: boolean | null; conclusionExcerpt: string | null; sourceExcerpt: string }> = {}) {
    return {
      agentNameRaw: 'Ruído contínuo',
      agentCategory: 'ruido',
      measuredValueRaw: '92 dB(A)',
      insalubre: true,
      conclusionExcerpt: 'caracteriza insalubridade em grau médio',
      sourceExcerpt: 'Ruído contínuo avaliado em 92 dB(A).',
      ...overrides,
    };
  }

  it('ruido + insalubre=true + PCMSO sem audiometria vira exame_ausente', () => {
    const findings = buildLipAgentFindings([agent()], ['Hemograma completo', 'ASO periódico']);
    expect(findings[0].exam_status).toBe('exame_ausente');
  });

  it('ruido + insalubre=true + PCMSO com audiometria vira ok', () => {
    const findings = buildLipAgentFindings([agent()], ['Exame audiométrico periódico']);
    expect(findings[0].exam_status).toBe('ok');
  });

  it('busca a palavra-chave case-insensitive e como substring (audiometria/audiométrico)', () => {
    const findings = buildLipAgentFindings([agent()], ['AUDIOMETRIA TONAL']);
    expect(findings[0].exam_status).toBe('ok');
  });

  it('ruido + insalubre=false nunca vira exame_ausente', () => {
    const findings = buildLipAgentFindings([agent({ insalubre: false })], []);
    expect(findings[0].exam_status).toBe('informativo');
  });

  it('ruido + insalubre=null (ambíguo) nunca vira exame_ausente', () => {
    const findings = buildLipAgentFindings([agent({ insalubre: null })], []);
    expect(findings[0].exam_status).toBe('informativo');
  });

  it('categoria diferente de ruido é sempre informativo, mesmo com insalubre=true', () => {
    const findings = buildLipAgentFindings([agent({ agentCategory: 'calor' })], []);
    expect(findings[0].exam_status).toBe('informativo');
  });

  it('lista vazia de agentes devolve lista vazia', () => {
    expect(buildLipAgentFindings([], ['Audiometria'])).toEqual([]);
  });

  it('preserva os campos de dado sem alteração, só adiciona exam_status', () => {
    const findings = buildLipAgentFindings([agent({ measuredValueRaw: null, conclusionExcerpt: null, insalubre: null })], []);
    expect(findings[0]).toEqual({
      agent_name_raw: 'Ruído contínuo',
      agent_category: 'ruido',
      measured_value_raw: null,
      insalubre: null,
      conclusion_excerpt: null,
      source_excerpt: 'Ruído contínuo avaliado em 92 dB(A).',
      exam_status: 'informativo',
    });
  });

  // Terceiro parâmetro (pós-Fase 28): segundo sinal de audiometria, calculado
  // por quem chama a partir do texto bruto do PCMSO (I/O fica fora desta
  // função pura) — cobre o caso real de PCMSO que lista audiometria solta,
  // sem vincular a nenhuma função (pcmsoExamDescriptions fica vazio nesse
  // caso, já que a extração função↔exame não gera linha nenhuma).
  it('hasAudiometriaNoTextoBruto=true vira ok mesmo com pcmsoExamDescriptions vazio', () => {
    const findings = buildLipAgentFindings([agent()], [], true);
    expect(findings[0].exam_status).toBe('ok');
  });

  it('hasAudiometriaNoTextoBruto=false (default) preserva o comportamento anterior', () => {
    const findings = buildLipAgentFindings([agent()], []);
    expect(findings[0].exam_status).toBe('exame_ausente');
  });

  it('hasAudiometriaNoTextoBruto=true não afeta categorias diferentes de ruido', () => {
    const findings = buildLipAgentFindings([agent({ agentCategory: 'calor' })], [], true);
    expect(findings[0].exam_status).toBe('informativo');
  });
});

describe('buildAgentCoverageFindings', () => {
  function a(name: string, category: string) {
    return { agentNameRaw: name, agentCategory: category };
  }

  it('categoria presente nos dois documentos vira "ambos"', () => {
    const findings = buildAgentCoverageFindings([a('Ruído contínuo', 'ruido')], [a('Ruído de impacto', 'ruido')]);
    expect(findings).toEqual([
      { agent_category: 'ruido', presence: 'ambos', agent_names_lip: ['Ruído contínuo'], agent_names_ltcat: ['Ruído de impacto'] },
    ]);
  });

  it('categoria só no LIP vira "so_lip"', () => {
    const findings = buildAgentCoverageFindings([a('Benzeno', 'quimico')], []);
    expect(findings).toEqual([
      { agent_category: 'quimico', presence: 'so_lip', agent_names_lip: ['Benzeno'], agent_names_ltcat: [] },
    ]);
  });

  it('categoria só no LTCAT vira "so_ltcat"', () => {
    const findings = buildAgentCoverageFindings([], [a('Calor', 'calor')]);
    expect(findings).toEqual([
      { agent_category: 'calor', presence: 'so_ltcat', agent_names_lip: [], agent_names_ltcat: ['Calor'] },
    ]);
  });

  it('várias categorias são classificadas independentemente', () => {
    const findings = buildAgentCoverageFindings(
      [a('Ruído contínuo', 'ruido'), a('Benzeno', 'quimico')],
      [a('Ruído de impacto', 'ruido'), a('Vibração', 'vibracao')],
    );
    const byCategory = Object.fromEntries(findings.map((f) => [f.agent_category, f.presence]));
    expect(byCategory).toEqual({ ruido: 'ambos', quimico: 'so_lip', vibracao: 'so_ltcat' });
  });

  it('nunca compara valor medido — só presença por categoria', () => {
    // Mesma categoria, nomes/valores completamente diferentes — ainda
    // assim "ambos", porque a comparação é só de cobertura por
    // categoria, nunca de valor numérico (decisão de escopo desta
    // fatia, mesmo espírito de nunca recalcular a NR-15).
    const findings = buildAgentCoverageFindings([a('Ruído — 120 dB(A)', 'ruido')], [a('Ruído — 40 dB(A)', 'ruido')]);
    expect(findings[0].presence).toBe('ambos');
  });

  it('sem agentes nos dois lados devolve lista vazia', () => {
    expect(buildAgentCoverageFindings([], [])).toEqual([]);
  });

  it('duas ocorrências da mesma categoria no mesmo documento aparecem juntas, sem duplicar a categoria', () => {
    const findings = buildAgentCoverageFindings([a('Ruído contínuo', 'ruido'), a('Ruído de impacto', 'ruido')], []);
    expect(findings).toHaveLength(1);
    expect(findings[0].agent_names_lip).toEqual(['Ruído contínuo', 'Ruído de impacto']);
  });
});

describe('buildMeasurementDivergenceFindings', () => {
  const lipDocument: PenteFinoDocumentRef = {
    id: 'doc-lip',
    title: 'LIP',
    extracted_at: null,
    elaboration_date: null,
    elaboration_date_source_excerpt: null,
    professional_name: null,
    professional_registro: null,
    professional_papel: null,
    professional_source_excerpt: null,
  };
  const ltcatDocument: PenteFinoDocumentRef = { ...lipDocument, id: 'doc-ltcat', title: 'LTCAT' };

  function measurement(overrides: Partial<LipAgentRow> = {}): LipAgentRow {
    return {
      agentNameRaw: 'Ruído contínuo',
      agentCategory: 'ruido',
      measuredValueRaw: '91,62 dB(A)',
      insalubre: null,
      conclusionExcerpt: null,
      sourceExcerpt: 'Ruído contínuo medido em 91,62 dB(A).',
      ...overrides,
    };
  }

  it('identifica valores divergentes do mesmo agente e unidade com evidência dos dois laudos', () => {
    const findings = buildMeasurementDivergenceFindings(
      [measurement()],
      [measurement({ agentNameRaw: 'RUIDO CONTINUO', measuredValueRaw: '95.52 dB (A)', sourceExcerpt: 'Ruído contínuo medido em 95,52 dB(A).' })],
      lipDocument,
      ltcatDocument,
    );

    expect(findings).toEqual([
      expect.objectContaining({
        type: 'quantitative_divergence',
        status: 'inconsistency',
        confidence: 'high',
        evidence: [
          expect.objectContaining({ document_id: 'doc-lip', title: 'LIP', source_excerpt: 'Ruído contínuo medido em 91,62 dB(A).', page: null }),
          expect.objectContaining({ document_id: 'doc-ltcat', title: 'LTCAT', source_excerpt: 'Ruído contínuo medido em 95,52 dB(A).', page: null }),
        ],
        recommended_verification: expect.any(String),
      }),
    ]);
  });

  it('não sinaliza diferença causada apenas por separador decimal ou espaços na unidade', () => {
    const findings = buildMeasurementDivergenceFindings(
      [measurement({ measuredValueRaw: '91,62 dB(A)' })],
      [measurement({ measuredValueRaw: '91.62 dB (A)' })],
      lipDocument,
      ltcatDocument,
    );

    expect(findings).toEqual([]);
  });

  it('não compara nomes de agente diferentes mesmo quando a categoria coincide', () => {
    const findings = buildMeasurementDivergenceFindings(
      [measurement({ agentNameRaw: 'Ruído contínuo' })],
      [measurement({ agentNameRaw: 'Ruído de impacto', measuredValueRaw: '95,52 dB(A)' })],
      lipDocument,
      ltcatDocument,
    );

    expect(findings).toEqual([]);
  });

  it('não compara valores com unidades diferentes ou não identificadas', () => {
    const differentUnits = buildMeasurementDivergenceFindings(
      [measurement({ measuredValueRaw: '91,62 dB(A)' })],
      [measurement({ measuredValueRaw: '95,52 Pa' })],
      lipDocument,
      ltcatDocument,
    );
    const missingUnit = buildMeasurementDivergenceFindings(
      [measurement({ measuredValueRaw: '91,62' })],
      [measurement({ measuredValueRaw: '95,52' })],
      lipDocument,
      ltcatDocument,
    );

    expect(differentUnits).toEqual([]);
    expect(missingUnit).toEqual([]);
  });

  it('não compara valores ambíguos ou não numéricos', () => {
    const findings = buildMeasurementDivergenceFindings(
      [measurement({ measuredValueRaw: 'dose variável dB(A)' })],
      [measurement({ measuredValueRaw: '95,52 dB(A)' })],
      lipDocument,
      ltcatDocument,
    );

    expect(findings).toEqual([]);
  });
});

// Cobre o Finding crítico da revisão final da Fase 28: uma linha já
// persistida em lip_agent_findings ANTES da correção de deriveInsalubre
// pode ter insalubre gravado errado (ex.: conclusão com quebra de linha
// entre "não" e "caracteriza" invertia o resultado). ensureLipAgents
// precisa re-derivar insalubre a partir de conclusion_excerpt na leitura
// do cache em vez de confiar cegamente no valor gravado — mesmo
// princípio já aplicado a position_id em ensureExtracted, acima.
describe('PenteFinoComparisonService — ensureLipAgents re-deriva insalubre do cache', () => {
  const lipDoc = {
    id: 'doc-lip',
    tenant_id: 'tenant-1',
    title: 'LIP Teste',
    file_key: 'key-lip',
    mime_type: 'application/pdf',
  };

  async function buildServiceWithLipCache(cachedRow: {
    agent_name_raw: string;
    agent_category: string;
    measured_value_raw: string | null;
    insalubre: boolean | null;
    conclusion_excerpt: string | null;
    source_excerpt: string;
  }): Promise<PenteFinoComparisonService> {
    const fakeClient = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("category = 'pgr'")) return { rows: [] };
        if (sql.includes("category = 'pcmso'")) return { rows: [] };
        if (sql.includes("category = 'ltcat'")) return { rows: [] };
        if (sql.includes("category = 'lip'")) return { rows: [lipDoc] };
        if (sql.includes('FROM positions')) return { rows: [] };
        if (sql.includes('FROM document_checklist_findings')) return { rows: [] };
        if (sql.includes('FROM lip_agent_findings')) return { rows: [cachedRow] };
        throw new Error(`query inesperada no fake: ${sql}`);
      }),
    };
    const fakeDb = { withTenantContext: jest.fn((_ctx: unknown, fn: any) => fn(fakeClient)) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PenteFinoComparisonService,
        PenteFinoExtractorService,
        { provide: DatabaseService, useValue: fakeDb },
        { provide: R2Service, useValue: { getObject: jest.fn() } },
        { provide: FUNCTION_EXTRACTION_PROVIDER, useValue: { extract: jest.fn() } },
        {
          provide: DocumentChecklistExtractorService,
          useValue: {
            extractChecklist: jest.fn().mockResolvedValue(EMPTY_CHECKLIST_ROW),
            persist: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: LipAgentExtractorService,
          useValue: {
            // Se o caminho de cache falhar e cair na extração de verdade, o
            // teste quebra aqui em vez de passar silenciosamente por outro motivo.
            extractAgents: jest
              .fn()
              .mockRejectedValue(new Error('extractAgents não deveria ser chamado quando já existe cache')),
            persist: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    return moduleRef.get(PenteFinoComparisonService);
  }

  const empresaUser = { id: 'user-1', tenantId: 'tenant-1', role: 'empresa' };

  it('re-deriva insalubre a partir de conclusion_excerpt em vez de confiar no valor gravado no cache', async () => {
    const service = await buildServiceWithLipCache({
      agent_name_raw: 'Ruído contínuo',
      agent_category: 'ruido',
      measured_value_raw: '92 dB(A)',
      insalubre: true, // gravado incorretamente antes da correção (bug de quebra de linha)
      conclusion_excerpt: 'não\ncaracteriza insalubridade',
      source_excerpt: 'Ruído contínuo medido em 92 dB(A).',
    });

    const report = await service.run('tenant-1', empresaUser);

    expect(report.lip_agents).toHaveLength(1);
    expect(report.lip_agents[0].insalubre).toBe(false);
    expect(report.lip_agents[0].source_excerpt).toBe('Ruído contínuo medido em 92 dB(A).');
  });
});

// Cobre o segundo sinal de audiometria (pós-Fase 28): varredura do texto
// bruto do PCMSO, independente de função nomeada — achado real descoberto
// em verificação com IA real em produção (audiometria solta no texto nunca
// aparecia em pcmso_function_exams). PDF de teste real (pdfkit) porque
// extractFullText usa parsing real de PDF, não é mockável neste nível sem
// esconder exatamente o comportamento sob teste.
describe('PenteFinoComparisonService — segundo sinal de audiometria no texto bruto do PCMSO', () => {
  const lipDoc = { id: 'doc-lip', tenant_id: 'tenant-1', title: 'LIP Teste', file_key: 'key-lip', mime_type: 'application/pdf' };
  const pcmsoDoc = { id: 'doc-pcmso', tenant_id: 'tenant-1', title: 'PCMSO Teste', file_key: 'key-pcmso', mime_type: 'application/pdf' };
  const empresaUser = { id: 'user-1', tenantId: 'tenant-1', role: 'empresa' };

  const ruidoInsalubreRow = {
    agent_name_raw: 'Ruído contínuo',
    agent_category: 'ruido',
    measured_value_raw: '92 dB(A)',
    insalubre: true,
    conclusion_excerpt: 'caracteriza insalubridade em grau médio',
  };

  function buildTestPdf(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.text(text);
      doc.end();
    });
  }

  async function buildServiceWithPcmso(options: {
    lipAgentRows: typeof ruidoInsalubreRow[];
    pcmsoExamDescriptions: string[];
    fakeGetObject: jest.Mock;
  }): Promise<PenteFinoComparisonService> {
    const fakeClient = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("category = 'pgr'")) return { rows: [] };
        if (sql.includes("category = 'pcmso'")) return { rows: [pcmsoDoc] };
        if (sql.includes("category = 'ltcat'")) return { rows: [] };
        if (sql.includes("category = 'lip'")) return { rows: [lipDoc] };
        if (sql.includes('FROM positions')) return { rows: [] };
        if (sql.includes('FROM document_checklist_findings')) return { rows: [] };
        if (sql.includes('FROM lip_agent_findings')) return { rows: options.lipAgentRows };
        if (sql.includes('FROM pcmso_function_exams'))
          return { rows: options.pcmsoExamDescriptions.map((d) => ({ position_id: null, function_text_raw: 'X', description: d, source_excerpt: d, created_at: new Date() })) };
        throw new Error(`query inesperada no fake: ${sql}`);
      }),
    };
    const fakeDb = { withTenantContext: jest.fn((_ctx: unknown, fn: any) => fn(fakeClient)) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PenteFinoComparisonService,
        PenteFinoExtractorService,
        { provide: DatabaseService, useValue: fakeDb },
        { provide: R2Service, useValue: { getObject: options.fakeGetObject } },
        { provide: FUNCTION_EXTRACTION_PROVIDER, useValue: { extract: jest.fn() } },
        {
          provide: DocumentChecklistExtractorService,
          useValue: { extractChecklist: jest.fn().mockResolvedValue(EMPTY_CHECKLIST_ROW), persist: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: LipAgentExtractorService,
          useValue: {
            extractAgents: jest.fn().mockRejectedValue(new Error('extractAgents não deveria ser chamado quando já existe cache')),
            persist: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    return moduleRef.get(PenteFinoComparisonService);
  }

  it('acha audiometria no texto bruto quando a extração por função não achou nada', async () => {
    const fakeGetObject = jest.fn().mockResolvedValue(await buildTestPdf('Exames complementares: audiometria tonal anual.'));
    const service = await buildServiceWithPcmso({
      lipAgentRows: [ruidoInsalubreRow],
      pcmsoExamDescriptions: ['Hemograma completo'], // não menciona audiometria
      fakeGetObject,
    });

    const report = await service.run('tenant-1', empresaUser);

    expect(report.lip_agents[0].exam_status).toBe('ok');
    expect(fakeGetObject).toHaveBeenCalledWith('key-pcmso');
  });

  it('texto bruto sem audiometria mantém exame_ausente', async () => {
    const fakeGetObject = jest.fn().mockResolvedValue(await buildTestPdf('Exames complementares: hemograma completo, glicemia de jejum.'));
    const service = await buildServiceWithPcmso({
      lipAgentRows: [ruidoInsalubreRow],
      // Não-vazio de propósito: pcmso_function_exams com pelo menos 1 linha
      // faz ensureExtracted tomar o caminho de CACHE (não a extração real
      // de PenteFinoExtractorService, que também chamaria r2.getObject e
      // confundiria a asserção deste teste com uma chamada não relacionada
      // ao sinal de texto bruto sob teste aqui).
      pcmsoExamDescriptions: ['Hemograma completo'],
      fakeGetObject,
    });

    const report = await service.run('tenant-1', empresaUser);

    expect(report.lip_agents[0].exam_status).toBe('exame_ausente');
  });

  it('não baixa o PCMSO de novo quando a extração por função JÁ achou audiometria (evita I/O desnecessário)', async () => {
    const fakeGetObject = jest.fn().mockRejectedValue(new Error('getObject não deveria ser chamado — sinal por função já bastou'));
    const service = await buildServiceWithPcmso({
      lipAgentRows: [ruidoInsalubreRow],
      pcmsoExamDescriptions: ['Exame audiométrico periódico'],
      fakeGetObject,
    });

    const report = await service.run('tenant-1', empresaUser);

    expect(report.lip_agents[0].exam_status).toBe('ok');
    expect(fakeGetObject).not.toHaveBeenCalled();
  });

  it('não baixa o PCMSO quando não há nenhum agente ruído+insalubre (nada a confirmar)', async () => {
    const fakeGetObject = jest.fn().mockRejectedValue(new Error('getObject não deveria ser chamado — nenhum agente relevante'));
    const service = await buildServiceWithPcmso({
      // ensureLipAgents re-deriva insalubre a partir de conclusion_excerpt no
      // caminho de cache (correção do achado Crítico da Fase 28) — pra este
      // teste dar insalubre=false de verdade, a conclusão citada precisa ser
      // negativa; só sobrescrever o campo `insalubre` da fixture não bastaria.
      lipAgentRows: [{ ...ruidoInsalubreRow, insalubre: false, conclusion_excerpt: 'não caracteriza insalubridade' }],
      // Não-vazio pelo mesmo motivo do teste acima — evita a extração real
      // via PenteFinoExtractorService confundir a asserção de I/O.
      pcmsoExamDescriptions: ['Hemograma completo'],
      fakeGetObject,
    });

    const report = await service.run('tenant-1', empresaUser);

    expect(report.lip_agents[0].exam_status).toBe('informativo');
    expect(fakeGetObject).not.toHaveBeenCalled();
  });
});

// Cobre a extensão da cobertura LIP×LTCAT: ensureAgentFindings roda pros
// dois documentos (mesma tabela lip_agent_findings, distinguida por
// document_id), e buildAgentCoverageFindings só é chamada quando os dois
// existem.
describe('PenteFinoComparisonService — cobertura de agentes LIP×LTCAT', () => {
  const lipDoc = { id: 'doc-lip', tenant_id: 'tenant-1', title: 'LIP Teste', file_key: 'key-lip', mime_type: 'application/pdf' };
  const ltcatDoc = { id: 'doc-ltcat', tenant_id: 'tenant-1', title: 'LTCAT Teste', file_key: 'key-ltcat', mime_type: 'application/pdf' };
  const empresaUser = { id: 'user-1', tenantId: 'tenant-1', role: 'empresa' };

  type CachedAgentRow = {
    agent_name_raw: string;
    agent_category: string;
    measured_value_raw: string | null;
    insalubre: boolean | null;
    conclusion_excerpt: string | null;
  };

  async function buildServiceWithCoverage(options: {
    hasLtcat: boolean;
    lipRows: CachedAgentRow[];
    ltcatRows: CachedAgentRow[];
    // 0 linhas em lip_agent_findings é ambíguo entre "nunca rodou" e
    // "rodou e não achou nada" (limitação aceita, Fase 28) — quando um
    // teste passa arrays vazios de propósito pra simular esse segundo
    // caso, precisa de um extractAgents que resolve (não rejeita) pra
    // não confundir com o caminho de cache real testado nos outros.
    allowFreshExtraction?: boolean;
  }): Promise<PenteFinoComparisonService> {
    const fakeClient = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("category = 'pgr'")) return { rows: [] };
        if (sql.includes("category = 'pcmso'")) return { rows: [] };
        if (sql.includes("category = 'ltcat'")) return { rows: options.hasLtcat ? [ltcatDoc] : [] };
        if (sql.includes("category = 'lip'")) return { rows: [lipDoc] };
        if (sql.includes('FROM positions')) return { rows: [] };
        if (sql.includes('FROM document_checklist_findings')) return { rows: [] };
        if (sql.includes('FROM lip_agent_findings')) {
          if (params[0] === 'doc-lip') return { rows: options.lipRows };
          if (params[0] === 'doc-ltcat') return { rows: options.ltcatRows };
          throw new Error(`document_id inesperado no fake: ${params[0]}`);
        }
        throw new Error(`query inesperada no fake: ${sql}`);
      }),
    };
    const fakeDb = { withTenantContext: jest.fn((_ctx: unknown, fn: any) => fn(fakeClient)) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PenteFinoComparisonService,
        PenteFinoExtractorService,
        { provide: DatabaseService, useValue: fakeDb },
        { provide: R2Service, useValue: { getObject: jest.fn() } },
        { provide: FUNCTION_EXTRACTION_PROVIDER, useValue: { extract: jest.fn() } },
        {
          provide: DocumentChecklistExtractorService,
          useValue: { extractChecklist: jest.fn().mockResolvedValue(EMPTY_CHECKLIST_ROW), persist: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: LipAgentExtractorService,
          useValue: {
            extractAgents: options.allowFreshExtraction
              ? jest.fn().mockResolvedValue([])
              : jest.fn().mockRejectedValue(new Error('extractAgents não deveria ser chamado quando já existe cache')),
            persist: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    return moduleRef.get(PenteFinoComparisonService);
  }

  const ruidoLip: CachedAgentRow = {
    agent_name_raw: 'Ruído contínuo',
    agent_category: 'ruido',
    measured_value_raw: '92 dB(A)',
    insalubre: true,
    conclusion_excerpt: 'caracteriza insalubridade em grau médio',
  };
  const ruidoLtcat: CachedAgentRow = {
    agent_name_raw: 'Ruído de impacto',
    agent_category: 'ruido',
    measured_value_raw: '128 dB',
    insalubre: null,
    conclusion_excerpt: null,
  };
  const beneznoLip: CachedAgentRow = {
    agent_name_raw: 'Benzeno',
    agent_category: 'quimico',
    measured_value_raw: null,
    insalubre: null,
    conclusion_excerpt: null,
  };

  it('LIP e LTCAT existem: agent_coverage reflete a categoria presente nos dois e a que só está no LIP', async () => {
    const service = await buildServiceWithCoverage({ hasLtcat: true, lipRows: [ruidoLip, beneznoLip], ltcatRows: [ruidoLtcat] });

    const report = await service.run('tenant-1', empresaUser);

    const byCategory = Object.fromEntries(report.agent_coverage.map((f) => [f.agent_category, f.presence]));
    expect(byCategory).toEqual({ ruido: 'ambos', quimico: 'so_lip' });
  });

  it('só LIP existe (sem LTCAT): agent_coverage fica vazio, sem tentar comparar com nada', async () => {
    const service = await buildServiceWithCoverage({ hasLtcat: false, lipRows: [ruidoLip], ltcatRows: [] });

    const report = await service.run('tenant-1', empresaUser);

    expect(report.agent_coverage).toEqual([]);
    expect(report.ltcat_document).toBeNull();
  });

  it('LIP e LTCAT existem mas nenhum agente foi extraído em nenhum dos dois: agent_coverage fica vazio', async () => {
    const service = await buildServiceWithCoverage({ hasLtcat: true, lipRows: [], ltcatRows: [], allowFreshExtraction: true });

    const report = await service.run('tenant-1', empresaUser);

    expect(report.agent_coverage).toEqual([]);
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
    cachedRows: (StoredRow & { created_at: Date })[];
  }): Promise<{ service: PenteFinoComparisonService; extractRows: jest.Mock }> {
    const fakeClient = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("category = 'pgr'")) return { rows: [pgrDoc] };
        if (sql.includes("category = 'pcmso'")) return { rows: [] };
        if (sql.includes("category = 'ltcat'")) return { rows: [] };
        if (sql.includes("category = 'lip'")) return { rows: [] };
        if (sql.includes('FROM positions')) return { rows: options.positions };
        if (sql.includes('FROM pgr_function_risks')) return { rows: options.cachedRows };
        if (sql.includes('FROM document_checklist_findings')) return { rows: [] };
        if (sql.includes('FROM lip_agent_findings')) return { rows: [] };
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
        {
          provide: DocumentChecklistExtractorService,
          useValue: {
            extractChecklist: jest.fn().mockResolvedValue(EMPTY_CHECKLIST_ROW),
            persist: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: LipAgentExtractorService,
          useValue: {
            extractAgents: jest.fn().mockResolvedValue([]),
            persist: jest.fn().mockResolvedValue(undefined),
          },
        },
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

  function cachedRow(overrides: Partial<StoredRow & { created_at: Date }> = {}): StoredRow & { created_at: Date } {
    return {
      position_id: null,
      function_text_raw: 'Soldador',
      description: 'Fumos metálicos',
      source_excerpt: 'trecho pgr',
      created_at: new Date('2026-09-01T10:00:00.000Z'),
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

  it('extracted_at do documento é o created_at mais recente das linhas em cache; documento ausente vira null', async () => {
    const { service } = await buildService({
      positions: [{ id: 'pos-1', name: 'Soldador' }],
      cachedRows: [
        cachedRow({ created_at: new Date('2026-09-01T10:00:00.000Z') }),
        cachedRow({ created_at: new Date('2026-09-03T08:30:00.000Z'), description: 'Ruído' }),
      ],
    });

    const report = await service.run('tenant-1', empresaUser);

    expect(report.pgr_document).toEqual({
      id: 'doc-pgr',
      title: 'PGR Teste',
      extracted_at: '2026-09-03T08:30:00.000Z',
      elaboration_date: null,
      elaboration_date_source_excerpt: null,
      professional_name: null,
      professional_registro: null,
      professional_papel: null,
      professional_source_excerpt: null,
    });
    // O fake não devolve PCMSO/LTCAT/LIP nenhum — documento ausente continua
    // null inteiro, não um objeto com campos null.
    expect(report.pcmso_document).toBeNull();
    expect(report.ltcat_document).toBeNull();
    expect(report.lip_document).toBeNull();
  });
});

describe('sortFunctionsByPriority', () => {
  function item(status: FunctionReportItem['status'], functionTextRaw: string): FunctionReportItem {
    return {
      position_id: null,
      position_name: null,
      function_text_raw: functionTextRaw,
      status,
      risks: [],
      exams: [],
    };
  }

  it('ordena risco_sem_exame, exame_sem_risco, ok e por último nome_sem_correspondencia', () => {
    const sorted = sortFunctionsByPriority([
      item('nome_sem_correspondencia', 'Ajudante'),
      item('ok', 'Pedreiro'),
      item('exame_sem_risco', 'Pintor'),
      item('risco_sem_exame', 'Soldador'),
    ]);

    expect(sorted.map((f) => f.status)).toEqual([
      'risco_sem_exame',
      'exame_sem_risco',
      'ok',
      'nome_sem_correspondencia',
    ]);
  });

  it('mantém a ordem original entre funções de mesmo status (sort estável)', () => {
    const sorted = sortFunctionsByPriority([
      item('risco_sem_exame', 'Soldador'),
      item('risco_sem_exame', 'Pintor'),
      item('risco_sem_exame', 'Pedreiro'),
    ]);

    expect(sorted.map((f) => f.function_text_raw)).toEqual(['Soldador', 'Pintor', 'Pedreiro']);
  });

  it('não muta o array recebido', () => {
    const original = [item('nome_sem_correspondencia', 'Ajudante'), item('risco_sem_exame', 'Soldador')];
    sortFunctionsByPriority(original);
    expect(original.map((f) => f.status)).toEqual(['nome_sem_correspondencia', 'risco_sem_exame']);
  });
});
