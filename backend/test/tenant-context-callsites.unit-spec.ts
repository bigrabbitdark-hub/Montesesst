import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

// ITEM 008 (auditoria 2026-09-27): a RLS só protege se a APLICAÇÃO montar o contexto
// (user_id/tenant_id/role) a partir de quem está autenticado. O bug histórico do
// `pente-fino` (`9af00d1`) foi exatamente isso: o contexto saiu do `tenant_id` do CORPO
// da requisição — para o banco o contexto era legítimo, a RLS deixou passar, e um técnico
// sem vínculo leu PGR/PCMSO de qualquer empresa. A varredura de isolamento
// (tenant-isolation-sweep) prova que as POLICIES estão certas; ela não pega esse erro.
//
// `req.withTenantContext(fn)` (172 usos) monta o contexto só do JWT, via
// TenantContextInterceptor, e não entra aqui. Este teste vigia o outro caminho, em duas
// frentes:
//  1. toda chamada `x.withTenantContext(...)` em que o CHAMADOR escolhe o contexto (literal
//     OU variável) precisa estar numa lista revisada, com o motivo por escrito e o número
//     exato de chamadas — uma chamada nova reprova até alguém revisar e atualizar a lista;
//  2. em TODO o src, nenhum objeto com formato de contexto (tenantId + role) pode ser
//     montado a partir de dto/body/query/params.
//
// LIMITE (heurístico): não é uma prova. Um alias (`const t = dto.tenant_id;` e depois
// `{ tenantId: t }`) escapa da frente 2. O valor do teste é tornar o erro visível na
// revisão, não impossível. (Uma primeira versão só via literais de objeto e deixava passar
// justamente o `pente-fino`, que usa uma variável `ctx` — por isso a frente 1 olha
// qualquer chamada, não só literais.)
const SRC = join(__dirname, '..', 'src');

const ALLOWED: Record<string, { calls: number; motivo: string }> = {
  'common/interceptors/tenant-context.interceptor.ts': {
    calls: 1,
    motivo: 'Monta o contexto a partir de request.user (JWT); é a única fonte de req.withTenantContext.',
  },
  'normative/normative-assistant.service.ts': {
    calls: 3,
    motivo:
      'Contexto do usuário autenticado (JWT). O tenantId ALVO vindo do corpo, para técnico/parceiro, é validado por assertTenantLinked antes; a empresa opera sempre no próprio tenant.',
  },
  'pente-fino/pente-fino-comparison.service.ts': {
    calls: 8,
    motivo:
      'O `ctx` é montado uma vez, de `user` (JWT) — nunca do tenantId alvo do corpo, que só entra em queries — com o vínculo técnico/parceiro checado por assigned_tenant_ids_for_current_user(). É o serviço do bug 9af00d1; o comentário do método explica o porquê.',
  },
  'cipa/ata-ai/ata-ai.service.ts': {
    calls: 4,
    motivo:
      'Recebe `ctx` por parâmetro; o único chamador (meetings.controller.ts) o monta de req.user (JWT) antes de disparar o processamento em segundo plano.',
  },
  'payments/subscription-access.service.ts': {
    calls: 1,
    motivo: 'Contexto do usuário autenticado (JWT), recebido da SubscriptionStatusGuard / rota /subscriptions/me.',
  },
  'google-calendar/google-calendar.controller.ts': {
    calls: 1,
    motivo:
      'Callback OAuth PÚBLICO (sem JWT). Contexto admin, mas a identidade vem do `state` assinado com HMAC (timingSafeEqual, validade de 10 min), verificado ANTES de qualquer uso do banco; a única escrita é um upsert da conta Google do id verificado.',
  },
  'dashboard/weekly-digest.service.ts': {
    calls: 2,
    motivo: 'Cron do sistema. Sem entrada de usuário: a lista de tenants sai do próprio banco (role admin).',
  },
  'visits/visit-reminder.cron.ts': { calls: 1, motivo: 'Cron do sistema (role admin), sem entrada de usuário.' },
  'normative/normative-monitor.service.ts': { calls: 1, motivo: 'Cron do sistema (role admin), sem entrada de usuário.' },
  'normative/assistant-query-log.service.ts': { calls: 1, motivo: 'Cron de purga do log (role admin), sem entrada de usuário.' },
};

