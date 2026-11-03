'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { atuacaoFetch, type PainelResposta, type ResumoFinanceiro } from './api';
import { AgendaHoje, BlocoSemDados, CategoriasEspera, CategoriasEsperaSemDados, MSG_PARCIAL, KpiLink, LINK_TEXTO, Pendencias, Secao } from './painel/Blocos';

const GRID = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4';

function Painel({ p, onRetry }: { p: PainelResposta; onRetry: () => void }) {
  const indisp = (bloco: string) => p.indisponiveis.includes(bloco);
  const { empresas, tarefas, agenda, documentos } = p;
  const docsTemAlgumNull = documentos !== null && Object.values(documentos).some((v) => v === null);
  return (
    <>
      <Secao id="painel-empresas" titulo="Empresas">
        {empresas && typeof empresas.acessiveis === 'number'
          ? <div className={GRID}><KpiLink href="/atuacao/empresas" label="Empresas acessíveis" value={empresas.acessiveis} /></div>
          : <BlocoSemDados indisponivel={indisp('empresas')} onRetry={onRetry} />}
      </Secao>

      <Secao id="painel-tarefas" titulo="Tarefas">
        {tarefas ? (
          <div className={GRID}>
            <KpiLink href="/atuacao/tarefas" label="Tarefas abertas" value={tarefas.abertas} />
            <KpiLink href="/atuacao/tarefas?vencidas=true" label="Tarefas vencidas" value={tarefas.vencidas} />
            <KpiLink href="/atuacao/tarefas" label="Tarefas para hoje" value={tarefas.hoje} hint="Abre todas as tarefas" />
            <KpiLink href="/atuacao/tarefas?status=blocked" label="Tarefas bloqueadas" value={tarefas.bloqueadas} />
          </div>
        ) : <BlocoSemDados indisponivel={indisp('tarefas')} onRetry={onRetry} />}
      </Secao>

      <Secao id="painel-categorias" titulo="Pendências por categoria">
        {tarefas ? <CategoriasEspera tarefas={tarefas} /> : <CategoriasEsperaSemDados indisponivel={indisp('tarefas')} />}
      </Secao>

      <Secao id="painel-documentos" titulo="Documentos">
        {documentos ? (
          <>
            <div className={GRID}>
              {documentos.vencidos !== null && <KpiLink href="/atuacao/vencimentos?faixa=vencidos" label="Documentos vencidos" value={documentos.vencidos} hint="Validade anterior a hoje" />}
              {documentos.vence_7 !== null && <KpiLink href="/atuacao/vencimentos?faixa=7" label="Vencem em até 7 dias" value={documentos.vence_7} />}
              {documentos.vence_15 !== null && <KpiLink href="/atuacao/vencimentos?faixa=15" label="Vencem em até 15 dias" value={documentos.vence_15} hint="Inclui os de até 7 dias" />}
              {documentos.vence_30 !== null && <KpiLink href="/atuacao/vencimentos?faixa=30" label="Vencem em até 30 dias" value={documentos.vence_30} hint="Inclui os de até 7 e 15 dias" />}
              {documentos.etapas && (
                <>
                  <KpiLink href="/atuacao/documentos?status=em_revisao" label="Aguardando minha revisão" value={documentos.etapas.em_revisao} hint="Revisar e aprovar" />
                  <KpiLink href="/atuacao/documentos?status=aprovado" label="Aguardando minha assinatura" value={documentos.etapas.para_assinar} hint="Registro interno de assinatura" />
                  <KpiLink href="/atuacao/documentos?status=assinado" label="Prontos para entregar" value={documentos.etapas.para_entregar} hint="Assinados, ainda não publicados ao cliente" />
                </>
              )}
              {documentos.aguardando_acao !== null && (
                <KpiLink href="/atuacao/documentos" label="Documentos aguardando ação" value={documentos.aguardando_acao} hint="Em revisão, aprovados ou assinados (registro interno)" />
              )}
            </div>
            {docsTemAlgumNull && <p className="mt-3 text-sm text-dash-muted">{MSG_PARCIAL}</p>}
          </>
        ) : <BlocoSemDados indisponivel={indisp('documentos')} onRetry={onRetry} />}
      </Secao>

      <Secao id="painel-agenda" titulo="Minha agenda">
        {agenda ? (
          <>
            <div className={`${GRID} mb-4`}>
              <KpiLink href="/atuacao/agenda" label="Compromissos hoje" value={agenda.hoje_total} hint={`${agenda.proximos_7_dias} nos próximos 7 dias`} />
            </div>
            <AgendaHoje hoje={agenda.hoje} total={agenda.hoje_total} />
            <Link href="/atuacao/agenda" className={`${LINK_TEXTO} mt-4 inline-block text-sm`}>Ver agenda</Link>
          </>
        ) : <BlocoSemDados indisponivel={indisp('agenda')} onRetry={onRetry} />}
      </Secao>

      <Secao id="painel-pendencias" titulo="Pendências prioritárias">
        <Pendencias itens={p.pendencias} incompleta={p.indisponiveis.length > 0} />
      </Secao>
    </>
  );
}

function FinanceiroKpi() {
  const [data, setData] = useState<ResumoFinanceiro | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    atuacaoFetch<ResumoFinanceiro>('/financeiro/resumo')
      .then((d) => {
        if (typeof d?.clientes?.com_pendencia !== 'number') throw new Error('Resumo financeiro indisponível.');
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(carregar, [carregar]);

  return (
    <section aria-labelledby="kpis-financeiro" className="mt-8">
      <h2 id="kpis-financeiro" className="mb-3 text-base font-semibold text-dash-primary">Financeiro</h2>
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-32 w-full"
        render={(r) => (
          <div className={GRID}>
            <KpiLink href="/atuacao/financeiro" label="Clientes com pendência financeira" value={r.clientes.com_pendencia} />
          </div>
        )}
      />
    </section>
  );
}

export default function AtuacaoPainelPage() {
  const [data, setData] = useState<PainelResposta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ultima = useRef(0);

  const carregar = useCallback(() => {
    const id = ++ultima.current;
    setLoading(true);
    setError(null);
    atuacaoFetch<PainelResposta>('/painel')
      .then((d) => {
        if (!d || typeof d !== 'object' || !Array.isArray(d.pendencias) || !Array.isArray(d.indisponiveis)) {
          throw new Error('Painel indisponível. Tente novamente.');
        }
        if (id === ultima.current) setData(d);
      })
      .catch((e: Error) => { if (id === ultima.current) { setData(null); setError(e.message); } })
      .finally(() => { if (id === ultima.current) setLoading(false); });
  }, []);

  useEffect(() => {
    carregar();
    // Respostas que chegam depois de sair da página (ou de uma nova tentativa) são descartadas.
    return () => { ultima.current += 1; };
  }, [carregar]);

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Painel" descricao="Números reais da carteira Montese, conforme as suas permissões." />
      <AsyncBody
        data={data}
        error={error}
        loading={loading && data === null}
        onRetry={carregar}
        skeletonClassName="h-48 w-full"
        render={(p) => <Painel p={p} onRetry={carregar} />}
      />
      <FinanceiroKpi />
    </div>
  );
}
