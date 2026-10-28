'use client';

import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { atuacaoFetch, erroEscritaPgr, erroLeituraPgr, NAO_INFORMADO, type CargoEmpresa, type Ghe } from '../../../api';
import { BTN, BTN_PRIMARY, ERRO } from '../../estilos';
import { CargosGhe } from './CargosGhe';
import { GheForm, type Unidade } from './GheForm';

type Edicao = { ghe: Ghe | null } | null;

function ordenar(l: Ghe[]): Ghe[] {
  return [...l].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// Etapa 3 — GHE (ambientes). Cada ação grava na hora; o estado do servidor é o rascunho. `expostos` é só um número.
export function Ambientes({ tenantId, ghes, unidades, onGhes, onMudou }: {
  tenantId: string; ghes: Ghe[]; unidades: Unidade[]; onGhes: (l: Ghe[]) => void; onMudou: () => void;
}) {
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const base = `/pgr/empresas/${tenantId}/ghes`;
  const origem = useRef<HTMLElement | null>(null);
  const [cargos, setCargos] = useState<CargoEmpresa[] | null>(null);
  const [erroCargos, setErroCargos] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    atuacaoFetch<CargoEmpresa[]>(`/pgr/empresas/${tenantId}/cargos`)
      .then((d) => { if (vivo) setCargos(d); })
      .catch((e) => { if (vivo) setErroCargos(erroLeituraPgr(e)); });
    return () => { vivo = false; };
  }, [tenantId]);
  const nomeUnidade = (id: string | null) => (id ? (unidades.find((u) => u.id === id)?.name ?? 'unidade não encontrada') : 'não informada');

  function trocar(g: Ghe) {
    onGhes(ordenar(ghes.some((x) => x.id === g.id) ? ghes.map((x) => (x.id === g.id ? g : x)) : [...ghes, g]));
    onMudou();
  }
  function fechar() {
    setEdicao(null);
    const el = origem.current;
    origem.current = null;
    if (el) setTimeout(() => { if (el.isConnected) el.focus(); }, 0);
  }
  function abrir(g: Ghe | null, el: HTMLElement) {
    origem.current = el; setErro(null); setOk(null); setErroForm(null); setEdicao({ ghe: g });
  }

  async function salvar(payload: Record<string, unknown>) {
    const g = edicao?.ghe ?? null;
    setSalvando(true); setErroForm(null);
    try {
      const salvo = await atuacaoFetch<Ghe>(g ? `${base}/${g.id}` : base, { method: g ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      trocar(salvo);
      setOk(g ? `GHE "${salvo.name}" atualizado.` : `GHE "${salvo.name}" criado.`);
      fechar();
    } catch (e) { setErroForm(erroEscritaPgr(e)); } finally { setSalvando(false); }
  }

  // PUT substitui o conjunto inteiro de cargos do GHE.
  async function definirCargos(g: Ghe, ids: string[]): Promise<boolean> {
    setOcupado(g.id); setErro(null); setOk(null);
    try {
      const salvo = await atuacaoFetch<Ghe>(`${base}/${g.id}/cargos`, { method: 'PUT', body: JSON.stringify({ position_ids: ids }) });
      trocar(salvo);
      setOk(`Cargos do GHE "${salvo.name}" atualizados.`);
      return true;
    } catch (e) { setErro(erroEscritaPgr(e)); return false; } finally { setOcupado(null); }
  }
  const removerCargo = (g: Ghe, cargoId: string) => definirCargos(g, g.positions.filter((p) => p.id !== cargoId).map((p) => p.id));

  async function excluir(g: Ghe) {
    setOcupado(g.id); setErro(null); setOk(null);
    try {
      await atuacaoFetch(`${base}/${g.id}`, { method: 'DELETE' });
      onGhes(ghes.filter((x) => x.id !== g.id));
      onMudou();
      setOk(`GHE "${g.name}" excluído.`);
    } catch (e) { setErro(erroEscritaPgr(e)); } finally { setOcupado(null); setExcluindo(null); }
  }

  return (
    <Card title="Ambientes (GHE)">
      <p className="text-sm text-dash-muted">
        Grupos homogêneos de exposição: ambientes, processos e atividades. Cada alteração é salva na hora e você pode continuar depois.
      </p>
      <div className="mt-3">
        {!edicao && <button type="button" className={BTN_PRIMARY} onClick={(e) => abrir(null, e.currentTarget)}>Novo ambiente (GHE)</button>}
      </div>
      <div className="mt-3">
        {edicao && <GheForm key={edicao.ghe?.id ?? 'novo'} inicial={edicao.ghe} unidades={unidades} salvando={salvando} erro={erroForm} onSalvar={salvar} onCancelar={fechar} />}
      </div>
      {ok && <p role="status" className="mt-2 text-sm text-dash-primary">{ok}</p>}
      {erro && <p role="alert" className={`mt-2 ${ERRO}`}>{erro}</p>}
      {ghes.length === 0 ? (
        <p className="mt-4 text-sm text-dash-muted">Nenhum GHE cadastrado ainda.</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {ghes.map((g) => (
            <li key={g.id} className="rounded-md border border-dash-border-input p-3">
              <p className="font-semibold text-dash-primary">{g.name}</p>
              <p className="mt-1 text-sm text-dash-muted">Unidade: {nomeUnidade(g.company_unit_id)}</p>
              <p className="text-sm text-dash-muted">{g.expostos === 1 ? '1 funcionário exposto' : `${g.expostos} funcionários expostos`}</p>
              <p className="text-sm text-dash-muted">Riscos: {g.riscos}</p>
              <div className="mt-2 text-sm">
                <span className="text-dash-muted">Cargos: </span>
                {g.positions.length === 0 && <span className="text-dash-muted">{NAO_INFORMADO}</span>}
                <ul className="inline-flex flex-wrap gap-2 align-middle">
                  {g.positions.map((p) => (
                    <li key={p.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
                      <span>{p.name}</span>
                      <button
                        type="button" disabled={ocupado === g.id} onClick={() => removerCargo(g, p.id)}
                        aria-label={`Remover cargo ${p.name} do GHE ${g.name}`}
                        className="rounded px-1 text-dash-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:opacity-50"
                      >×</button>
                    </li>
                  ))}
                </ul>
                <CargosGhe tenantId={tenantId} ghe={g} cargos={cargos} erroCargos={erroCargos} ocupado={ocupado === g.id} onSalvar={(ids) => definirCargos(g, ids)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={BTN} disabled={ocupado === g.id || salvando} onClick={(e) => abrir(g, e.currentTarget)} aria-label={`Editar GHE ${g.name}`}>Editar</button>
                {excluindo === g.id ? (
                  <>
                    <button type="button" className={BTN_PRIMARY} disabled={ocupado === g.id} onClick={() => excluir(g)}>Confirmar exclusão</button>
                    <button type="button" className={BTN} disabled={ocupado === g.id} onClick={() => setExcluindo(null)}>Cancelar</button>
                  </>
                ) : (
                  <button type="button" className={BTN} disabled={ocupado === g.id} onClick={() => setExcluindo(g.id)} aria-label={`Excluir GHE ${g.name}`}>Excluir</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
