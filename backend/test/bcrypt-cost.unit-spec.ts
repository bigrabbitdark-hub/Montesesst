/**
 * Cobre F-24 do audit pré-prod (bcrypt rounds 10 -> 12, env-driven via
 * BCRYPT_COST). 5 cenários:
 *  1. Default sem env = 12 (OWASP 2024)
 *  2. Override válido é respeitado (10, 14)
 *  3. Fora da faixa 4-15 cai no default 12
 *  4. Valor não-numérico ou vazio cai no default 12
 *  5. Varredura estática: nenhum `bcrypt.hash(..., <numero literal>)` em src/
 *     (single source of truth: bcrypt-cost.ts; quem precisa hash usa BCRYPT_COST)
 *
 * Roda SEM infra externa (sem Postgres/Redis), em jest-unit.json.
 *
 * O BCRYPT_COST é uma constante avaliada no momento do import do módulo,
 * então cada cenário usa `jest.isolateModules()` para reavaliar o módulo
 * com o process.env que acabamos de setar — não há forma de "mudar" o
 * valor sem reimportar.
 */

import * as fs from 'fs';
import * as path from 'path';

function loadBcryptCost(): number {
  let result = -1;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../src/common/auth/bcrypt-cost');
    result = mod.BCRYPT_COST;
  });
  return result;
}

describe('BCRYPT_COST — F-24', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('default = 12 quando BCRYPT_COST não está setado', () => {
    delete process.env.BCRYPT_COST;
    expect(loadBcryptCost()).toBe(12);
  });

  it('override válido é respeitado (limites inferior e superior próximos)', () => {
    process.env.BCRYPT_COST = '10';
    expect(loadBcryptCost()).toBe(10);

    process.env.BCRYPT_COST = '14';
    expect(loadBcryptCost()).toBe(14);

    process.env.BCRYPT_COST = '4';
    expect(loadBcryptCost()).toBe(4);

    process.env.BCRYPT_COST = '15';
    expect(loadBcryptCost()).toBe(15);
  });

  it('fora da faixa 4-15 cai no default 12', () => {
    process.env.BCRYPT_COST = '3';
    expect(loadBcryptCost()).toBe(12);

    process.env.BCRYPT_COST = '16';
    expect(loadBcryptCost()).toBe(12);

    process.env.BCRYPT_COST = '99';
    expect(loadBcryptCost()).toBe(12);

    process.env.BCRYPT_COST = '0';
    expect(loadBcryptCost()).toBe(12);
  });

  it('valor não-numérico ou vazio cai no default 12', () => {
    process.env.BCRYPT_COST = 'banana';
    expect(loadBcryptCost()).toBe(12);

    process.env.BCRYPT_COST = '12.5'; // float truncado por parseInt -> 12
    expect(loadBcryptCost()).toBe(12);

    process.env.BCRYPT_COST = '';
    expect(loadBcryptCost()).toBe(12);
  });

  it('varredura estática: nenhum `bcrypt.hash(..., <literal>)` em src/', () => {
    // Single source of truth: bcrypt-cost.ts. Qualquer call site novo de
    // bcrypt.hash DEVE importar BCRYPT_COST, nunca hardcodar `10`/`12`
    // literal. Este teste falha se alguém regredir isso num PR futuro.
    const srcDir = path.join(__dirname, '..', 'src');
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          const content = fs.readFileSync(p, 'utf8');
          // bcrypt.hash(arg, <digit>) — busca o segundo argumento sendo
          // um literal numérico (não BCRYPT_COST nem envInt nem variável).
          const matches = content.match(/bcrypt\.hash\([^,]+,\s*\d+\s*[,)]/g);
          if (matches) {
            for (const m of matches) offenders.push(`${p}: ${m}`);
          }
        }
      }
    }

    walk(srcDir);

    expect(offenders).toEqual([]);
  });
});
