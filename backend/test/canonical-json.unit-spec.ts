import { canonicalJson, sha256Hex } from '../src/epi-ficha/canonical-json.util';

describe('canonicalJson', () => {
  it('ordena as chaves recursivamente e ignora a ordem de entrada', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it('trata null e omite undefined, como o JSON', () => {
    expect(canonicalJson({ a: null, b: undefined })).toBe('{"a":null}');
  });
  it('sha256Hex tem 64 hex e muda com qualquer byte', () => {
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
  });
  it('Date vira string ISO (como no JSON), inclusive em objeto aninhado', () => {
    const d = new Date('2026-10-14T12:00:00.000Z');
    expect(canonicalJson({ a: d })).toBe('{"a":"2026-10-14T12:00:00.000Z"}');
    expect(canonicalJson({ z: { y: [d] } })).toBe('{"z":{"y":["2026-10-14T12:00:00.000Z"]}}');
  });
});
