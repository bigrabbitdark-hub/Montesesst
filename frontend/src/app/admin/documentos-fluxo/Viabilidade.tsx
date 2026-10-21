'use client';

import { AsyncBody, Badge, CardEmpty, type Tone } from '@/components/admin/Card';
import type { FetchState } from '@/components/admin/useAdminFetch';
import { DOC_CATEGORIA_LABEL } from '@/app/atuacao/api';
import { ACAO_LABEL, type StatusViabilidade, type Viabilidade } from './tipos';

const STATUS: Record<StatusViabilidade, { texto: string; tom: Tone }> = {
  viavel: { texto: 'Viável', tom: 'ok' },
  inviavel: { texto: 'Inviável', tom: 'bad' },
  nao_configurada: { texto: 'Não configurada', tom: 'neutral' },
};

// Verificação informativa vinda do servidor: o estado é sempre o TEXTO do selo, a cor só reforça.
export function ListaViabilidade({ estado }: { estado: FetchState<Viabilidade[]> }) {
  return (
    <AsyncBody state={estado} rows={4}>
      {(lista) =>
        lista.length === 0 ? (
          <CardEmpty>Nenhum tipo de documento retornado.</CardEmpty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {lista.map((v) => <CartaoViabilidade key={v.category} v={v} />)}
          </div>
        )
      }
    </AsyncBody>
  );
}

function CartaoViabilidade({ v }: { v: Viabilidade }) {
  const nome = DOC_CATEGORIA_LABEL[v.category] ?? v.category;
  const id = `viab-${v.category}`;
  const st = STATUS[v.status];
  return (
    <article aria-labelledby={id} className="adm-card-2 min-w-0 p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <h4 id={id} className="font-semibold text-brand-900">{nome}</h4>
        <Badge tone={st.tom}>{st.texto}</Badge>
      </div>
      {v.faltas.length > 0 && (
        <ul className="mt-2 ml-4 list-disc space-y-1 text-xs text-adm-status-crit-text">
          {v.faltas.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
      {v.avisos.length > 0 && (
        <ul className="mt-2 ml-4 list-disc space-y-1 text-xs text-adm-status-warn-text">
          {v.avisos.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}
      <dl className="mt-3 space-y-1.5 text-xs">
        {v.habilitados.map((h) => (
          <div key={h.acao}>
            <dt className="font-medium text-brand-700">{ACAO_LABEL[h.acao] ?? h.acao}</dt>
            <dd className="text-brand-900">
              {h.pessoas.length === 0 ? (
                <span className="text-brand-700">Ninguém habilitado</span>
              ) : (
                <ul>
                  {h.pessoas.map((p) => (
                    <li key={p.id}>
                      {p.registro_confirmado === undefined
                        ? p.nome
                        : `${p.nome} — ${p.registro_confirmado ? 'registro confirmado' : 'sem registro confirmado'}`}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
