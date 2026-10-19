import { ConflictException, BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { maskCpf } from '../epi-ficha/cpf-mask.util';
import { EPI_TERM } from '../epi-ficha/epi-ficha-term';
import { CreateSignatureRequestDto } from './dto/create-signature-request.dto';
import { InPersonDto } from './dto/in-person.dto';
import { ReceiptData } from './receipt-pdf.util';
import { generatePin, generateToken, hashPin, hashToken, signatureTermAllowed, termTextSha256 } from './signature-secrets.util';

const LINK_TTL_MS = 24 * 3600 * 1000;
const lockTimeoutMs = () => {
  const n = Number(process.env.EPI_SIGNATURE_LOCK_TIMEOUT_MS);
  return Number.isInteger(n) && n > 0 ? n : 5000;
};

// Trava com tempo limite: a conexão do pool nunca fica presa atrás de outra operação lenta (55P03 -> 503, nunca 500).
async function lockQuery<T = any>(client: PoolClient, sql: string, params: unknown[]): Promise<T[]> {
  try {
    return (await client.query(sql, params)).rows as T[];
  } catch (err) {
    if ((err as { code?: string }).code === '55P03') {
      throw new ServiceUnavailableException('Há outra operação de assinatura em andamento para este funcionário; tente novamente');
    }
    throw err;
  }
}

// ORDEM DE TRAVAS (a mesma de epi_sig_sign/epi_sig_refuse, que travam a REQUISIÇÃO primeiro e as ENTREGAS depois):
// funcionário -> requisições (UPDATE) -> entregas. Nunca travar entregas antes das requisições (deadlock 40P01).
@Injectable()
export class EpiSignatureService {
  // Revoga os links ativos que contêm alguma das entregas (o UPDATE trava as requisições). Deve vir ANTES de travar as entregas.
  private async revokeActiveForDeliveries(client: PoolClient, deliveryIds: string[]): Promise<void> {
    await client.query(
      `UPDATE epi_signature_requests SET status = 'revogada'
        WHERE status = 'ativa' AND id IN (SELECT request_id FROM epi_signature_request_items WHERE delivery_id = ANY($1::uuid[]))`,
      [deliveryIds],
    );
  }

  async createRequest(client: PoolClient, dto: CreateSignatureRequestDto, userId: string) {
    if (!signatureTermAllowed()) throw new ConflictException('O termo de recebimento ainda não foi aprovado para uso');
    await client.query(`SET LOCAL lock_timeout = ${lockTimeoutMs()}`);
    // (a) trava o funcionário (serializa novos links do mesmo funcionário) e obtém o tenant da LINHA (nunca do corpo)
    const emp = (await lockQuery(client, 'SELECT id, tenant_id FROM employees WHERE id = $1 FOR NO KEY UPDATE', [dto.employee_id]))[0];
    if (!emp) throw new NotFoundException('Funcionário não encontrado');
    // idempotência: a chave já usada devolve 409 (o código em claro não é recuperável)
    const prev = await client.query('SELECT 1 FROM epi_signature_requests WHERE tenant_id = $1 AND idempotency_key = $2', [emp.tenant_id, dto.idempotency_key]);
    if (prev.rowCount) throw new ConflictException('Link já emitido com esta chave; revogue e gere outro');

    // (b) entregas elegíveis, lidas SEM travar (pendentes ou recusadas do funcionário)
    const ids = dto.delivery_ids ?? null;
    if (ids) {
      // todas as pedidas devem existir sob RLS e pertencer ao funcionário
      const found = (await client.query('SELECT id, employee_id FROM employee_epi_deliveries WHERE id = ANY($1::uuid[])', [ids])).rows;
      if (found.length !== ids.length || found.some((f) => f.employee_id !== dto.employee_id)) throw new NotFoundException('Entrega não encontrada');
    }
    const eligibleSql = `SELECT id FROM employee_epi_deliveries
        WHERE employee_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) AND signature_status IN ('pendente','recusada')
          AND quantity IS NOT NULL ORDER BY id`;
    const peek = (await client.query(eligibleSql, [dto.employee_id, ids])).rows as { id: string }[];
    if (ids && peek.length !== ids.length) throw new ConflictException('Há entregas que não aguardam assinatura');
    if (peek.length === 0) throw new ConflictException('Não há entregas aguardando assinatura');

    // (c) revoga os links ativos que compartilham essas entregas ANTES de travar ou alterar as entregas
    await this.revokeActiveForDeliveries(client, peek.map((r) => r.id));
    // (d) só então trava as entregas e confere de novo (uma assinatura concorrente pode ter vencido a corrida)
    const rows = await lockQuery<{ id: string }>(client, `${eligibleSql} FOR UPDATE`, [dto.employee_id, ids]);
    if (rows.length !== peek.length || rows.some((r, i) => r.id !== peek[i].id)) throw new ConflictException('As entregas mudaram de situação; tente novamente');
    const deliveryIds = rows.map((r) => r.id);

    // (e) cria a requisição ativa (token e código em claro só existem nesta resposta)
    const token = generateToken();
    const pin = generatePin();
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO epi_signature_requests (tenant_id, employee_id, token_hash, pin_hash, expires_at, term_version, term_text_sha256, created_by_user_id, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, expires_at`,
        [emp.tenant_id, dto.employee_id, hashToken(token), hashPin(token, pin), expiresAt, EPI_TERM.version, termTextSha256(), userId, dto.idempotency_key],
      );
    } catch (err) {
      mapPgError(err);
    }
    // (f) entregas recusadas voltam a pendente (o guard dos itens exige entrega pendente)
    await client.query(`UPDATE employee_epi_deliveries SET signature_status = 'pendente' WHERE id = ANY($1::uuid[]) AND signature_status = 'recusada'`, [deliveryIds]);
    // (g) itens
    for (const id of deliveryIds) {
      try {
        await client.query('INSERT INTO epi_signature_request_items (request_id, delivery_id) VALUES ($1,$2)', [inserted.rows[0].id, id]);
      } catch (err) {
        mapPgError(err);
      }
    }
    const base = (process.env.PUBLIC_APP_URL || 'https://app.invalid').replace(/\/+$/, '');
    const url = `${base}/assinar#token=${token}`;
    return { id: inserted.rows[0].id, url, qr_payload: url, code: pin, expires_at: inserted.rows[0].expires_at, delivery_ids: deliveryIds };
  }

  // Nunca devolve token_hash, pin_hash, token nem código.
  async listRequests(client: PoolClient, employeeId: string) {
    const emp = await client.query('SELECT id FROM employees WHERE id = $1', [employeeId]);
    if (!emp.rows[0]) throw new NotFoundException('Funcionário não encontrado');
    const r = await client.query(
      `SELECT q.id, q.employee_id, q.status, q.attempts, q.expires_at, q.created_at, q.used_at, q.refusal_reason,
              COALESCE((SELECT array_agg(i.delivery_id ORDER BY i.delivery_id) FROM epi_signature_request_items i WHERE i.request_id = q.id), '{}') AS delivery_ids
         FROM epi_signature_requests q WHERE q.employee_id = $1 ORDER BY q.created_at DESC, q.id`,
      [employeeId],
    );
    return r.rows;
  }

  // Entregas do livro aguardando assinatura. Colunas explícitas: nada de token, hash, código nem CPF.
  // A empresa inexistente ou invisível pela RLS responde 404 uniforme (sem oráculo de existência).
  async listPending(client: PoolClient, tenantId: string, f: { employeeId?: string; page: number; pageSize: number }) {
    const t = await client.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId]);
    if (!t.rowCount) throw new NotFoundException('Empresa não encontrada');
    const params: unknown[] = [tenantId];
    let emp = '';
    if (f.employeeId) { params.push(f.employeeId); emp = ` AND d.employee_id = $${params.length}`; }
    const where = `d.tenant_id = $1 AND d.signature_status IN ('pendente','recusada') AND d.quantity IS NOT NULL${emp}`;
    const total = await client.query<{ n: string }>(`SELECT count(*) AS n FROM employee_epi_deliveries d WHERE ${where}`, params);
    const rows = await client.query(
      `SELECT d.id AS delivery_id, d.employee_id, e.full_name AS employee_name, d.tenant_epi_id, eci.description AS epi_description,
              te.ca_number, d.quantity, d.delivered_at, d.signature_status,
              r.id AS active_request_id, r.status AS active_request_status, r.expires_at AS active_request_expires_at
         FROM employee_epi_deliveries d
         JOIN employees e ON e.id = d.employee_id
         JOIN tenant_epis te ON te.id = d.tenant_epi_id
         JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
         LEFT JOIN LATERAL (
           SELECT q.id, q.status, q.expires_at
             FROM epi_signature_request_items i JOIN epi_signature_requests q ON q.id = i.request_id
            WHERE i.delivery_id = d.id AND q.status = 'ativa' AND q.expires_at > now()
            ORDER BY q.created_at DESC, q.id LIMIT 1
         ) r ON true
        WHERE ${where}
        ORDER BY d.delivered_at ASC, d.id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.pageSize, (f.page - 1) * f.pageSize],
    );
    return { items: rows.rows, total: Number(total.rows[0].n), page: f.page, page_size: f.pageSize };
  }

  async revoke(client: PoolClient, id: string) {
    const r = await client.query(`UPDATE epi_signature_requests SET status = 'revogada' WHERE id = $1 AND status = 'ativa' RETURNING id, status`, [id]);
    if (r.rows[0]) return r.rows[0];
    const exists = await client.query('SELECT 1 FROM epi_signature_requests WHERE id = $1', [id]);
    if (!exists.rowCount) throw new NotFoundException('Requisição não encontrada');
    throw new ConflictException('A requisição não está ativa');
  }

  // Dados do comprovante, lidos sob RLS (outra empresa / não vinculado = inexistente -> 404). Roda DENTRO da transação do
  // tenant; o PDF é gerado depois, com a transação já fechada. Não lê o R2: o comprovante não embute a imagem.
  // Usa a evidência gravada (epi_signatures), nunca valores vindos do cliente.
  async getReceiptData(client: PoolClient, id: string): Promise<ReceiptData> {
    const r = await client.query(
      `SELECT s.receipt_code, s.signed_at, s.term_version, s.term_text_sha256, s.items_snapshot, s.evidence_sha256, s.signature_sha256, s.ip,
              t.name AS company_name, t.cnpj AS company_cnpj, e.full_name, e.cpf
         FROM epi_signatures s
         JOIN tenants t ON t.id = s.tenant_id
         JOIN employees e ON e.id = s.employee_id
        WHERE s.id = $1`,
      [id],
    );
    const x = r.rows[0];
    if (!x) throw new NotFoundException('Comprovante não encontrado');
    // O texto do termo só é impresso quando é exatamente o aceito (mesmo hash); senão o comprovante diz que não está disponível.
    const sameTerm = x.term_version === EPI_TERM.version && x.term_text_sha256 === termTextSha256();
    return {
      company: { name: x.company_name, cnpj: x.company_cnpj },
      employee: { full_name: x.full_name, cpf_masked: maskCpf(x.cpf) },
      receipt_code: x.receipt_code,
      signed_at: new Date(x.signed_at).toISOString(),
      items: (x.items_snapshot as any[]).map((i) => ({
        date: i.date, epi_description: i.epi_description, manufacturer: i.manufacturer ?? null, model: i.model ?? null,
        ca_number: i.ca_number, quantity: i.quantity ?? null,
      })),
      term: sameTerm
        ? { version: EPI_TERM.version, draft: EPI_TERM.draft, title: EPI_TERM.title, paragraphs: [...EPI_TERM.paragraphs] }
        : {
            version: x.term_version, draft: String(x.term_version).startsWith('rascunho'), title: 'Termo de recebimento e responsabilidade',
            paragraphs: ['O texto integral desta versão do termo não está disponível nesta versão do sistema; o hash do texto aceito consta nas evidências técnicas.'],
          },
      term_text_sha256: x.term_text_sha256,
      evidence_sha256: x.evidence_sha256,
      signature_sha256: x.signature_sha256,
      ip: x.ip ?? null,
    };
  }

  // Assinatura presencial: sem imagem nem evidência eletrônica. Grava autor, testemunha, motivo e data em
  // epi_in_person_signatures (imutável) e marca as entregas como 'presencial' (signed_by_name = nome do funcionário, como no
  // fluxo eletrônico). Tudo na MESMA transação.
  async registerInPerson(client: PoolClient, dto: InPersonDto, userId: string) {
    // o presencial também depende do termo aprovado (mesmo 409 da criação de link)
    if (!signatureTermAllowed()) throw new ConflictException('O termo de recebimento ainda não foi aprovado para uso');
    const witness = dto.witness_name.trim();
    const reason = dto.reason.trim();
    // o DTO mede o texto bruto (unidades UTF-16); o registro guarda o texto aparado e o CHECK do banco mede caracteres (code points)
    const cp = (t: string) => [...t].length;
    if (cp(witness) < 3 || cp(witness) > 120 || cp(reason) < 5 || cp(reason) > 300) throw new BadRequestException('Informe o nome da testemunha e o motivo');
    await client.query(`SET LOCAL lock_timeout = ${lockTimeoutMs()}`);
    // todas as entregas devem existir sob RLS (outra empresa / não vinculado = inexistente) e ser do MESMO funcionário
    const found = (await client.query('SELECT id, employee_id FROM employee_epi_deliveries WHERE id = ANY($1::uuid[])', [dto.delivery_ids])).rows as { id: string; employee_id: string }[];
    if (found.length !== dto.delivery_ids.length) throw new NotFoundException('Entrega não encontrada');
    const employeeIds = new Set(found.map((f) => f.employee_id));
    if (employeeIds.size !== 1) throw new BadRequestException('As entregas devem ser do mesmo funcionário');
    // mesma ordem de travas da criação: funcionário -> requisições -> entregas
    const emp = (await lockQuery<{ id: string; tenant_id: string; full_name: string }>(
      client, 'SELECT id, tenant_id, full_name FROM employees WHERE id = $1 FOR NO KEY UPDATE', [found[0].employee_id]))[0];
    if (!emp) throw new NotFoundException('Funcionário não encontrado');
    // Revoga os links ativos ANTES de validar o status das entregas. Isso só é seguro porque tudo roda numa única
    // transação: se a validação abaixo falhar (409), o ROLLBACK desfaz a revogação.
    await this.revokeActiveForDeliveries(client, dto.delivery_ids);
    const locked = await lockQuery<{ id: string; signature_status: string }>(
      client, 'SELECT id, signature_status FROM employee_epi_deliveries WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [dto.delivery_ids]);
    if (locked.length !== dto.delivery_ids.length || locked.some((d) => d.signature_status !== 'pendente' && d.signature_status !== 'recusada')) {
      throw new ConflictException('Há entregas que não aguardam assinatura');
    }
    // Registro e itens ANTES do UPDATE: o trigger da entrega só aceita 'presencial' se já houver item (e o COMMIT confere o resto).
    let reg;
    try {
      reg = await client.query(
        `INSERT INTO epi_in_person_signatures (tenant_id, employee_id, witness_name, reason, registered_by_user_id, term_version)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, registered_at`,
        [emp.tenant_id, emp.id, witness, reason, userId, EPI_TERM.version],
      );
      for (const d of dto.delivery_ids) {
        await client.query('INSERT INTO epi_in_person_signature_items (in_person_id, delivery_id) VALUES ($1,$2)', [reg.rows[0].id, d]);
      }
    } catch (err) {
      mapPgError(err);
    }
    const upd = await client.query(
      `UPDATE employee_epi_deliveries SET signature_status = 'presencial', signed_at = now(), signed_by_name = $2
        WHERE id = ANY($1::uuid[]) RETURNING id, employee_id, signature_status, signed_at, signed_by_name`,
      [dto.delivery_ids, emp.full_name],
    );
    return { in_person_id: reg.rows[0].id, registered_at: reg.rows[0].registered_at, deliveries: upd.rows };
  }
}
