import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { mapPgError } from '../../common/pg-error.util';
import type { AplicarChecklistDto, CreateModeloDto, DefinirItensDto, ResponderItemDto, TipoItem } from './checklists.dto';
import { validarResposta } from './resposta';

// Violações das guardas do banco (RAISE EXCEPTION, SQLSTATE P0001) viram 409 com texto fixo (nunca a mensagem crua).
function traduzir(err: unknown): never {
  if ((err as { code?: string })?.code === 'P0001') throw new ConflictException('Operação não permitida para este modelo, checklist ou documento.');
  return mapPgError(err);
}

const COLUNAS_ITEM = 'i.id, i.position, i.label, i.instruction, i.kind, i.required, i.blocks_review';

@Injectable()
export class ChecklistsService {
  // ---- modelos ---------------------------------------------------------------------------

  async listarModelos(c: PoolClient) {
    const r = await c.query(
      `/* checklists:modelos */
       SELECT t.id, t.service, t.name, t.created_at,
              (SELECT v.id FROM checklist_template_versions v WHERE v.template_id = t.id AND v.status = 'aprovado') AS versao_aprovada_id,
              (SELECT v.version_number FROM checklist_template_versions v WHERE v.template_id = t.id AND v.status = 'aprovado') AS versao_aprovada,
              (SELECT v.id FROM checklist_template_versions v WHERE v.template_id = t.id AND v.status = 'rascunho') AS rascunho_id,
              (SELECT max(v.version_number) FROM checklist_template_versions v WHERE v.template_id = t.id) AS ultima_versao
         FROM checklist_templates t
        ORDER BY t.service, t.name, t.id
        LIMIT 500`,
    );
    return r.rows;
  }

  async obterVersao(c: PoolClient, versionId: string) {
    const v = await c.query(
      `SELECT v.id, v.template_id, t.service, t.name, v.version_number, v.status, v.change_note, v.created_at, v.approved_at,
              cb.full_name AS created_by_name, ab.full_name AS approved_by_name
         FROM checklist_template_versions v
         JOIN checklist_templates t ON t.id = v.template_id
         LEFT JOIN list_socios() cb ON cb.id = v.created_by
         LEFT JOIN list_socios() ab ON ab.id = v.approved_by
        WHERE v.id = $1`,
      [versionId],
    );
    if (v.rowCount === 0 || !v.rows[0]) throw new NotFoundException('Modelo não encontrado');
    const itens = await c.query(`SELECT ${COLUNAS_ITEM} FROM checklist_template_items i WHERE i.version_id = $1 ORDER BY i.position`, [versionId]);
    return { ...v.rows[0], itens: itens.rows };
  }

  async criarModelo(c: PoolClient, userId: string, dto: CreateModeloDto) {
    try {
      const t = await c.query<{ id: string }>(
        'INSERT INTO checklist_templates (service, name, created_by) VALUES ($1,$2,$3) RETURNING id',
        [dto.service, dto.name.trim(), userId],
      );
      const v = await c.query<{ id: string }>(
        'INSERT INTO checklist_template_versions (template_id, version_number, created_by) VALUES ($1, 1, $2) RETURNING id',
        [t.rows[0].id, userId],
      );
      return this.obterVersao(c, v.rows[0].id);
    } catch (err) {
      return traduzir(err);
    }
  }

