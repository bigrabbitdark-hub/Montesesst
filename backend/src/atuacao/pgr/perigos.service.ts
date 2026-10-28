import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { PoolClient } from 'pg';
import { mapPgError } from '../../common/pg-error.util';
import type { AuditCtx } from '../permissoes/permissoes-admin.service';
import {
  AtualizarPerigoDto, CAMPOS_OPCIONAIS, CriarPerigoDto, DuplicarPerigoDto, ExportarPerigosQuery,
  ImportarPerigosDto, ListarPerigosQuery, MAX_IMPORTACAO, PerigoItemDto,
} from './dto/perigo.dto';

export type Ator = { id: string; role: string };
type Origem = 'manual' | 'importado' | 'duplicado';

const COLUNAS_LISTA = `id, scope, tenant_id, category, name, left(description, 200) AS description, esocial_code, default_assessment, active`;
const ATUALIZAVEIS: string[] = ['category', 'name', ...CAMPOS_OPCIONAIS];
const LIMITE_EXPORTACAO = 5000;
const NOME_DUPLICADO = 'Já existe um perigo com este nome nesta categoria e escopo.';

// Cada método recebe o `client` já dentro do contexto do usuário (req.withTenantContext, uma transação):
// a RLS decide o que cada papel enxerga/escreve; as checagens abaixo só dão a resposta HTTP correta.
// A auditoria é gravada na MESMA transação (fail-closed) e o `detail` leva só ids e NOMES de campos.
@Injectable()
export class PerigosService {
  // Empresa visível ao chamador (sócio só enxerga clientes Montese). Invisível/inexistente ⇒ 404.
  private async exigirEmpresa(c: PoolClient, tenantId: string) {
    // Biblioteca de empresa só existe para cliente Montese, para qualquer papel (admin inclusive): uniforme 404.
    const r = await c.query('SELECT t.id FROM tenants t WHERE t.id = $1 AND is_montese_tenant(t.id)', [tenantId]);
    if (!r.rows.length) throw new NotFoundException('Empresa não encontrada');
  }

  private projetar(row: any) {
    const { created_by: _omitido, ...resto } = row;
    return resto;
  }

  private async auditar(c: PoolClient, ator: Ator, ctx: AuditCtx, action: string, resourceId: string | null, detail: string) {
    await c.query(
      `INSERT INTO audit_log (actor_user_id, actor_role, action, resource_type, resource_id, method, path, status_code, ip_address, detail)
       VALUES ($1, $2, $3, 'pgr_hazard', $4, $5, $6, 200, $7, $8)`,
      [ator.id, ctx.role, action, resourceId, ctx.method, ctx.path, ctx.ip ?? null, detail],
    );
  }

