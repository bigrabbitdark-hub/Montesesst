import { escapeHtml } from '../common/html-escape.util';

// Evento acumulado por NormativeMonitorService.runOnce durante uma rodada:
// fonte que atingiu exatamente 2 falhas seguidas, ou versão nova que entrou
// como aguardando_validacao. `source` é o rótulo já pronto ("NR-35 — Trabalho
// em Altura").
export type MonitorEvent =
  | { kind: 'falha_repetida'; source: string; error: string }
  | { kind: 'nova_versao'; source: string };

export const MONITOR_ALERT_SUBJECT = 'Montese SST — monitor normativo precisa de atenção';

// Função pura: monta o e-mail-resumo de UMA rodada do monitor. Rótulo de
// fonte e mensagem de erro entram escapados (o título de uma fonte é texto
// digitado por um admin e o erro vem de uma resposta externa).
export function buildMonitorAlertEmail(events: MonitorEvent[]): { subject: string; html: string } {
  const failures = events.filter(
    (e): e is Extract<MonitorEvent, { kind: 'falha_repetida' }> => e.kind === 'falha_repetida',
  );
  const versions = events.filter(
    (e): e is Extract<MonitorEvent, { kind: 'nova_versao' }> => e.kind === 'nova_versao',
  );

  const parts = ['<p>O monitor normativo da Montese SST precisa de atenção.</p>'];
  if (failures.length > 0) {
    const items = failures.map((f) => `<li>${escapeHtml(f.source)} — ${escapeHtml(f.error)}</li>`).join('');
    parts.push(`<h3>Fontes com 2 falhas seguidas na verificação</h3><ul>${items}</ul>`);
  }
  if (versions.length > 0) {
    const items = versions.map((v) => `<li>${escapeHtml(v.source)}</li>`).join('');
    parts.push(`<h3>Versões novas aguardando validação</h3><ul>${items}</ul>`);
  }
  parts.push('<p>Abra Admin › Normativa para revisar.</p>');

  return { subject: MONITOR_ALERT_SUBJECT, html: parts.join('') };
}
