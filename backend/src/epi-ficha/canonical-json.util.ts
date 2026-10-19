// JSON canônico (chaves ordenadas recursivamente) e SHA-256: base do hash do instantâneo da ficha emitida.
import { createHash } from 'crypto';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  // Date (e qualquer objeto com toJSON) vira o valor serializado, como no JSON.stringify (senão viraria {}).
  if (v && typeof v === 'object' && typeof (v as { toJSON?: unknown }).toJSON === 'function') {
    return sortKeys((v as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = sortKeys((v as Record<string, unknown>)[k]);
      return acc;
    }, {});
  }
  return v;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
