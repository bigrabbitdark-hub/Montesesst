'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { CipaMeeting, CipaMeetingParticipant, CipaMeetingAtaDraft, CipaMember, formatDateBR } from '@/lib/cipa-types';

const CHECKLIST_ITEMS: { field: keyof CipaMeeting; label: string; group: 'Antes' | 'Durante' | 'Depois' }[] = [
  { field: 'chk_pauta_definida', label: 'Pauta definida', group: 'Antes' },
  { field: 'chk_participantes_convocados', label: 'Participantes convocados', group: 'Antes' },
  { field: 'chk_local_confirmado', label: 'Local confirmado', group: 'Antes' },
  { field: 'chk_presenca_registrada', label: 'Presença registrada', group: 'Durante' },
  { field: 'chk_assuntos_discutidos', label: 'Assuntos discutidos', group: 'Durante' },
  { field: 'chk_decisoes_registradas', label: 'Decisões registradas', group: 'Durante' },
  { field: 'chk_ata_criada', label: 'Ata criada', group: 'Depois' },
  { field: 'chk_acoes_distribuidas', label: 'Ações distribuídas', group: 'Depois' },
  { field: 'chk_pendencias_registradas', label: 'Pendências registradas', group: 'Depois' },
];

// Achado da revisão final (Finding 1 — Important): sem um teto, um rascunho
// 'processando' que nunca sai desse estado (ex.: o backend derrubou o job em
// segundo plano) fazia o polling continuar pra sempre, sem nenhuma saída pro
// usuário. ~10 minutos a 4s por tentativa é generoso pra reuniões longas
// (transcrição de um áudio de horas), mas não é infinito.
const MAX_POLL_ATTEMPTS = 150;

