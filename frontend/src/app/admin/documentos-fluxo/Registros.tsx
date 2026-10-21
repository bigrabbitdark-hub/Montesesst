'use client';

import { useRef, useState, type FormEvent } from 'react';
import { AsyncBody, Badge, CardEmpty, CardError, CardSkeleton, type Tone } from '@/components/admin/Card';
import { adminSend } from '@/components/admin/api';
import { useAdminFetch, type FetchState } from '@/components/admin/useAdminFetch';
import { Dialogo } from './Dialogo';
import { BASE_DOCUMENTOS, TEXTO_CONFIRMAR, TEXTO_REVOGAR, type Registro, type Socio, type StatusRegistro } from './tipos';

const STATUS: Record<StatusRegistro, { texto: string; tom: Tone }> = {
  pendente: { texto: 'Pendente', tom: 'warn' },
  confirmado: { texto: 'Confirmado', tom: 'ok' },
  revogado: { texto: 'Revogado', tom: 'bad' },
};

type Acao = { tipo: 'confirmar' | 'revogar'; reg: Registro };

// O número do registro é dado do cadastro e aparece só na tabela e no diálogo (para o admin conferir).
// Nunca vai a URL (as rotas usam o id), a console nem a mensagens de erro (todas aqui são textos fixos
// ou a mensagem do servidor).
export function RegistrosProfissionais({ socios, onMudouViabilidade }: { socios: FetchState<Socio[]>; onMudouViabilidade: () => void }) {
  const lista = useAdminFetch<Registro[]>(`${BASE_DOCUMENTOS}/registros`);
  const [mensagem, setMensagem] = useState('');
  const [acao, setAcao] = useState<Acao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const emVoo = useRef(false);

  async function executar() {
    if (!acao || emVoo.current) return;
    emVoo.current = true;
    setOcupado(true);
    setErro('');
    const confirmar = acao.tipo === 'confirmar';
    try {
      await adminSend('POST', `${BASE_DOCUMENTOS}/registros/${encodeURIComponent(acao.reg.id)}/${confirmar ? 'confirmar' : 'revogar'}`);
      setMensagem(confirmar ? 'Registro confirmado.' : 'Registro revogado.');
      setAcao(null);
      lista.reload();
      onMudouViabilidade();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir a ação. Tente novamente.');
      lista.reload(); // o estado pode ter mudado (ex.: 409): atualiza a lista
    } finally {
      emVoo.current = false;
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-6">
      <FormularioRegistro
        socios={socios}
        onCriado={() => { setMensagem('Registro cadastrado como pendente. Confirme-o depois de conferir em fonte oficial.'); lista.reload(); }}
        limparMensagem={() => setMensagem('')}
      />

      {mensagem && <p role="status" className="text-sm text-adm-status-ok-text">{mensagem}</p>}

      <AsyncBody state={lista} rows={4}>
        {(registros) =>
          registros.length === 0 ? (
            <CardEmpty>Nenhum registro profissional cadastrado.</CardEmpty>
          ) : (
            <div className="overflow-x-auto">
              <table className="adm-table">
                <caption className="sr-only">Registros profissionais dos sócios</caption>
                <thead>
                  <tr>
                    <th scope="col">Sócio</th>
                    <th scope="col">Conselho</th>
                    <th scope="col">Número</th>
                    <th scope="col">UF</th>
                    <th scope="col">Situação</th>
                    <th scope="col"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((r) => {
                    const nome = r.nome ?? 'Sócio não localizado';
                    const st = STATUS[r.status] ?? { texto: r.status, tom: 'neutral' as Tone };
                    return (
                      <tr key={r.id}>
                        <th scope="row" className="text-left font-medium text-brand-900">{nome}</th>
                        <td className="text-brand-900">{r.council}</td>
                        <td className="text-brand-900">{r.registration_number}</td>
                        <td className="text-brand-900">{r.uf}</td>
                        <td><Badge tone={st.tom}>{st.texto}</Badge></td>
                        <td>
                          {r.status === 'pendente' && (
                            <button
                              type="button"
                              aria-label={`Confirmar registro de ${nome}`}
                              onClick={() => { setErro(''); setMensagem(''); setAcao({ tipo: 'confirmar', reg: r }); }}
                              className="adm-link whitespace-nowrap"
                            >
                              Confirmar
                            </button>
                          )}
                          {r.status === 'confirmado' && (
                            <button
                              type="button"
                              aria-label={`Revogar registro de ${nome}`}
                              onClick={() => { setErro(''); setMensagem(''); setAcao({ tipo: 'revogar', reg: r }); }}
                              className="adm-link-danger whitespace-nowrap"
                            >
                              Revogar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </AsyncBody>

      {acao && (
        <Dialogo
          titulo={acao.tipo === 'confirmar' ? 'Confirmar registro profissional' : 'Revogar registro profissional'}
          ocupado={ocupado}
          onFechar={() => setAcao(null)}
        >
          <p className="text-sm text-brand-900">
            {acao.reg.nome ?? 'Sócio não localizado'} — {acao.reg.council} {acao.reg.registration_number}/{acao.reg.uf}
          </p>
          <p className="mt-3 text-sm text-brand-900">{acao.tipo === 'confirmar' ? TEXTO_CONFIRMAR : TEXTO_REVOGAR}</p>
          {erro && <p role="alert" className="mt-3 text-sm text-adm-status-crit-text">{erro}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-3">
            <button type="button" onClick={() => setAcao(null)} disabled={ocupado} className="adm-btn disabled:opacity-50">
              Cancelar
            </button>
            <button
              type="button"
              onClick={executar}
              disabled={ocupado}
              className={`adm-btn ${acao.tipo === 'confirmar' ? 'adm-btn-primary' : 'adm-btn-danger'} disabled:opacity-50`}
            >
              {ocupado ? 'Enviando...' : acao.tipo === 'confirmar' ? 'Confirmar registro' : 'Revogar registro'}
            </button>
          </div>
        </Dialogo>
      )}
    </div>
  );
}

function FormularioRegistro({ socios, onCriado, limparMensagem }: {
  socios: FetchState<Socio[]>; onCriado: () => void; limparMensagem: () => void;
}) {
  const [userId, setUserId] = useState('');
  const [conselho, setConselho] = useState('');
  const [numero, setNumero] = useState('');
  const [uf, setUf] = useState('');
  const [problemas, setProblemas] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const emVoo = useRef(false);

  if (!socios.data) {
    return socios.error ? <CardError onRetry={socios.reload} message="Não foi possível carregar os sócios." /> : <CardSkeleton rows={2} />;
  }
  if (socios.data.length === 0) {
    return <CardEmpty>Sem sócios cadastrados, não há a quem vincular um registro profissional.</CardEmpty>;
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (emVoo.current) return;
    const c = conselho.trim();
    const n = numero.trim();
    const erros: string[] = [];
    if (!userId) erros.push('Selecione o sócio.');
    if (c.length < 2 || c.length > 20) erros.push('Informe o conselho (2 a 20 caracteres).');
    if (n.length < 1 || n.length > 30) erros.push('Informe o número do registro (1 a 30 caracteres).');
    if (!/^[A-Z]{2}$/.test(uf)) erros.push('Informe a UF com 2 letras maiúsculas.');
    setProblemas(erros);
    if (erros.length) return;
    emVoo.current = true;
    setEnviando(true);
    limparMensagem();
    try {
      await adminSend('POST', `${BASE_DOCUMENTOS}/registros`, { user_id: userId, council: c, registration_number: n, uf });
      setConselho(''); setNumero(''); setUf(''); setUserId('');
      onCriado();
    } catch (err) {
      setProblemas([err instanceof Error ? err.message : 'Não foi possível concluir a ação. Tente novamente.']);
    } finally {
      emVoo.current = false;
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex min-w-0 flex-col gap-1 text-sm text-brand-900">
        Sócio
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className="adm-input">
          <option value="">Selecione…</option>
          {socios.data.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-sm text-brand-900">
        Conselho
        <input value={conselho} onChange={(e) => setConselho(e.target.value)} autoComplete="off" className="adm-input" />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-sm text-brand-900">
        Número do registro
        <input value={numero} onChange={(e) => setNumero(e.target.value)} autoComplete="off" className="adm-input" />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-sm text-brand-900">
        UF
        <input
          value={uf}
          onChange={(e) => setUf(e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2))}
          autoComplete="off"
          className="adm-input"
        />
      </label>
      {problemas.length > 0 && (
        <div role="alert" className="text-sm text-adm-status-crit-text sm:col-span-2 lg:col-span-4">
          <ul className="ml-4 list-disc">
            {problemas.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      )}
      <button type="submit" disabled={enviando} className="adm-btn adm-btn-primary self-start disabled:opacity-50 sm:col-span-2 lg:col-span-4">
        {enviando ? 'Cadastrando...' : 'Cadastrar registro'}
      </button>
    </form>
  );
}
