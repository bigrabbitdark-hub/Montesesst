import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { mapPgError } from '../../../common/pg-error.util';
import type { AuditCtx } from '../../permissoes/permissoes-admin.service';
import type { Ator } from '../perigos.service';
import { calcular, celulas, MatrizConfig, MatrizForaDaEscalaError, MatrizSemFaixaError } from './matriz-config';
import { CriarAvaliacaoDto, KINDS_AVALIACAO, MapaCalorQueryDto } from './dto/matriz.dto';

// O sócio não recebe o id do usuário que avaliou (id interno); o admin continua vendo.
const semAutor = (ator: Ator, row: any) => {
  if (!row || ator.role === 'admin') return row;
  const { assessed_by: _omit, ...resto } = row;
  return resto;
};

const SEM_MATRIZ = 'Aguardando matriz publicada pela equipe técnica.';
const MATRIZ_MUDOU = 'A matriz vigente mudou; recarregue e classifique novamente na versão atual';

// Colunas das avaliações devolvidas (lista branca). `nivel` é o objeto do nível na config da versão EXATA usada.
const SQL_HISTORICO = `
  SELECT a.id, a.risk_id, a.kind, a.matrix_version_id, v.version_number AS matrix_version_number, a.severity_value, a.probability_value,
         a.score, a.level_id,
         (SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.config->'niveis') = 'array' THEN v.config->'niveis' ELSE '[]'::jsonb END) AS t(e)
           WHERE e->>'id' = a.level_id LIMIT 1) AS nivel,
         a.justification, a.assessed_by, a.assessed_at
    FROM pgr_risk_assessments a JOIN pgr_matrix_versions v ON v.id = a.matrix_version_id
   WHERE a.risk_id = $1 AND a.tenant_id = $2
   ORDER BY a.assessed_at DESC, a.id DESC LIMIT 500`;

// Avaliações de risco (inerente / residual previsto), append-only. O servidor calcula escore e nível a partir da versão EXATA
// da matriz; o cliente só informa severidade e probabilidade. Tenant da URL sempre conferido (404 uniforme).
@Injectable()
export class AvaliacoesService {
  private async exigirEmpresa(c: PoolClient, tenantId: string) {
    // Só cliente da carteira Montese, para TODOS os papéis (inclusive admin): parceiro fora do escopo ⇒ 404.
    const r = await c.query('SELECT t.id FROM tenants t WHERE t.id = $1 AND is_montese_tenant(t.id)', [tenantId]);
    if (!r.rows.length) throw new NotFoundException('Empresa não encontrada');
  }

  private exigirPapel(ator: Ator) {
    if (ator.role !== 'admin' && ator.role !== 'socio') throw new ForbiddenException('Operação não permitida para este perfil');
  }

  private async auditar(c: PoolClient, ator: Ator, ctx: AuditCtx, action: string, id: string, detail: string) {
    await c.query(
      `INSERT INTO audit_log (actor_user_id, actor_role, action, resource_type, resource_id, method, path, status_code, ip_address, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 200, $8, $9)`,
      [ator.id, ctx.role, action, 'pgr_risk_assessment', id, ctx.method, ctx.path, ctx.ip ?? null, detail],
    );
  }

  private erroBanco(e: unknown): never {
    const err = e as { code?: string; message?: string };
    if (err?.code === '23514' && /tenant incoerente/.test(err.message ?? '')) throw new BadRequestException('Referência não pertence a esta empresa');
    if (err?.code === '23514' && /status publicada/.test(err.message ?? '')) throw new BadRequestException('A versão da matriz informada não está publicada');
    return mapPgError(e);
  }

