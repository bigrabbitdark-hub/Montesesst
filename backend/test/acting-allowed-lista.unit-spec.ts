import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// Trava da superfície do modo "atuar como empresa" (sócia com token de atuação). Só rotas marcadas com
// @ActingAllowed() passam pelo ActingTenantGuard; todo o resto é negado (fail-closed).
// LISTA FECHADA. Mudar aqui exige atualizar a seção 3 do spec
// (docs/superpowers/specs/2026-11-05-socio-cadastra-e-atua-como-empresa-design.md) e passar por revisão de segurança.

const SRC = join(__dirname, '..', 'src');
const MARCA = '@ActingAllowed(';
function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return controllers(p);
    return p.endsWith('.controller.ts') ? [relative(SRC, p).replace(/\\/g, '/')] : [];
  });
}
const ler = (f: string) => readFileSync(join(SRC, f), 'utf8');
const marcados = () => controllers(SRC).filter((f) => ler(f).includes(MARCA)).sort();
const contarMarcas = (txt: string) => (txt.match(/@ActingAllowed\(/g) ?? []).length;
// Rotas HTTP declaradas no controller (um decorator de verbo por handler), como "VERBO caminho".
// `@Get(variavel)` (caminho não literal) aparece como "GET ?" — também conta.
const VERBO = /^\s*@(Get|Post|Put|Patch|Delete|All|Head|Options)\(\s*([^)]*?)\s*\)/gm;
const rotas = (txt: string) =>
  [...txt.matchAll(VERBO)].map(([, v, arg]) => {
    const lit = /^'([^']*)'$/.exec(arg);
    return `${v.toUpperCase()} ${lit ? lit[1] : arg === '' ? '' : '?'}`.trim();
  });
const contarHandlers = (txt: string) => rotas(txt).length;
const MSG_HANDLER_NOVO = 'handler novo em controller liberado ao modo atuação: revisar e atualizar a seção 3 do spec';

// Trecho entre o fim do membro anterior ("\n  }\n") e a declaração do método: são os decorators dele.
function decoratorsDe(txt: string, metodo: string): string {
  const m = new RegExp(`\\n  (async )?${metodo}\\(`).exec(txt);
  if (!m) throw new Error(`método ${metodo} não encontrado`);
  const inicioClasse = txt.indexOf('export class');
  const fimAnterior = txt.lastIndexOf('\n  }\n', m.index);
  return txt.slice(Math.max(inicioClasse, fimAnterior), m.index);
}
// Trecho entre @Controller( e "export class": decorators da CLASSE.
function decoratorsDaClasse(txt: string): string {
  return txt.slice(txt.indexOf('@Controller('), txt.indexOf('export class'));
}

