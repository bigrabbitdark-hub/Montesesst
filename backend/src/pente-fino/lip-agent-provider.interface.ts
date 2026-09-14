export interface LipAgentExtraction {
  agent_name_raw: string;
  agent_category: string;
  measured_value_raw: string;
  conclusion_excerpt: string;
  source_excerpt: string;
}

export interface LipAgentExtractionProvider {
  extract(fullText: string): Promise<LipAgentExtraction[]>;
}

export const LIP_AGENT_EXTRACTION_PROVIDER = Symbol('LIP_AGENT_EXTRACTION_PROVIDER');
