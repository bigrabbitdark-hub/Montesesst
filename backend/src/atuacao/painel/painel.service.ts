import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { todayDateOnly, type DateOnly } from '../../common/dates/date-only';
import { AtuacaoService } from '../atuacao.service';
import { TarefasService } from '../tarefas.service';
import { ESPERA } from '../tarefa-status';
import { AgendaService } from '../agenda.service';
import { EmpresasService } from '../empresas/empresas.service';
import type { FaixaVencimento, ListVencimentosQuery } from './dto/painel.dto';
import type { ListAgendaQuery } from '../dto/agenda.dto';

export type TipoPendencia = 'tarefa_atrasada' | 'tarefa_aguardando' | 'documento_vencido' | 'documento_vencendo' | 'documento_aguardando';

export interface Pendencia {
  tipo: TipoPendencia;
  tenant_id: string;
  empresa: string;
  descricao: string;
  prazo: string | null;
  prioridade: string | null;
  href: string; // sempre caminho relativo do app (/atuacao/...), nunca URL externa
}

export interface EventoPainel {
  id: string; titulo: string; tipo: string; data: string; hora: string | null;
  tenant_id: string; empresa: string; status: string;
}

export interface DocumentosPainel {
  vencidos: number | null; vence_7: number | null; vence_15: number | null; vence_30: number | null;
  aguardando_acao: number | null;
}

export interface PainelDto {
  gerado_em: string;
  empresas: { acessiveis: number } | null;
  tarefas: {
    abertas: number; vencidas: number; hoje: number; bloqueadas: number;
    aguardando_cliente: number; aguardando_avaliacao: number; aguardando_execucao: number; aguardando_eficacia: number;
  } | null;
  // hoje_total = contagem real dos eventos de hoje (a lista `hoje` é limitada a 10).
  // proximos_7_dias vem de AgendaService.listar, que tem teto de 300 linhas (aceitável para um contador de painel).
  agenda: { hoje: EventoPainel[]; hoje_total: number; proximos_7_dias: number } | null;
  documentos: DocumentosPainel | null;
  pendencias: Pendencia[];
  // Blocos permitidos que FALHARAM (isolados por savepoint): 'empresas'|'tarefas'|'agenda'|'documentos'.
  // Bloco null e fora desta lista = sem permissão; null e listado = indisponível.
  indisponiveis: string[];
}

export interface VencimentoItem {
  documento_id: string; tenant_id: string; empresa: string; titulo: string; categoria: string;
  expires_at: string; dias: number; href: string;
}

const MAX_PENDENCIAS = 20;
const MAX_EVENTOS_HOJE = 10;
const PAGINA = 100;
// Rascunhos do fluxo 0096 que ainda pedem ação de alguém (revisar, aprovar, assinar, publicar).
const AGUARDANDO = ['em_revisao', 'aprovado', 'assinado'];
// Cumulativo: "vence_15" = vence em até 15 dias (inclui os de 7). Vencido = expires_at < hoje; vencer hoje ainda não é vencido
// (mesma regra de documentSituation).
const DIAS_DA_FAIXA: Record<Exclude<FaixaVencimento, 'vencidos'>, number> = { '7': 7, '15': 15, '30': 30 };
// A categoria já é escondida do sócio pela RLS (migration 0083); o filtro explícito é defesa em profundidade.
const CARTEIRA = `d.expires_at IS NOT NULL AND d.category <> 'cadastro_funcionarios' AND is_montese_tenant(d.tenant_id)`;