// Liberados na CLASSE inteira: todos os handlers são operacionais da empresa e nenhum chama IA, vincula
// técnico/parceiro, mexe em plano/pagamento ou em dados cadastrais do tenant. Handlers restritos a
// tecnico/parceiro/admin continuam negados pelo RolesGuard (o papel efetivo da sócia é 'empresa').
// As rotas de cada um ficam FIXADAS aqui: handler novo (ou rota mudada) num controller liberado inteiro
// quebra o teste e obriga a revisar a exposição no modo atuação.
const ROTAS_CLASSE: Record<string, string[]> = {
  'caepi/caepi.controller.ts': ['GET search', 'GET sync-status'],
  'cipa/committees.controller.ts': ['POST', 'POST :id/generate-meetings', 'GET', 'GET :id'],
  'cipa/dds.controller.ts': ['POST', 'GET', 'DELETE :id'],
  'cipa/elections.controller.ts': ['POST', 'GET', 'GET :id', 'GET :id/candidates', 'POST :id/candidates', 'PATCH :id/candidates/:candidateId', 'POST :id/concluir'],
  'cipa/members.controller.ts': ['POST', 'GET', 'PATCH :id'],
  'cipa/pendencias.controller.ts': ['POST', 'GET', 'PATCH :id'],
  'cipa/sipat.controller.ts': ['POST', 'GET', 'DELETE :id', 'GET :id/activities', 'POST :id/activities', 'PATCH :id/activities/:activityId'],
  'cipa/trainings.controller.ts': ['POST', 'GET', 'DELETE :id'],
  // PATCH :id edita legal_name, CNAE e endereço da filial/matriz (CNPJ protegido) — ver spec §3.
  'company-units/company-units.controller.ts': ['POST', 'GET', 'GET :id', 'PATCH :id', 'DELETE :id'],
  'dashboard/dashboard.controller.ts': ['GET summary', 'GET overview', 'GET nr-conformidade', 'GET nr-aplicaveis'],
  'emergency-drill/emergency-drill.controller.ts': ['POST', 'GET', 'GET :id'],
  'epi-ficha/epi-ficha.controller.ts': ['GET employees/:employeeId', 'GET employees/:employeeId/preview.pdf', 'POST employees/:employeeId/issue', 'GET employees/:employeeId/documents', 'GET documents/:documentId/download', 'GET documents/:documentId/verify'],
  'epi-signature/epi-signature.controller.ts': ['POST requests', 'GET requests', 'GET pending', 'POST requests/:id/revoke', 'POST in-person', 'GET :id/receipt.pdf'],
  'epi/epi-catalog.controller.ts': ['GET'],
  'epi/epis.controller.ts': ['POST', 'GET', 'GET search', 'GET movements', 'GET dashboard', 'GET settings', 'PATCH settings', 'PATCH :id', 'GET :id/lots', 'DELETE :id', 'POST :id/deliveries', 'POST :id/movements', 'POST :id/adjustments', 'POST movements/:movementId/reversal', 'GET :id/deliveries'],
  'fire-brigade/fire-brigade.controller.ts': ['POST members', 'GET members', 'GET members/:id', 'PATCH members/:id', 'DELETE members/:id', 'POST members/:id/trainings', 'GET members/:id/trainings', 'GET coverage', 'PUT coverage-target'],
  'fire-safety-equipment/fire-safety-equipment.controller.ts': ['POST', 'GET', 'GET :id', 'PATCH :id', 'DELETE :id', 'POST :id/foto', 'GET :id/foto'],
  'inspections/action-plans.controller.ts': ['GET', 'PATCH :id'],
  'positions/positions.controller.ts': ['POST', 'GET', 'GET link-suggestions', 'POST confirm-links', 'GET :id', 'PATCH :id', 'PUT :id/epi-requirements', 'PUT :id/training-requirements'],
  'prevention-checklist/prevention-checklist.controller.ts': ['POST', 'GET', 'GET :id', 'PATCH :id/items/:itemId', 'POST :id/items/:itemId/foto', 'GET :id/items/:itemId/foto', 'POST :id/concluir'],
  'prevention-corrective-actions/prevention-corrective-actions.controller.ts': ['GET', 'PATCH :id'],
};
const CLASSE = Object.keys(ROTAS_CLASSE);

// Compara as rotas reais com as fixadas; a mensagem diz o que fazer quando muda.
function conferirRotas(txt: string, esperadas: string[]): void {
  const reais = rotas(txt);
  if (reais.length !== esperadas.length || reais.some((r, i) => r !== esperadas[i])) {
    throw new Error(`${MSG_HANDLER_NOVO}\n  esperado: ${JSON.stringify(esperadas)}\n  encontrado: ${JSON.stringify(reais)}`);
  }
}

