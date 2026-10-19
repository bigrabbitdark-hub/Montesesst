// Provedor de IA para extração de cadastro de funcionários em texto livre. Recebe SÓ texto já minimizado
// (janelas com CPF → [CPF_n]); o resultado é não confiável até passar por verifyAiPeople.
export const EMPLOYEE_EXTRACTION_PROVIDER = 'EMPLOYEE_EXTRACTION_PROVIDER';

export interface AiPerson {
  cpf_ref: string;
  full_name?: string;
  birth_date?: string;
  sex?: string;
  position?: string;
  admission_date?: string;
  evidence: string;
}

export interface EmployeeExtractionProvider {
  // deadlineMs: orçamento TOTAL (tentativas e repetição incluídas); estourou → BadGatewayException.
  extract(redactedText: string, opts?: { deadlineMs?: number }): Promise<AiPerson[]>;
}