// Entradas do CLIENTE que nunca podem compor um contexto: o identificador SOLTO
// (`dto.tenant_id`, `body.x`, `query.y`, `params.z`) ou `req.body`/`req.query`/`req.params`.
// `client.query(` não conta: o lookbehind exige que não seja propriedade de outro objeto.
const CLIENT_INPUT = /(?<![.\w])(?:dto|body|query|params)\b(?!\s*[(:])|\b(?:req|request)\.(?:body|query|params)\b/;

interface CallSite {
  file: string;
  argument: string; // primeiro argumento: literal de contexto ou o nome da variável
}

// `.withTenantContext(` chamado num objeto que NÃO é `req`/`request` (esses recebem uma
// função e montam o contexto do JWT). A definição do método e parâmetros com esse nome
// não têm ponto antes, então ficam de fora.
const DIRECT = /(?<!\breq)(?<!\brequest)\.withTenantContext\(/g;

// Devolve o texto do 1º argumento (até a vírgula de nível zero), respeitando (), {} e [].
function firstArgument(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if ('({['.includes(ch)) depth++;
    else if (')}]'.includes(ch)) {
      if (depth === 0) return source.slice(from, i).trim();
      depth--;
    } else if (ch === ',' && depth === 0) return source.slice(from, i).trim();
  }
  return source.slice(from).trim();
}

export function findDirectCallSites(file: string, source: string): CallSite[] {
  return [...source.matchAll(DIRECT)].map((m) => ({
    file,
    argument: firstArgument(source, (m.index as number) + m[0].length),
  }));
}

// Objeto literal que contém `idx`, do `{` que o abre ao `}` que o fecha.
function enclosingObject(source: string, idx: number): string | null {
  let depth = 0;
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    if (source[i] === '}') depth++;
    else if (source[i] === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return null;
  // Só objeto LITERAL: o `{` vem depois de `(`, `,`, `=`, `:`, `[`, `?` ou `return`. Corpo de
  // classe/função/if vem depois de `)`, de um identificador ou de `=>` — e um parâmetro
  // `tenantId: string` dentro de uma assinatura não é uma chave de objeto.
  const before = source.slice(0, start).trimEnd();
  const literalStart = /[(,=:[?]$/.test(before) && !before.endsWith('=>') || /\breturn$/.test(before);
  if (!literalStart) return null;
  depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) {
      const literal = source.slice(start, i + 1);
      return literal.length <= 600 ? literal : null; // contexto é pequeno; algo maior não é um literal de contexto
    }
  }
  return null;
}

// A chave escrita como abreviação (`{ tenantId, role }`) esconde de onde o valor vem.
const SHORTHAND_TENANT_ID = /[{,]\s*tenantId\s*[,}]/;

// Objetos com formato de contexto: têm a chave `tenantId` (explícita ou abreviada) e `role`.
export function findContextShapedObjects(source: string): string[] {
  const found = new Map<string, string>();
  for (const m of source.matchAll(/\btenantId\s*:|[{,]\s*tenantId\s*(?=[,}])/g)) {
    const obj = enclosingObject(source, m.index as number);
    if (obj && /\brole\s*:|[{,]\s*role\s*[,}]/.test(obj)) found.set(obj, obj);
  }
  return [...found.values()];
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

const files = tsFiles(SRC).map((full) => ({
  file: relative(SRC, full).split(sep).join('/'),
  source: readFileSync(full, 'utf8'),
}));

describe('Contexto de tenant montado pelo chamador (ITEM 008)', () => {
  describe('os localizadores', () => {
    it('acham a chamada direta com literal, com variável e encadeada em outra linha', () => {
      expect(findDirectCallSites('a.ts', `await this.db.withTenantContext({ role: 'admin' }, (c) => x(c));`)).toEqual([
        { file: 'a.ts', argument: `{ role: 'admin' }` },
      ]);
      expect(findDirectCallSites('b.ts', `this.db.withTenantContext(\n  { userId: u.id, tenantId: u.tenantId, role: u.role },\n  fn,\n)`)[0].argument).toBe(
        '{ userId: u.id, tenantId: u.tenantId, role: u.role }',
      );
      expect(findDirectCallSites('c.ts', `await this.db.withTenantContext(ctx, (client) => f(client));`)[0].argument).toBe('ctx');
      expect(findDirectCallSites('d.ts', `this.db\n  .withTenantContext(ctx, fn)`)).toHaveLength(1);
    });

    it('ignoram req.withTenantContext(fn), .bind(req), o parâmetro homônimo e menções em comentário', () => {
      expect(findDirectCallSites('e.ts', `return req.withTenantContext((client) => x(client));`)).toHaveLength(0);
      expect(findDirectCallSites('f.ts', `req.withTenantContext.bind(req)`)).toHaveLength(0);
      expect(findDirectCallSites('g.ts', `await withTenantContext(async (client) => 1);`)).toHaveLength(0);
      expect(findDirectCallSites('h.ts', `// usa withTenantContext({ role: 'admin' }) na mão`)).toHaveLength(0);
    });

    it('reconhecem o padrão do bug histórico: tenantId vindo do corpo', () => {
      const src = `this.db.withTenantContext({ userId: user.id, tenantId: dto.tenant_id, role: user.role }, fn)`;
      expect(CLIENT_INPUT.test(findDirectCallSites('i.ts', src)[0].argument)).toBe(true);
      const [obj] = findContextShapedObjects(`const ctx = { userId: user.id, tenantId: body.tenant_id, role: user.role };`);
      expect(CLIENT_INPUT.test(obj)).toBe(true);
    });

    it('acham a forma abreviada { userId, tenantId, role } — a mais provável de esconder a origem do valor', () => {
      const [obj] = findContextShapedObjects(`const ctx = { userId: user.id, tenantId, role: user.role };`);
      expect(SHORTHAND_TENANT_ID.test(obj)).toBe(true);
    });

    it('acham objeto de contexto em qualquer lugar (não só como argumento) e ignoram objetos sem role', () => {
      expect(findContextShapedObjects(`f({ userId: req.user.id, tenantId: req.user.tenantId, role: req.user.role }, id)`)).toHaveLength(1);
      expect(findContextShapedObjects(`f({ tenantId: t.id, name: 'x' })`)).toHaveLength(0);
      expect(findContextShapedObjects(`interface T { tenantId?: string; role?: string }`)).toHaveLength(0);
    });
  });

  it('o teste enxerga o código (sem isso "nenhuma chamada nova" seria vazio)', () => {
    expect(files.length).toBeGreaterThan(100);
    const sites = files.flatMap((f) => findDirectCallSites(f.file, f.source));
    expect(sites.length).toBeGreaterThanOrEqual(20);
  });

  it('cada arquivo com chamada direta está na lista revisada, com o mesmo número de chamadas', () => {
    const counts = new Map<string, number>();
    for (const f of files) {
      const n = findDirectCallSites(f.file, f.source).length;
      if (n) counts.set(f.file, n);
    }
    const actual = Object.fromEntries([...counts].sort());
    const expected = Object.fromEntries(Object.entries(ALLOWED).map(([file, v]) => [file, v.calls]).sort());
    expect(actual).toEqual(expected);
  });

  it('nenhum argumento de withTenantContext é montado a partir de dto/body/query/params', () => {
    const offenders = files
      .flatMap((f) => findDirectCallSites(f.file, f.source))
      .filter((s) => CLIENT_INPUT.test(s.argument));
    expect(offenders).toEqual([]);
  });

  it('em TODO o src, nenhum objeto com formato de contexto (tenantId + role) usa dto/body/query/params — o bug do pente-fino', () => {
    const offenders = files.flatMap((f) =>
      findContextShapedObjects(f.source)
        .filter((obj) => CLIENT_INPUT.test(obj))
        .map((obj) => ({ file: f.file, objeto: obj })),
    );
    expect(offenders).toEqual([]);
  });

  it('nenhum objeto de contexto usa a abreviação `tenantId` (escreva `tenantId: <de onde vem>`)', () => {
    const offenders = files.flatMap((f) =>
      findContextShapedObjects(f.source)
        .filter((obj) => SHORTHAND_TENANT_ID.test(obj))
        .map((obj) => ({ file: f.file, objeto: obj })),
    );
    expect(offenders).toEqual([]);
  });

  it('há objetos com formato de contexto no código (o teste acima não é vazio)', () => {
    const total = files.reduce((n, f) => n + findContextShapedObjects(f.source).length, 0);
    expect(total).toBeGreaterThanOrEqual(5);
  });

  it('toda entrada da lista tem um motivo escrito', () => {
    for (const [file, v] of Object.entries(ALLOWED)) {
      expect({ file, temMotivo: v.motivo.trim().length > 30 }).toEqual({ file, temMotivo: true });
    }
  });
});