  async listar(c: PoolClient, ator: Ator, q: ListarPerigosQuery) {
    const where: string[] = [];
    const p: unknown[] = [];
    if (q.tenantId) {
      await this.exigirEmpresa(c, q.tenantId);
      p.push(q.tenantId);
      where.push(`(scope = 'global' OR tenant_id = $${p.length})`);
    } else if (ator.role === 'admin') {
      where.push("(scope = 'global' OR is_montese_tenant(tenant_id))");
    } else {
      // Sócio sem empresa escolhida vê só a biblioteca global (nunca perigos de clientes em bloco).
      where.push("scope = 'global'");
    }
    if (q.categoria) { p.push(q.categoria); where.push(`category = $${p.length}`); }
    if (q.ativo) { p.push(q.ativo === 'true'); where.push(`active = $${p.length}`); }
    if (q.q) {
      p.push(`%${q.q.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`name ILIKE $${p.length}`);
    }
    const r = await c.query(
      `SELECT ${COLUNAS_LISTA} FROM pgr_hazards ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY category, lower(name), id LIMIT 200`,
      p,
    );
    return r.rows;
  }

  private async buscar(c: PoolClient, id: string) {
    const r = await c.query(
      'SELECT * FROM pgr_hazards WHERE id = $1 AND (tenant_id IS NULL OR is_montese_tenant(tenant_id))', [id],
    );
    if (!r.rows.length) throw new NotFoundException('Perigo não encontrado');
    return r.rows[0];
  }

  // Sócio lê perigo de empresa só informando a empresa (tenantId) a que ele pertence; sem isso, 404.
  async obter(c: PoolClient, ator: Ator, id: string, tenantId?: string) {
    const row = await this.buscar(c, id);
    if (ator.role !== 'admin' && row.scope === 'tenant' && row.tenant_id !== tenantId) {
      throw new NotFoundException('Perigo não encontrado');
    }
    return this.projetar(row);
  }

  // Sócio só mexe em perigo do tenant (Montese, pela RLS); o global é do admin.
  // Valida o papel e só então trava a linha: FOR UPDATE de uma linha que o sócio só pode LER
  // (global) a esconderia pela RLS e viraria 404 em vez de 403.
  private async travarParaEscrita(c: PoolClient, ator: Ator, row: { id: string; scope: string }) {
    this.exigirEscrita(ator, row);
    await c.query('SELECT id FROM pgr_hazards WHERE id = $1 FOR UPDATE', [row.id]);
  }

  private exigirEscrita(ator: Ator, row: { scope: string }) {
    if (row.scope === 'global' && ator.role !== 'admin') {
      throw new ForbiddenException('Apenas o administrador altera a biblioteca global');
    }
  }

  private async inserir(c: PoolClient, ator: Ator, scope: 'global' | 'tenant', tenantId: string | null, d: PerigoItemDto, origem: Origem) {
    // origin é constante interna (literal no SQL), nunca entrada do cliente.
    const cols = ['scope', 'tenant_id', 'category', 'name', 'origin', 'created_by'];
    const vals: unknown[] = [scope, tenantId, d.category, d.name, ator.id];
    const marcas = ['$1', '$2', '$3', '$4', `'${origem}'`, '$5'];
    for (const k of CAMPOS_OPCIONAIS) {
      const v = (d as any)[k];
      if (v === undefined) continue;
      if (k === 'exposure_routes' && v === null) continue;
      vals.push(k === 'psychosocial' && v !== null ? JSON.stringify(v) : v);
      cols.push(k);
      marcas.push(`$${vals.length}${k === 'psychosocial' ? '::jsonb' : ''}`);
    }
    try {
      const r = await c.query(`INSERT INTO pgr_hazards (${cols.join(', ')}) VALUES (${marcas.join(', ')}) RETURNING *`, vals);
      return r.rows[0];
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException(NOME_DUPLICADO);
      return mapPgError(e);
    }
  }

  private nomesCampos(d: object): string {
    return Object.keys(d).filter((k) => (d as any)[k] !== undefined).join(', ');
  }

  async criar(c: PoolClient, ator: Ator, dto: CriarPerigoDto, ctx: AuditCtx) {
    const admin = ator.role === 'admin';
    const scope = dto.scope ?? (dto.tenant_id ? 'tenant' : admin ? 'global' : 'tenant');
    let tenantId: string | null = null;
    if (scope === 'global') {
      if (!admin) throw new ForbiddenException('Apenas o administrador cria perigos globais');
      if (dto.tenant_id) throw new BadRequestException('Perigo global não tem empresa');
    } else {
      if (!dto.tenant_id) throw new BadRequestException('Informe a empresa (tenant_id)');
      await this.exigirEmpresa(c, dto.tenant_id);
      tenantId = dto.tenant_id;
    }
    const { tenant_id: _t, scope: _s, ...conteudo } = dto;
    const row = await this.inserir(c, ator, scope, tenantId, conteudo as PerigoItemDto, 'manual');
    await this.auditar(c, ator, ctx, 'pgr.hazard.created', row.id,
      `perigo: ${row.id}; escopo: ${scope}${tenantId ? `; empresa: ${tenantId}` : ''}; campos: ${this.nomesCampos(conteudo)}`);
    return this.projetar(row);
  }

  async atualizar(c: PoolClient, ator: Ator, id: string, dto: AtualizarPerigoDto, ctx: AuditCtx) {
    const campos = Object.keys(dto).filter((k) => (dto as any)[k] !== undefined);
    if (campos.some((k) => !ATUALIZAVEIS.includes(k))) throw new BadRequestException('Campo não permitido');
    if (!campos.length) throw new BadRequestException('Informe ao menos um campo para alterar');
    for (const k of ['category', 'name', 'exposure_routes']) {
      if ((dto as any)[k] === null) throw new BadRequestException(`${k} não pode ser nulo`);
    }
    await this.travarParaEscrita(c, ator, await this.buscar(c, id));
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of campos) {
      const v = (dto as any)[k];
      vals.push(k === 'psychosocial' && v !== null ? JSON.stringify(v) : v);
      sets.push(`${k} = $${vals.length}${k === 'psychosocial' ? '::jsonb' : ''}`);
    }
    vals.push(id);
    try {
      const r = await c.query(`UPDATE pgr_hazards SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
      if (!r.rows.length) throw new NotFoundException('Perigo não encontrado');
      await this.auditar(c, ator, ctx, 'pgr.hazard.updated', id, `perigo: ${id}; campos: ${campos.join(', ')}`);
      return this.projetar(r.rows[0]);
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException(NOME_DUPLICADO);
      if (e instanceof NotFoundException) throw e;
      return mapPgError(e);
    }
  }

  async definirAtivo(c: PoolClient, ator: Ator, id: string, active: boolean, ctx: AuditCtx) {
    await this.travarParaEscrita(c, ator, await this.buscar(c, id));
    const r = await c.query('UPDATE pgr_hazards SET active = $1 WHERE id = $2 RETURNING *', [active, id]);
    if (!r.rows.length) throw new NotFoundException('Perigo não encontrado');
    await this.auditar(c, ator, ctx, 'pgr.hazard.toggled', id, `perigo: ${id}; campos: active`);
    return this.projetar(r.rows[0]);
  }

  // Cópia: sócio ⇒ sempre do tenant (informa a empresa ou herda a do perigo de origem);
  // admin ⇒ global, salvo se informar `tenant_id`.
  async duplicar(c: PoolClient, ator: Ator, id: string, dto: DuplicarPerigoDto, ctx: AuditCtx) {
    const admin = ator.role === 'admin';
    const origem = await this.buscar(c, id);
    const tenantId = admin ? dto.tenant_id ?? null : dto.tenant_id ?? origem.tenant_id ?? null;
    if (!admin && !tenantId) throw new BadRequestException('Informe a empresa (tenant_id)');
    if (admin && !tenantId && origem.scope === 'tenant' && dto.para_global !== true) {
      throw new BadRequestException('Para copiar um perigo de empresa para a biblioteca global, envie para_global: true (ou informe tenant_id)');
    }
    if (dto.para_global && dto.tenant_id) throw new BadRequestException('Use para_global ou tenant_id, não os dois');
    if (dto.para_global && !admin) throw new ForbiddenException('Apenas o administrador cria perigos globais');
    if (tenantId) await this.exigirEmpresa(c, tenantId);
    const nome = dto.name ?? (origem.name.length + 9 > 200 ? origem.name.slice(0, 191) : origem.name) + ' (cópia)';
    const conteudo: Record<string, unknown> = { category: origem.category, name: nome };
    for (const k of CAMPOS_OPCIONAIS) conteudo[k] = origem[k] ?? undefined;
    if (origem.default_assessment == null) delete conteudo.default_assessment;
    const row = await this.inserir(c, ator, tenantId ? 'tenant' : 'global', tenantId, conteudo as unknown as PerigoItemDto, 'duplicado');
    await this.auditar(c, ator, ctx, 'pgr.hazard.duplicated', row.id, `perigo: ${row.id}; origem: ${id}; escopo: ${row.scope}${dto.para_global ? '; campos: para_global' : ''}`);
    return this.projetar(row);
  }

  async exportar(c: PoolClient, _ator: Ator, q: ExportarPerigosQuery) {
    const p: unknown[] = [];
    let filtro = "scope = 'global'";
    if (q.tenantId) {
      await this.exigirEmpresa(c, q.tenantId);
      p.push(q.tenantId);
      filtro = 'tenant_id = $1';
    }
    const r = await c.query(
      `SELECT category, name, description, sources, health_effects, exposure_routes, default_assessment, default_unit,
              tolerance_limit, tolerance_reference, suggested_controls, esocial_code, psychosocial, active
         FROM pgr_hazards WHERE ${filtro} ORDER BY category, lower(name) LIMIT ${LIMITE_EXPORTACAO + 1}`,
      p,
    );
    const truncado = r.rows.length > LIMITE_EXPORTACAO;
    return { versao: 1, escopo: q.tenantId ? 'tenant' : 'global', truncado, itens: truncado ? r.rows.slice(0, LIMITE_EXPORTACAO) : r.rows };
  }

  // Tudo-ou-nada: valida TODAS as linhas antes de gravar; qualquer erro ⇒ 400 com relatório e nada é inserido.
  async importar(c: PoolClient, ator: Ator, dto: ImportarPerigosDto, ctx: AuditCtx) {
    if (ator.role !== 'admin') throw new ForbiddenException('Apenas o administrador importa a biblioteca');
    const itens = dto.itens ?? [];
    if (!itens.length || itens.length > MAX_IMPORTACAO) {
      throw new BadRequestException(`Informe de 1 a ${MAX_IMPORTACAO} itens`);
    }
    const tenantId = dto.tenant_id ?? null;
    if (tenantId) await this.exigirEmpresa(c, tenantId);

    const erros: Array<{ linha: number; campos: string[] }> = [];
    const validos: PerigoItemDto[] = [];
    itens.forEach((bruto, i) => {
      const inst = plainToInstance(PerigoItemDto, bruto);
      const e = validateSync(inst, { whitelist: true, forbidNonWhitelisted: true });
      if (e.length) erros.push({ linha: i + 1, campos: e.map((x) => x.property) });
      else validos.push(inst);
    });
    // Nome repetido no arquivo ou já existente no escopo ⇒ erro da linha (mesma chave do índice único).
    const existentes = await c.query(
      'SELECT category, lower(name) AS n FROM pgr_hazards WHERE tenant_id IS NOT DISTINCT FROM $1::uuid',
      [tenantId],
    );
    const vistos = new Set<string>(existentes.rows.map((r: any) => `${r.category}|${r.n}`));
    let vi = 0;
    itens.forEach((_, i) => {
      if (erros.some((e) => e.linha === i + 1)) return;
      const d = validos[vi++];
      const chave = `${d.category}|${d.name.toLowerCase()}`;
      if (vistos.has(chave)) erros.push({ linha: i + 1, campos: ['name'] });
      vistos.add(chave);
    });
    if (erros.length) {
      erros.sort((a, b) => a.linha - b.linha);
      throw new BadRequestException({ statusCode: 400, message: 'Importação recusada: corrija as linhas indicadas', erros });
    }
    for (const d of validos) await this.inserir(c, ator, tenantId ? 'tenant' : 'global', tenantId, d, 'importado');
    await this.auditar(c, ator, ctx, 'pgr.hazard.imported', null,
      `itens: ${validos.length}; escopo: ${tenantId ? 'tenant' : 'global'}${tenantId ? `; empresa: ${tenantId}` : ''}`);
    return { importados: validos.length };
  }
}
