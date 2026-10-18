export type SstAuditRuleOutcome =
  | 'NC'
  | 'IN'
  | 'EA'
  | 'RC'
  | 'AT'
  | 'RT'
  | 'consistent'
  | 'not_applicable'
  | 'not_reported'
  | 'not_evaluated';

export interface SstAuditRuleInputFact {
  id: string;
  document_id: string;
  document_title: string;
  fact_type: string;
  subject_type: string;
  subject_raw: string;
  subject_key: string;
  value_json: Record<string, unknown>;
  unit: string | null;
  page_number: number;
  source_excerpt: string;
}

export interface SstAuditRuleResult {
  outcome: SstAuditRuleOutcome;
  summary: string;
  fact_ids: string[];
  limitations: string[];
  recommended_verification: string;
}

export interface SstCoverageDocumentRef {
  id: string;
  title: string;
  extracted_at: string | null;
}

export interface SstCoverageCell {
  item: string;
  document_results: Array<{
    document_type: string;
    status: 'consistent' | 'divergent' | 'not_applicable' | 'not_reported' | 'not_evaluated';
    fact_ids: string[];
    evidence: Array<{ document_id: string; title: string; source_excerpt: string; page: number | null }>;
  }>;
}

export function evaluateSstAuditRules(facts: SstAuditRuleInputFact[], auditDate: Date): SstAuditRuleResult[] {
  const byType = new Map<string, SstAuditRuleInputFact[]>();
  for (const fact of facts) {
    const list = byType.get(fact.fact_type) ?? [];
    list.push(fact);
    byType.set(fact.fact_type, list);
  }

  const noise = byType.get('noise_measurement') ?? [];
  if (noise.length >= 2) {
    const values = noise.map((fact) => Number(fact.value_json.value ?? NaN)).filter((value) => Number.isFinite(value));
    if (values.length >= 2 && values.some((value) => value !== values[0])) {
      return [
        {
          outcome: 'IN',
          summary: 'Há divergência quantitativa entre medições de ruído em documentos diferentes e a diferença precisa ser conferida.',
          fact_ids: noise.map((fact) => fact.id),
          limitations: ['A diferença não determina, por si só, não conformidade.', 'Método e período de medição ainda precisam ser comparados.'],
          recommended_verification: 'Conferir relatórios de medição, unidade e período dos documentos.',
        },
      ];
    }
  }

  if (facts.length === 0) {
    return [
      {
        outcome: 'not_reported',
        summary: 'Sem fatos extraídos para avaliar o cruzamento.',
        fact_ids: [],
        limitations: ['Não houve evidência documental suficiente para comparar itens do escopo.'],
        recommended_verification: 'Verificar se os documentos foram recebidos e extraídos corretamente.',
      },
    ];
  }

  return [
    {
      outcome: 'consistent',
      summary: `Não há evidência suficiente para NC em ${auditDate.toISOString().slice(0, 10)}; o cruzamento permanece em observação.`,
      fact_ids: facts.map((fact) => fact.id),
      limitations: ['Conformidade normativa não é confirmada apenas pela ausência de divergência.'],
      recommended_verification: 'Revisar o conjunto documental e a vigência da norma antes de concluir NC.',
    },
  ];
}

export function buildSstCoverageMatrix(
  facts: SstAuditRuleInputFact[],
  documentRefs: SstCoverageDocumentRef[],
): SstCoverageCell[] {
  const documents = documentRefs.map((document) => ({
    document_type: document.id,
    title: document.title,
    extracted_at: document.extracted_at,
  }));

  const items = Array.from(new Set(facts.map((fact) => fact.fact_type)));
  return items.map((item) => {
    const itemFacts = facts.filter((fact) => fact.fact_type === item);
    return {
      item,
      document_results: documents.map((document) => {
        const docsFacts = itemFacts.filter((fact) => fact.document_id === document.document_type);
        return {
          document_type: document.document_type,
          status: docsFacts.length > 0 ? 'consistent' : 'not_reported',
          fact_ids: docsFacts.map((fact) => fact.id),
          evidence: docsFacts.map((fact) => ({
            document_id: fact.document_id,
            title: fact.document_title,
            source_excerpt: fact.source_excerpt,
            page: fact.page_number,
          })),
        };
      }),
    };
  });
}
