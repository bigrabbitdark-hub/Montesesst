import type { Tone } from './Card';

// Tom do Badge por status. O TEXTO do badge é sempre o valor original; aqui só se escolhe a cor, e só
// para valores cuja semântica está confirmada no código. Desconhecido = neutro.
export function subscriptionTone(status: string): Tone {
  if (status === 'authorized') return 'ok';
  if (status === 'paused') return 'warn';
  return 'neutral';
}

// Mesma faixa de cores que a página de auditoria já usava (2xx verde, 4xx amarelo, 5xx vermelho).
export function httpStatusTone(code: number): Tone {
  if (code >= 200 && code < 300) return 'ok';
  if (code >= 400 && code < 500) return 'warn';
  if (code >= 500) return 'bad';
  return 'neutral';
}
