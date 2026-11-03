import type { TipoItem } from './checklists.dto';

// Valida o valor de uma resposta pelo tipo do item (o trigger da migration 0103 repete a regra).
// Devolve a mensagem de erro, ou null quando válido.
export function validarResposta(kind: TipoItem, value: string): string | null {
  if (kind === 'sim_nao_na') return ['sim', 'nao', 'na'].includes(value) ? null : 'Responda sim, não ou não se aplica.';
  if (kind === 'numero') return /^-?[0-9]+([.,][0-9]+)?$/.test(value) ? null : 'Informe um número válido.';
  if (kind === 'data') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Informe uma data válida (AAAA-MM-DD).';
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? null : 'Informe uma data válida (AAAA-MM-DD).';
  }
  return value.trim().length > 0 ? null : 'Informe a resposta.';
}
