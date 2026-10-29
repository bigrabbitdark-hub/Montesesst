import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { mapPgError } from '../../common/pg-error.util';
import type { AuditCtx } from '../permissoes/permissoes-admin.service';
import {
  AtualizarControleDto, AtualizarMedicaoDto, AtualizarRiscoDto, CopiarRiscosDto, CriarControleDto, CriarMedicaoDto, CriarRiscosDto,
} from './dto/risco.dto';
import type { Ator } from './perigos.service';

// Colunas que cada UPDATE pode tocar (defesa em profundidade além do ValidationPipe). tenant_id, ghe_id, hazard_id,
// risk_id nunca entram: o vínculo do risco com o GHE/perigo e dos filhos com o risco é imutável.
const RISCO_PERMITIDOS = [
  'category', 'name', 'description', 'sources', 'health_effects', 'exposure_routes', 'tolerance_limit', 'tolerance_reference',
  'psychosocial', 'activity', 'exposure_type', 'esocial_code', 'assessment_type', 'assessment_notes', 'status',
] as const;
const RISCO_NAO_NULOS = ['category', 'name', 'status', 'exposure_routes'];
const CONTROLE_PERMITIDOS = ['kind', 'description', 'status', 'effectiveness', 'epi_catalog_item_id', 'training_tipo'] as const;
const CONTROLE_NAO_NULOS = ['kind', 'description', 'status', 'effectiveness'];
const MEDICAO_PERMITIDOS = [
  'agent', 'value', 'unit', 'tolerance_limit', 'reference', 'methodology', 'equipment', 'equipment_serial',
  'calibration_date', 'evaluated_on', 'responsible_name', 'professional_registration_id', 'document_id',
] as const;
const MEDICAO_NAO_NULOS = ['agent'];
const MAX_RISCOS_COPIA = 500;

// Medição: datas como AAAA-MM-DD (sem fuso).
const COLS_MED = `id, tenant_id, risk_id, agent, value, unit, tolerance_limit, reference, methodology, equipment, equipment_serial,
  to_char(calibration_date, 'YYYY-MM-DD') AS calibration_date, to_char(evaluated_on, 'YYYY-MM-DD') AS evaluated_on,
  responsible_name, professional_registration_id, document_id, created_at, updated_at`;

const SQL_RISCO = `
  SELECT r.*,
         COALESCE((SELECT json_agg(x) FROM (SELECT c.* FROM pgr_risk_controls c WHERE c.risk_id = r.id ORDER BY c.created_at, c.id) x), '[]'::json) AS controles,
         COALESCE((SELECT json_agg(x) FROM (SELECT ${COLS_MED} FROM pgr_risk_measurements m WHERE m.risk_id = r.id ORDER BY m.created_at, m.id) x), '[]'::json) AS medicoes
    FROM pgr_risks r`;

// Cada método recebe o `client` já no contexto do usuário (req.withTenantContext, uma transação). Tenant da URL é
// sempre conferido contra o do registro (IDOR ⇒ 404 uniforme). Auditoria na MESMA transação (fail-closed); o
// `detail` leva só ids e NOMES de campos, nunca texto livre.
@Injectable()
export class RiscosService {
  private async exigirEmpresa(c: PoolClient, tenantId: string) {
    // Só cliente da carteira Montese, para TODOS os papéis (inclusive admin): parceiro fora do escopo ⇒ 404.
    const r = await c.query('SELECT t.id FROM tenants t WHERE t.id = $1 AND is_montese_tenant(t.id)', [tenantId]);
    if (!r.rows.length) throw new NotFoundException('Empresa não encontrada');
  }