// Liberados MÉTODO A MÉTODO: o controller mistura handlers aceitáveis com handlers que chamam IA externa,
// que não são da empresa ou que mexem em dados cadastrais. `liberados` recebem a marca; `negados` nunca.
// liberados + negados cobrem TODOS os handlers do arquivo (handler novo obriga a decidir aqui).
const METODO: Record<string, { liberados: string[]; negados: string[] }> = {
  'cipa/meetings.controller.ts': {
    liberados: ['create', 'findAll', 'findOne', 'update', 'findParticipants', 'setParticipants', 'approveAta', 'reopenAta', 'getAtaAiDraft'],
    negados: ['uploadAtaAudio'], // envia o áudio da reunião à transcrição/extração por IA (Groq/OpenRouter)
  },
  'documents/documents.controller.ts': {
    liberados: ['upload', 'listRules', 'findAll', 'compliance', 'updateValidity', 'download', 'remove'],
    negados: [
      'classifyBatch', // envia o texto dos PDFs ao MiniMax para classificar
      'updateRule', // só admin (regra global de validade)
      'portfolioCompliance', // só tecnico/parceiro (carteira)
    ],
  },
  'employees/employees.controller.ts': {
    liberados: ['listExtractions', 'getExtraction', 'resolveExtraction', 'create', 'importCsv', 'previewImport', 'importMapped',
      'findAll', 'findTable', 'history', 'bulkUpdate', 'findOne', 'update', 'remove'],
    negados: ['uploadDocument'], // cadastro por documento: pode enviar o texto ao MiniMax (EMPLOYEE_INGESTION_AI_ENABLED)
  },
  'inspections/inspections.controller.ts': {
    liberados: ['findAll', 'blankTemplate', 'findOne'],
    negados: ['create', 'update', 'updateItem', 'aiDraft', 'conclude'], // escrita é só do técnico; aiDraft chama IA
  },
  'tenants/tenants.controller.ts': {
    liberados: ['findMe'], // EmpresaShell precisa do nome/logo
    negados: ['updateMe', 'uploadLogo', 'removeLogo', 'getLogo', 'findAll', 'findDetail'], // cadastro do tenant / admin; getLogo é @Public
  },
};

const PERMITIDOS = [...CLASSE, ...Object.keys(METODO)].sort();

// Nunca liberados (redundante com a lista exata acima, mas explícito para a revisão).
const PROIBIDOS = [
  'payments/subscriptions.controller.ts', 'payments/plans.controller.ts', 'payments/webhook.controller.ts',
  'tenant-technicians/tenant-technicians.controller.ts', 'partners/partners.controller.ts',
  'technicians/technicians.controller.ts', 'auth/auth.controller.ts',
  'normative/normative-assistant.controller.ts', 'normative/normative-documents.controller.ts',
  'normative/official-sources.controller.ts', 'ai-copilot/ai-copilot.controller.ts', 'common/ai-usage/ai-usage.controller.ts',
  'pente-fino/pente-fino.controller.ts', // único handler (POST run) dispara até 7 chamadas de LLM com o conteúdo dos documentos
  'google-calendar/google-calendar.controller.ts', 'admin-dashboard/admin-dashboard.controller.ts',
  'admin/carteira-socios/carteira-socios.controller.ts', 'overview/overview.controller.ts',
  'sst-checklist/sst-checklist.controller.ts', 'system-status/system-status.controller.ts', 'audit-log/audit-log.controller.ts',
  'visits/visits.controller.ts',
  // eSocial/ASO: certificado digital A1 e dados de saúde; fora até decisão do dono.
  'esocial/accidents/accidents.controller.ts', 'esocial/certificates/certificates.controller.ts',
  'esocial/events/esocial-events.controller.ts', 'esocial/prerequisites/esocial-prerequisites.controller.ts',
  'aso/aso.controller.ts',
  ...controllers(SRC).filter((f) => f.startsWith('atuacao/')),
];

