import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { mapPgError } from '../../../common/pg-error.util';
import type { AuditCtx } from '../../permissoes/permissoes-admin.service';
import type { Ator } from '../perigos.service';
import { celulas, MatrizConfig, MatrizHashInvalidoError, sha256Canonico, validarConfig } from './matriz-config';
import { AtualizarMatrizDto, CriarMatrizDto, MAX_CONFIG_BYTES, PublicarMatrizDto, ValidarMatrizDto } from './dto/matriz.dto';

// Advisory lock (chave por hash de texto, espaço próprio) que serializa criação e publicação de versões.
const LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtextextended('pgr_matrix_versions:numero', 0))`;

// Listas brancas de colunas. O sócio nunca recebe created_by/published_by (ids de usuários internos).
const COLS_ADMIN = 'id, version_number, status, config_sha256, notes, created_by, published_by, published_at, created_at, updated_at';
const COLS_SOCIO = 'id, version_number, status, config_sha256, notes, published_at, created_at, updated_at';
const STATUS_VISIVEIS_SOCIO = ['publicada', 'arquivada'];

// Matriz global da Montese: só o admin escreve (checagem de papel ANTES de qualquer consulta/lock, além do @Roles); o sócio lê
// versões publicadas/arquivadas (RLS + filtro explícito). Auditoria na MESMA transação (fail-closed), `detail` só com ids/nomes
// de campo/hash — nunca texto livre (notas, rótulos, descrições).
@Injectable()
export class MatrizService {
  private exigirAdmin(ator: Ator) {
    if (ator.role !== 'admin') throw new ForbiddenException('Operação não permitida para este perfil');
  }

  private cols(ator: Ator) { return ator.role === 'admin' ? COLS_ADMIN : COLS_SOCIO; }
  private filtroStatus(ator: Ator) { return ator.role === 'admin' ? '' : ` AND status = ANY($2::text[])`; }

  private async auditar(c: PoolClient, ator: Ator, ctx: AuditCtx, action: string, id: string, detail: string) {
    await c.query(
      `INSERT INTO audit_log (actor_user_id, actor_role, action, resource_type, resource_id, method, path, status_code, ip_address, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 200, $8, $9)`,
      [ator.id, ctx.role, action, 'pgr_matrix_version', id, ctx.method, ctx.path, ctx.ip ?? null, detail],
    );
  }

  private erroBanco(e: unknown): never {
    const err = e as { code?: string; constraint?: string };
    if (err?.code === '23514' && /config_check/.test(err.constraint ?? '')) {
      throw new BadRequestException(`A configuração excede o limite de ${MAX_CONFIG_BYTES} bytes`);
    }
    if (typeof err?.code === 'string' && err.code.startsWith('22')) throw new BadRequestException('Configuração contém dados que não podem ser armazenados');
    if (err?.code === '23505' && /version_number/.test(err.constraint ?? '')) {
      throw new ConflictException('Outra versão foi criada ao mesmo tempo; tente novamente');
    }
    return mapPgError(e);
  }

  private tamanho(config: unknown) {
    if (Buffer.byteLength(JSON.stringify(config), 'utf8') > MAX_CONFIG_BYTES) {
      throw new BadRequestException(`A configuração excede o limite de ${MAX_CONFIG_BYTES} bytes`);
    }
  }

  // Avisos do rascunho: erros e pendências da validação (não impedem gravar rascunho).
  private avisos(config: unknown) {
    const v = validarConfig(config, { publicar: true });
    return { erros: v.erros, pendencias: v.pendencias, pode_publicar: v.ok };
  }

  private async travar(c: PoolClient, id: string) {
    const r = await c.query('SELECT * FROM pgr_matrix_versions WHERE id = $1 FOR UPDATE', [id]);
    if (!r.rows.length) throw new NotFoundException('Versão da matriz não encontrada');
    return r.rows[0];
  }

  async listar(c: PoolClient, ator: Ator) {
    const admin = ator.role === 'admin';
    const r = await c.query(
      `SELECT ${this.cols(ator)} FROM pgr_matrix_versions ${admin ? '' : 'WHERE status = ANY($1::text[])'} ORDER BY version_number DESC LIMIT 500`,
      admin ? [] : [STATUS_VISIVEIS_SOCIO],
    );
    return r.rows;
  }

  // Vigente = a de MAIOR version_number entre as publicadas (não se exige uma única publicada).
  async vigente(c: PoolClient, ator: Ator) {
    const r = await c.query(
      `SELECT ${this.cols(ator)}, config FROM pgr_matrix_versions WHERE status = 'publicada' ORDER BY version_number DESC LIMIT 1`,
    );
    if (!r.rows.length) throw new NotFoundException('Nenhuma matriz publicada.');
    return r.rows[0];
  }

  async obter(c: PoolClient, ator: Ator, id: string) {
    const admin = ator.role === 'admin';
    const r = await c.query(
      `SELECT ${this.cols(ator)}, config FROM pgr_matrix_versions WHERE id = $1${this.filtroStatus(ator)}`,
      admin ? [id] : [id, STATUS_VISIVEIS_SOCIO],
    );
    if (!r.rows.length) throw new NotFoundException('Versão da matriz não encontrada');
    return r.rows[0];
  }

  async criar(c: PoolClient, ator: Ator, dto: CriarMatrizDto, ctx: AuditCtx) {
    this.exigirAdmin(ator);
    if (dto.copiar_de && dto.config) throw new BadRequestException('Informe copiar_de ou config, não os dois');
    let config: unknown = dto.config ?? {};
    if (dto.config) this.tamanho(dto.config);
    if (dto.copiar_de) {
      const o = await c.query('SELECT config FROM pgr_matrix_versions WHERE id = $1', [dto.copiar_de]);
      if (!o.rows.length) throw new NotFoundException('Versão de origem não encontrada');
      config = o.rows[0].config;
    }
    let id: string;
    try {
      // Serializa criadores concorrentes até o fim da transação: o max+1 só é lido depois do lock, então nunca colide.
      await c.query(LOCK_SQL);
      const n = (await c.query('SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM pgr_matrix_versions')).rows[0].n as number;
      id = (await c.query(
        'INSERT INTO pgr_matrix_versions (version_number, config, notes, created_by) VALUES ($1, $2::jsonb, $3, $4) RETURNING id',
        [Number(n), JSON.stringify(config), dto.notes ?? null, ator.id],
      )).rows[0].id;
    } catch (e) { return this.erroBanco(e); }
    const novo = await this.obterAdmin(c, ator, id);
    await this.auditar(c, ator, ctx, 'pgr.matrix.created', id,
      `versao: ${id}; numero: ${novo.version_number}; origem: ${dto.copiar_de ?? 'nenhuma'}`);
    return { ...novo, validacao: this.avisos(novo.config) };
  }

  private async obterAdmin(c: PoolClient, ator: Ator, id: string) {
    const r = await c.query(`SELECT ${COLS_ADMIN}, config FROM pgr_matrix_versions WHERE id = $1`, [id]);
    if (!r.rows.length) throw new NotFoundException('Versão da matriz não encontrada');
    return r.rows[0];
  }

  async atualizar(c: PoolClient, ator: Ator, id: string, dto: AtualizarMatrizDto, ctx: AuditCtx) {
    this.exigirAdmin(ator);
    if (dto.config === undefined && dto.notes === undefined) throw new BadRequestException('Informe ao menos um campo para alterar');
    if (dto.config === null) throw new BadRequestException('config não pode ser nulo');
    if (dto.config !== undefined) this.tamanho(dto.config);
    const atual = await this.travar(c, id);
    if (atual.status !== 'rascunho') throw new ConflictException('Somente uma versão em rascunho pode ser alterada; crie uma nova versão a partir desta');
    const campos: string[] = [];
    const vals: unknown[] = [];
    if (dto.config !== undefined) { campos.push('config'); vals.push(JSON.stringify(dto.config)); }
    if (dto.notes !== undefined) { campos.push('notes'); vals.push(dto.notes); }
    const sets = campos.map((k, i) => `${k} = $${i + 1}${k === 'config' ? '::jsonb' : ''}`);
    vals.push(id);
    try {
      await c.query(`UPDATE pgr_matrix_versions SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    } catch (e) { return this.erroBanco(e); }
    await this.auditar(c, ator, ctx, 'pgr.matrix.updated', id, `versao: ${id}; numero: ${atual.version_number}; campos: ${campos.join(', ')}`);
    const novo = await this.obterAdmin(c, ator, id);
    return { ...novo, validacao: this.avisos(novo.config) };
  }

  async publicar(c: PoolClient, ator: Ator, id: string, ctx: AuditCtx, dto: PublicarMatrizDto = {}) {
    this.exigirAdmin(ator);
    // Mesmo lock da criação (antes do lock da linha, ordem única): publicações concorrentes não furam a regra abaixo.
    await c.query(LOCK_SQL);
    const atual = await this.travar(c, id);
    if (atual.status !== 'rascunho') throw new ConflictException('Somente uma versão em rascunho pode ser publicada');
    // Rascunho alterado depois que o cliente o leu (ex.: outra aba/admin): não publica o que ele não viu.
    if (dto.updated_at !== undefined && new Date(dto.updated_at).getTime() !== new Date(atual.updated_at).getTime()) {
      throw new ConflictException('O rascunho foi alterado desde que você o abriu; recarregue antes de publicar.');
    }
    // A vigente é a de maior número: publicar um número menor que o de uma publicada seria inócuo e confuso.
    const mais = await c.query(`SELECT 1 FROM pgr_matrix_versions WHERE status = 'publicada' AND version_number > $1 LIMIT 1`, [atual.version_number]);
    if (mais.rows.length) throw new ConflictException('Existe uma versão publicada mais nova; crie uma nova versão a partir desta (copiar_de).');
    const v = validarConfig(atual.config, { publicar: true });
    if (!v.ok) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'A matriz não pode ser publicada: corrija os erros e preencha as pendências.',
        erros: v.erros,
        pendencias: v.pendencias,
      });
    }
    let sha: string;
    try { sha = sha256Canonico(atual.config); } catch (e) {
      if (e instanceof MatrizHashInvalidoError) throw new BadRequestException(`A configuração não pode ser publicada: ${e.message}`);
      throw e;
    }
    try {
      await c.query(
        `UPDATE pgr_matrix_versions SET status = 'publicada', config_sha256 = $1, published_by = $2, published_at = now() WHERE id = $3`,
        [sha, ator.id, id],
      );
    } catch (e) { return this.erroBanco(e); }
    await this.auditar(c, ator, ctx, 'pgr.matrix.published', id, `versao: ${id}; numero: ${atual.version_number}; sha256: ${sha}`);
    return this.obterAdmin(c, ator, id);
  }

  async arquivar(c: PoolClient, ator: Ator, id: string, ctx: AuditCtx) {
    this.exigirAdmin(ator);
    const atual = await this.travar(c, id);
    if (atual.status !== 'publicada') throw new ConflictException('Somente uma versão publicada pode ser arquivada');
    try {
      await c.query(`UPDATE pgr_matrix_versions SET status = 'arquivada' WHERE id = $1`, [id]);
    } catch (e) { return this.erroBanco(e); }
    await this.auditar(c, ator, ctx, 'pgr.matrix.archived', id, `versao: ${id}; numero: ${atual.version_number}`);
    return this.obterAdmin(c, ator, id);
  }

  // Validação sem persistência. `celulas` (prévia do mapa de calor) só quando não há erros.
  validar(dto: ValidarMatrizDto) {
    this.tamanho(dto.config);
    const v = validarConfig(dto.config, { publicar: dto.publicar === true });
    const pode = validarConfig(dto.config, { publicar: true }).ok;
    let cel: unknown = null;
    if (v.erros.length === 0) {
      try { cel = celulas(dto.config as unknown as MatrizConfig); } catch { cel = null; }
    }
    return { ok: v.ok, erros: v.erros, pendencias: v.pendencias, pode_publicar: pode, celulas: cel };
  }
}
