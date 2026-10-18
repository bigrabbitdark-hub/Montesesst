import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AREAS, categoriaValidaParaArea, isRuleArea, RuleArea } from './normative-rule-areas';
import { ProvisionRow } from './provisions.service';

export type RuleStatus = 'rascunho' | 'revisada' | 'revisar' | 'retirada';
export type RulePapel = 'fundamento' | 'criterio' | 'excecao' | 'metodo';

export interface NormativeRule {
  id: string;
  rule_key: string;
  area: RuleArea;
  categoria: string;
  agente_ou_atividade: string;
  metodo_avaliacao: string;
  unidade: string | null;
  criterio: string;
  excecoes: string | null;
  dependencias: unknown[];
  interpretacao: string;
  exige_revisao_profissional: boolean;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  status: RuleStatus;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  reviewer_registro: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuleProvisionLink {
  provision_id: string;
  papel: RulePapel;
}

export type CreateRuleData = Pick<NormativeRule, 'rule_key' | 'area' | 'categoria' | 'agente_ou_atividade' | 'metodo_avaliacao' | 'criterio' | 'interpretacao'> &
  Partial<Pick<NormativeRule, 'unidade' | 'excecoes' | 'dependencias' | 'exige_revisao_profissional' | 'vigencia_inicio' | 'vigencia_fim'>>;

// area é imutável: não entra no tipo de edição nem na lista branca abaixo.
export type UpdateRuleData = Partial<Omit<CreateRuleData, 'rule_key' | 'area'>>;

// Lista branca: area, status e campos de revisão NUNCA entram por update(); status só por review()/retire().
const UPDATABLE = [
  'categoria',
  'agente_ou_atividade',
  'metodo_avaliacao',
  'unidade',
  'criterio',
  'excecoes',
  'dependencias',
  'interpretacao',
  'exige_revisao_profissional',
  'vigencia_inicio',
  'vigencia_fim',
] as const;

// Mesma regra do CHECK normative_rules_area_categoria_coerente, mas com 400 claro antes de ir ao banco.
function exigirCategoriaDaArea(area: unknown, categoria: unknown): void {
  if (!isRuleArea(area)) throw new BadRequestException(`area inválida; use uma de: ${AREAS.join(', ')}`);
  if (!categoriaValidaParaArea(area, categoria)) {
    throw new BadRequestException(`categoria '${String(categoria)}' não pertence à área '${area}'`);
  }
}

@Injectable()
export class NormativeRulesService {
  async create(client: PoolClient, data: CreateRuleData): Promise<NormativeRule> {
    exigirCategoriaDaArea(data.area, data.categoria);
    let result;
    try {
      result = await client.query<NormativeRule>(
        `INSERT INTO normative_rules (rule_key, area, categoria, agente_ou_atividade, metodo_avaliacao, unidade, criterio, excecoes,
                                dependencias, interpretacao, exige_revisao_profissional, vigencia_inicio, vigencia_fim, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, 'rascunho') RETURNING *`,
        [
          data.rule_key,
          data.area,
          data.categoria,
          data.agente_ou_atividade,
          data.metodo_avaliacao,
          data.unidade ?? null,
          data.criterio,
          data.excecoes ?? null,
          JSON.stringify(data.dependencias ?? []),
          data.interpretacao,
          data.exige_revisao_profissional ?? true,
          data.vigencia_inicio ?? null,
          data.vigencia_fim ?? null,
        ],
      );
    } catch (err) {
      // UNIQUE(rule_key) → 409 com mensagem clara, em vez de 500.
      if ((err as { code?: string } | null)?.code === '23505') throw new ConflictException('Já existe uma regra com esta rule_key');
      throw err;
    }
    return result.rows[0];
  }

  async list(client: PoolClient, f: { area?: string; categoria?: string; status?: string }): Promise<NormativeRule[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.area) {
      if (!isRuleArea(f.area)) throw new BadRequestException(`area inválida; use uma de: ${AREAS.join(', ')}`);
      params.push(f.area);
      where.push(`area = $${params.length}`);
    }
    if (f.categoria) {
      params.push(f.categoria);
      where.push(`categoria = $${params.length}`);
    }
    if (f.status) {
      params.push(f.status);
      where.push(`status = $${params.length}`);
    }
    const result = await client.query<NormativeRule>(
      `SELECT * FROM normative_rules ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY rule_key`,
      params,
    );
    return result.rows;
  }

