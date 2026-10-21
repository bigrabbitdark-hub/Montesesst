import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CATEGORIAS_DOCUMENTO } from '../src/atuacao/documentos/dto/documentos.dto';
import { DocumentosAdminService } from '../src/atuacao/documentos/documentos-admin.service';

function montar(rows: Record<string, any[]>) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      const chave = Object.keys(rows).find((k) => sql.includes(k));
      return { rows: chave ? rows[chave] : [], rowCount: chave ? rows[chave].length : 0 };
    }),
  };
  return { service: new DocumentosAdminService(), client, consultas };
}

describe('DocumentosAdminService', () => {
  it('definirMatriz: usuário fora de list_socios => 400 "Responsável inválido" sem escrever', async () => {
    const { service, client, consultas } = montar({ 'FROM list_socios()': [] });
    await expect(service.definirMatriz(client, 'adm', 'pgr', 'u1', ['elaborar'])).rejects.toThrow(new BadRequestException('Responsável inválido'));
    expect(consultas.some((c) => /DELETE|INSERT/.test(c.sql))).toBe(false);
  });

  it('definirMatriz: trava por par, apaga e reinsere com granted_by do admin, na ordem', async () => {
    const { service, client, consultas } = montar({ 'FROM list_socios()': [{ id: 'u1' }] });
    const out = await service.definirMatriz(client, 'adm', 'pgr', 'u1', ['assinar', 'elaborar']);
    const sqls = consultas.map((c) => c.sql);
    const iLock = sqls.findIndex((s) => s.includes('pg_advisory_xact_lock'));
    const iDel = sqls.findIndex((s) => s.includes('DELETE FROM document_type_permissions'));
    const iIns = sqls.findIndex((s) => s.includes('INSERT INTO document_type_permissions'));
    expect(iLock).toBeGreaterThanOrEqual(0);
    expect(iLock).toBeLessThan(iDel);
    expect(iDel).toBeLessThan(iIns);
    expect(consultas[iIns].params).toEqual(['pgr', 'u1', ['elaborar', 'assinar'], 'adm']);
    expect(out).toEqual({ category: 'pgr', user_id: 'u1', acoes: ['elaborar', 'assinar'] });
  });

  it('definirMatriz: conjunto vazio só apaga', async () => {
    const { service, client, consultas } = montar({ 'FROM list_socios()': [{ id: 'u1' }] });
    const out = await service.definirMatriz(client, 'adm', 'pgr', 'u1', []);
    expect(consultas.some((c) => c.sql.includes('INSERT INTO document_type_permissions'))).toBe(false);
    expect(consultas.some((c) => c.sql.includes('DELETE FROM document_type_permissions'))).toBe(true);
    expect(out.acoes).toEqual([]);
  });

  it('listarMatriz: filtra por categoria quando informada', async () => {
    const { service, client, consultas } = montar({ 'FROM document_type_permissions': [{ category: 'pgr', user_id: 'u1', nome: 'N', acoes: ['elaborar'] }] });
    const out = await service.listarMatriz(client, 'pgr');
    expect(out).toHaveLength(1);
    expect(consultas[0].params[0]).toBe('pgr');
  });

  it('criarRegistro: sócio inexistente => 400; duplicata (23505) => 409', async () => {
    const a = montar({ 'FROM list_socios()': [] });
    await expect(a.service.criarRegistro(a.client, 'adm', { user_id: 'u1', council: 'TESTE', registration_number: '0000', uf: 'SC' }))
      .rejects.toBeInstanceOf(BadRequestException);
    const b = montar({ 'FROM list_socios()': [{ id: 'u1' }] });
    const orig = b.client.query;
    b.client.query = jest.fn(async (sql: string, p: any[]) => {
      if (sql.includes('INSERT INTO professional_registrations')) throw Object.assign(new Error('dup'), { code: '23505' });
      return orig(sql, p);
    });
    await expect(b.service.criarRegistro(b.client, 'adm', { user_id: 'u1', council: 'TESTE', registration_number: '0000', uf: 'SC' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('confirmarRegistro: só pendente; inexistente 404; já confirmado 409', async () => {
    const ok = montar({ 'UPDATE professional_registrations': [{ id: 'r1', status: 'confirmado' }] });
    expect((await ok.service.confirmarRegistro(ok.client, 'adm', 'r1')).status).toBe('confirmado');
    expect(ok.consultas[0].sql).toContain("status = 'pendente'");
    expect(ok.consultas[0].params).toEqual(['r1', 'adm']);
    const ja = montar({ 'FROM professional_registrations': [{ id: 'r1' }] });
    await expect(ja.service.confirmarRegistro(ja.client, 'adm', 'r1')).rejects.toBeInstanceOf(ConflictException);
    const nao = montar({});
    await expect(nao.service.confirmarRegistro(nao.client, 'adm', 'r1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revogarRegistro: só confirmado -> revogado (grava revoked_by); inexistente 404; repetir 409', async () => {
    const ok = montar({ 'UPDATE professional_registrations': [{ id: 'r1', user_id: 'u1', status: 'revogado' }] });
    expect((await ok.service.revogarRegistro(ok.client, 'adm', 'r1')).status).toBe('revogado');
    expect(ok.consultas[0].sql).toContain("status = 'confirmado'");
    expect(ok.consultas[0].sql).toContain('revoked_by');
    expect(ok.consultas[0].params).toEqual(['r1', 'adm']);
    const ja = montar({ 'FROM professional_registrations': [{ id: 'r1' }] });
    await expect(ja.service.revogarRegistro(ja.client, 'adm', 'r1')).rejects.toBeInstanceOf(ConflictException);
    const nao = montar({});
    await expect(nao.service.revogarRegistro(nao.client, 'adm', 'r1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listarSocios: usa list_socios() ordenado e devolve só id e nome', async () => {
    const { service, client, consultas } = montar({ 'FROM list_socios()': [{ id: 'u1', nome: 'Ana' }] });
    expect(await service.listarSocios(client)).toEqual([{ id: 'u1', nome: 'Ana' }]);
    expect(consultas[0].sql).toContain('list_socios()');
  });

  it('viabilidade: cobre todas as categorias; sem linhas => nao_configurada; assinar mostra registro_confirmado; sem conselho/número', async () => {
    const { service, client, consultas } = montar({
      'FROM document_type_permissions': [
        { category: 'pgr', user_id: 'a', nome: 'Ana', acoes: ['elaborar'] },
        { category: 'pgr', user_id: 'b', nome: 'Beto', acoes: ['revisar', 'aprovar', 'assinar', 'publicar'] },
        { category: 'laudo', user_id: 'c', nome: 'Cris', acoes: ['assinar'] },
        { category: 'ltcat', user_id: 'x', nome: null, acoes: ['elaborar'] },
      ],
      'FROM professional_registrations': [{ user_id: 'b' }],
    });
    const out = await service.viabilidade(client);
    expect(out.map((o: any) => o.category)).toEqual([...CATEGORIAS_DOCUMENTO]);
    const por = (c: string) => out.find((o: any) => o.category === c)!;
    expect(por('pgr').status).toBe('viavel');
    expect(por('pgr').habilitados.find((h: any) => h.acao === 'assinar')!.pessoas).toEqual([{ id: 'b', nome: 'Beto', registro_confirmado: true }]);
    expect(por('pgr').habilitados.find((h: any) => h.acao === 'elaborar')!.pessoas).toEqual([{ id: 'a', nome: 'Ana' }]);
    expect(por('laudo').status).toBe('inviavel');
    expect(por('laudo').habilitados.find((h: any) => h.acao === 'assinar')!.pessoas).toEqual([{ id: 'c', nome: 'Cris', registro_confirmado: false }]);
    expect(por('ltcat').status).toBe('nao_configurada'); // linha de quem não é sócio é ignorada
    expect(por('lip').status).toBe('nao_configurada');
    expect(JSON.stringify(out)).not.toMatch(/council|registration_number|TESTE|0000/);
    const regSql = consultas.find((c) => c.sql.includes('FROM professional_registrations'))!.sql;
    expect(regSql).toContain("status = 'confirmado'");
    expect(regSql).not.toMatch(/registration_number|council/);
  });
});
