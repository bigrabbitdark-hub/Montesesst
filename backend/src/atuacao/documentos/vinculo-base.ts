import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { mapPgError } from '../../common/pg-error.util';

// Vínculo opcional LTCAT/LIP/laudo -> PGR-base da mesma empresa (migration 0105). Só informativo: gera avisos,
// nunca bloqueia nem herda datas; o conteúdo técnico continua sendo responsabilidade do profissional habilitado.
export const CATEGORIAS_COM_BASE = ['ltcat', 'lip', 'laudo'] as const;
export const CATEGORIAS_TECNICAS = ['pgr', 'ltcat', 'lip', 'laudo', 'pcmso'] as const;

export type AvisoBase = { codigo: 'base_mais_nova' | 'base_nao_publicada' | 'base_cancelada'; mensagem: string };
type RefBase = { status: string; versao_em: Date | string | null };
type RefDoc = { status: string; versao_em: Date | string | null };

const t = (d: Date | string | null) => (d ? new Date(d).getTime() : null);

export function avisosDaBase(base: RefBase | null, doc: RefDoc): AvisoBase[] {
  if (!base || doc.status === 'cancelado') return [];
  const out: AvisoBase[] = [];
  if (base.status === 'cancelado') {
    out.push({ codigo: 'base_cancelada', mensagem: 'O PGR-base deste documento foi cancelado. Informe outro PGR ou revise o vínculo.' });
    return out;
  }
  const b = t(base.versao_em);
  const d = t(doc.versao_em);
  if (b !== null && (d === null || b > d)) {
    out.push({ codigo: 'base_mais_nova', mensagem: 'O PGR-base tem uma versão mais recente que a última versão deste documento. Reveja o conteúdo.' });
  }
  if (base.status !== 'publicado') {
    out.push({ codigo: 'base_nao_publicada', mensagem: 'O PGR-base ainda não foi publicado.' });
  }
  return out;
}

// Violações das guardas do banco (P0001) viram 409 com texto fixo, nunca a mensagem crua.
export function traduzirBase(err: unknown): never {
  if ((err as { code?: string })?.code === 'P0001') {
    throw new ConflictException('PGR-base inválido: use um PGR da mesma empresa, não cancelado, e só com o documento em elaboração.');
  }
  return mapPgError(err);
}

export async function gravarBase(client: PoolClient, draftId: string, baseId: string | null) {
  try {
    await client.query('UPDATE document_drafts SET base_draft_id = $2 WHERE id = $1', [draftId, baseId]);
  } catch (err) {
    traduzirBase(err);
  }
}

export async function obterBaseEDerivados(client: PoolClient, draftId: string, baseId: string | null, doc: RefDoc) {
  let base: Record<string, unknown> | null = null;
  if (baseId) {
    const r = await client.query(
      `/* vinculo:base */
       SELECT b.id, b.title, b.category, b.status, cv.version_number AS versao, cv.created_at AS versao_em
         FROM document_drafts b LEFT JOIN document_draft_versions cv ON cv.id = b.current_version_id
        WHERE b.id = $1`,
      [baseId],
    );
    base = r.rows[0] ?? null;
  }
  const der = await client.query(
    `/* vinculo:derivados */
     SELECT d.id, d.category, d.title, d.status, cv.version_number AS versao
       FROM document_drafts d LEFT JOIN document_draft_versions cv ON cv.id = d.current_version_id
      WHERE d.base_draft_id = $1 AND d.status <> 'cancelado' ORDER BY d.category, d.created_at`,
    [draftId],
  );
  return {
    base,
    avisos_base: avisosDaBase(base as RefBase | null, doc),
    derivados: der.rows,
  };
}

// Visão por empresa: o rascunho mais recente (não cancelado) de cada tipo técnico, com etapa, correções pendentes
// e avisos do vínculo. Sob RLS: o sócio só enxerga empresas da carteira.
export async function listarTecnicosDaEmpresa(client: PoolClient, tenantId: string) {
  const r = await client.query(
    `/* vinculo:empresa */
     SELECT DISTINCT ON (d.category) d.id, d.category, d.title, d.status, d.base_draft_id, d.updated_at,
            cv.version_number AS versao, cv.created_at AS versao_em,
            b.status AS base_status, bv.created_at AS base_versao_em,
            (SELECT count(*)::int FROM document_corrections c WHERE c.draft_id = d.id AND c.status IN ('aberta','corrigida')) AS correcoes_pendentes
       FROM document_drafts d
       LEFT JOIN document_draft_versions cv ON cv.id = d.current_version_id
       LEFT JOIN document_drafts b ON b.id = d.base_draft_id
       LEFT JOIN document_draft_versions bv ON bv.id = b.current_version_id
      WHERE d.tenant_id = $1 AND d.category = ANY($2) AND d.status <> 'cancelado'
      ORDER BY d.category, d.updated_at DESC`,
    [tenantId, CATEGORIAS_TECNICAS as unknown as string[]],
  );
  return r.rows.map((x) => ({
    id: x.id, category: x.category, title: x.title, status: x.status, versao: x.versao, base_draft_id: x.base_draft_id,
    correcoes_pendentes: x.correcoes_pendentes, updated_at: x.updated_at,
    avisos_base: avisosDaBase(x.base_draft_id ? { status: x.base_status, versao_em: x.base_versao_em } : null, { status: x.status, versao_em: x.versao_em }),
  }));
}
