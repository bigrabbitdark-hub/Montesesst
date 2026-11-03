import { deriveAccessState } from '../src/payments/subscription-access.service';

describe('deriveAccessState', () => {
  const base = { has_authorized: false, has_recent_pending: false, has_lapsed: false };
  it('ativa quando há assinatura authorized, mesmo com outras', () => {
    expect(deriveAccessState({ has_authorized: true, has_recent_pending: true, has_lapsed: true })).toBe('ativa');
  });
  it('pendente tem precedência sobre inativa', () => {
    expect(deriveAccessState({ ...base, has_recent_pending: true, has_lapsed: true })).toBe('pendente');
  });
  it('inativa quando só há cancelled/paused', () => {
    expect(deriveAccessState({ ...base, has_lapsed: true })).toBe('inativa');
  });
  it('trial quando nunca assinou', () => {
    expect(deriveAccessState(base)).toBe('trial');
  });
});
