import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { toDateOnly, todayDateOnly } from '../common/dates/date-only';
import { mapPgError } from '../common/pg-error.util';
import { normalizeOccurredAt } from './occurred-at.util';
import { INT_MAX } from './dto/epi-dto-rules';
import { CreateEpiMovementDto } from './dto/create-epi-movement.dto';
import {
  ApplyMovementInput,
  ApplyResult,
  EpiMovement,
  MOVEMENT_DIRECTION,
  LedgerMovementType,
} from './epi-stock.types';

interface LockedEpi {
  id: string;
  tenant_id: string;
  controls_lot: boolean;
  status: string;
  stock_balance: number;
  ca_valid_until: string | null;
}

interface LotRow {
  id: string;
  valid_until: string | null;
  balance: number;
}

// Datas de validade são comparadas como 'AAAA-MM-DD' (dia do Brasil), nunca como timestamp.
// As colunas DATE saem do SQL já formatadas (to_char), sem depender do parser de DATE do driver pg.
const today = () => todayDateOnly(new Date());

@Injectable()
export class EpiStockService {
  // ÚNICA porta de escrita do saldo. Tudo roda na transação do chamador
  // (req.withTenantContext); qualquer exceção desfaz a movimentação inteira.
  async applyMovement(client: PoolClient, input: ApplyMovementInput): Promise<ApplyResult> {
    // 1) Trava o EPI: serializa entregas concorrentes do mesmo item.
    const epiRes = await client.query<LockedEpi>(
      `SELECT id, tenant_id, controls_lot, status, stock_balance,
              to_char(ca_valid_until, 'YYYY-MM-DD') AS ca_valid_until
       FROM tenant_epis WHERE id = $1 FOR UPDATE`,
      [input.tenantEpiId],
    );
    const epi = epiRes.rows[0];
    if (!epi) throw new NotFoundException('EPI não encontrado');

    // 2) Repetição idempotente (depois da trava, para duas requisições iguais em paralelo).
    const prev = await client.query<EpiMovement>(
      'SELECT * FROM epi_movements WHERE tenant_id = $1 AND idempotency_key = $2',
      [epi.tenant_id, input.idempotencyKey],
    );
    if (prev.rows[0]) {
      const p = prev.rows[0];
      // Compara todos os campos que identificam a operação, não só EPI/tipo/quantidade.
      const norm = (v: string | null | undefined) => (v ?? '').trim();
      let lotId: string | null = input.lotId ?? null;
      if (!lotId && input.lotCode) {
        const l = await client.query<{ id: string }>(
          'SELECT id FROM epi_lots WHERE tenant_epi_id = $1 AND lot_code = $2',
          [epi.id, input.lotCode],
        );
        lotId = l.rows[0]?.id ?? null;
      }
      const same =
        p.tenant_epi_id === epi.id &&
        p.type === input.type &&
        p.quantity === input.quantity &&
        (input.direction === undefined || p.direction === input.direction) &&
        (p.reverses_movement_id ?? null) === (input.reversesMovementId ?? null) &&
        (p.employee_id ?? null) === (input.employeeId ?? null) &&
        (p.lot_id ?? null) === lotId &&
        norm(p.supplier) === norm(input.supplier) &&
        norm(p.reason) === norm(input.reason);
      if (!same) {
        throw new ConflictException('Chave de idempotência já usada em outra operação');
      }
      return { movement: p, replayed: true };
    }

    const direction = this.resolveDirection(input);
    this.validateBusinessRules(input, epi, direction);

    if (input.reversesMovementId) {
      const done = await client.query('SELECT 1 FROM epi_movements WHERE reverses_movement_id = $1', [
        input.reversesMovementId,
      ]);
      if (done.rowCount) throw new ConflictException('Movimentação já estornada');
    }

    if (input.employeeId) {
      const emp = await client.query('SELECT 1 FROM employees WHERE id = $1 AND tenant_id = $2', [
        input.employeeId,
        epi.tenant_id,
      ]);
      if (!emp.rowCount) throw new NotFoundException('Funcionário não encontrado');
    }

    // Devolução limitada ao que o funcionário recebeu deste EPI (entregas + trocas − devoluções),
    // ignorando movimentações já estornadas. Roda sob a trava do EPI, então é serial por item.
    if (input.type === 'devolucao') {
      const saldo = await this.employeeEpiBalance(client, epi.id, input.employeeId!);
      if (input.quantity > saldo) {
        throw new ConflictException('Devolução maior que a quantidade entregue ao funcionário');
      }
    }

    // Estornar uma entrega/troca já devolvida (em parte) criaria estoque fantasma: exige estornar
    // antes as devoluções. Lido aqui, sob a trava do EPI (reverse() lê sem trava).
    if (input.type === 'estorno' && input.reversesMovementId) {
      const o = await client.query<{ type: string; employee_id: string | null; quantity: number }>(
        'SELECT type, employee_id, quantity FROM epi_movements WHERE id = $1 AND tenant_epi_id = $2',
        [input.reversesMovementId, epi.id],
      );
      const orig = o.rows[0];
      if (orig && (orig.type === 'entrega' || orig.type === 'troca') && orig.employee_id) {
        const saldo = await this.employeeEpiBalance(client, epi.id, orig.employee_id);
        if (saldo - orig.quantity < 0) {
          throw new ConflictException('Estorne antes as devoluções deste funcionário neste EPI');
        }
      }
    }

    const lot = await this.resolveLot(client, epi, input, direction);

    // Uma abertura por EPI e, em EPI com controle de lote, uma por lote.
    if (input.type === 'abertura') {
      const hasAny = await client.query(
        `SELECT 1 FROM epi_movements WHERE tenant_epi_id = $1
           AND lot_id IS NOT DISTINCT FROM $2::uuid LIMIT 1`,
        [epi.id, lot?.id ?? null],
      );
      if (hasAny.rowCount) {
        throw new ConflictException(
          epi.controls_lot
            ? 'Já existe movimentação para este lote; use entrada ou ajuste'
            : 'Já existe movimentação para este EPI; use entrada ou ajuste',
        );
      }
    }

    if ((input.type === 'entrega' || input.type === 'troca') && epi.ca_valid_until && epi.ca_valid_until < today()) {
      throw new ConflictException('CA vencido: não é possível entregar este EPI');
    }
    if ((input.type === 'entrega' || input.type === 'troca') && lot?.valid_until && lot.valid_until < today()) {
      throw new ConflictException('Lote vencido: não é possível entregar deste lote');
    }

    const newBalance = epi.stock_balance + direction * input.quantity;
    if (newBalance < 0) throw new ConflictException('Estoque insuficiente');
    // Teto do INT do Postgres: sem isso o UPDATE estoura com 22003 (500).
    if (newBalance > INT_MAX || (lot && lot.balance + direction * input.quantity > INT_MAX)) {
      throw new ConflictException('Saldo máximo excedido');
    }
    if (lot && lot.balance + direction * input.quantity < 0) {
      throw new ConflictException('Estoque insuficiente no lote');
    }

    let deliveryId = input.deliveryId;
    if (input.beforeInsert) deliveryId = await input.beforeInsert({ id: epi.id, tenant_id: epi.tenant_id });

    try {
      const ins = await client.query<EpiMovement>(
        `INSERT INTO epi_movements
           (tenant_id, tenant_epi_id, type, direction, quantity, balance_after, employee_id, supplier,
            lot_id, reason, occurred_at, delivery_id, reverses_movement_id, idempotency_key, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz, now()),$12,$13,$14,$15)
         RETURNING *`,
        [
          epi.tenant_id, epi.id, input.type, direction, input.quantity, newBalance,
          input.employeeId ?? null, input.supplier ?? null, lot?.id ?? null, input.reason ?? null,
          input.occurredAt ?? null, deliveryId ?? null, input.reversesMovementId ?? null,
          input.idempotencyKey, input.userId,
        ],
      );
      await client.query('UPDATE tenant_epis SET stock_balance = $2, updated_by_user_id = $3 WHERE id = $1', [
        epi.id, newBalance, input.userId,
      ]);
      if (lot) {
        await client.query('UPDATE epi_lots SET balance = balance + $2 WHERE id = $1', [
          lot.id, direction * input.quantity,
        ]);
      }
      if (input.type === 'estorno' && deliveryId) {
        await client.query(`UPDATE employee_epi_deliveries SET signature_status = 'estornada' WHERE id = $1`, [
          deliveryId,
        ]);
      }
      return { movement: ins.rows[0], replayed: false };
    } catch (err) {
      mapPgError(err);
    }
  }

