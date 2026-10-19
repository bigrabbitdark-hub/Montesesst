// Consulta de CNPJ (rota do backend /api/cnpj-lookup — a chave/fonte externa
// nunca fica no navegador) e utilitários de CNPJ.

export interface CnpjData {
  cnpj: string;
  razao_social: string | null;
  situacao: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  cnae_code: string | null;
  cnae_description: string | null;
}

export type CnpjLookupOutcome =
  | { ok: true; data: CnpjData }
  | { ok: false; reason: 'invalid' | 'not_found' | 'rate_limited' | 'unavailable' | 'aborted'; message: string };

export const CNPJ_MESSAGES = {
  invalid: 'CNPJ inválido. Confira os números digitados.',
  not_found: 'Empresa não encontrada para este CNPJ. Você pode preencher os dados manualmente.',
  rate_limited: 'Limite de consultas atingido. Aguarde alguns minutos ou preencha manualmente.',
  unavailable: 'Não foi possível consultar o CNPJ agora. Você pode preencher os dados manualmente.',
} as const;

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidCnpj(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const check = (base: string) => {
    const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base.split('').reduce((acc, ch, i) => acc + Number(ch) * weights[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const base = d.slice(0, 12);
  const d1 = check(base);
  const d2 = check(base + d1);
  return d === `${base}${d1}${d2}`;
}

export async function lookupCnpj(rawCnpj: string, signal?: AbortSignal): Promise<CnpjLookupOutcome> {
  const cnpj = onlyDigits(rawCnpj);
  if (!isValidCnpj(cnpj)) return { ok: false, reason: 'invalid', message: CNPJ_MESSAGES.invalid };
  try {
    const res = await fetch(`/api/cnpj-lookup/${cnpj}`, { signal });
    if (res.ok) return { ok: true, data: (await res.json()) as CnpjData };
    if (res.status === 400) return { ok: false, reason: 'invalid', message: CNPJ_MESSAGES.invalid };
    if (res.status === 404) return { ok: false, reason: 'not_found', message: CNPJ_MESSAGES.not_found };
    if (res.status === 429) return { ok: false, reason: 'rate_limited', message: CNPJ_MESSAGES.rate_limited };
    return { ok: false, reason: 'unavailable', message: CNPJ_MESSAGES.unavailable };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return { ok: false, reason: 'aborted', message: '' };
    return { ok: false, reason: 'unavailable', message: CNPJ_MESSAGES.unavailable };
  }
}

export function formatCnpj(raw: string | null | undefined): string {
  const d = onlyDigits(raw ?? '');
  if (d.length !== 14) return raw ?? '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
