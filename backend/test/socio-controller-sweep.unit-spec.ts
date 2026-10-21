import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../src/common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../src/common/permissions';

const SRC = join(__dirname, '..', 'src');
const METHODS: Record<number, string> = { 0: 'GET', 1: 'POST', 2: 'PUT', 3: 'DELETE', 4: 'PATCH' };

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? controllerFiles(p) : p.endsWith('.controller.ts') ? [p] : [];
  });
}

interface Rota { file: string; handler: string; roles: string[]; perms: string[]; method: string }

function rotas(): Rota[] {
  const out: Rota[] = [];
  for (const file of controllerFiles(SRC)) {
    const mod = require(file);
    for (const exp of Object.values<any>(mod)) {
      if (typeof exp !== 'function' || !Reflect.getMetadata('path', exp)) continue;
      for (const name of Object.getOwnPropertyNames(exp.prototype)) {
        const h = exp.prototype[name];
        if (name === 'constructor' || typeof h !== 'function') continue;
        const reqMethod = Reflect.getMetadata('method', h);
        if (reqMethod === undefined) continue;
        out.push({
          file: file.replace(SRC + '/', ''),
          handler: `${exp.name}.${name}`,
          method: METHODS[reqMethod] ?? String(reqMethod),
          roles: Reflect.getMetadata(ROLES_KEY, h) ?? Reflect.getMetadata(ROLES_KEY, exp) ?? [],
          perms: Reflect.getMetadata(REQUIRE_PERMISSION_KEY, h) ?? Reflect.getMetadata(REQUIRE_PERMISSION_KEY, exp) ?? [],
        });
      }
    }
  }
  return out;
}

describe('varredura de controllers — papel socio', () => {
  const todas = rotas();

  it('encontra rotas (a varredura não está vazia)', () => {
    expect(todas.length).toBeGreaterThan(100);
  });

  it('só auth/me lista socio em @Roles sem exigir permissão', () => {
    const fora = todas.filter((r) => r.roles.includes('socio') && r.perms.length === 0 && r.handler !== 'AuthController.me');
    expect(fora.map((r) => r.handler)).toEqual([]);
  });

  it('toda permissão exigida existe na lista fechada', () => {
    const invalidas = todas.flatMap((r) => r.perms.filter((p) => !(PERMISSIONS as readonly string[]).includes(p)).map((p) => `${r.handler}:${p}`));
    expect(invalidas).toEqual([]);
  });

  it('nenhuma rota de escrita em payments/ ou admin-dashboard exige permissão de socio', () => {
    const escritaFinanceira = todas.filter(
      (r) => r.method !== 'GET' && (r.file.startsWith('payments/') || r.file.startsWith('admin-dashboard/')) && (r.perms.length > 0 || r.roles.includes('socio')),
    );
    expect(escritaFinanceira.map((r) => `${r.method} ${r.handler}`)).toEqual([]);
  });

  it('nenhuma rota exige permissão de escrita financeira (inexistente por desenho)', () => {
    const proibidas = ['finance.write', 'billing.manage', 'payments.refund', 'users.manage', 'settings.manage'];
    expect((PERMISSIONS as readonly string[]).filter((p) => proibidas.includes(p))).toEqual([]);
  });

  it('toda rota que exige finance.read é GET (financeiro é somente leitura)', () => {
    const financeiras = todas.filter((r) => r.perms.includes('finance.read'));
    expect(financeiras.length).toBeGreaterThan(0);
    expect(financeiras.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.handler}`)).toEqual([]);
  });

  it('nenhuma rota de payments/ ou admin-dashboard lista socio em @Roles', () => {
    const lista = todas.filter((r) => (r.file.startsWith('payments/') || r.file.startsWith('admin-dashboard/')) && r.roles.includes('socio'));
    expect(lista.map((r) => r.handler)).toEqual([]);
  });
});