  private async load(client: PoolClient, id: string, forUpdate = false): Promise<NormativeRule> {
    const result = await client.query<NormativeRule>(`SELECT * FROM normative_rules WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
    const rule = result.rows[0];
    if (!rule) throw new NotFoundException('Regra não encontrada');
    return rule;
  }

  async findOne(client: PoolClient, id: string): Promise<NormativeRule & { provisions: (ProvisionRow & { papel: RulePapel })[] }> {
    const rule = await this.load(client, id);
    const provisions = await client.query<ProvisionRow & { papel: RulePapel }>(
      `SELECT p.*, rp.papel FROM normative_rule_provisions rp JOIN normative_provisions p ON p.id = rp.provision_id
       WHERE rp.rule_id = $1 ORDER BY p.norma, p.anexo, p.char_start`,
      [id],
    );
    return { ...rule, provisions: provisions.rows };
  }

  async update(client: PoolClient, id: string, data: UpdateRuleData): Promise<NormativeRule> {
    const rule = await this.load(client, id, true);
    if (rule.status === 'retirada') throw new ConflictException('Regra retirada não pode ser editada');
    // A área é fixa; a categoria nova tem de pertencer à área da regra.
    if (data.categoria !== undefined) exigirCategoriaDaArea(rule.area, data.categoria);
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const col of UPDATABLE) {
      if ((data as Record<string, unknown>)[col] === undefined) continue;
      const value = (data as Record<string, unknown>)[col];
      params.push(col === 'dependencias' ? JSON.stringify(value) : value);
      sets.push(`${col} = $${params.length}${col === 'dependencias' ? '::jsonb' : ''}`);
    }
    if (sets.length === 0) return rule;
    // Editar o conteúdo de uma regra já revisada invalida a revisão.
    if (rule.status === 'revisada') sets.push(`status = 'revisar'`);
    sets.push('updated_at = now()');
    const result = await client.query<NormativeRule>(`UPDATE normative_rules SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
    return result.rows[0];
  }

  // DELETE + INSERTs só são atômicos dentro da transação do chamador: req.withTenantContext abre BEGIN/ROLLBACK (database.service.ts). O FOR UPDATE de load() serializa review()/setProvisions() sobre a mesma regra.
  async setProvisions(client: PoolClient, id: string, links: RuleProvisionLink[]): Promise<NormativeRule> {
    const rule = await this.load(client, id, true);
    if (rule.status === 'retirada') throw new ConflictException('Regra retirada não pode ser editada');
    const ids = [...new Set(links.map((l) => l.provision_id))];
    const valid = await client.query<{ id: string }>(
      `SELECT id FROM normative_provisions WHERE id = ANY($1::uuid[]) AND status = 'ativo'`,
      [ids],
    );
    const validIds = new Set(valid.rows.map((r) => r.id));
    const invalid = ids.filter((x) => !validIds.has(x));
    if (invalid.length > 0) throw new BadRequestException('Há dispositivos inexistentes ou obsoletos na lista');

    await client.query('DELETE FROM normative_rule_provisions WHERE rule_id = $1', [id]);
    for (const l of links) {
      await client.query(
        `INSERT INTO normative_rule_provisions (rule_id, provision_id, papel) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [id, l.provision_id, l.papel],
      );
    }
    const result = await client.query<NormativeRule>(
      `UPDATE normative_rules SET ${rule.status === 'revisada' ? `status = 'revisar', ` : ''}updated_at = now() WHERE id = $1 RETURNING *`,
      [id],
    );
    return result.rows[0];
  }

  async review(client: PoolClient, id: string, reviewerUserId: string, registro: string): Promise<NormativeRule> {
    const rule = await this.load(client, id, true);
    if (rule.status !== 'rascunho' && rule.status !== 'revisar') {
      throw new ConflictException('Só regras em rascunho ou a revisar podem ser marcadas como revisadas');
    }
    const reg = registro.trim();
    if (!reg) throw new BadRequestException('Informe o registro do profissional habilitado');
    const ativos = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM normative_rule_provisions rp JOIN normative_provisions p ON p.id = rp.provision_id
       WHERE rp.rule_id = $1 AND p.status = 'ativo'`,
      [id],
    );
    if (Number(ativos.rows[0].n) < 1) {
      throw new BadRequestException('Vincule ao menos um dispositivo literal ativo antes de marcar a regra como revisada');
    }
    const result = await client.query<NormativeRule>(
      `UPDATE normative_rules
       SET status = 'revisada', reviewed_by_user_id = $2, reviewed_at = now(), reviewer_registro = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, reviewerUserId, reg],
    );
    return result.rows[0];
  }

  async retire(client: PoolClient, id: string): Promise<NormativeRule> {
    const rule = await this.load(client, id, true);
    if (rule.status === 'retirada') throw new ConflictException('A regra já está retirada');
    const result = await client.query<NormativeRule>(
      `UPDATE normative_rules SET status = 'retirada', updated_at = now() WHERE id = $1 RETURNING *`,
      [id],
    );
    return result.rows[0];
  }
}
