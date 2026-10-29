import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb, TestUserFixture } from './db-test-helper';

process.env.RATE_LIMIT_MAX = '5000';

// D1 Task 1: GET /atuacao/painel e GET /atuacao/vencimentos (somente socio; blocos por permissão).
// Datas dos documentos são relativas ao "hoje" de São Paulo (mesmo dia que o servidor usa), em deslocamentos fixos.
describe('atuacao-painel — dashboard e vencimentos da carteira (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sTudo: TestUserFixture;
  let sSoClientes: TestUserFixture;
  let sSemNada: TestUserFixture;
  let sVenc: TestUserFixture; // empresas.read + clients.read
  let sSoEmpresas: TestUserFixture; // empresas.read sem clients.read
  let admin: TestUserFixture;
  let tecnico: TestUserFixture;
  let parceiroUser: TestUserFixture;
  let montese: { tenantId: string; userId: string; email: string; password: string };
  let monteseB: { tenantId: string; userId: string };
  let parceiro: { tenantId: string; userId: string };
  let tTudo: string, tClientes: string, tNada: string, tVenc: string, tSoEmp: string, tAdmin: string, tTec: string, tPar: string, tEmp: string;
  const sufixo = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, path: string) => request(app.getHttpServer()).get(`/atuacao/${path}`).set(auth(t));

  const SP = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
  const mkDoc = async (t: { tenantId: string; userId: string }, category: string, offset: number | null, titulo: string) =>
    (
      await db.client.query(
        `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role, expires_at)
         VALUES ($1,$2,$3,$4,'a.pdf','application/pdf',10,$5,'empresa', ${offset === null ? 'NULL' : `${SP} + ${offset}`}) RETURNING id`,
        [t.tenantId, category, `${titulo} ${sufixo}`, `segredo/${randomUUID()}`, t.userId],
      )
    ).rows[0].id as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService).useValue({ createPreapproval: jest.fn() })
      .overrideProvider(R2Service).useValue({ getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://example.com/fake-url') })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    sTudo = await db.createUserWithRole('socio', `Socio Painel Tudo ${sufixo}`);
    sSoClientes = await db.createUserWithRole('socio', `Socio Painel Clientes ${sufixo}`);
    sSemNada = await db.createUserWithRole('socio', `Socio Painel Nada ${sufixo}`);
    sVenc = await db.createUserWithRole('socio', `Socio Painel Venc ${sufixo}`);
    sSoEmpresas = await db.createUserWithRole('socio', `Socio Painel SoEmp ${sufixo}`);
    admin = await db.createUserWithRole('admin', 'Admin Painel');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Painel');
    parceiroUser = await db.createUserWithRole('parceiro', 'Parc Painel');
    montese = await db.createTenantWithUser('Cliente Montese Painel');
    monteseB = await db.createTenantWithUser('Cliente Montese B Painel');
    parceiro = await db.createTenantWithUser('Cliente Parceiro Painel');
    for (const p of ['clients.read', 'tasks.read', 'appointments.manage', 'empresas.read', 'documents.read']) await db.grantSocioPermission(sTudo.userId, p);
    await db.grantSocioPermission(sSoClientes.userId, 'clients.read');
    await db.grantSocioPermission(sVenc.userId, 'empresas.read');
    await db.grantSocioPermission(sVenc.userId, 'clients.read');
    await db.grantSocioPermission(sSoEmpresas.userId, 'empresas.read');

    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [parceiro.tenantId, tec.rows[0].id]);

    // Fronteiras (deslocamento em dias a partir de hoje-SP): -1 vencido; 0 hoje; 7; 8; 15; 16; 30; 31
    const offs: Array<[string, number]> = [['m1', -1], ['d0', 0], ['d7', 7], ['d8', 8], ['d15', 15], ['d16', 16], ['d30', 30], ['d31', 31]];
    for (const [k, o] of offs) ids[k] = await mkDoc(montese, 'pgr', o, `Doc ${k}`);
    ids.semData = await mkDoc(montese, 'pgr', null, 'Sem data');
    ids.cadastro = await mkDoc(montese, 'cadastro_funcionarios', -5, 'Cadastro');
    ids.deB = await mkDoc(monteseB, 'laudo', 2, 'DocB');
    ids.parceiro = await mkDoc(parceiro, 'pgr', -3, 'Doc parceiro');

    [tTudo, tClientes, tNada, tVenc, tSoEmp, tAdmin, tTec, tPar, tEmp] = await Promise.all(
      [sTudo, sSoClientes, sSemNada, sVenc, sSoEmpresas, admin, tecnico, parceiroUser, montese].map(login),
    );
  }, 90000);

  afterAll(async () => {
    const us = [sTudo, sSoClientes, sSemNada, sVenc, sSoEmpresas].map((u) => u.userId);
    await db.client.query('DELETE FROM tasks WHERE assignee_user_id = ANY($1)', [us]);
    await db.client.query('DELETE FROM agenda_events WHERE owner_user_id = ANY($1)', [us]);
    await db.client.query('DELETE FROM document_drafts WHERE created_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [us]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  describe('autorização', () => {
    it('empresa, técnico, parceiro e admin ⇒ 403 nas duas rotas', async () => {
      for (const t of [tEmp, tTec, tPar, tAdmin]) {
        expect((await get(t, 'painel')).status).toBe(403);
        expect((await get(t, 'vencimentos')).status).toBe(403);
      }
    });
    it('sem token ⇒ 401', async () => {
      expect((await request(app.getHttpServer()).get('/atuacao/painel')).status).toBe(401);
      expect((await request(app.getHttpServer()).get('/atuacao/vencimentos')).status).toBe(401);
    });
    it('/painel sem clients.read ⇒ 403 PERMISSION_DENIED', async () => {
      for (const t of [tNada, tSoEmp]) {
        const r = await get(t, 'painel');
        expect(r.status).toBe(403);
        expect(JSON.stringify(r.body)).toContain('PERMISSION_DENIED');
      }
    });
    it('/vencimentos exige empresas.read E clients.read', async () => {
      for (const t of [tNada, tClientes, tSoEmp]) expect((await get(t, 'vencimentos')).status).toBe(403);
      expect((await get(tVenc, 'vencimentos')).status).toBe(200);
    });
  });

  describe('/painel', () => {
    it('sócio só com clients.read: empresas preenchido e demais blocos null; pendencias vazia', async () => {
      const r = await get(tClientes, 'painel');
      expect(r.status).toBe(200);
      expect(r.body.empresas.acessiveis).toBeGreaterThanOrEqual(2);
      expect(r.body.tarefas).toBeNull();
      expect(r.body.agenda).toBeNull();
      expect(r.body.documentos).toBeNull();
      expect(r.body.pendencias).toEqual([]);
      expect(r.body.indisponiveis).toEqual([]);
      expect(typeof r.body.gerado_em).toBe('string');
    });

    it('contagens de documentos respeitam as bordas (-1, 0, 7, 8, 15, 16, 30, 31), sem data e cadastro_funcionarios; parceiro nunca conta', async () => {
      const base = (await get(tTudo, 'painel')).body.documentos;
      // O banco de teste pode ter outras empresas Montese; comparamos com a contagem direta de SQL no mesmo critério.
      const esperado = (await db.client.query(
        `SELECT count(*) FILTER (WHERE d.expires_at < ${SP})::int AS vencidos,
                count(*) FILTER (WHERE d.expires_at >= ${SP} AND d.expires_at <= ${SP} + 7)::int AS vence_7,
                count(*) FILTER (WHERE d.expires_at >= ${SP} AND d.expires_at <= ${SP} + 15)::int AS vence_15,
                count(*) FILTER (WHERE d.expires_at >= ${SP} AND d.expires_at <= ${SP} + 30)::int AS vence_30
           FROM documents d
          WHERE d.category <> 'cadastro_funcionarios' AND is_montese_tenant(d.tenant_id)`,
      )).rows[0];
      expect(base.vencidos).toBe(esperado.vencidos);
      expect(base.vence_7).toBe(esperado.vence_7);
      expect(base.vence_15).toBe(esperado.vence_15);
      expect(base.vence_30).toBe(esperado.vence_30);
      expect(typeof base.aguardando_acao).toBe('number');
    });

    it('cada faixa de /vencimentos contém exatamente os documentos de fronteira esperados (isolando a empresa de teste)', async () => {
      const por = async (faixa: string) => {
        const r = await get(tVenc, `vencimentos?${faixa ? `faixa=${faixa}&` : ''}tenantId=${montese.tenantId}`);
        expect(r.status).toBe(200);
        return (r.body.itens as any[]).map((i) => i.documento_id).sort();
      };
      const quero = (...k: string[]) => k.map((x) => ids[x]).sort();
      expect(await por('vencidos')).toEqual(quero('m1')); // cadastro_funcionarios (-5) nunca aparece
      expect(await por('7')).toEqual(quero('d0', 'd7'));
      expect(await por('15')).toEqual(quero('d0', 'd7', 'd8', 'd15'));
      expect(await por('30')).toEqual(quero('d0', 'd7', 'd8', 'd15', 'd16', 'd30'));
      // sem faixa: todos com vencimento (sem data e cadastro_funcionarios fora)
      expect(await por('')).toEqual(quero('m1', 'd0', 'd7', 'd8', 'd15', 'd16', 'd30', 'd31'));
    });

    it('pendencias: <= 20, href relativo, ordem determinística, sem documento de parceiro', async () => {
      const a = await get(tTudo, 'painel');
      const b = await get(tTudo, 'painel');
      expect(a.body.pendencias.length).toBeLessThanOrEqual(20);
      expect(a.body.pendencias).toEqual(b.body.pendencias);
      for (const p of a.body.pendencias) {
        expect(p.href).toMatch(/^\/atuacao\//);
        expect(p.href).not.toMatch(/https?:|\/\//);
        expect(p.tenant_id).not.toBe(parceiro.tenantId);
      }
      expect(JSON.stringify(a.body)).not.toContain(parceiro.tenantId);
      expect(JSON.stringify(a.body)).not.toContain('Cadastro ' + sufixo);
    });

    it('tarefas, agenda e documentos aguardando ação refletem os dados do próprio sócio', async () => {
      await db.client.query(
        `INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id, due_date, priority)
         VALUES ($1,$2,$3,$3, ${SP} - 2, 'urgente'), ($1,$4,$3,$3, ${SP}, 'media')`,
        [montese.tenantId, `Atrasada ${sufixo}`, sTudo.userId, `Hoje ${sufixo}`],
      );
      await db.client.query(
        `INSERT INTO agenda_events (tenant_id, owner_user_id, created_by, type, title, event_date)
         VALUES ($1,$2,$2,'visita',$3, ${SP}), ($1,$2,$2,'reuniao',$4, ${SP} + 3), ($1,$2,$2,'reuniao',$5, ${SP} + 9)`,
        [montese.tenantId, sTudo.userId, `Hoje ev ${sufixo}`, `Em 3 dias ${sufixo}`, `Em 9 dias ${sufixo}`],
      );
      await db.client.query(
        `INSERT INTO document_drafts (tenant_id, category, title, status, created_by)
         VALUES ($1,'pgr',$2,'em_revisao',$3), ($1,'pgr',$4,'em_elaboracao',$3), ($5,'pgr',$6,'em_revisao',$3)`,
        [montese.tenantId, `Rev ${sufixo}`, sTudo.userId, `Elab ${sufixo}`, parceiro.tenantId, `Parceiro ${sufixo}`],
      );
      const antes = (await get(tClientes, 'painel')).body; // controle: não vê nada disso
      expect(antes.tarefas).toBeNull();

      const r = (await get(tTudo, 'painel')).body;
      expect(r.tarefas).toEqual({
        abertas: 2, vencidas: 1, hoje: 1, bloqueadas: 0,
        aguardando_cliente: 0, aguardando_avaliacao: 0, aguardando_execucao: 0, aguardando_eficacia: 0,
      });
      expect(r.agenda.hoje.map((e: any) => e.titulo)).toEqual([`Hoje ev ${sufixo}`]);
      expect(r.agenda.hoje[0]).toMatchObject({ tipo: 'visita', tenant_id: montese.tenantId, status: 'agendado', data: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
      expect(r.agenda.hoje_total).toBe(1);
      expect(r.agenda.proximos_7_dias).toBe(1);
      const aguardando = r.pendencias.filter((p: any) => p.tipo === 'documento_aguardando');
      expect(aguardando.map((p: any) => p.descricao).join('|')).toContain(`Rev ${sufixo}`);
      expect(aguardando.map((p: any) => p.descricao).join('|')).not.toContain(`Elab ${sufixo}`);
      expect(aguardando.map((p: any) => p.descricao).join('|')).not.toContain(`Parceiro ${sufixo}`); // tenant de parceiro invisível
      const atras = r.pendencias.find((p: any) => p.tipo === 'tarefa_atrasada');
      expect(atras).toMatchObject({ tenant_id: montese.tenantId, prioridade: 'urgente', href: '/atuacao/tarefas?vencidas=true' });
      // Os mesmos dados NÃO aparecem para outro sócio (tarefas/agenda são do usuário)
      const outro = (await get(tVenc, 'painel')).body;
      expect(outro.tarefas).toBeNull(); // sem tasks.read
    });
  });

  describe('/painel — tarefas em espera (D2)', () => {
    it('contagens aditivas por categoria, campos antigos intactos, pendências tarefa_aguardando só com tasks.read', async () => {
      const antes = (await get(tTudo, 'painel')).body.tarefas;
      await db.client.query(
        `INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id, status, due_date)
         VALUES ($1,$2,$3,$3,'awaiting_client', ${SP} + 4), ($1,$4,$3,$3,'awaiting_review', NULL),
                ($1,$5,$3,$3,'awaiting_execution', ${SP}), ($1,$6,$3,$3,'awaiting_efficacy', ${SP} - 1),
                ($1,$7,$3,$3,'completed', ${SP} + 1), ($1,$8,$3,$3,'awaiting_client', ${SP} + 9)`,
        [montese.tenantId, `EspC ${sufixo}`, sTudo.userId, `EspR ${sufixo}`, `EspX ${sufixo}`, `EspE ${sufixo}`, `Fim ${sufixo}`, `EspC2 ${sufixo}`],
      );
      // tarefa de OUTRO sócio não conta
      await db.client.query(
        `INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id, status) VALUES ($1,$2,$3,$3,'awaiting_client')`,
        [montese.tenantId, `Alheia ${sufixo}`, sSoClientes.userId],
      );
      const r = (await get(tTudo, 'painel')).body;
      expect(r.tarefas).toEqual({
        abertas: antes.abertas + 5, vencidas: antes.vencidas + 1, hoje: antes.hoje + 1, bloqueadas: antes.bloqueadas,
        aguardando_cliente: antes.aguardando_cliente + 2, aguardando_avaliacao: antes.aguardando_avaliacao + 1,
        aguardando_execucao: antes.aguardando_execucao + 1, aguardando_eficacia: antes.aguardando_eficacia + 1,
      });
      const ag = r.pendencias.filter((p: any) => p.tipo === 'tarefa_aguardando');
      const desc = ag.map((p: any) => p.descricao);
      expect(desc).toEqual(expect.arrayContaining([`EspC ${sufixo}`, `EspR ${sufixo}`, `EspX ${sufixo}`, `EspC2 ${sufixo}`]));
      expect(desc).not.toContain(`EspE ${sufixo}`); // atrasada: já aparece como tarefa_atrasada
      expect(desc).not.toContain(`Fim ${sufixo}`);
      expect(desc).not.toContain(`Alheia ${sufixo}`);
      const c = ag.find((p: any) => p.descricao === `EspC ${sufixo}`);
      expect(c).toMatchObject({ tenant_id: montese.tenantId, href: '/atuacao/tarefas?status=awaiting_client' });
      expect(r.pendencias.length).toBeLessThanOrEqual(20);
      expect(r.pendencias.some((p: any) => p.tipo === 'tarefa_atrasada' && p.descricao === `EspE ${sufixo}`)).toBe(true);
      // sem tasks.read: bloco null e nenhuma pendência de tarefa
      const sem = (await get(tClientes, 'painel')).body;
      expect(sem.tarefas).toBeNull();
      expect(sem.pendencias.some((p: any) => String(p.tipo).startsWith('tarefa_'))).toBe(false);
      expect(JSON.stringify(sem)).not.toContain(`Esp`);
    });
  });

  describe('/vencimentos', () => {
    it('contrato do item, ordenado por expires_at, dias coerentes e href relativo', async () => {
      const r = await get(tVenc, `vencimentos?faixa=30&tenantId=${montese.tenantId}`);
      expect(r.status).toBe(200);
      expect(typeof r.body.total).toBe('number');
      const it0 = r.body.itens[0];
      expect(Object.keys(it0).sort()).toEqual(['categoria', 'dias', 'documento_id', 'empresa', 'expires_at', 'href', 'tenant_id', 'titulo']);
      expect(it0.href).toBe(`/atuacao/empresas/${montese.tenantId}`);
      const dias = r.body.itens.map((i: any) => i.dias);
      expect([...dias].sort((a: number, b: number) => a - b)).toEqual(dias);
      const venc = (await get(tVenc, `vencimentos?faixa=vencidos&tenantId=${montese.tenantId}`)).body.itens[0];
      expect(venc.dias).toBe(-1);
      expect(venc.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    it('carteira inteira nunca inclui parceiro nem cadastro_funcionarios', async () => {
      const r = await get(tVenc, 'vencimentos');
      expect(r.status).toBe(200);
      const idsRet = (r.body.itens as any[]).map((i) => i.documento_id);
      expect(idsRet).not.toContain(ids.parceiro);
      expect(idsRet).not.toContain(ids.cadastro);
      expect(idsRet).not.toContain(ids.semData);
      expect(idsRet).toContain(ids.deB);
      expect((r.body.itens as any[]).every((i) => i.tenant_id !== parceiro.tenantId)).toBe(true);
    });
    it('tenantId de empresa de parceiro ⇒ 404; inexistente ⇒ 404; inválido ⇒ 400', async () => {
      expect((await get(tVenc, `vencimentos?tenantId=${parceiro.tenantId}`)).status).toBe(404);
      expect((await get(tVenc, `vencimentos?tenantId=${randomUUID()}`)).status).toBe(404);
      expect((await get(tVenc, 'vencimentos?tenantId=abc')).status).toBe(400);
    });
    it('faixa e page inválidos ⇒ 400; propriedade desconhecida ⇒ 400', async () => {
      for (const q of ['faixa=99', 'faixa=abc', 'page=0', 'page=-1', 'page=x', 'page=1.5', 'foo=1']) {
        expect((await get(tVenc, `vencimentos?${q}`)).status).toBe(400);
      }
    });
    it('page além do fim ⇒ itens vazios e total preservado', async () => {
      const r = await get(tVenc, `vencimentos?tenantId=${montese.tenantId}&page=50`);
      expect(r.status).toBe(200);
      expect(r.body.itens).toEqual([]);
      expect(r.body.total).toBeGreaterThanOrEqual(8);
    });
    it('audita a leitura (company.accessed) sem título nem valores', async () => {
      await get(tVenc, `vencimentos?tenantId=${montese.tenantId}`);
      const a = await db.client.query(
        "SELECT detail FROM audit_log WHERE actor_user_id = $1 AND action = 'company.accessed' ORDER BY occurred_at DESC LIMIT 1",
        [sVenc.userId],
      );
      expect(a.rows[0].detail).toBe('modulo: vencimentos-carteira');
    });
  });
});