describe('@ActingAllowed — lista fechada', () => {
  it('exatamente os controllers permitidos', () => expect(marcados()).toEqual(PERMITIDOS));

  it.each(PROIBIDOS)('%s nunca é liberado', (f) => {
    expect(ler(f)).not.toContain(MARCA);
  });

  it.each(CLASSE)('%s: uma marca, na classe, logo abaixo de @Controller', (f) => {
    const txt = ler(f);
    expect(contarMarcas(txt)).toBe(1);
    expect(txt).toMatch(/@Controller\([^)]*\)\s*[\r\n]+\s*@ActingAllowed\(\)/);
  });

  it.each(CLASSE)('%s: rotas fixadas (handler novo exige revisão)', (f) => {
    expect(() => conferirRotas(ler(f), ROTAS_CLASSE[f])).not.toThrow();
  });

  // Sabotagem permanente: prova que a trava acima pega handler novo (inclusive @All/@Head/@Options)
  // num controller liberado inteiro, sem precisar alterar o arquivo real.
  it.each([
    ["@Post('vincular-tecnico')", 'POST vincular-tecnico'],
    ["@All('qualquer')", 'ALL qualquer'],
    ["@Head()", 'HEAD'],
    ["@Options(':id')", 'OPTIONS :id'],
    ['@Get(ROTA_DINAMICA)', 'GET ?'],
  ])('sabotagem: %s num controller de classe é detectado', (decorator, rota) => {
    const f = 'cipa/dds.controller.ts';
    const txt = ler(f);
    const sabotado = txt.replace(/\n}\s*$/, `\n  ${decorator}\n  fantasma() {\n    return 1;\n  }\n}\n`);
    expect(rotas(sabotado)).toContain(rota);
    expect(() => conferirRotas(sabotado, ROTAS_CLASSE[f])).toThrow(MSG_HANDLER_NOVO);
  });

  // Fecha o contorno da lista: ninguém usa a chave diretamente (SetMetadata) nem importa o decorator com alias.
  it('chave ACTING_ALLOWED_KEY / SetMetadata / alias só no decorator e no guard', () => {
    const PERMITIDOS_CHAVE = ['common/decorators/acting-allowed.decorator.ts', 'common/guards/acting-tenant.guard.ts'];
    const todos = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) return todos(p);
        return p.endsWith('.ts') ? [relative(SRC, p).replace(/\\/g, '/')] : [];
      });
    const violacoes = todos(SRC)
      .filter((f) => !PERMITIDOS_CHAVE.includes(f))
      .filter((f) => {
        const txt = ler(f);
        return (
          txt.includes('ACTING_ALLOWED_KEY') ||
          /['"`]acting_allowed['"`]/.test(txt) ||
          /ActingAllowed\s+as\s+/.test(txt) ||
          /import\s+\*\s+as\s+\w+\s+from\s+['"][^'"]*acting-allowed\.decorator['"]/.test(txt)
        );
      });
    expect(violacoes).toEqual([]);
  });

  describe.each(Object.entries(METODO))('%s: marca por método', (f, { liberados, negados }) => {
    const txt = ler(f);
    it('sem marca na classe', () => expect(decoratorsDaClasse(txt)).not.toContain(MARCA));
    it('liberados + negados cobrem todos os handlers', () => {
      expect(liberados.length + negados.length).toBe(contarHandlers(txt));
      expect(contarMarcas(txt)).toBe(liberados.length);
    });
    it.each(liberados)('%s tem a marca', (m) => expect(decoratorsDe(txt, m)).toContain(MARCA));
    it.each(negados)('%s NÃO tem a marca', (m) => expect(decoratorsDe(txt, m)).not.toContain(MARCA));
  });

  it('em tenants, só o GET me', () => {
    const txt = ler('tenants/tenants.controller.ts');
    expect(txt.match(/@ActingAllowed\(/g)).toHaveLength(1);
    expect(txt).toMatch(/@ActingAllowed\(\)\s*[\r\n]+\s*@Get\('me'\)|@Get\('me'\)\s*[\r\n]+\s*@ActingAllowed\(\)/);
  });
});
