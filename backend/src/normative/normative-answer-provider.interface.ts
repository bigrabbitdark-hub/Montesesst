export interface NormativeClaim {
  claim: string;
  chunk_ids: string[];
}

export interface NormativeAnswerProvider {
  answer(question: string, chunks: { id: string; content: string }[]): Promise<NormativeClaim[]>;
}

export const NORMATIVE_ANSWER_PROVIDER = Symbol('NORMATIVE_ANSWER_PROVIDER');
