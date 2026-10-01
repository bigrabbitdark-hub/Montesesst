import type { NrStatus } from './nr-catalog';

export interface Evidencia {
  // Uma entrada por item de evidência; null = item sem data de validade.
  validades: (string | null)[];
}

export interface Avaliacao {
  status: Exclude<NrStatus, 'nao_avaliavel'>;
  quantidade: number;
  proxima_validade: string | null;
}

const JANELA_ATENCAO_DIAS = 30; // mesma janela de documents.getCompliance

export function hojeISO(agora: Date = new Date()): string {
  const y = agora.getFullYear();
  const m = String(agora.getMonth() + 1).padStart(2, '0');
  const d = String(agora.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function somarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

type Situacao = 'vencida' | 'vencendo' | 'vigente';

function situacaoDe(validade: string | null, hoje: string, limite: string): Situacao {
  if (validade === null) return 'vigente'; // sem data informada: não há como afirmar que venceu
  if (validade < hoje) return 'vencida';
  if (validade <= limite) return 'vencendo';
  return 'vigente';
}

export function avaliarEvidencia(ev: Evidencia, agregacao: 'alguma' | 'todas', hoje: string): Avaliacao {
  const quantidade = ev.validades.length;
  const futuras = ev.validades.filter((v): v is string => v !== null && v >= hoje).sort();
  const proxima_validade = futuras[0] ?? null;

  if (quantidade === 0) return { status: 'pendente', quantidade, proxima_validade };

  const limite = somarDias(hoje, JANELA_ATENCAO_DIAS);
  const situacoes = ev.validades.map((v) => situacaoDe(v, hoje, limite));

  if (agregacao === 'alguma') {
    if (situacoes.every((s) => s === 'vencida')) return { status: 'pendente', quantidade, proxima_validade };
    if (situacoes.includes('vigente')) return { status: 'em_dia', quantidade, proxima_validade };
    return { status: 'atencao', quantidade, proxima_validade };
  }

  if (situacoes.includes('vencida')) return { status: 'pendente', quantidade, proxima_validade };
  if (situacoes.includes('vencendo')) return { status: 'atencao', quantidade, proxima_validade };
  return { status: 'em_dia', quantidade, proxima_validade };
}