export default function ReuniaoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [meeting, setMeeting] = useState<CipaMeeting | null>(null);
  const [participants, setParticipants] = useState<CipaMeetingParticipant[]>([]);
  const [members, setMembers] = useState<CipaMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pauta, setPauta] = useState('');
  const [discussoes, setDiscussoes] = useState('');
  const [deliberacoes, setDeliberacoes] = useState('');
  const [novoNomeLivre, setNovoNomeLivre] = useState('');
  const [novoMembroId, setNovoMembroId] = useState('');

  const [ataDraft, setAtaDraft] = useState<CipaMeetingAtaDraft | null>(null);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttempts = useRef(0);

  async function load() {
    const token = getToken();
    if (!token) {
      router.push('/login');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const meetingRes = await fetch(`/api/cipa/meetings/${params.id}`, { headers });
    if (!meetingRes.ok) {
      setLoadError('Não foi possível carregar esta reunião.');
      setReady(true);
      return;
    }
    setLoadError(null);
    const m: CipaMeeting = await meetingRes.json();
    setMeeting(m);
    setPauta(m.pauta ?? '');
    setDiscussoes(m.discussoes ?? '');
    setDeliberacoes(m.deliberacoes ?? '');
    const membersData: CipaMember[] = await fetch(`/api/cipa/members?company_unit_id=${m.company_unit_id}`, {
      headers,
    }).then((r) => (r.ok ? r.json() : []));
    setMembers(membersData);
    // Achado da revisão final (Fix 1 — Critical): sem este fetch, o estado
    // `participants` só era populado pela resposta de addParticipant nesta
    // mesma sessão — recarregar a página "esquecia" os participantes já
    // salvos, e o próximo PUT (full replace) apagava eles do banco.
    const participantsData: CipaMeetingParticipant[] = await fetch(
      `/api/cipa/meetings/${params.id}/participants`,
      { headers },
    ).then((r) => (r.ok ? r.json() : []));
    setParticipants(participantsData);
    const draftRes = await fetch(`/api/cipa/meetings/${params.id}/ata-ai-draft`, { headers });
    if (draftRes.ok) {
      const draft: CipaMeetingAtaDraft = await draftRes.json();
      setAtaDraft(draft);
      if (draft.status === 'processando') startPolling();
    }
    setReady(true);
  }

  function startPolling() {
    if (pollTimer.current) return;
    pollAttempts.current = 0;
    pollTimer.current = setInterval(async () => {
      pollAttempts.current += 1;
      if (pollAttempts.current > MAX_POLL_ATTEMPTS) {
        if (pollTimer.current) {
          clearInterval(pollTimer.current);
          pollTimer.current = null;
        }
        setAudioError('Isso está demorando mais que o esperado. Tente enviar o áudio novamente.');
        setAtaDraft(null);
        return;
      }
      const token = getToken();
      if (!token) return;
      const res = await fetch(`/api/cipa/meetings/${params.id}/ata-ai-draft`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const draft: CipaMeetingAtaDraft = await res.json();
      setAtaDraft(draft);
      if (draft.status !== 'processando' && pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    }, 4000);
  }

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  async function uploadAudio(file: File) {
    setAudioError(null);
    setUploadingAudio(true);
    const token = getToken();
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`/api/cipa/meetings/${params.id}/ata-audio`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        // Achado da revisão final (Finding 2 — Important): 503 é o backend
        // recusando de propósito porque a chave da API de transcrição ainda
        // não está ativada nesta conta — tentar de novo nunca vai funcionar,
        // então a mensagem não sugere isso (diferente do branch genérico
        // abaixo, que cobre erros que podem ser transitórios).
        if (res.status === 503) {
          setAudioError('Transcrição de áudio ainda não está disponível nesta conta.');
        } else {
          setAudioError('Não foi possível iniciar a transcrição. Confira o formato do arquivo.');
        }
        return;
      }
      const draft: CipaMeetingAtaDraft = await res.json();
      setAtaDraft(draft);
      startPolling();
    } catch {
      // Achado da revisão final (Finding 4 — Important): sem este catch, uma
      // conexão caindo no meio do upload (fetch rejeitando) ficava
      // silenciosa — nenhuma mensagem de erro, só uma promise rejeitada sem
      // handler no console e o input de arquivo reaparecendo sem explicação.
      setAudioError('Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.');
    } finally {
      setUploadingAudio(false);
    }
  }

  function applyDraftField(field: 'pauta' | 'discussoes' | 'deliberacoes', value: string) {
    if (field === 'pauta') setPauta(value);
    if (field === 'discussoes') setDiscussoes(value);
    if (field === 'deliberacoes') setDeliberacoes(value);
  }

  function discardDraftField(field: 'draft_pauta' | 'draft_discussoes' | 'draft_deliberacoes') {
    if (!ataDraft) return;
    setAtaDraft({ ...ataDraft, [field]: null });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (!ready) {
    return <div className="px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  // Achado da revisão final (Fix 2 — Important): sem checar r.ok, uma
  // reunião inexistente/inacessível (404/403) fazia `meeting` virar o body
  // de erro do NestJS (truthy, status_ata undefined) — isRascunho dava
  // false e a página renderizava como se a ata estivesse APROVADA
  // (travada), em vez de um estado de erro neutro.
  if (loadError || !meeting) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-brand-700">{loadError ?? 'Não foi possível carregar esta reunião.'}</p>
      </div>
    );
  }

  const isRascunho = meeting.status_ata === 'rascunho';

  async function patch(data: Record<string, unknown>) {
    setError(null);
    setSaving(true);
    const token = getToken();
    try {
      const res = await fetch(`/api/cipa/meetings/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        setError('Não foi possível salvar. A ata pode já estar aprovada.');
        return;
      }
      const updated = await res.json();
      setMeeting(updated);
    } finally {
      setSaving(false);
    }
  }

  async function toggleChecklist(field: keyof CipaMeeting) {
    if (!isRascunho || !meeting) return;
    await patch({ [field]: !meeting[field] });
  }

  async function saveAta() {
    await patch({ pauta, discussoes, deliberacoes });
  }

  async function addParticipant() {
    // Achado da revisão final (Fix — Important): GET :id/participants (e a
    // resposta do próprio PUT) retorna rows completas do banco, com `id` e
    // `meeting_id`. O DTO do backend (SetParticipantsDto/ParticipantDto) usa
    // whitelist + forbidNonWhitelisted e só aceita cipa_member_id/nome_livre/
    // presente — enviar `id`/`meeting_id` de volta faz o PUT ser rejeitado
    // com 400. Reduzimos cada participante existente só aos campos aceitos
    // antes de reenviar.
    const existingSlim = participants.map((p) => ({
      cipa_member_id: p.cipa_member_id ?? undefined,
      nome_livre: p.nome_livre ?? undefined,
      presente: p.presente,
    }));
    const next = [
      ...existingSlim,
      novoMembroId
        ? { cipa_member_id: novoMembroId, presente: true }
        : { nome_livre: novoNomeLivre, presente: true },
    ];
    const token = getToken();
    const res = await fetch(`/api/cipa/meetings/${params.id}/participants`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ participants: next }),
    });
    if (res.ok) {
      setParticipants(await res.json());
      setNovoNomeLivre('');
      setNovoMembroId('');
    } else {
      setError('Não foi possível adicionar o participante.');
    }
  }

  async function approve() {
    if (!confirm('Aprovar esta ata? Depois de aprovada, ela fica travada para edição.')) return;
    setError(null);
    setSaving(true);
    const token = getToken();
    try {
      const res = await fetch(`/api/cipa/meetings/${params.id}/aprovar-ata`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError('Não foi possível aprovar a ata.');
        return;
      }
      setMeeting(await res.json());
    } finally {
      setSaving(false);
    }
  }

  async function reopen() {
    if (!confirm('Reabrir esta ata para edição?')) return;
    setError(null);
    setSaving(true);
    const token = getToken();
    try {
      const res = await fetch(`/api/cipa/meetings/${params.id}/reabrir-ata`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError('Não foi possível reabrir a ata.');
        return;
      }
      setMeeting(await res.json());
    } finally {
      setSaving(false);
    }
  }

  const titulo = meeting.tipo === 'ordinaria' ? `${meeting.numero}ª Reunião Ordinária da CIPA` : meeting.titulo;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-bold text-brand-900">{titulo}</h1>
      <p className="mt-1 text-sm text-brand-700">
        {meeting.data ? formatDateBR(meeting.data) : 'Sem data'} {meeting.hora ? `às ${meeting.hora}` : ''}
        {meeting.local ? ` — ${meeting.local}` : ''}
      </p>

      <div className="mt-3">
        {isRascunho ? (
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
            📝 Rascunho
          </span>
        ) : (
          <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800">
            ✅ Ata aprovada
          </span>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-brand-700">Checklist</h2>
      {(['Antes', 'Durante', 'Depois'] as const).map((group) => (
        <div key={group} className="mt-3">
          <p className="text-xs font-semibold text-brand-500">{group}</p>
          <div className="mt-1 flex flex-col gap-1">
            {CHECKLIST_ITEMS.filter((i) => i.group === group).map((item) => (
              <label key={item.field} className="flex items-center gap-2 text-sm text-brand-900">
                <input
                  type="checkbox"
                  checked={Boolean(meeting[item.field])}
                  disabled={!isRascunho || saving}
                  onChange={() => toggleChecklist(item.field)}
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>
      ))}

      {(isRascunho || ataDraft?.transcript) && (
        <>
          <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-brand-700">
            🎙️ Gerar ata por áudio
          </h2>
          <div className="mt-3 rounded-lg border border-brand-100 p-4">
            {isRascunho && (
              <>
                {audioError && <p className="mb-2 text-sm text-red-600">{audioError}</p>}

                {(!ataDraft || ataDraft.status === 'falhou') && (
                  <div className="flex flex-col gap-2">
                    {ataDraft?.status === 'falhou' && (
                      <p className="text-sm text-red-600">
                        {ataDraft.error_message ?? 'Não foi possível gerar o rascunho.'} Tente enviar o áudio de novo.
                      </p>
                    )}
                    <label className="flex flex-col gap-1 text-sm text-brand-900">
                      Áudio da reunião (mp3, m4a, ogg ou wav)
                      <input
                        type="file"
                        accept="audio/*"
                        disabled={uploadingAudio}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadAudio(file);
                          e.target.value = '';
                        }}
                        className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                      />
                    </label>
                  </div>
                )}

                {ataDraft?.status === 'processando' && (
                  <p className="text-sm text-brand-700">
                    Transcrevendo e gerando rascunho... isso pode levar alguns minutos. Pode continuar usando a página normalmente.
                  </p>
                )}

                {ataDraft?.status === 'concluido' && (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs font-semibold text-brand-500">
                      Sugestão gerada por IA — revise e confirme. Não substitui a avaliação do profissional habilitado.
                    </p>
                    {([
                      { field: 'draft_pauta' as const, applyField: 'pauta' as const, label: 'Pauta', value: ataDraft.draft_pauta },
                      { field: 'draft_discussoes' as const, applyField: 'discussoes' as const, label: 'Discussões', value: ataDraft.draft_discussoes },
                      { field: 'draft_deliberacoes' as const, applyField: 'deliberacoes' as const, label: 'Deliberações', value: ataDraft.draft_deliberacoes },
                    ]).map((card) =>
                      card.value === null ? null : (
                        <div key={card.field} className="rounded-md border border-brand-100 bg-brand-50 p-3">
                          <p className="text-xs font-semibold text-brand-700">{card.label} (sugestão)</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-brand-900">{card.value || '(vazio)'}</p>
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => {
                                applyDraftField(card.applyField, card.value ?? '');
                                discardDraftField(card.field);
                              }}
                              className="rounded-[9px] bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                            >
                              Aplicar
                            </button>
                            <button
                              onClick={() => discardDraftField(card.field)}
                              className="rounded-[9px] border border-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-white"
                            >
                              Descartar
                            </button>
                          </div>
                        </div>
                      ),
                    )}
                    <button
                      onClick={() => setAtaDraft(null)}
                      className="self-start text-xs font-semibold text-brand-700 underline"
                    >
                      Enviar outro áudio
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Fora do isRascunho acima de propósito: a transcrição continua
                consultável depois da ata aprovada — é justamente nesse ponto
                (alguém questionando se a ata reflete bem o que foi dito) que
                ela é mais útil, já que o áudio original não existe mais pra
                reouvir (spec §2: "áudio original é descartado após a
                transcrição"). Mesmo raciocínio do link de download do PDF,
                que também só faz sentido — e só aparece — depois de aprovada. */}
            {ataDraft?.transcript && (
              <div className={isRascunho ? 'mt-3' : undefined}>
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="text-xs font-semibold text-brand-700 underline"
                >
                  {showTranscript ? 'Ocultar transcrição' : 'Ver transcrição'}
                </button>
                {showTranscript && (
                  <p className="mt-2 whitespace-pre-wrap rounded-md bg-brand-50 p-3 text-xs text-brand-700">
                    {ataDraft.transcript}
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-brand-700">Ata</h2>
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Pauta
          <textarea
            value={pauta}
            disabled={!isRascunho}
            onChange={(e) => setPauta(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2 disabled:bg-brand-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Discussões
          <textarea
            value={discussoes}
            disabled={!isRascunho}
            onChange={(e) => setDiscussoes(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2 disabled:bg-brand-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Deliberações
          <textarea
            value={deliberacoes}
            disabled={!isRascunho}
            onChange={(e) => setDeliberacoes(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2 disabled:bg-brand-50"
          />
        </label>
        {isRascunho && (
          <button
            onClick={saveAta}
            disabled={saving}
            className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar ata'}
          </button>
        )}
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-brand-700">Participantes</h2>
      <div className="mt-3 flex flex-col gap-2">
        {participants.map((p) => (
          <p key={p.id} className="text-sm text-brand-900">
            {p.cipa_member_id ? members.find((m) => m.id === p.cipa_member_id)?.nome ?? 'Membro' : p.nome_livre}
          </p>
        ))}
      </div>
      {isRascunho && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Membro cadastrado
            <select
              value={novoMembroId}
              onChange={(e) => {
                setNovoMembroId(e.target.value);
                setNovoNomeLivre('');
              }}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            >
              <option value="">Selecione...</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </label>
          <span className="pb-2 text-sm text-brand-700">ou</span>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Convidado (nome livre)
            <input
              type="text"
              value={novoNomeLivre}
              onChange={(e) => {
                setNovoNomeLivre(e.target.value);
                setNovoMembroId('');
              }}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <button
            onClick={addParticipant}
            disabled={!novoMembroId && !novoNomeLivre}
            className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
      )}

      <div className="mt-10 flex gap-3">
        {isRascunho ? (
          <button
            onClick={approve}
            disabled={saving}
            className="rounded-[9px] bg-green-600 px-6 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            ✅ Aprovar ata
          </button>
        ) : (
          <>
            {meeting.ata_document_id && (
              <a
                href={`/api/documents/${meeting.ata_document_id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[9px] border border-brand-500 px-6 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                📄 Baixar ata (PDF)
              </a>
            )}
            <button
              onClick={reopen}
              disabled={saving}
              className="rounded-[9px] border border-brand-100 px-6 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
            >
              🔓 Reabrir ata
            </button>
          </>
        )}
      </div>
    </div>
  );
}
