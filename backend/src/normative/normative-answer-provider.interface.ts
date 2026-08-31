export interface OperationalItem {
  id: string;
  titulo: string;
}

export interface NormativeClaim {
  claim: string;
  chunk_ids: string[];
  operational_ref_ids: string[];
}

export interface NormativeAnswerProvider {
  answer(
    question: string,
    chunks: { id: string; content: string }[],
    operationalItems: OperationalItem[],
  ): Promise<NormativeClaim[]>;
}

export const NORMATIVE_ANSWER_PROVIDER = Symbol('NORMATIVE_ANSWER_PROVIDER');