  // Valida o corpo da API, cria a entrega vinculada (entrega/troca) e aplica o movimento.
  async registerMovement(
    client: PoolClient,
    tenantEpiId: string,
    dto: CreateEpiMovementDto,
    userId: string,
  ): Promise<ApplyResult> {
    // Normalizado UMA vez: o mesmo instante vale para o movimento e para a entrega vinculada.
    const occurredAt = normalizeOccurredAt(dto.occurred_at);
    const input: ApplyMovementInput = {
      tenantEpiId,
      type: dto.type,
      quantity: dto.quantity,
      employeeId: dto.employee_id,
      supplier: dto.supplier,
      lotId: dto.lot_id,
      lotCode: dto.lot_code,
      lotValidUntil: dto.lot_valid_until,
      reason: dto.reason,
      occurredAt,
      idempotencyKey: dto.idempotency_key,
      userId,
    };
    if (dto.type === 'entrega' || dto.type === 'troca') {
      input.beforeInsert = async (epi) => {
        // delivered_at é o dia civil de São Paulo (e não o dia UTC do servidor).
        const d = await client.query<{ id: string }>(
          `INSERT INTO employee_epi_deliveries
             (tenant_id, tenant_epi_id, employee_id, delivered_at, quantity, signature_status,
              signed_by_name, signed_at, created_by_user_id)
           VALUES ($1, $2, $3, (COALESCE($4::timestamptz, now()) AT TIME ZONE 'America/Sao_Paulo')::date, $5, 'pendente', NULL, NULL, $6)
           RETURNING id`,
          [epi.tenant_id, epi.id, dto.employee_id, occurredAt ?? null, dto.quantity, userId],
        );
        return d.rows[0].id;
      };
    }
    return this.applyMovement(client, input);
  }

