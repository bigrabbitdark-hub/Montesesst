import { BadRequestException } from '@nestjs/common';
import { PERMISSIONS } from '../src/common/permissions';
import { CATALOGO_PERMISSOES, PERMISSOES_SENSIVEIS } from '../src/atuacao/permissoes/permissoes-catalogo';
import { PermissoesAdminService } from '../src/atuacao/permissoes/permissoes-admin.service';

const CTX = { role: 'admin', method: 'PUT', path: '/atuacao/admin/permissoes/u1', ip: '127.0.0.1' };

function montar(socios: any[], atuais: string[], falhaAuditoria = false) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      if (sql.includes('INSERT INTO audit_log') && falhaAuditoria) throw new Error('falha simulada da auditoria');
      if (sql.includes('FROM users') && sql.includes('$1')) {
        const r = socios.filter((s) => s.id === params[0]);
        return { rows: r, rowCount: r.length };
      }
      if (sql.includes('FROM users')) return { rows: socios, rowCount: socios.length };
      if (sql.includes('SELECT permission FROM socio_permissions')) return { rows: atuais.map((permission) => ({ permission })), rowCount: atuais.length };
      if (sql.includes('FROM socio_permissions')) return { rows: atuais.map((permission) => ({ user_id: 'u1', permission })), rowCount: atuais.length };
      return { rows: [], rowCount: 0 };
    }),
  };
  return { service: new PermissoesAdminService(), client, consultas };
}
const SOCIO = [{ id: 'u1', nome: 'Fulano Teste', status: 'ativo' }];
const INATIVO = [{ id: 'u1', nome: 'Fulano Teste', status: 'inativo' }];

describe('catálogo de permissões', () => {
  it('cobre EXATAMENTE PERMISSIONS, sem repetição, em 8 grupos', () => {
    const todas = CATALOGO_PERMISSOES.flatMap((g) => g.itens.map((i) => i.permissao));
    expect(new Set(todas).size).toBe(todas.length);
    expect([...todas].sort()).toEqual([...PERMISSIONS].sort());
    expect(CATALOGO_PERMISSOES.map((g) => g.titulo)).toEqual(['Clientes', 'Tarefas e agenda', 'Financeiro', 'Documentos', 'Atuação por empresa', 'PGR — Programa de Gerenciamento de Riscos', 'Checklists por serviço', 'Alertas e notificações']);
    for (const g of CATALOGO_PERMISSOES) for (const i of g.itens) { expect(i.rotulo.length).toBeGreaterThan(2); expect(i.descricao.length).toBeGreaterThan(5); }
  });
  it('grupo empresas traz empresas.read e empresas.documentos, não sensíveis', () => {
    const g = CATALOGO_PERMISSOES.find((x) => x.id === 'empresas')!;
    expect(g.titulo).toBe('Atuação por empresa');
    expect(g.itens.map((x) => x.permissao)).toEqual(['empresas.read', 'empresas.documentos']);
    expect(g.itens.every((x) => x.sensivel === false)).toBe(true);
  });
  it('grupo pgr traz pgr.read e pgr.write, não sensíveis', () => {
    const g = CATALOGO_PERMISSOES.find((x) => x.id === 'pgr')!;
    expect(g.itens.map((x) => x.permissao)).toEqual(['pgr.read', 'pgr.write']);
    expect(g.itens.every((x) => x.sensivel === false)).toBe(true);
  });
  it('sensíveis são exatamente os 8 do plano', () => {
    const sens = CATALOGO_PERMISSOES.flatMap((g) => g.itens).filter((i) => i.sensivel).map((i) => i.permissao).sort();
    expect(sens).toEqual(['alertas.manage', 'checklists.approve', 'documents.approve', 'documents.cancel', 'documents.publish', 'documents.review', 'documents.sign', 'documents.view_registration']);
    expect([...PERMISSOES_SENSIVEIS].sort()).toEqual(sens);
  });
});

