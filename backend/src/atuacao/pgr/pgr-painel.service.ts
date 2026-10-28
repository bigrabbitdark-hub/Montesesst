import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';

// Só cliente Montese (todos os papéis, inclusive admin). Resumo do cadastro importado para o PGR. SOMENTE LEITURA sobre dados existentes: nada é inferido nem
// gravado; o que falta vira `pendencias` e a correção continua em /atuacao/clientes/[id].
// grau_risco: o cadastro não tem esse campo (nem existe tabela de CNAE→grau de risco no sistema);
// por isso vem null ("indisponível") e NÃO entra em pendências nem em completude, para não inventar dado.
@Injectable()
export class PgrPainelService {
  async resumo(c: PoolClient, tenantId: string) {
    const t = await c.query(
      `SELECT t.id, t.name, t.trade_name, t.cnpj, t.cnae_code, t.address_street, t.address_city, t.address_state, t.address_zip
         FROM tenants t WHERE t.id = $1 AND is_montese_tenant(t.id)`,
      [tenantId],
    );
    const e = t.rows[0];
    if (!e) throw new NotFoundException('Empresa não encontrada');
    const n = (await c.query(
      `SELECT (SELECT count(*)::int FROM company_units WHERE tenant_id = $1 AND status = 'ativo') AS unidades,
              (SELECT count(*)::int FROM positions WHERE tenant_id = $1) AS cargos,
              (SELECT count(*)::int FROM employees WHERE tenant_id = $1 AND status = 'ativo') AS funcionarios,
              (SELECT count(*)::int FROM pgr_ghes WHERE tenant_id = $1) AS ghes,
              (SELECT count(*)::int FROM pgr_risks WHERE tenant_id = $1) AS riscos`,
      [tenantId],
    )).rows[0];
    const preenchido = (v: unknown) => typeof v === 'string' && v.trim() !== '';
    const importados = {
      cnpj: preenchido(e.cnpj),
      cnae: preenchido(e.cnae_code),
      grau_risco: null as boolean | null,
      endereco: preenchido(e.address_street) && preenchido(e.address_city) && preenchido(e.address_state) && preenchido(e.address_zip),
      unidades: n.unidades as number,
      cargos: n.cargos as number,
      funcionarios: n.funcionarios as number,
    };
    const checagens: Array<[string, boolean]> = [
      ['cnpj', importados.cnpj], ['cnae', importados.cnae], ['endereco', importados.endereco],
      ['unidades', importados.unidades > 0], ['cargos', importados.cargos > 0], ['funcionarios', importados.funcionarios > 0],
      ['ghes', n.ghes > 0], ['riscos', n.riscos > 0],
    ];
    return {
      empresa: { id: e.id as string, name: e.name as string, trade_name: (e.trade_name ?? null) as string | null, cnpj: e.cnpj as string },
      importados,
      pendencias: checagens.filter(([, ok]) => !ok).map(([k]) => k),
      ghes: n.ghes as number,
      riscos: n.riscos as number,
      completude: Math.round((100 * checagens.filter(([, ok]) => ok).length) / checagens.length),
    };
  }
}
