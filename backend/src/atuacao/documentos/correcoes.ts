import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { mapPgError } from '../../common/pg-error.util';
import type { CreateCorrecaoDto, UpdateCorrecaoDto } from './dto/documentos.dto';

// Correções estruturadas de documento (migration 0102). Funções com I/O, sem estado; as regras de coerência
// (transições, responsável sócio ativo, autoria dos carimbos) estão também no trigger do banco.
export const MSG_CORRECOES_PENDENTES =
  'Há correções em aberto ou aguardando verificação. Conclua e verifique todas antes de aprovar, assinar ou publicar.';

const COLUNAS = `c.id, c.draft_id, c.version_id, v.version_number, c.description, c.origin, c.requester_label,
  c.requested_by, rb.full_name AS requested_by_name, c.responsible_user_id, rp.full_name AS responsible_name,
  to_char(c.due_date, 'YYYY-MM-DD') AS due_date, c.status, c.corrected_by, c.corrected_at, c.verified_by, c.verified_at,
  c.resolution_note, c.created_at, c.updated_at`;

// Violações das guardas do banco (RAISE EXCEPTION, SQLSTATE P0001) viram 409 com texto fixo (nunca a mensagem crua).
function traduzir(err: unknown): never {
  if ((err as { code?: string })?.code === 'P0001') throw new ConflictException('Operação não permitida para esta correção ou documento.');
  return mapPgError(err);
}

async function exigirResponsavel(client: PoolClient, userId: string) {
  const r = await client.query('SELECT 1 FROM list_socios() s WHERE s.id = $1', [userId]);
  if (r.rowCount === 0 || r.rows.length === 0) throw new BadRequestException('O responsável precisa ser um sócio ativo.');
}

const TRANSICAO: Record<string, readonly string[]> = {
  aberta: ['corrigida', 'cancelada'],
  corrigida: ['verificada', 'aberta', 'cancelada'],
};
const DESTINO = { corrigir: 'corrigida', verificar: 'verificada', reabrir: 'aberta', cancelar: 'cancelada' } as const;

export async function listarCorrecoes(client: PoolClient, draftId: string) {
  const r = await client.query(
    `/* correcoes:lista */
     SELECT ${COLUNAS}
       FROM document_corrections c
       LEFT JOIN document_draft_versions v ON v.id = c.version_id
       LEFT JOIN list_socios() rb ON rb.id = c.requested_by
       LEFT JOIN list_socios() rp ON rp.id = c.responsible_user_id
      WHERE c.draft_id = $1
      ORDER BY c.created_at, c.id`,
    [draftId],
  );
  return r.rows;
}

export async function contarPendentes(client: PoolClient, draftId: string): Promise<number> {
  const r = await client.query<{ n: number }>(
    `/* correcoes:pendentes */
     SELECT count(*)::int AS n FROM document_corrections WHERE draft_id = $1 AND status IN ('aberta', 'corrigida')`,
    [draftId],
  );
  return r.rows[0]?.n ?? 0;
}

export async function exigirSemPendentes(client: PoolClient, draftId: string, criar: (msg: string) => Error) {
  if ((await contarPendentes(client, draftId)) > 0) throw criar(MSG_CORRECOES_PENDENTES);
}

export async function inserirCorrecao(
  client: PoolClient,
  d: { id: string; tenant_id: string; current_version_id: string | null },
  p: {
    descricao: string; origem: 'revisao' | 'cliente' | 'interna'; solicitante?: string | null; solicitadoPor: string;
    responsavel: string; prazo?: string | null;
  },
) {
  await exigirResponsavel(client, p.responsavel);
  try {
    const r = await client.query<{ id: string }>(
      `INSERT INTO document_corrections
         (draft_id, tenant_id, version_id, description, origin, requester_label, requested_by, responsible_user_id, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [d.id, d.tenant_id, d.current_version_id, p.descricao, p.origem, p.solicitante ?? null, p.solicitadoPor, p.responsavel, p.prazo ?? null],
    );
    return r.rows[0].id;
  } catch (err) {
    return traduzir(err);
  }
}

export async function registrarCorrecao(
  client: PoolClient, userId: string, d: { id: string; tenant_id: string; current_version_id: string | null }, dto: CreateCorrecaoDto,
) {
  const descricao = dto.description.trim();
  if (!descricao) throw new BadRequestException('Descreva o que precisa ser corrigido.');
  if (dto.origin === 'cliente' && !dto.requester_label?.trim()) throw new BadRequestException('Informe quem do cliente solicitou.');
  return inserirCorrecao(client, d, {
    descricao, origem: dto.origin, solicitante: dto.requester_label?.trim() || null, solicitadoPor: userId,
    responsavel: dto.responsavel_id ?? userId, prazo: dto.prazo ?? null,
  });
}

const PERMISSAO_DA_ACAO = {
  corrigir: 'documents.create_draft', ajustar: 'documents.create_draft', cancelar: 'documents.create_draft',
  verificar: 'documents.review', reabrir: 'documents.review',
} as const;

export async function atualizarCorrecao(
  client: PoolClient, userId: string, rbac: ReadonlySet<string>, draftId: string, correcaoId: string, dto: UpdateCorrecaoDto,
) {
  if (!rbac.has(PERMISSAO_DA_ACAO[dto.acao])) throw new ForbiddenException('Sem permissão para esta ação na correção.');
  const cur = await client.query<{ status: string }>(
    'SELECT status FROM document_corrections WHERE id = $1 AND draft_id = $2 FOR UPDATE',
    [correcaoId, draftId],
  );
  if (cur.rowCount === 0 || !cur.rows[0]) throw new NotFoundException('Correção não encontrada');
  const destino = dto.acao in DESTINO ? DESTINO[dto.acao as keyof typeof DESTINO] : null;
  const atual = cur.rows[0].status;
  if (destino ? !TRANSICAO[atual]?.includes(destino) : !TRANSICAO[atual]) {
    throw new ConflictException('Ação não permitida no estado atual da correção.');
  }
  if (dto.responsavel_id !== undefined) await exigirResponsavel(client, dto.responsavel_id);
  const nota = dto.nota?.trim() || null;
  if ((dto.acao === 'reabrir' || dto.acao === 'cancelar') && !nota) throw new BadRequestException('Informe a nota (motivo).');
  if (dto.acao === 'ajustar' && dto.responsavel_id === undefined && dto.prazo === undefined) {
    throw new BadRequestException('Informe o novo responsável ou o novo prazo.');
  }
  const sets: string[] = [];
  const params: unknown[] = [correcaoId];
  const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (dto.responsavel_id !== undefined) set('responsible_user_id', dto.responsavel_id);
  if (dto.prazo !== undefined) set('due_date', dto.prazo);
  if (dto.acao === 'corrigir') {
    set('status', 'corrigida'); set('corrected_by', userId); sets.push('corrected_at = clock_timestamp()');
    if (nota) set('resolution_note', nota);
  } else if (dto.acao === 'verificar') {
    set('status', 'verificada'); set('verified_by', userId); sets.push('verified_at = clock_timestamp()');
    if (nota) set('resolution_note', nota);
  } else if (dto.acao === 'reabrir') {
    set('status', 'aberta'); set('resolution_note', nota);
  } else if (dto.acao === 'cancelar') {
    set('status', 'cancelada'); set('resolution_note', nota);
  }
  try {
    await client.query(`UPDATE document_corrections SET ${sets.join(', ')} WHERE id = $1`, params);
  } catch (err) {
    traduzir(err);
  }
}
