import { buildMonitorAlertEmail, MONITOR_ALERT_SUBJECT } from '../src/normative/normative-monitor-email';

describe('buildMonitorAlertEmail (unit)', () => {
  it('usa o assunto fixo', () => {
    const { subject } = buildMonitorAlertEmail([{ kind: 'nova_versao', source: 'NR-01 — Disposições Gerais' }]);
    expect(subject).toBe(MONITOR_ALERT_SUBJECT);
  });

  it('só inclui a seção de falhas quando há eventos de falha', () => {
    const { html } = buildMonitorAlertEmail([
      { kind: 'falha_repetida', source: 'NR-01 — Disposições Gerais', error: 'Fonte respondeu status 404' },
    ]);
    expect(html).toContain('2 falhas seguidas');
    expect(html).toContain('NR-01 — Disposições Gerais');
    expect(html).toContain('Fonte respondeu status 404');
    expect(html).not.toContain('aguardando validação');
  });

  it('só inclui a seção de versões novas quando há eventos de versão nova', () => {
    const { html } = buildMonitorAlertEmail([{ kind: 'nova_versao', source: 'NR-35 — Trabalho em Altura' }]);
    expect(html).toContain('Versões novas aguardando validação');
    expect(html).toContain('NR-35 — Trabalho em Altura');
    expect(html).not.toContain('2 falhas seguidas');
  });

  it('inclui as duas seções quando há os dois tipos de evento', () => {
    const { html } = buildMonitorAlertEmail([
      { kind: 'falha_repetida', source: 'NR-01', error: 'timeout' },
      { kind: 'nova_versao', source: 'NR-35' },
    ]);
    expect(html).toContain('2 falhas seguidas');
    expect(html).toContain('Versões novas aguardando validação');
  });

  it('escapa HTML no rótulo da fonte e no erro', () => {
    const { html } = buildMonitorAlertEmail([
      { kind: 'falha_repetida', source: '<script>alert(1)</script>', error: '<img src=x onerror=alert(1)>' },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
});
