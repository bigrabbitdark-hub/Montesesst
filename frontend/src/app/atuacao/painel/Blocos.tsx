import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { KpiCard } from '@/components/dashboard/KpiCard';
import {
  AGENDA_STATUS_LABEL, AGENDA_STATUS_TONE, AGENDA_TIPO_LABEL, PRIORIDADE_LABEL, formatDataCurta, hrefAtuacaoSeguro,
  type AgendaStatus, type AgendaTipo, type PainelEvento, type PainelPendencia, type PendenciaTipo, type Prioridade, type TarefasKpi,
} from '../api';

export const MSG_SEM_PERMISSAO = 'Sem permissão para este bloco (peça ao administrador)';
export const MSG_PARCIAL = 'Parte deste bloco não está disponível (sem permissão ou falha momentânea)';
export const MSG_INDISPONIVEL = 'Bloco indisponível no momento. Tente novamente.';

const FOCO = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2';
export const LINK_TEXTO = `rounded font-semibold text-dash-primary underline ${FOCO}`;

// Todo KPI é um link para a lista filtrada correspondente.
export function KpiLink({ href, label, value, hint }: { href: string; label: string; value: number; hint?: string }) {
  return (
    <Link href={href} className={`block rounded-[18px] transition-shadow hover:shadow-md ${FOCO}`}>
      <KpiCard label={label} value={value} hint={hint} />
    </Link>
  );
}

// Bloco sem dados: "sem permissão" (null sem falha) ou "indisponível" (null listado em `indisponiveis`, com nova tentativa).
export function BlocoSemDados({ indisponivel, onRetry }: { indisponivel: boolean; onRetry: () => void }) {
  if (!indisponivel) return <p className="text-sm text-dash-muted">{MSG_SEM_PERMISSAO}</p>;
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm text-dash-status-crit-text">
      <span>{MSG_INDISPONIVEL}</span>
      <button type="button" onClick={onRetry} className="rounded border border-dash-border-input px-2 py-1 text-xs font-semibold">
        Tentar novamente
      </button>
    </div>
  );
}

// Pendências por categoria de espera (D2): contagem do servidor + link para a lista filtrada pelo status técnico.
const CATEGORIAS_ESPERA = [
  { campo: 'aguardando_cliente', status: 'awaiting_client', label: 'Aguardando cliente' },
  { campo: 'aguardando_avaliacao', status: 'awaiting_review', label: 'Aguardando avaliação técnica' },
  { campo: 'aguardando_execucao', status: 'awaiting_execution', label: 'Aguardando execução' },
  { campo: 'aguardando_eficacia', status: 'awaiting_efficacy', label: 'Aguardando comprovação de eficácia' },
] as const;

export function CategoriasEspera({ tarefas }: { tarefas: TarefasKpi }) {
  const itens = CATEGORIAS_ESPERA.filter((c) => typeof tarefas[c.campo] === 'number');
  if (itens.length === 0) return <p className="text-sm text-dash-muted">Contagens por categoria indisponíveis no momento.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {itens.map((c) => <KpiLink key={c.status} href={`/atuacao/tarefas?status=${c.status}`} label={c.label} value={tarefas[c.campo] as number} />)}
    </div>
  );
}

// tarefas null: mesma regra dos demais blocos; a nova tentativa fica no bloco Tarefas (mesma fonte), sem botão repetido.
export function CategoriasEsperaSemDados({ indisponivel }: { indisponivel: boolean }) {
  return indisponivel
    ? <p role="alert" className="text-sm text-dash-status-crit-text">{MSG_INDISPONIVEL}</p>
    : <p className="text-sm text-dash-muted">{MSG_SEM_PERMISSAO}</p>;
}

export function Secao({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="mb-3 text-base font-semibold text-dash-primary">{titulo}</h2>
      {children}
    </section>
  );
}

export function AgendaHoje({ hoje, total }: { hoje: PainelEvento[]; total: number }) {
  if (hoje.length === 0) return <p className="text-sm text-dash-muted">Nenhum compromisso para hoje.</p>;
  return (
    <>
      <ul className="flex flex-col gap-2">
        {hoje.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-dash-card px-4 py-3 text-sm shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
            <span className="w-20 shrink-0 font-semibold text-dash-primary">{e.hora ?? 'Dia inteiro'}</span>
            <span className="min-w-0 flex-1 break-words font-medium text-dash-primary">{e.titulo}</span>
            <span className="break-words text-dash-muted">{e.empresa}</span>
            <span className="text-dash-muted">{AGENDA_TIPO_LABEL[e.tipo as AgendaTipo] ?? e.tipo}</span>
            <Badge tone={AGENDA_STATUS_TONE[e.status as AgendaStatus] ?? 'high'}>{AGENDA_STATUS_LABEL[e.status as AgendaStatus] ?? e.status}</Badge>
          </li>
        ))}
      </ul>
      {total > hoje.length && <p className="mt-2 text-sm text-dash-muted">{`Mostrando ${hoje.length} de ${total} de hoje.`}</p>}
    </>
  );
}

const TIPO_PENDENCIA: Record<PendenciaTipo, { label: string; tone: 'crit' | 'warn' | 'info' }> = {
  tarefa_atrasada: { label: 'Tarefa atrasada', tone: 'crit' },
  tarefa_aguardando: { label: 'Tarefa em espera', tone: 'warn' },
  documento_vencido: { label: 'Documento vencido', tone: 'crit' },
  documento_vencendo: { label: 'Documento vencendo', tone: 'warn' },
  documento_aguardando: { label: 'Aguardando ação', tone: 'info' },
};

export function Pendencias({ itens, incompleta }: { itens: PainelPendencia[]; incompleta: boolean }) {
  return (
    <>
      {itens.length === 0 ? (
        <p className="text-sm text-dash-muted">Nenhuma pendência no momento.</p>
      ) : (
        <div className="overflow-hidden rounded-[18px] bg-dash-card shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
          <ul className="divide-y divide-dash-border-input">
            {itens.map((p, i) => {
              const href = hrefAtuacaoSeguro(p.href);
              const t = TIPO_PENDENCIA[p.tipo] ?? { label: p.tipo, tone: 'info' as const };
              return (
                <li key={`${p.tipo}-${i}-${p.descricao}`} className="flex flex-col gap-1 px-6 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={t.tone}>{t.label}</Badge>
                    <span className="break-words text-dash-muted">{p.empresa}</span>
                  </div>
                  {href ? <Link href={href} className={`${LINK_TEXTO} w-fit break-words`}>{p.descricao}</Link> : <span className="break-words font-semibold text-dash-primary">{p.descricao}</span>}
                  {(p.prazo || p.prioridade) && (
                    <p className="text-dash-muted">
                      {p.prazo && <>Prazo: {formatDataCurta(p.prazo)}</>}
                      {p.prazo && p.prioridade && ' · '}
                      {p.prioridade && <>Prioridade: {PRIORIDADE_LABEL[p.prioridade as Prioridade] ?? p.prioridade}</>}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {incompleta && (
        <p className="mt-2 text-sm text-dash-muted">Há blocos indisponíveis no momento: a lista pode estar incompleta.</p>
      )}
    </>
  );
}
