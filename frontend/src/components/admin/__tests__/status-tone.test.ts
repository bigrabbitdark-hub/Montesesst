import { describe, it, expect } from 'vitest';
import { httpStatusTone, subscriptionTone } from '../status-tone';

describe('subscriptionTone', () => {
  it('mapeia só os status confirmados no código (authorized, paused)', () => {
    expect(subscriptionTone('authorized')).toBe('ok');
    expect(subscriptionTone('paused')).toBe('warn');
  });
  it('cancelled e valores desconhecidos ficam neutros (não inventa semântica)', () => {
    expect(subscriptionTone('cancelled')).toBe('neutral');
    expect(subscriptionTone('qualquer-coisa')).toBe('neutral');
  });
});

describe('httpStatusTone', () => {
  it.each([
    [200, 'ok'], [201, 'ok'], [299, 'ok'],
    [400, 'warn'], [403, 'warn'], [429, 'warn'],
    [500, 'bad'], [503, 'bad'],
    [302, 'neutral'], [100, 'neutral'],
  ])('%i → %s', (codigo, tom) => {
    expect(httpStatusTone(codigo)).toBe(tom);
  });
});