  private async travarGhe(c: PoolClient, tenantId: string, id: string) {
    const r = await c.query('SELECT id FROM pgr_ghes WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [id, tenantId]);
    if (!r.rows.length) throw new NotFoundException('GHE não encontrado');
  }

  private async travarRisco(c: PoolClient, tenantId: string, id: string) {
    const r = await c.query('SELECT * FROM pgr_risks WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [id, tenantId]);
    if (!r.rows.length) throw new NotFoundException('Risco não encontrado');
    return r.rows[0];
  }

  // Filho (controle/medição): descobre o risco pai SEM travar, trava o pai e só então o filho (ordem única ⇒ sem deadlock).
  private async travarFilho(c: PoolClient, tenantId: string, tabela: 'pgr_risk_controls' | 'pgr_risk_measurements', id: string) {
    const pai = await c.query(`SELECT risk_id FROM ${tabela} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!pai.rows.length) throw new NotFoundException('Registro não encontrado');
    const risco = await this.travarRisco(c, tenantId, pai.rows[0].risk_id);
    const r = await c.query(`SELECT * FROM ${tabela} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
    if (!r.rows.length) throw new NotFoundException('Registro não encontrado');
    return { risco, filho: r.rows[0] };
  }

  private async auditar(c: PoolClient, ator: Ator, ctx: AuditCtx, action: string, tipo: string, resourceId: string, detail: string) {
    await c.query(
      `INSERT INTO audit_log (actor_user_id, actor_role, action, resource_type, resource_id, method, path, status_code, ip_address, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 200, $8, $9)`,
      [ator.id, ctx.role, action, tipo, resourceId, ctx.method, ctx.path, ctx.ip ?? null, detail],
    );
  }

  // Erros do banco ⇒ resposta HTTP: incoerência de tenant do trigger (23514) vira 400; o resto segue o mapeamento comum.
  private erroBanco(e: unknown): never {
    const err = e as { code?: string; message?: string };
    if (err?.code === '23505' && /pgr_risks_ghe_hazard_uidx/.test((err as any).constraint ?? '')) {
      throw new ConflictException('Este perigo já está no GHE');
    }
    if (err?.code === '23514' && /tenant incoerente/.test(err.message ?? '')) {
      throw new BadRequestException('Referência não pertence a esta empresa');
    }
    // Trigger pgr_risks_keep_assessments (0099): o histórico de avaliações da matriz é append-only.
    if (err?.code === '23514' && /avaliações registradas/.test(err.message ?? '')) {
      throw new ConflictException('Este risco possui avaliações registradas na matriz e não pode ser excluído; o histórico é mantido.');
    }
    return mapPgError(e);
  }

  private campos(dto: object, permitidos: readonly string[], naoNulos: string[]): string[] {
    const campos = permitidos.filter((k) => (dto as any)[k] !== undefined);
    if (!campos.length) throw new BadRequestException('Informe ao menos um campo para alterar');
    for (const k of campos) {
      if ((dto as any)[k] === null && naoNulos.includes(k)) throw new BadRequestException(`${k} não pode ser nulo`);
    }
    return campos;
  }

  private valor(k: string, v: unknown) {
    return k === 'psychosocial' && v !== null ? JSON.stringify(v) : v;
  }

  private async projetarRiscos(c: PoolClient, tenantId: string, ids: string[]) {
    if (!ids.length) return [];
    return (await c.query(`${SQL_RISCO} WHERE r.tenant_id = $1 AND r.id = ANY($2::uuid[]) ORDER BY r.created_at, lower(r.name), r.id`, [tenantId, ids])).rows;
  }

  private async projetarRisco(c: PoolClient, tenantId: string, id: string) {
    const r = await this.projetarRiscos(c, tenantId, [id]);
    if (!r.length) throw new NotFoundException('Risco não encontrado');
    return r[0];
  }

  async listar(c: PoolClient, tenantId: string, gheId: string) {
    await this.exigirEmpresa(c, tenantId);
    const g = await c.query('SELECT id FROM pgr_ghes WHERE id = $1 AND tenant_id = $2', [gheId, tenantId]);
    if (!g.rows.length) throw new NotFoundException('GHE não encontrado');
    return (await c.query(`${SQL_RISCO} WHERE r.tenant_id = $1 AND r.ghe_id = $2 ORDER BY r.created_at, lower(r.name), r.id LIMIT 500`, [tenantId, gheId])).rows;
  }

  // Cópia de VALORES: o risco não guarda dependência viva do perigo (hazard_id é só rastro).
  async criarDePerigos(c: PoolClient, ator: Ator, tenantId: string, gheId: string, dto: CriarRiscosDto, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    await this.travarGhe(c, tenantId, gheId);
    const ids = [...new Set(dto.hazard_ids)];
    // Primeiro o que já está no GHE (ignorado, mesmo que o perigo tenha sido inativado depois); só o restante passa
    // pela checagem de perigo ATIVO e visível a este tenant (inativo/outro tenant/inexistente ⇒ 400 sem gravar nada).
    const ja = await c.query('SELECT hazard_id FROM pgr_risks WHERE ghe_id = $1 AND hazard_id = ANY($2::uuid[])', [gheId, ids]);
    const presentes = new Set<string>(ja.rows.map((r: any) => r.hazard_id));
    const novos = ids.filter((id) => !presentes.has(id));
    const ignorados = ids.filter((id) => presentes.has(id));
    const FILTRO = `h.id = ANY($1::uuid[]) AND h.active = true AND (h.scope = 'global' OR h.tenant_id = $2)`;
    if (novos.length) {
      const visiveis = await c.query(`SELECT h.id FROM pgr_hazards h WHERE ${FILTRO}`, [novos, tenantId]);
      if (visiveis.rows.length !== novos.length) throw new BadRequestException('Há perigos inexistentes, inativos ou indisponíveis para esta empresa');
    }
    let criados: string[] = [];
    if (novos.length) {
      try {
        const r = await c.query(
          `INSERT INTO pgr_risks (tenant_id, ghe_id, hazard_id, category, name, description, sources, health_effects, exposure_routes,
                                  tolerance_limit, tolerance_reference, psychosocial, esocial_code, assessment_type, exposure_type, status)
           SELECT $3, $4, h.id, h.category, h.name, h.description, h.sources, h.health_effects, h.exposure_routes,
                  h.tolerance_limit, h.tolerance_reference, h.psychosocial, h.esocial_code, h.default_assessment, $5, 'rascunho'
             FROM pgr_hazards h WHERE ${FILTRO} ORDER BY lower(h.name), h.id
           RETURNING id`,
          [novos, tenantId, tenantId, gheId, dto.exposure_type ?? null],
        );
        criados = r.rows.map((x: any) => x.id);
      } catch (e) { return this.erroBanco(e); }
      if (criados.length !== novos.length) throw new BadRequestException('Há perigos inexistentes, inativos ou indisponíveis para esta empresa');
    }
    await this.auditar(c, ator, ctx, 'pgr.risk.created', 'pgr_ghe', gheId,
      `ghe: ${gheId}; empresa: ${tenantId}; riscos: ${criados.join(', ') || 'nenhum'}; ignorados: ${ignorados.join(', ') || 'nenhum'}`);
    return { riscos: await this.projetarRiscos(c, tenantId, criados), ignorados };
  }

  async atualizar(c: PoolClient, ator: Ator, tenantId: string, id: string, dto: AtualizarRiscoDto, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    const campos = this.campos(dto, RISCO_PERMITIDOS, RISCO_NAO_NULOS);
    const atual = await this.travarRisco(c, tenantId, id);
    if (campos.includes('assessment_type') && dto.assessment_type !== 'quantitativa' && atual.assessment_type === 'quantitativa') {
      const n = (await c.query('SELECT count(*)::int AS n FROM pgr_risk_measurements WHERE risk_id = $1', [id])).rows[0].n;
      if (n > 0) throw new ConflictException('O risco possui medições; remova-as antes de deixar de ser quantitativo');
    }
    const final = { ...atual, ...Object.fromEntries(campos.map((k) => [k, (dto as any)[k]])) };
    if (final.status === 'completo' && (!final.exposure_type || !final.assessment_type)) {
      throw new BadRequestException('Para marcar o risco como completo, informe o tipo de exposição e o tipo de avaliação');
    }
    const vals: unknown[] = campos.map((k) => this.valor(k, (dto as any)[k]));
    const sets = campos.map((k, i) => `${k} = $${i + 1}${k === 'psychosocial' ? '::jsonb' : ''}`);
    vals.push(id, tenantId);
    try {
      await c.query(`UPDATE pgr_risks SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length}`, vals);
    } catch (e) { return this.erroBanco(e); }
    await this.auditar(c, ator, ctx, 'pgr.risk.updated', 'pgr_risk', id, `risco: ${id}; ghe: ${atual.ghe_id}; empresa: ${tenantId}; campos: ${campos.join(', ')}`);
    return this.projetarRisco(c, tenantId, id);
  }

  async excluir(c: PoolClient, ator: Ator, tenantId: string, id: string, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    const atual = await this.travarRisco(c, tenantId, id);
    try {
      await c.query('DELETE FROM pgr_risks WHERE id = $1 AND tenant_id = $2', [id, tenantId]); // controles/medições: ON DELETE CASCADE
    } catch (e) { return this.erroBanco(e); }
    await this.auditar(c, ator, ctx, 'pgr.risk.deleted', 'pgr_risk', id, `risco: ${id}; ghe: ${atual.ghe_id}; empresa: ${tenantId}`);
    return { id };
  }

  // ---- controles ----
  private async validarControle(c: PoolClient, kind: string, epi: string | null | undefined, treino: string | null | undefined) {
    if (epi && kind !== 'epi') throw new BadRequestException('epi_catalog_item_id só vale para controle do tipo epi');
    if (treino && kind !== 'treinamento') throw new BadRequestException('training_tipo só vale para controle do tipo treinamento');
    if (epi) {
      const r = await c.query('SELECT id FROM epi_catalog_items WHERE id = $1', [epi]);
      if (!r.rows.length) throw new BadRequestException('EPI não encontrado no catálogo');
    }
  }

  async criarControle(c: PoolClient, ator: Ator, tenantId: string, riscoId: string, dto: CriarControleDto, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    await this.travarRisco(c, tenantId, riscoId);
    await this.validarControle(c, dto.kind, dto.epi_catalog_item_id, dto.training_tipo);
    const cols = ['tenant_id', 'risk_id'];
    const vals: unknown[] = [tenantId, riscoId];
    for (const k of CONTROLE_PERMITIDOS) {
      if ((dto as any)[k] === undefined || (dto as any)[k] === null) continue;
      cols.push(k);
      vals.push((dto as any)[k]);
    }
    let id: string;
    try {
      id = (await c.query(`INSERT INTO pgr_risk_controls (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals)).rows[0].id;
    } catch (e) { return this.erroBanco(e); }
    await this.auditar(c, ator, ctx, 'pgr.control.created', 'pgr_risk_control', id,
      `controle: ${id}; risco: ${riscoId}; empresa: ${tenantId}; campos: ${cols.slice(2).join(', ')}`);
    return (await c.query('SELECT * FROM pgr_risk_controls WHERE id = $1 AND tenant_id = $2', [id, tenantId])).rows[0];
  }

  async atualizarControle(c: PoolClient, ator: Ator, tenantId: string, id: string, dto: AtualizarControleDto, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    const campos = this.campos(dto, CONTROLE_PERMITIDOS, CONTROLE_NAO_NULOS);
    const { filho } = await this.travarFilho(c, tenantId, 'pgr_risk_controls', id);
    const f = { ...filho, ...Object.fromEntries(campos.map((k) => [k, (dto as any)[k]])) };
    await this.validarControle(c, f.kind, f.epi_catalog_item_id, f.training_tipo);
    const vals: unknown[] = campos.map((k) => (dto as any)[k]);
    const sets = campos.map((k, i) => `${k} = $${i + 1}`);
    vals.push(id, tenantId);
    try {
      await c.query(`UPDATE pgr_risk_controls SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length}`, vals);
    } catch (e) { return this.erroBanco(e); }
    await this.auditar(c, ator, ctx, 'pgr.control.updated', 'pgr_risk_control', id,
      `controle: ${id}; risco: ${filho.risk_id}; empresa: ${tenantId}; campos: ${campos.join(', ')}`);
    return (await c.query('SELECT * FROM pgr_risk_controls WHERE id = $1 AND tenant_id = $2', [id, tenantId])).rows[0];
  }

  async excluirControle(c: PoolClient, ator: Ator, tenantId: string, id: string, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    const { filho } = await this.travarFilho(c, tenantId, 'pgr_risk_controls', id);
    await c.query('DELETE FROM pgr_risk_controls WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    await this.auditar(c, ator, ctx, 'pgr.control.deleted', 'pgr_risk_control', id, `controle: ${id}; risco: ${filho.risk_id}; empresa: ${tenantId}`);
    return { id };
  }

  // ---- medições ----
  private exigirQuantitativo(risco: { assessment_type: string | null }) {
    if (risco.assessment_type !== 'quantitativa') throw new BadRequestException('Medição só é permitida em risco com avaliação quantitativa');
  }

  // Registro profissional: precisa estar CONFIRMADO e ser acessível ao chamador. A RLS já limita o sócio às próprias
  // linhas; a checagem explícita (user_id = chamador, salvo admin) não depende só dela.
  private async validarRegistro(c: PoolClient, ator: Ator, registroId: string | null | undefined) {
    if (!registroId) return;
    const r = await c.query(
      `SELECT id FROM professional_registrations WHERE id = $1 AND status = 'confirmado' AND ($3 = 'admin' OR user_id = $2)`,
      [registroId, ator.id, ator.role],
    );
    if (!r.rows.length) throw new BadRequestException('Registro profissional inválido, não confirmado ou indisponível');
  }

  async criarMedicao(c: PoolClient, ator: Ator, tenantId: string, riscoId: string, dto: CriarMedicaoDto, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    const risco = await this.travarRisco(c, tenantId, riscoId);
    this.exigirQuantitativo(risco);
    await this.validarRegistro(c, ator, dto.professional_registration_id);
    const cols = ['tenant_id', 'risk_id'];
    const vals: unknown[] = [tenantId, riscoId];
    for (const k of MEDICAO_PERMITIDOS) {
      if ((dto as any)[k] === undefined || (dto as any)[k] === null) continue;
      cols.push(k);
      vals.push((dto as any)[k]);
    }
    let id: string;
    try {
      id = (await c.query(`INSERT INTO pgr_risk_measurements (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals)).rows[0].id;
    } catch (e) { return this.erroBanco(e); }
    await this.auditar(c, ator, ctx, 'pgr.measurement.created', 'pgr_risk_measurement', id,
      `medicao: ${id}; risco: ${riscoId}; empresa: ${tenantId}; campos: ${cols.slice(2).join(', ')}`);
    return (await c.query(`SELECT ${COLS_MED} FROM pgr_risk_measurements WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows[0];
  }

  async atualizarMedicao(c: PoolClient, ator: Ator, tenantId: string, id: string, dto: AtualizarMedicaoDto, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    const campos = this.campos(dto, MEDICAO_PERMITIDOS, MEDICAO_NAO_NULOS);
    const { risco, filho } = await this.travarFilho(c, tenantId, 'pgr_risk_measurements', id);
    this.exigirQuantitativo(risco);
    if (campos.includes('professional_registration_id') && dto.professional_registration_id !== filho.professional_registration_id) {
      await this.validarRegistro(c, ator, dto.professional_registration_id);
    }
    const vals: unknown[] = campos.map((k) => (dto as any)[k]);
    const sets = campos.map((k, i) => `${k} = $${i + 1}`);
    vals.push(id, tenantId);
    try {
      await c.query(`UPDATE pgr_risk_measurements SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length}`, vals);
    } catch (e) { return this.erroBanco(e); }
    await this.auditar(c, ator, ctx, 'pgr.measurement.updated', 'pgr_risk_measurement', id,
      `medicao: ${id}; risco: ${filho.risk_id}; empresa: ${tenantId}; campos: ${campos.join(', ')}`);
    return (await c.query(`SELECT ${COLS_MED} FROM pgr_risk_measurements WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows[0];
  }

  async excluirMedicao(c: PoolClient, ator: Ator, tenantId: string, id: string, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    const { filho } = await this.travarFilho(c, tenantId, 'pgr_risk_measurements', id);
    await c.query('DELETE FROM pgr_risk_measurements WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    await this.auditar(c, ator, ctx, 'pgr.measurement.deleted', 'pgr_risk_measurement', id, `medicao: ${id}; risco: ${filho.risk_id}; empresa: ${tenantId}`);
    return { id };
  }

  // Copia riscos e controles (NÃO medições: são evidência do GHE de origem) entre GHEs do MESMO tenant.
  // Riscos cujo perigo já está no GHE de destino são ignorados. Cópias nascem como rascunho.
  async copiar(c: PoolClient, ator: Ator, tenantId: string, gheId: string, dto: CopiarRiscosDto, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    if (dto.from_ghe_id === gheId) throw new BadRequestException('GHE de origem e destino devem ser diferentes');
    // Trava os dois GHEs em ordem de id (sem deadlock); qualquer um fora do tenant da URL ⇒ 404 uniforme.
    const g = await c.query(
      'SELECT id FROM pgr_ghes WHERE id = ANY($1::uuid[]) AND tenant_id = $2 ORDER BY id FOR UPDATE',
      [[gheId, dto.from_ghe_id], tenantId],
    );
    if (g.rows.length !== 2) throw new NotFoundException('GHE não encontrado');
    // FOR SHARE: os riscos de origem não mudam nem somem (PATCH/DELETE travam o risco FOR UPDATE) até o fim da transação.
    const origem = await c.query(
      'SELECT id, hazard_id FROM pgr_risks WHERE ghe_id = $1 AND tenant_id = $2 ORDER BY created_at, id LIMIT $3 FOR SHARE',
      [dto.from_ghe_id, tenantId, MAX_RISCOS_COPIA + 1],
    );
    if (origem.rows.length > MAX_RISCOS_COPIA) throw new ConflictException(`O GHE de origem tem mais de ${MAX_RISCOS_COPIA} riscos; copie em partes`);
    const ja = await c.query('SELECT hazard_id FROM pgr_risks WHERE ghe_id = $1 AND hazard_id IS NOT NULL', [gheId]);
    const presentes = new Set<string>(ja.rows.map((r: any) => r.hazard_id));
    const ignorados: string[] = [];
    const criados: string[] = [];
    try {
      for (const o of origem.rows) {
        if (o.hazard_id && presentes.has(o.hazard_id)) { ignorados.push(o.hazard_id); continue; }
        const n = await c.query(
          `INSERT INTO pgr_risks (tenant_id, ghe_id, hazard_id, category, name, description, sources, health_effects, exposure_routes,
                                  tolerance_limit, tolerance_reference, psychosocial, activity, exposure_type, esocial_code, assessment_type, assessment_notes, status)
           SELECT tenant_id, $2, hazard_id, category, name, description, sources, health_effects, exposure_routes,
                  tolerance_limit, tolerance_reference, psychosocial, activity, exposure_type, esocial_code, assessment_type, assessment_notes, 'rascunho'
             FROM pgr_risks WHERE id = $1 AND tenant_id = $3 RETURNING id`,
          [o.id, gheId, tenantId],
        );
        if (!n.rows.length) throw new ConflictException('Um risco de origem foi removido durante a cópia; tente novamente');
        const novo = n.rows[0].id as string;
        criados.push(novo);
        await c.query(
          `INSERT INTO pgr_risk_controls (tenant_id, risk_id, kind, description, status, effectiveness, epi_catalog_item_id, training_tipo)
           SELECT tenant_id, $2, kind, description, status, effectiveness, epi_catalog_item_id, training_tipo
             FROM pgr_risk_controls WHERE risk_id = $1 AND tenant_id = $3`,
          [o.id, novo, tenantId],
        );
      }
    } catch (e) { return this.erroBanco(e); }
    await this.auditar(c, ator, ctx, 'pgr.risk.copied', 'pgr_ghe', gheId,
      `ghe: ${gheId}; origem: ${dto.from_ghe_id}; empresa: ${tenantId}; riscos: ${criados.join(', ') || 'nenhum'}; ignorados: ${ignorados.join(', ') || 'nenhum'}`);
    return { riscos: await this.projetarRiscos(c, tenantId, criados), ignorados };
  }
}
