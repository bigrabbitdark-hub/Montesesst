import type { Tone } from '@/components/ui/Badge';
import type { ApiAttentionItem, ApiNrItem, ApiNrStatus, ApiPrioridade, ApiStatus } from './api-types';
import { diasEntre, formatarData, type Selo } from './status';

// Níveis do Score (decisão de produto de 2026-09-30, NÃO normativos):
// 90–100 Excelente, 80–89 Bom, 60–79 Atenção, 0–59 Crítico.
export function nivelScore(score: number | null): string {
  if (score === null) return 'Sem dados';
  if (score >= 90) return 'Excelente';
  if (score >= 80) return 'Bom';
  if (score >= 60) return 'Atenção';
  return 'Crítico';
}

// O selo usa o `status` calculado pelo backend (mesma regra do /empresa/dashboard).
export function seloDoStatus(status: ApiStatus): Selo {
  if (status === 'ok') return { tone: 'ok', texto: 'Conforme' };
  if (status === 'atencao') return { tone: 'warn', texto: 'Conforme, com ressalvas' };
  return { tone: 'crit', texto: 'Pendências críticas' };
}

const PRIORIDADE: Record<ApiPrioridade, { rotulo: string; tone: Tone }> = {
  alta: { rotulo: 'Urgente', tone: 'crit' },
  media: { rotulo: 'A vencer', tone: 'warn' },
  baixa: { rotulo: 'Acompanhar', tone: 'ok' },
};

export interface ItemLista {
  id: string;
  titulo: string;
  detalhe: string;
  rotulo: string;
  tone: Tone;
  href: string;
}

export interface VencimentoItem {
  id: string;
  nome: string;
  validade: string; // yyyy-mm-dd
  href: string;
}

const RESPONSAVEL = { empresa: 'Sua empresa', tecnico: 'Técnico' } as const;

function idDe(item: ApiAttentionItem, i: number): string {
  return `${item.tipo}|${item.titulo}|${item.data ?? ''}|${i}`;
}

// A ordem já vem do backend (prioridade, depois data); aqui só apresentamos.
export function paraItensLista(itens: ApiAttentionItem[]): ItemLista[] {
  return itens.map((item, i) => {
    const { rotulo, tone } = PRIORIDADE[item.prioridade];
    const detalhe = item.data
      ? `${RESPONSAVEL[item.responsavel]} · ${formatarData(item.data)}`
      : RESPONSAVEL[item.responsavel];
    return { id: idDe(item, i), titulo: item.titulo, detalhe, rotulo, tone, href: item.link };
  });
}

// Itens com data, do mais atrasado/próximo para o mais distante.
export function paraVencimentos(itens: ApiAttentionItem[]): VencimentoItem[] {
  return itens
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.data !== null)
    .sort((a, b) => (a.item.data as string).localeCompare(b.item.data as string))
    .map(({ item, i }) => ({ id: idDe(item, i), nome: item.titulo, validade: item.data as string, href: item.link }));
}

const NR_STATUS: Record<ApiNrStatus, { rotulo: string; tone: Tone }> = {
  em_dia: { rotulo: 'Em dia', tone: 'ok' },
  atencao: { rotulo: 'Atenção', tone: 'warn' },
  pendente: { rotulo: 'Pendente', tone: 'crit' },
  nao_avaliavel: { rotulo: 'Não avaliável', tone: 'info' },
};

export interface NrLinha {
  code: string;
  nome: string;
  rotulo: string;
  tone: Tone;
  detalhe: string;
  fonteUrl: string;
}

// Texto sempre "evidências cadastradas": o sistema não afirma obrigação nem descumprimento.
export function paraNrLinhas(itens: ApiNrItem[]): NrLinha[] {
  return itens.map((item) => {
    const { rotulo, tone } = NR_STATUS[item.status] ?? NR_STATUS.nao_avaliavel;
    let detalhe: string;
    if (item.evidencia == null) {
      detalhe = item.mensagem ?? 'Sem dados para avaliar.';
    } else if (item.evidencia.quantidade === 0) {
      detalhe = 'Nenhuma evidência cadastrada';
    } else {
      const q = item.evidencia.quantidade;
      detalhe = `${q} ${q === 1 ? 'evidência cadastrada' : 'evidências cadastradas'}`;
      if (item.evidencia.proxima_validade) {
        detalhe += ` · próxima validade ${formatarData(item.evidencia.proxima_validade)}`;
      }
    }
    return { code: item.code, nome: item.nome, rotulo, tone, detalhe, fonteUrl: item.fonte_oficial_url };
  });
}

// Endpoint não essencial: falha de rede, resposta não-OK, JSON inválido ou corpo sem `nrs`
// viram null ("indisponível" no cartão) e nunca derrubam o painel inteiro.
export async function lerNrs(res: Response | null): Promise<ApiNrItem[] | null> {
  if (!res || !res.ok) return null;
  try {
    const body = await res.json();
    return Array.isArray(body?.nrs) ? (body.nrs as ApiNrItem[]) : null;
  } catch {
    return null;
  }
}

// Data local de hoje em yyyy-mm-dd (fica fora dos componentes para o cálculo ser testável).
export function hojeISO(agora: Date = new Date()): string {
  const y = agora.getFullYear();
  const m = String(agora.getMonth() + 1).padStart(2, '0');
  const d = String(agora.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export { diasEntre };