  async reverse(
    client: PoolClient,
    movementId: string,
    data: { reason: string; idempotencyKey: string; userId: string },
  ): Promise<ApplyResult> {
    const res = await client.query<EpiMovement>('SELECT * FROM epi_movements WHERE id = $1', [movementId]);
    const orig = res.rows[0];
    if (!orig) throw new NotFoundException('Movimentação não encontrada');
    if (orig.type === 'estorno') throw new ConflictException('Um estorno não pode ser estornado');
    return this.applyMovement(client, {
      tenantEpiId: orig.tenant_epi_id,
      type: 'estorno',
      direction: orig.direction === 1 ? -1 : 1,
      quantity: orig.quantity,
      employeeId: orig.employee_id ?? undefined,
      lotId: orig.lot_id ?? undefined,
      reason: data.reason,
      reversesMovementId: orig.id,
      deliveryId: orig.delivery_id ?? undefined,
      idempotencyKey: data.idempotencyKey,
      userId: data.userId,
    });
  }

  async listMovements(
    client: PoolClient,
    f: { tenantId?: string; tenantEpiId?: string; employeeId?: string; type?: string; from?: string; to?: string; page: number; pageSize: number },
  ): Promise<{ items: Array<EpiMovement & { reversed: boolean }>; total: number; page: number; page_size: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sqlFrag: string, v: unknown) => {
      params.push(v);
      where.push(sqlFrag.replace('?', `$${params.length}`));
    };
    if (f.tenantId) add('tenant_id = ?', f.tenantId);
    if (f.tenantEpiId) add('tenant_epi_id = ?', f.tenantEpiId);
    if (f.employeeId) add('employee_id = ?', f.employeeId);
    if (f.type) add('type = ?', f.type);
    if (f.from) add('occurred_at >= ?', f.from);
    if (f.to) add('occurred_at <= ?', f.to);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await client.query<{ n: string }>(`SELECT count(*) AS n FROM epi_movements ${w}`, params);
    const items = await client.query<EpiMovement & { reversed: boolean }>(
      `SELECT x.*,
              EXISTS (SELECT 1 FROM epi_movements r
                      WHERE r.reverses_movement_id = x.id AND r.tenant_id = x.tenant_id) AS reversed
       FROM (
         SELECT * FROM epi_movements ${w} ORDER BY occurred_at DESC, created_at DESC
         LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}
       ) x
       ORDER BY x.occurred_at DESC, x.created_at DESC`,
      params,
    );
    return { items: items.rows, total: Number(total.rows[0].n), page: f.page, page_size: f.pageSize };
  }

  // Saldo do funcionário neste EPI: entregue (entrega+troca) − devolvido, sem contar movimentações estornadas.
  private async employeeEpiBalance(client: PoolClient, tenantEpiId: string, employeeId: string): Promise<number> {
    const r = await client.query<{ saldo: number }>(
      `SELECT COALESCE(SUM(CASE WHEN m.type IN ('entrega','troca') THEN m.quantity ELSE -m.quantity END), 0)::int AS saldo
       FROM epi_movements m
       WHERE m.tenant_epi_id = $1 AND m.employee_id = $2
         AND m.type IN ('entrega','troca','devolucao')
         AND NOT EXISTS (SELECT 1 FROM epi_movements r WHERE r.reverses_movement_id = m.id)`,
      [tenantEpiId, employeeId],
    );
    return r.rows[0].saldo;
  }

  private resolveDirection(input: ApplyMovementInput): 1 | -1 {
    if (input.type === 'ajuste' || input.type === 'estorno') {
      if (input.direction !== 1 && input.direction !== -1) throw new BadRequestException('Direção obrigatória');
      return input.direction;
    }
    return MOVEMENT_DIRECTION[input.type as LedgerMovementType];
  }

  private validateBusinessRules(input: ApplyMovementInput, epi: LockedEpi, direction: 1 | -1): void {
    const needsEmployee = ['entrega', 'troca', 'devolucao'].includes(input.type);
    if (needsEmployee && !input.employeeId) throw new BadRequestException('Funcionário é obrigatório');
    if ((input.type === 'entrada') && !input.supplier?.trim()) {
      throw new BadRequestException('Fornecedor/origem é obrigatório na entrada');
    }
    if (['baixa', 'ajuste', 'estorno'].includes(input.type) && !input.reason?.trim()) {
      throw new BadRequestException('Motivo é obrigatório');
    }
    if (epi.status !== 'ativo' && ['entrada', 'entrega', 'troca', 'abertura'].includes(input.type)) {
      throw new ConflictException('EPI inativo');
    }
    if (direction === 1 && input.type === 'entrega') throw new BadRequestException('Direção inválida');
  }

  // Resolve (ou cria, em entrada/abertura) o lote e o trava. Retorna null se o EPI não controla lote.
  private async resolveLot(
    client: PoolClient,
    epi: LockedEpi,
    input: ApplyMovementInput,
    direction: 1 | -1,
  ): Promise<LotRow | null> {
    // Lote novo só nasce em entrada/abertura; nos demais tipos só se usa lote EXISTENTE (lot_id).
    // Sem isso uma devolução com lot_code criaria lote novo e escaparia do bloqueio de lote vencido.
    if ((input.lotCode || input.lotValidUntil) && input.type !== 'entrada' && input.type !== 'abertura') {
      throw new BadRequestException('lot_code e lot_valid_until só são aceitos em entrada e abertura; use lot_id');
    }
    if (!epi.controls_lot) {
      if (input.lotId || input.lotCode) throw new BadRequestException('Este EPI não controla lote');
      return null;
    }
    if (input.lotId) {
      const r = await client.query<LotRow>(
        `SELECT id, to_char(valid_until, 'YYYY-MM-DD') AS valid_until, balance FROM epi_lots WHERE id = $1 AND tenant_epi_id = $2 FOR UPDATE`,
        [input.lotId, epi.id],
      );
      if (!r.rows[0]) throw new NotFoundException('Lote não encontrado');
      return r.rows[0];
    }
    if (direction === 1 && input.lotCode) {
      const found = await client.query<LotRow>(
        `SELECT id, to_char(valid_until, 'YYYY-MM-DD') AS valid_until, balance FROM epi_lots WHERE tenant_epi_id = $1 AND lot_code = $2 FOR UPDATE`,
        [epi.id, input.lotCode],
      );
      if (found.rows[0]) {
        const cur = found.rows[0].valid_until;
        const informed = toDateOnly(input.lotValidUntil);
        if (informed && cur && cur !== informed) {
          throw new ConflictException('Lote já existe com outra validade');
        }
        return found.rows[0];
      }
      const created = await client.query<LotRow>(
        `INSERT INTO epi_lots (tenant_id, tenant_epi_id, lot_code, valid_until)
         VALUES ($1, $2, $3, $4) RETURNING id, to_char(valid_until, 'YYYY-MM-DD') AS valid_until, balance`,
        [epi.tenant_id, epi.id, input.lotCode, toDateOnly(input.lotValidUntil)],
      );
      return created.rows[0];
    }
    throw new BadRequestException('Informe o lote (lot_id ou lot_code) para este EPI');
  }
}