describe('PermissoesAdminService', () => {
  it('definir: valida sócio, trava, apaga e reinsere com granted_by do admin; calcula o diff', async () => {
    const { service, client, consultas } = montar(SOCIO, ['clients.read', 'tasks.read']);
    const out = await service.definir(client, 'adm', 'u1', ['tasks.read', 'tasks.write'], false, CTX);
    const sqls = consultas.map((c) => c.sql);
    const iLock = sqls.findIndex((s) => s.includes('pg_advisory_xact_lock'));
    const iDel = sqls.findIndex((s) => s.includes('DELETE FROM socio_permissions'));
    const iIns = sqls.findIndex((s) => s.includes('INSERT INTO socio_permissions'));
    expect(iLock).toBeGreaterThanOrEqual(0);
    expect(iLock).toBeLessThan(iDel);
    expect(iDel).toBeLessThan(iIns);
    expect(consultas[iIns].params).toEqual(['u1', ['tasks.read', 'tasks.write'], 'adm']);
    const aud = consultas.find((c) => c.sql.includes('INSERT INTO audit_log'))!;
    expect(aud.params).toEqual(['adm', 'admin', 'u1', 'PUT', '/atuacao/admin/permissoes/u1', '127.0.0.1',
      'usuario: u1; adicionadas(1): tasks.write; removidas(1): clients.read']);
    expect(aud.sql).toContain("'socio_permissions.changed'");
    expect(sqls.findIndex((x) => x.includes('INSERT INTO audit_log'))).toBeGreaterThan(iIns);
    expect(out).toEqual({ id: 'u1', nome: 'Fulano Teste', permissoes: ['tasks.read', 'tasks.write'], adicionadas: ['tasks.write'], removidas: ['clients.read'] });
  });
  it('definir: idempotente (mesmo conjunto) não escreve nada', async () => {
    const { service, client, consultas } = montar(SOCIO, ['clients.read', 'tasks.read']);
    const out = await service.definir(client, 'adm', 'u1', ['tasks.read', 'clients.read'], false, CTX);
    expect(consultas.some((c) => /DELETE|INSERT/.test(c.sql))).toBe(false); // inclui audit_log
    expect(out.adicionadas).toEqual([]);
    expect(out.removidas).toEqual([]);
  });
  it('definir: vazio remove todas e só apaga', async () => {
    const { service, client, consultas } = montar(SOCIO, ['clients.read']);
    const out = await service.definir(client, 'adm', 'u1', [], false, CTX);
    expect(consultas.some((c) => c.sql.includes('INSERT INTO socio_permissions'))).toBe(false);
    expect(consultas.some((c) => c.sql.includes('DELETE FROM socio_permissions'))).toBe(true);
    expect(out).toMatchObject({ permissoes: [], removidas: ['clients.read'] });
  });
  it('definir: fora de list_socios => 400 "Responsável inválido" sem escrever', async () => {
    const { service, client, consultas } = montar([], []);
    await expect(service.definir(client, 'adm', 'u1', ['clients.read'], false, CTX)).rejects.toThrow(new BadRequestException('Responsável inválido'));
    expect(consultas.some((c) => /DELETE|INSERT/.test(c.sql))).toBe(false);
  });
  it('definir: sensível adicionada sem confirmação => 400 sem escrever; com confirmação passa', async () => {
    const a = montar(SOCIO, []);
    await expect(a.service.definir(a.client, 'adm', 'u1', ['documents.sign'], false, CTX)).rejects.toThrow(new BadRequestException('Confirme a concessão de permissões sensíveis.'));
    expect(a.consultas.some((c) => /DELETE|INSERT/.test(c.sql))).toBe(false);
    const b = montar(SOCIO, []);
    const out = await b.service.definir(b.client, 'adm', 'u1', ['documents.sign'], true, CTX);
    expect(out.adicionadas).toEqual(['documents.sign']);
  });
  it('definir: manter sensível já concedida não exige confirmação', async () => {
    const { service, client } = montar(SOCIO, ['documents.sign']);
    const out = await service.definir(client, 'adm', 'u1', ['documents.sign', 'tasks.read'], false, CTX);
    expect(out.adicionadas).toEqual(['tasks.read']);
  });
  it('definir: permissão fora da lista ou repetida => 400', async () => {
    const { service, client } = montar(SOCIO, []);
    await expect(service.definir(client, 'adm', 'u1', ['x.y'], true, CTX)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.definir(client, 'adm', 'u1', ['clients.read', 'clients.read'], true, CTX)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('falha no INSERT da auditoria propaga o erro (a transação do chamador faz ROLLBACK)', async () => {
    const { service, client } = montar(SOCIO, [], true);
    await expect(service.definir(client, 'adm', 'u1', ['clients.read'], false, CTX)).rejects.toThrow('falha simulada da auditoria');
  });
  it('inativo: só remove; adicionar => 400 sem escrever; remoção total permitida', async () => {
    const a = montar(INATIVO, ['clients.read', 'tasks.read']);
    await expect(a.service.definir(a.client, 'adm', 'u1', ['clients.read', 'finance.read'], false, CTX)).rejects.toThrow(new BadRequestException('Sócio inativo: só é possível remover permissões.'));
    expect(a.consultas.some((c) => /DELETE|INSERT/.test(c.sql))).toBe(false);
    const b = montar(INATIVO, ['clients.read', 'tasks.read']);
    const out = await b.service.definir(b.client, 'adm', 'u1', [], false, CTX);
    expect(out.removidas).toEqual(['clients.read', 'tasks.read']);
    const c = montar(INATIVO, ['clients.read', 'tasks.read']);
    expect((await c.service.definir(c.client, 'adm', 'u1', ['tasks.read'], false, CTX)).removidas).toEqual(['clients.read']);
  });
  it('listar: devolve catálogo e sócios com permissões, sem e-mail', async () => {
    const { service, client } = montar(SOCIO, ['tasks.read']);
    const out = await service.listar(client);
    expect((await montar(INATIVO, []).service.listar(montar(INATIVO, []).client)).socios[0].ativo).toBe(false);
    expect(out.socios).toEqual([{ id: 'u1', nome: 'Fulano Teste', ativo: true, permissoes: ['tasks.read'] }]);
    expect(out.catalogo.grupos).toHaveLength(8);
    expect(JSON.stringify(out)).not.toContain('email');
  });
});