  // Versão informada (qualquer status visível) ou, se omitida, a vigente publicada (maior version_number).
  private async matriz(c: PoolClient, id: string | undefined, vigenteObrigatoria: boolean) {
    if (id) {
      const r = await c.query('SELECT id, version_number, status, config FROM pgr_matrix_versions WHERE id = $1', [id]);
      if (!r.rows.length) throw new BadRequestException('Versão da matriz inexistente');
      return r.rows[0];
    }
    const r = await c.query(
      `SELECT id, version_number, status, config FROM pgr_matrix_versions
        WHERE status = 'publicada' ORDER BY version_number DESC LIMIT 1`,
    );
    if (!r.rows.length) {
      if (vigenteObrigatoria) throw new ConflictException(SEM_MATRIZ);
    }
    return r.rows[0] ?? null;
  }

  async listar(c: PoolClient, ator: Ator, tenantId: string, riscoId: string) {
    await this.exigirEmpresa(c, tenantId);
    const risco = await c.query('SELECT id FROM pgr_risks WHERE id = $1 AND tenant_id = $2', [riscoId, tenantId]);
    if (!risco.rows.length) throw new NotFoundException('Risco não encontrado');
    const historico = (await c.query(SQL_HISTORICO, [riscoId, tenantId])).rows.map((h: any) => semAutor(ator, h));
    const vigente: Record<string, unknown> = {};
    for (const k of KINDS_AVALIACAO) vigente[k] = historico.find((h: any) => h.kind === k) ?? null;
    return { historico, vigente };
  }

