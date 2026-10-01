import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { FONTE_OFICIAL_NRS_URL, isNrCode, NR_CATALOG, NrCatalogEntry, NrStatus, Regra } from './nr-catalog';
import { avaliarEvidencia, Evidencia, hojeISO } from './nr-status';

export interface NrConformidadeItem {
  code: string;
  nome: string;
  status: NrStatus;
  evidencia: { quantidade: number; proxima_validade: string | null } | null;
  fonte_oficial_url: string;
  mensagem?: string;
}

@Injectable()
export class NrConformidadeService {
  private readonly logger = new Logger(NrConformidadeService.name);

  async getAplicaveis(client: PoolClient, tenantId: string) {
    const marcadas = await this.marcadasVigentes(client, tenantId);
    return {
      catalogo: NR_CATALOG.map((e) => ({ code: e.code, nome: e.nome })),
      marcadas: NR_CATALOG.map((e) => e.code).filter((c) => marcadas.has(c)),
    };
  }

  // Só NRs marcadas e vigentes, na ordem do catálogo. Cada NR roda dentro de um
  // SAVEPOINT: um erro de SQL numa regra aborta a transação inteira (25P02) e
  // derrubaria as demais; o savepoint isola a falha e a NR vira "nao_avaliavel".
  async getConformidade(client: PoolClient, tenantId: string, hoje: string = hojeISO()): Promise<{ nrs: NrConformidadeItem[] }> {
    const marcadas = await this.marcadasVigentes(client, tenantId);
    const nrs: NrConformidadeItem[] = [];
    for (const entrada of NR_CATALOG) {
      if (!marcadas.has(entrada.code)) continue;
      nrs.push(await this.avaliar(client, tenantId, entrada, hoje));
    }
    return { nrs };
  }

  // Aplica o rascunho da visita: insere o que é novo, marca `unmarked_at` no que saiu,
  // não toca no que ficou igual. Chamado na conclusão da inspeção, na mesma transação.
  async applyMarks(
    client: PoolClient,
    tenantId: string,
    inspectionId: string,
    userId: string,
    desejadas: readonly string[],
  ): Promise<void> {
    const invalidas = desejadas.filter((c) => !isNrCode(c));
    if (invalidas.length > 0) throw new BadRequestException(`NR fora do catálogo: ${invalidas.join(', ')}`);

    const alvo = new Set(desejadas);
    const vigentes = await this.marcadasVigentes(client, tenantId);

    for (const code of alvo) {
      if (vigentes.has(code)) continue;
      await client.query(
        `INSERT INTO company_applicable_nrs (tenant_id, nr_code, marked_by_user_id, source_inspection_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, nr_code) WHERE unmarked_at IS NULL DO NOTHING`,
        [tenantId, code, userId, inspectionId],
      );
    }
    for (const code of vigentes) {
      if (alvo.has(code)) continue;
      await client.query(
        `UPDATE company_applicable_nrs SET unmarked_at = now()
         WHERE tenant_id = $1 AND nr_code = $2 AND unmarked_at IS NULL`,
        [tenantId, code],
      );
    }
  }

  private async marcadasVigentes(client: PoolClient, tenantId: string): Promise<Set<string>> {
    const { rows } = await client.query<{ nr_code: string }>(
      `SELECT nr_code FROM company_applicable_nrs WHERE tenant_id = $1 AND unmarked_at IS NULL`,
      [tenantId],
    );
    return new Set(rows.map((r) => r.nr_code));
  }

  private async avaliar(client: PoolClient, tenantId: string, entrada: NrCatalogEntry, hoje: string): Promise<NrConformidadeItem> {
    const base = { code: entrada.code, nome: entrada.nome, fonte_oficial_url: FONTE_OFICIAL_NRS_URL };
    await client.query('SAVEPOINT nr_eval');
    try {
      const evidencia = await this.buscarEvidencia(client, tenantId, entrada.regra);
      const r = avaliarEvidencia(evidencia, entrada.agregacao, hoje);
      await client.query('RELEASE SAVEPOINT nr_eval');
      return { ...base, status: r.status, evidencia: { quantidade: r.quantidade, proxima_validade: r.proxima_validade } };
    } catch (err) {
      this.logger.error(`Falha ao avaliar ${entrada.code} (tenant ${tenantId})`, (err as Error).stack);
      await client.query('ROLLBACK TO SAVEPOINT nr_eval');
      return { ...base, status: 'nao_avaliavel', evidencia: null, mensagem: 'Não foi possível calcular agora.' };
    }
  }

  // `tenant_id` explícito em toda consulta: técnico/parceiro enxergam VÁRIOS tenants pela RLS,
  // então o filtro explícito é o que garante a empresa certa. `::text` devolve DATE como
  // 'yyyy-mm-dd' (sem a armadilha do objeto Date do node-pg).
  private async buscarEvidencia(client: PoolClient, tenantId: string, regra: Regra): Promise<Evidencia> {
    let sql: string;
    let params: unknown[] = [tenantId];
    switch (regra.fonte) {
      case 'documento':
        sql = `SELECT expires_at::text AS d FROM documents WHERE tenant_id = $1 AND category = ANY($2::text[])`;
        params = [tenantId, [...regra.categorias]];
        break;
      case 'cipa':
        sql = `SELECT data_termino::text AS d FROM cipa_committees WHERE tenant_id = $1 AND status = 'ativa'`;
        break;
      case 'epi':
        sql = `SELECT ca_valid_until::text AS d FROM tenant_epis WHERE tenant_id = $1`;
        break;
      case 'equipamento_incendio':
        sql = `SELECT proxima_manutencao::text AS d FROM fire_safety_equipment WHERE tenant_id = $1`;
        break;
    }
    const { rows } = await client.query<{ d: string | null }>(sql, params);
    return { validades: rows.map((r) => r.d) };
  }
}