  // Nova versão em rascunho, copiando os itens da mais recente. Um único rascunho por modelo.
  async novaVersao(c: PoolClient, userId: string, templateId: string, note?: string) {
    // Serializa criações concorrentes de versão do mesmo modelo (a tabela de modelos não tem UPDATE para o sócio).
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`checklist_template:${templateId}`]);
    const t = await c.query('SELECT id FROM checklist_templates WHERE id = $1', [templateId]);
    if (t.rowCount === 0 || !t.rows[0]) throw new NotFoundException('Modelo não encontrado');
    const ult = await c.query<{ id: string; version_number: number; status: string }>(
      'SELECT id, version_number, status FROM checklist_template_versions WHERE template_id = $1 ORDER BY version_number DESC LIMIT 1',
      [templateId],
    );
    const base = ult.rows[0];
    if (base?.status === 'rascunho') throw new ConflictException('Já existe uma versão em rascunho deste modelo.');
    try {
      const v = await c.query<{ id: string }>(
        'INSERT INTO checklist_template_versions (template_id, version_number, created_by, change_note) VALUES ($1,$2,$3,$4) RETURNING id',
        [templateId, (base?.version_number ?? 0) + 1, userId, note?.trim() || null],
      );
      if (base) {
        await c.query(
          `INSERT INTO checklist_template_items (version_id, position, label, instruction, kind, required, blocks_review)
           SELECT $1, position, label, instruction, kind, required, blocks_review FROM checklist_template_items WHERE version_id = $2`,
          [v.rows[0].id, base.id],
        );
      }
      return this.obterVersao(c, v.rows[0].id);
    } catch (err) {
      return traduzir(err);
    }
  }

  async travarRascunho(c: PoolClient, versionId: string) {
    const r = await c.query<{ status: string }>('SELECT status FROM checklist_template_versions WHERE id = $1 FOR UPDATE', [versionId]);
    if (r.rowCount === 0 || !r.rows[0]) throw new NotFoundException('Modelo não encontrado');
    if (r.rows[0].status !== 'rascunho') throw new ConflictException('Só é possível alterar uma versão em rascunho.');
  }

  async definirItens(c: PoolClient, versionId: string, dto: DefinirItensDto) {
    await this.travarRascunho(c, versionId);
    for (const [idx, it] of dto.items.entries()) {
      if (it.blocks_review && !it.required) throw new BadRequestException(`Item ${idx + 1}: só um item obrigatório pode bloquear o envio para revisão.`);
    }
    try {
      await c.query('DELETE FROM checklist_template_items WHERE version_id = $1', [versionId]);
      for (const [idx, it] of dto.items.entries()) {
        await c.query(
          `INSERT INTO checklist_template_items (version_id, position, label, instruction, kind, required, blocks_review)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [versionId, idx + 1, it.label.trim(), it.instruction?.trim() || null, it.kind, it.required, it.blocks_review],
        );
      }
      if (dto.change_note !== undefined) {
        await c.query('UPDATE checklist_template_versions SET change_note = $2 WHERE id = $1', [versionId, dto.change_note.trim() || null]);
      }
    } catch (err) {
      traduzir(err);
    }
    return this.obterVersao(c, versionId);
  }

  async aprovar(c: PoolClient, userId: string, versionId: string) {
    const v = await c.query<{ template_id: string; status: string }>(
      'SELECT template_id, status FROM checklist_template_versions WHERE id = $1 FOR UPDATE', [versionId],
    );
    if (v.rowCount === 0 || !v.rows[0]) throw new NotFoundException('Modelo não encontrado');
    if (v.rows[0].status !== 'rascunho') throw new ConflictException('Só é possível aprovar uma versão em rascunho.');
    const n = await c.query('SELECT 1 FROM checklist_template_items WHERE version_id = $1 LIMIT 1', [versionId]);
    if (n.rowCount === 0 || n.rows.length === 0) throw new ConflictException('Não é possível aprovar um modelo sem itens.');
    try {
      await c.query(
        "UPDATE checklist_template_versions SET status = 'substituido' WHERE template_id = $1 AND status = 'aprovado'",
        [v.rows[0].template_id],
      );
      await c.query(
        "UPDATE checklist_template_versions SET status = 'aprovado', approved_by = $2, approved_at = clock_timestamp() WHERE id = $1",
        [versionId, userId],
      );
    } catch (err) {
      traduzir(err);
    }
    return this.obterVersao(c, versionId);
  }

  async excluirRascunho(c: PoolClient, versionId: string) {
    await this.travarRascunho(c, versionId);
    try {
      await c.query('DELETE FROM checklist_template_versions WHERE id = $1', [versionId]);
    } catch (err) {
      traduzir(err);
    }
  }

  // ---- checklists do documento -----------------------------------------------------------

  private async rascunho(c: PoolClient, draftId: string) {
    const r = await c.query<{ id: string; tenant_id: string; status: string }>('SELECT id, tenant_id, status FROM document_drafts WHERE id = $1', [draftId]);
    if (r.rowCount === 0 || !r.rows[0]) throw new NotFoundException('Documento não encontrado');
    return r.rows[0];
  }

  async listarDoDocumento(c: PoolClient, draftId: string) {
    await this.rascunho(c, draftId);
    const cls = await c.query(
      `/* checklists:instancias */
       SELECT dc.id, dc.template_version_id, dc.company_unit_id, dc.created_at, t.service, t.name, v.version_number, v.status AS versao_status
         FROM document_checklists dc
         JOIN checklist_template_versions v ON v.id = dc.template_version_id
         JOIN checklist_templates t ON t.id = v.template_id
        WHERE dc.draft_id = $1
        ORDER BY dc.created_at, dc.id`,
      [draftId],
    );
    const out: Array<Record<string, unknown>> = [];
    for (const cl of cls.rows) {
      const itens = await c.query(
        `/* checklists:itens-respostas */
         SELECT ${COLUNAS_ITEM}, a.value AS resposta, a.note AS resposta_nota, a.answered_at, ab.full_name AS respondido_por
           FROM checklist_template_items i
           LEFT JOIN document_checklist_answers a ON a.item_id = i.id AND a.checklist_id = $1
           LEFT JOIN list_socios() ab ON ab.id = a.answered_by
          WHERE i.version_id = $2
          ORDER BY i.position`,
        [cl.id, cl.template_version_id],
      );
      const faltando = itens.rows.filter((i) => i.required && i.resposta == null);
      out.push({
        ...cl, itens: itens.rows,
        completude: {
          total: itens.rows.length,
          respondidos: itens.rows.filter((i) => i.resposta != null).length,
          obrigatorios_pendentes: faltando.length,
          bloqueiam_revisao: faltando.filter((i) => i.blocks_review).length,
        },
      });
    }
    return out;
  }

  async aplicar(c: PoolClient, userId: string, draftId: string, dto: AplicarChecklistDto) {
    const d = await this.rascunho(c, draftId);
    if (d.status === 'publicado' || d.status === 'cancelado') throw new ConflictException('Documento publicado ou cancelado não aceita checklist.');
    const v = await c.query<{ status: string }>('SELECT status FROM checklist_template_versions WHERE id = $1', [dto.template_version_id]);
    if (v.rowCount === 0 || !v.rows[0]) throw new NotFoundException('Modelo não encontrado');
    if (v.rows[0].status !== 'aprovado') throw new ConflictException('Só é possível usar um modelo aprovado e vigente.');
    try {
      await c.query(
        'INSERT INTO document_checklists (draft_id, tenant_id, template_version_id, company_unit_id, created_by) VALUES ($1,$2,$3,$4,$5)',
        [draftId, d.tenant_id, dto.template_version_id, dto.company_unit_id ?? null, userId],
      );
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') throw new ConflictException('Este modelo já foi aplicado ao documento.');
      traduzir(err);
    }
    return this.listarDoDocumento(c, draftId);
  }

  async responder(c: PoolClient, userId: string, draftId: string, checklistId: string, itemId: string, dto: ResponderItemDto) {
    const d = await this.rascunho(c, draftId);
    if (d.status === 'publicado' || d.status === 'cancelado') throw new ConflictException('Documento publicado ou cancelado não aceita alteração.');
    const it = await c.query<{ kind: TipoItem }>(
      `SELECT i.kind FROM document_checklists dc JOIN checklist_template_items i ON i.version_id = dc.template_version_id
        WHERE dc.id = $1 AND dc.draft_id = $2 AND i.id = $3`,
      [checklistId, draftId, itemId],
    );
    if (it.rowCount === 0 || !it.rows[0]) throw new NotFoundException('Item não encontrado neste checklist');
    const valor = dto.value.trim();
    const erro = validarResposta(it.rows[0].kind, valor);
    if (erro) throw new BadRequestException(erro);
    try {
      await c.query(
        `INSERT INTO document_checklist_answers (checklist_id, tenant_id, item_id, value, note, answered_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (checklist_id, item_id) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note, answered_by = EXCLUDED.answered_by`,
        [checklistId, d.tenant_id, itemId, valor, dto.note?.trim() || null, userId],
      );
    } catch (err) {
      traduzir(err);
    }
    return this.listarDoDocumento(c, draftId);
  }
}
