export interface ChecklistItemSuggestion {
  item_key: string;
  status: 'C' | 'NC' | 'NA';
  notes: string;
}

export interface FieldReportExtractor {
  extract(reportText: string): Promise<ChecklistItemSuggestion[]>;
}

export const FIELD_REPORT_EXTRACTOR = Symbol('FIELD_REPORT_EXTRACTOR');