function somarDias(dia: DateOnly, n: number): DateOnly {
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function faixaDoDia(dias: number): FaixaVencimento {
  return dias < 0 ? 'vencidos' : dias <= 7 ? '7' : dias <= 15 ? '15' : '30';
}

@Injectable()
export class PainelService {
  private readonly logger = new Logger(PainelService.name);

  constructor(
    private readonly atuacao: AtuacaoService,
    private readonly tarefas: TarefasService,
    private readonly agenda: AgendaService,
    private readonly empresas: EmpresasService,
  ) {}

  // Fuso: o dia de "hoje" é o de America/Sao_Paulo (todayDateOnly), o mesmo de EmpresasService.vencimentos e,
  // no banco, de tarefas (now() AT TIME ZONE 'America/Sao_Paulo'). Entra como parâmetro ($n::date): as contas
  // de dias acontecem no banco e os testes fixam o dia.
  async painel(c: PoolClient, userId: string, hoje: DateOnly = todayDateOnly(new Date())): Promise<PainelDto> {
    // Falha fechada: se não der para ler as permissões, o erro propaga (a rota inteira falha).
    const perm = (await c.query<{ permission: string }>('SELECT permission FROM socio_permissions WHERE user_id = $1', [userId]))
      .rows.map((r) => r.permission);
    const tem = (p: string) => perm.includes(p);

    const empresas = tem('clients.read')
      ? await this.bloco(c, 'empresas', async () => ({ acessiveis: (await this.atuacao.resumo(c)).total }))
      : null;
    const tarefas = tem('tasks.read') ? await this.bloco(c, 'tarefas', () => this.tarefas.resumo(c, userId)) : null;
    const agenda = tem('appointments.manage') ? await this.bloco(c, 'agenda', () => this.blocoAgenda(c, userId, hoje)) : null;
    const documentos = tem('empresas.read') || tem('documents.read') ? await this.blocoDocumentos(c, tem('empresas.read'), tem('documents.read'), hoje) : null;

    const indisponiveis: string[] = [];
    if (tem('clients.read') && empresas === null) indisponiveis.push('empresas');
    if (tem('tasks.read') && tarefas === null) indisponiveis.push('tarefas');
    if (tem('appointments.manage') && agenda === null) indisponiveis.push('agenda');
    if ((tem('empresas.read') || tem('documents.read')) && documentos === null) indisponiveis.push('documentos');

    const pendencias = await this.pendencias(c, userId, hoje, {
      tarefas: tem('tasks.read'), vencimentos: tem('empresas.read'), rascunhos: tem('documents.read'),
    });
    return { gerado_em: new Date().toISOString(), empresas, tarefas, agenda, documentos, pendencias, indisponiveis };
  }

  async vencimentos(
    c: PoolClient, q: ListVencimentosQuery, hoje: DateOnly = todayDateOnly(new Date()),
  ): Promise<{ itens: VencimentoItem[]; total: number }> {
    // Empresa fora da carteira Montese (ex.: parceiro) ⇒ 404 (a RLS do sócio já a esconde).
    if (q.tenantId) await this.empresas.exigirEmpresa(c, q.tenantId);
    const params: unknown[] = [hoje, q.tenantId ?? null];
    // faixa só chega aqui validada por @IsIn; o valor nunca entra no SQL, só o número da tabela DIAS_DA_FAIXA.
    // Sem faixa, `$1::date IS NOT NULL` só fixa o tipo de $1 (o Postgres recusa parâmetro não referenciado).
    let faixa = 'AND $1::date IS NOT NULL';
    if (q.faixa === 'vencidos') faixa = 'AND d.expires_at < $1::date';
    else if (q.faixa) faixa = `AND d.expires_at >= $1::date AND d.expires_at <= $1::date + ${DIAS_DA_FAIXA[q.faixa]}`;
    const filtro = `${CARTEIRA} ${faixa} AND ($2::uuid IS NULL OR d.tenant_id = $2::uuid)`;
    const offset = ((q.page ?? 1) - 1) * PAGINA;
    const lista = await c.query(
      `/* painel:vencimentos-lista */
       SELECT d.id AS documento_id, d.tenant_id, t.name AS empresa, d.title AS titulo, d.category AS categoria,
              d.expires_at::text AS expires_at, (d.expires_at - $1::date)::int AS dias
         FROM documents d JOIN tenants t ON t.id = d.tenant_id
        WHERE ${filtro}
        ORDER BY d.expires_at, d.title, d.id
        LIMIT ${PAGINA} OFFSET $3`,
      [...params, offset],
    );
    const total = await c.query(
      `/* painel:vencimentos-total */ SELECT count(*)::int AS n FROM documents d WHERE ${filtro}`,
      params,
    );
    return {
      itens: lista.rows.map((r: any) => ({
        documento_id: r.documento_id, tenant_id: r.tenant_id, empresa: r.empresa, titulo: r.titulo, categoria: r.categoria,
        expires_at: r.expires_at, dias: r.dias, href: `/atuacao/empresas/${r.tenant_id}`,
      })),
      total: total.rows[0]?.n ?? 0,
    };
  }

  // Cada bloco roda sob SAVEPOINT: um erro SQL aborta só o savepoint, não a transação inteira, e os demais
  // blocos continuam. O log leva só o nome do bloco e o código do erro (nunca mensagem/SQL/parâmetros).
  private async bloco<T>(c: PoolClient, nome: string, fn: () => Promise<T>): Promise<T | null> {
    await c.query('SAVEPOINT painel_bloco');
    try {
      const r = await fn();
      await c.query('RELEASE SAVEPOINT painel_bloco');
      return r;
    } catch (e: any) {
      await c.query('ROLLBACK TO SAVEPOINT painel_bloco'); // se falhar aqui, a conexão está ruim: propaga
      this.logger.warn(`bloco "${nome}" indisponível (${typeof e?.code === 'string' ? e.code : e?.constructor?.name ?? 'erro'})`);
      return null;
    }
  }

  private async blocoAgenda(c: PoolClient, userId: string, hoje: DateOnly) {
    const doDia = await this.agenda.listar(c, userId, { owner: 'me', from: hoje, to: hoje } as ListAgendaQuery);
    const proximos = await this.agenda.listar(c, userId, {
      owner: 'me', status: 'agendado', from: somarDias(hoje, 1), to: somarDias(hoje, 7),
    } as ListAgendaQuery);
    return {
      hoje_total: doDia.length,
      hoje: doDia.slice(0, MAX_EVENTOS_HOJE).map((e) => ({
        id: e.id, titulo: e.title, tipo: e.type, data: e.event_date, hora: e.start_time ?? null,
        tenant_id: e.tenant_id, empresa: e.tenant_name, status: e.status,
      })),
      proximos_7_dias: proximos.length,
    };
  }

  private async blocoDocumentos(c: PoolClient, venc: boolean, aguard: boolean, hoje: DateOnly): Promise<DocumentosPainel | null> {
    const v = venc
      ? await this.bloco(c, 'documentos.vencimentos', async () => (await c.query(
        `/* painel:doc-contagem */
         SELECT count(*) FILTER (WHERE d.expires_at < $1::date)::int AS vencidos,
                count(*) FILTER (WHERE d.expires_at >= $1::date AND d.expires_at <= $1::date + 7)::int AS vence_7,
                count(*) FILTER (WHERE d.expires_at >= $1::date AND d.expires_at <= $1::date + 15)::int AS vence_15,
                count(*) FILTER (WHERE d.expires_at >= $1::date AND d.expires_at <= $1::date + 30)::int AS vence_30
           FROM documents d WHERE ${CARTEIRA}`,
        [hoje],
      )).rows[0])
      : null;
    const a = aguard
      ? await this.bloco(c, 'documentos.aguardando', async () => (await c.query(
        `/* painel:rascunhos-contagem */ SELECT count(*)::int AS n FROM document_drafts WHERE status = ANY($1::text[])`,
        [AGUARDANDO],
      )).rows[0].n as number)
      : null;
    if (v === null && a === null) return null;
    return {
      vencidos: v?.vencidos ?? null, vence_7: v?.vence_7 ?? null, vence_15: v?.vence_15 ?? null, vence_30: v?.vence_30 ?? null,
      aguardando_acao: a,
    };
  }

  // União ordenada por urgência: (1) atrasadas/vencidas, por prazo crescente; (2) vencendo, por prazo; (3) aguardando
  // ação, por última atualização. Desempate fixo por tipo e id ⇒ resultado determinístico. Cada fonte traz no máximo
  // 20 linhas (consulta única por fonte), então o custo é constante.
  private async pendencias(
    c: PoolClient, userId: string, hoje: DateOnly, quem: { tarefas: boolean; vencimentos: boolean; rascunhos: boolean },
  ): Promise<Pendencia[]> {
    type Item = Pendencia & { _grupo: number; _ordem: string; _id: string };
    const itens: Item[] = [];

    if (quem.tarefas) {
      const ts = await this.bloco(c, 'pendencias.tarefas', () => this.tarefas.listar(c, userId, { assignee: 'me', vencidas: 'true' }));
      for (const t of ts ?? []) {
        itens.push({
          tipo: 'tarefa_atrasada', tenant_id: t.tenant_id, empresa: t.tenant_name, descricao: t.title, prazo: t.due_date,
          prioridade: t.priority, href: '/atuacao/tarefas?vencidas=true', _grupo: 0, _ordem: t.due_date ?? '9999-12-31', _id: t.id,
        });
      }
    }
    if (quem.tarefas) {
      // Em espera e NÃO atrasadas (as atrasadas já entram como tarefa_atrasada). Ordem: prazo (sem prazo por último), id.
      const es = await this.bloco(c, 'pendencias.tarefas-espera', async () => (await c.query(
        `/* painel:tarefas-aguardando */
         SELECT k.id, k.tenant_id, t.name AS empresa, k.title, k.priority, k.status, to_char(k.due_date, 'YYYY-MM-DD') AS due_date
           FROM tasks AS k JOIN tenants t ON t.id = k.tenant_id
          WHERE k.assignee_user_id = $1 AND k.status = ANY($2::text[]) AND (k.due_date IS NULL OR k.due_date >= $3::date)
          ORDER BY k.due_date NULLS LAST, k.id
          LIMIT ${MAX_PENDENCIAS}`,
        [userId, ESPERA, hoje],
      )).rows);
      for (const t of es ?? []) {
        itens.push({
          tipo: 'tarefa_aguardando', tenant_id: t.tenant_id, empresa: t.empresa, descricao: t.title, prazo: t.due_date,
          prioridade: t.priority, href: `/atuacao/tarefas?status=${t.status}`, _grupo: 3, _ordem: t.due_date ?? '9999-12-31', _id: t.id,
        });
      }
    }
    if (quem.vencimentos) {
      const ds = await this.bloco(c, 'pendencias.vencimentos', async () => (await c.query(
        `/* painel:doc-pendentes */
         SELECT d.id, d.tenant_id, t.name AS empresa, d.title, d.category, d.expires_at::text AS expires_at,
                (d.expires_at - $1::date)::int AS dias
           FROM documents d JOIN tenants t ON t.id = d.tenant_id
          WHERE ${CARTEIRA} AND d.expires_at <= $1::date + 30
          ORDER BY d.expires_at, d.id
          LIMIT ${MAX_PENDENCIAS}`,
        [hoje],
      )).rows);
      for (const d of ds ?? []) {
        const vencido = d.dias < 0;
        itens.push({
          tipo: vencido ? 'documento_vencido' : 'documento_vencendo', tenant_id: d.tenant_id, empresa: d.empresa,
          descricao: d.title, prazo: d.expires_at, prioridade: null, href: `/atuacao/vencimentos?faixa=${faixaDoDia(d.dias)}`,
          _grupo: vencido ? 0 : 1, _ordem: d.expires_at, _id: d.id,
        });
      }
    }
    if (quem.rascunhos) {
      const rs = await this.bloco(c, 'pendencias.rascunhos', async () => (await c.query(
        `/* painel:rascunhos-lista */
         SELECT d.id, d.tenant_id, t.name AS empresa, d.title, d.status, d.updated_at
           FROM document_drafts d JOIN tenants t ON t.id = d.tenant_id
          WHERE d.status = ANY($1::text[])
          ORDER BY d.updated_at, d.id
          LIMIT ${MAX_PENDENCIAS}`,
        [AGUARDANDO],
      )).rows);
      for (const r of rs ?? []) {
        itens.push({
          tipo: 'documento_aguardando', tenant_id: r.tenant_id, empresa: r.empresa, descricao: r.title, prazo: null,
          prioridade: null, href: `/atuacao/documentos/${r.id}`, _grupo: 2,
          _ordem: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at), _id: r.id,
        });
      }
    }

    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    itens.sort((a, b) => a._grupo - b._grupo || cmp(a._ordem, b._ordem) || cmp(a.tipo, b.tipo) || cmp(a._id, b._id));
    return itens.slice(0, MAX_PENDENCIAS).map(({ _grupo, _ordem, _id, ...p }) => p);
  }
}
