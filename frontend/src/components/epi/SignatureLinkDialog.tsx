'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { epiApi } from '@/lib/epi/api';
import { EpiApiError } from '@/lib/epi/errors';
import { formatDateTime } from '@/lib/epi/format';
import { newIdempotencyKey } from '@/lib/epi/idempotency';
import type { CreateRequestResult } from '@/lib/epi/types';
import { Modal } from './Modal';
import { mapSignatureError } from './signatureErrors';
import { BTN_PRIMARY, BTN_SECONDARY } from './styles';

interface Props {
  open: boolean;
  // A empresa vem do funcionário (RLS no backend); o parâmetro existe para que o técnico identifique a empresa em uso
  // e a tela remonte ao trocar de empresa. Não é enviado: o servidor nunca decide o tenant por valor do cliente.
  tenantId?: string;
  employeeId: string;
  deliveryIds?: string[];
  // `changed` = true quando um link foi gerado nesta abertura (só um sinal: link e código nunca saem do diálogo).
  onClose: (changed?: boolean) => void;
}

// O link e o código de 6 dígitos existem SÓ no estado deste componente: aparecem uma vez, somem ao fechar/desmontar,
// nunca vão a storage, cookie, console, URL da navegação ou título. Não são colocados em campos de formulário
// (o navegador poderia guardá-los) nem em refs.
export function SignatureLinkDialog(props: Props) {
  if (!props.open) return null;
  return <SignatureLinkInner {...props} />;
}

const formatCode = (c: string) => (/^\d{6}$/.test(c) ? `${c.slice(0, 3)} ${c.slice(3)}` : c);

function selectNode(el: HTMLElement | null) {
  const sel = window.getSelection?.();
  if (!el || !sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

function SignatureLinkInner({ employeeId, deliveryIds, onClose: onCloseProp }: Props) {
  const createdRef = useRef(false);
  const onClose = () => onCloseProp(createdRef.current);
  const [result, setResult] = useState<CreateRequestResult | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  // Chave de idempotência: uma por criação; reaproveitada na nova tentativa enquanto o formulário (funcionário + entregas) for o mesmo.
  const keyRef = useRef<{ form: string; key: string } | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const errRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLElement>(null);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => { if (result) resultRef.current?.focus(); }, [result]);
  useEffect(() => { if (error) errRef.current?.focus(); }, [error]);

  async function generate() {
    if (busyRef.current || result) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const form = `${employeeId}|${(deliveryIds ?? []).join(',')}`;
    if (!keyRef.current || keyRef.current.form !== form) keyRef.current = { form, key: newIdempotencyKey() };
    try {
      const r = await epiApi.createSignatureRequest({
        employee_id: employeeId,
        ...(deliveryIds && deliveryIds.length > 0 ? { delivery_ids: deliveryIds } : {}),
        idempotency_key: keyRef.current.key,
      });
      if (!aliveRef.current) return;
      createdRef.current = true;
      setResult(r);
      try {
        // QR gerado aqui, no navegador: nenhuma requisição a terceiros.
        const dataUrl = await QRCode.toDataURL(r.url, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
        if (aliveRef.current) setQr(dataUrl);
      } catch {
        if (aliveRef.current) setQrFailed(true);
      }
    } catch (e) {
      if (aliveRef.current) setError(mapSignatureError(e));
      // 409 "Link já emitido": a chave já foi consumida (a resposta com o código se perdeu). A próxima tentativa usa chave nova.
      if (e instanceof EpiApiError && e.status === 409 && /Link já emitido/i.test(e.serverMessage)) keyRef.current = null;
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  }

  async function copy(text: string, done: string, el: HTMLElement | null) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('sem clipboard');
      await navigator.clipboard.writeText(text);
      setNote(done);
    } catch {
      selectNode(el);
      setNote('O navegador não permitiu copiar. O texto foi selecionado: copie manualmente.');
    }
  }

  const count = deliveryIds?.length ?? 0;

  return (
    <Modal title="Link de assinatura do funcionário" onClose={onClose} busy={busy}>
      <div aria-live="polite" className="sr-only">
        {result ? 'Link de assinatura gerado.' : ''}
      </div>
      <div ref={errRef} tabIndex={-1} aria-live="assertive" role={error ? 'alert' : undefined} className={error ? 'mb-4 rounded-lg bg-dash-status-crit-bg p-3 text-base text-dash-status-crit-text' : ''}>
        {error}
      </div>

      {!result && (
        <div className="space-y-4">
          <p className="text-base text-dash-primary">
            {count > 0
              ? `Será gerado um link para a assinatura eletrônica de ${count} ${count === 1 ? 'entrega' : 'entregas'} deste funcionário.`
              : 'Será gerado um link para a assinatura eletrônica das entregas pendentes deste funcionário.'}
          </p>
          <p className="text-base text-dash-status-warn-text">Atenção: gerar um novo link invalida o link ativo destas entregas, se houver.</p>
          <p className="text-base text-dash-muted">O link vale por 24 horas. O funcionário o abre no celular e informa o código de 6 dígitos que aparecerá aqui.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" aria-disabled={busy} className={BTN_SECONDARY} onClick={() => { if (!busy) onClose(); }}>Cancelar</button>
            <button type="button" aria-disabled={busy} className={BTN_PRIMARY} onClick={generate}>{busy ? 'Gerando...' : 'Gerar link de assinatura'}</button>
          </div>
        </div>
      )}

      {result && (
        <div ref={resultRef} tabIndex={-1} className="space-y-5 outline-none">
          <p role="alert" className="rounded-lg bg-dash-status-warn-bg p-3 text-base font-medium text-dash-status-warn-text">
            Anote ou informe ao funcionário agora: este código não poderá ser exibido de novo. Se perder, gere outro link: o anterior é invalidado.
          </p>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR code do link de assinatura" width={240} height={240} className="h-60 w-60 rounded-lg border border-dash-border-input bg-white" />
            ) : (
              <p className="text-base text-dash-muted" role="status">{qrFailed ? 'Não foi possível desenhar o QR code. Use o link abaixo.' : 'Gerando QR code...'}</p>
            )}
            <div className="min-w-0 flex-1 space-y-4">
              <div>
                <p className="text-base font-medium text-dash-primary">Código de 6 dígitos</p>
                <p className="text-3xl font-bold tracking-widest text-dash-primary">
                  <span ref={codeRef} className="select-all" data-testid="signature-code">{formatCode(result.code)}</span>
                </p>
                <button type="button" className={`${BTN_SECONDARY} mt-2`} onClick={() => copy(result.code, 'Código copiado.', codeRef.current)}>Copiar código</button>
              </div>
              <div>
                <p className="text-base font-medium text-dash-primary">Link</p>
                <p className="break-all text-base text-dash-primary"><code ref={linkRef} className="select-all" data-testid="signature-link">{result.url}</code></p>
                <button type="button" className={`${BTN_SECONDARY} mt-2`} onClick={() => copy(result.url, 'Link copiado.', linkRef.current)}>Copiar link</button>
              </div>
            </div>
          </div>

          <div aria-live="polite" className="min-h-[1.5rem] text-base text-dash-muted">{note}</div>

          <div className="space-y-1 text-base text-dash-muted">
            <p>O link vale por 24 horas: expira em {formatDateTime(result.expires_at)} (horário de Brasília).</p>
            <p>Como o funcionário usa: ele lê o QR code com a câmera do celular, ou abre o link, e informa o código. Se ele estiver ao seu lado, informe o código a ele.</p>
          </div>

          <div className="flex justify-end">
            <button type="button" className={BTN_PRIMARY} onClick={onClose}>Fechar</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