  async criar(c: PoolClient, ator: Ator, tenantId: string, riscoId: string, dto: CriarAvaliacaoDto, ctx: AuditCtx) {
    this.exigirPapel(ator);
    await this.exigirEmpresa(c, tenantId);
    // Trava o risco: serializa avaliações concorrentes e impede a exclusão durante a gravação.
    const risco = await c.query('SELECT id, ghe_id FROM pgr_risks WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [riscoId, tenantId]);
    if (!risco.rows.length) throw new NotFoundException('Risco não encontrado');

    // SEM FOR SHARE na versão: verificado que o sócio não consegue travar a linha (SELECT ... FOR SHARE exige passar também a
    // policy de UPDATE, que o sócio não tem; a consulta devolve 0 linhas). A corrida com "arquivar" é coberta pelo trigger
    // pgr_risk_assessments_check_version (status publicada no INSERT ⇒ 23514 ⇒ 400 em erroBanco); arquivar ainda não
    // confirmado equivale a uma avaliação feita antes do arquivamento.
    const m = await this.matriz(c, dto.matrix_version_id, true);
    if (m.status !== 'publicada') {
      throw new BadRequestException(m.status === 'arquivada'
        ? 'A versão da matriz informada está arquivada; use a matriz vigente'
        : 'A versão da matriz informada ainda não foi publicada');
    }
    // Só a matriz vigente classifica: outra versão publicada (mais antiga) ⇒ 409, para o cliente recarregar a vigente.
    if (dto.matrix_version_id) {
      const v = await c.query(`SELECT id FROM pgr_matrix_versions WHERE status = 'publicada' ORDER BY version_number DESC LIMIT 1`);
      if (!v.rows.length || v.rows[0].id !== m.id) throw new ConflictException(MATRIZ_MUDOU);
    }
    let calc;
    try {
      calc = calcular(m.config as MatrizConfig, dto.severity_value, dto.probability_value);
    } catch (e) {
      if (e instanceof MatrizForaDaEscalaError) throw new BadRequestException(e.message);
      if (e instanceof MatrizSemFaixaError) throw new ConflictException('A matriz publicada está inconsistente; avise a equipe técnica');
      throw new ConflictException('A matriz publicada está inconsistente; avise a equipe técnica');
    }

    let id: string;
    try {
      // clock_timestamp(): a ordem das avaliações segue a ordem em que o lock do risco foi obtido (now() seria o início da transação).
      id = (await c.query(
        `INSERT INTO pgr_risk_assessments (tenant_id, risk_id, kind, matrix_version_id, severity_value, probability_value, score, level_id,
                                           justification, assessed_by, assessed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, clock_timestamp())
         RETURNING id`,
        [tenantId, riscoId, dto.kind, m.id, dto.severity_value, dto.probability_value, calc.score, calc.nivel_id, dto.justification, ator.id],
      )).rows[0].id;
    } catch (e) { return this.erroBanco(e); }
    await this.auditar(c, ator, ctx, 'pgr.assessment.created', id,
      `avaliacao: ${id}; risco: ${riscoId}; empresa: ${tenantId}; matriz: ${m.id}; tipo: ${dto.kind}`);

    const row = (await c.query(
      SQL_HISTORICO.replace('WHERE a.risk_id = $1 AND a.tenant_id = $2', 'WHERE a.risk_id = $1 AND a.tenant_id = $2 AND a.id = $3'), [riscoId, tenantId, id],
    )).rows[0];
    return semAutor(ator, row) ?? semAutor(ator, { id, risk_id: riscoId, kind: dto.kind, matrix_version_id: m.id, matrix_version_number: m.version_number, score: calc.score, level_id: calc.nivel_id, nivel: calc.nivel });
  }

  // Mapa de calor: usa a avaliação VIGENTE de cada risco (a mais recente do tipo). Conta na célula só quando essa avaliação é da
  // versão escolhida; as demais aparecem em `em_outra_versao` (precisam de reavaliação) e riscos sem avaliação em `sem_avaliacao`.
  async mapaCalor(c: PoolClient, tenantId: string, q: MapaCalorQueryDto) {
    await this.exigirEmpresa(c, tenantId);
    const m = await this.matriz(c, q.matrix_version_id, true);
    if (m.status === 'rascunho') throw new BadRequestException('A versão da matriz informada ainda não foi publicada');
    let grade;
    try { grade = celulas(m.config as MatrizConfig); } catch { throw new ConflictException('A matriz está inconsistente; avise a equipe técnica'); }

    const total = (await c.query('SELECT count(*)::int AS n FROM pgr_risks WHERE tenant_id = $1', [tenantId])).rows[0].n as number;
    // Uma única leitura: avaliação vigente (mais recente do tipo) de cada risco, agrupada por versão e célula.
    const ult = (await c.query(
      `WITH ult AS (
         SELECT DISTINCT ON (a.risk_id) a.risk_id, a.matrix_version_id, a.severity_value, a.probability_value
           FROM pgr_risk_assessments a WHERE a.tenant_id = $1 AND a.kind = $2
          ORDER BY a.risk_id, a.assessed_at DESC, a.id DESC)
       SELECT u.matrix_version_id, v.version_number, u.severity_value, u.probability_value, count(*)::int AS n
         FROM ult u JOIN pgr_matrix_versions v ON v.id = u.matrix_version_id
        GROUP BY u.matrix_version_id, v.version_number, u.severity_value, u.probability_value`,
      [tenantId, q.kind],
    )).rows as Array<{ matrix_version_id: string; version_number: number; severity_value: number; probability_value: number; n: number }>;

    const contagem = new Map<string, number>();
    const porVersao = new Map<number, number>();
    let avaliados = 0;
    let naVersao = 0;
    for (const u of ult) {
      avaliados += u.n;
      porVersao.set(u.version_number, (porVersao.get(u.version_number) ?? 0) + u.n);
      if (u.matrix_version_id !== m.id) continue;
      naVersao += u.n;
      contagem.set(`${u.severity_value}x${u.probability_value}`, u.n);
    }
    return {
      kind: q.kind,
      matrix_version: { id: m.id, version_number: m.version_number, status: m.status },
      cells: grade.map((g) => ({ ...g, quantidade: contagem.get(`${g.severidade}x${g.probabilidade}`) ?? 0 })),
      total_riscos: total,
      classificados: naVersao,
      em_outra_versao: avaliados - naVersao,
      sem_avaliacao: total - avaliados,
      por_versao: [...porVersao.entries()].sort((x, y) => x[0] - y[0]).map(([version_number, n]) => ({ version_number, n })),
    };
  }
}
