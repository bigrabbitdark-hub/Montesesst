import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { toDateString } from './committees.service';

export interface CipaElection {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  ano: number;
  data_eleicao: string | null;
  inicio_mandato: string;
  fim_mandato: string;
  status: 'aberta' | 'concluida';
  created_at: string;
  updated_at: string;
}

export interface CipaElectionCandidate {
  id: string;
  election_id: string;
  employee_id: string | null;
  nome_livre: string | null;
  votos: number | null;
  eleito: boolean;
  titular_suplente: 'titular' | 'suplente' | null;
  created_at: string;
  updated_at: string;
}

function normalizeElection(row: CipaElection): CipaElection {
  return {
    ...row,
    data_eleicao: toDateString(row.data_eleicao),
    inicio_mandato: toDateString(row.inicio_mandato) as string,
    fim_mandato: toDateString(row.fim_mandato) as string,
  };
}

@Injectable()
export class ElectionsService {
  async create(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    ano: number,
    dataEleicao: string | undefined,
    inicioMandato: string,
    fimMandato: string,
  ): Promise<CipaElection> {
    // FOR UPDATE em company_units — serializa duas criações quase
    // simultâneas pro mesmo estabelecimento, mesmo raciocínio de
    // AtaAiService.createDraft (Fase 13): sem isso, duas requisições
    // concorrentes passam as duas pela checagem de "já existe eleição
    // aberta" antes de qualquer uma comitar. O índice único parcial
    // (0028_cipa_elections.sql) é o backstop de banco.
    const unitCheck = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [
      companyUnitId,
      tenantId,
    ]);
    if (unitCheck.rowCount === 0) {
      throw new BadRequestException('Estabelecimento inválido para esta empresa');
    }

    const openCheck = await client.query(
      `SELECT 1 FROM cipa_elections WHERE company_unit_id = $1 AND status = 'aberta'`,
      [companyUnitId],
    );
    if ((openCheck.rowCount ?? 0) > 0) {
      throw new ConflictException('Já existe uma eleição aberta para este estabelecimento');
    }

    try {
      const result = await client.query<CipaElection>(
        `INSERT INTO cipa_elections (tenant_id, company_unit_id, ano, data_eleicao, inicio_mandato, fim_mandato)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, companyUnitId, ano, dataEleicao ?? null, inicioMandato, fimMandato],
      );
      return normalizeElection(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, companyUnitId?: string): Promise<CipaElection[]> {
    if (companyUnitId) {
      const result = await client.query<CipaElection>(
        'SELECT * FROM cipa_elections WHERE company_unit_id = $1 ORDER BY created_at DESC',
        [companyUnitId],
      );
      return result.rows.map(normalizeElection);
    }
    const result = await client.query<CipaElection>('SELECT * FROM cipa_elections ORDER BY created_at DESC');
    return result.rows.map(normalizeElection);
  }

  async findOne(client: PoolClient, id: string): Promise<CipaElection> {
    const result = await client.query<CipaElection>('SELECT * FROM cipa_elections WHERE id = $1', [id]);
    const election = result.rows[0];
    if (!election) throw new NotFoundException('Eleição não encontrada');
    return normalizeElection(election);
  }

  async findCandidates(client: PoolClient, electionId: string): Promise<CipaElectionCandidate[]> {
    const result = await client.query<CipaElectionCandidate>(
      'SELECT * FROM cipa_election_candidates WHERE election_id = $1 ORDER BY created_at',
      [electionId],
    );
    return result.rows;
  }

  async addCandidate(
    client: PoolClient,
    electionId: string,
    employeeId: string | undefined,
    nomeLivre: string | undefined,
  ): Promise<CipaElectionCandidate> {
    const electionResult = await client.query<{ status: string; tenant_id: string }>(
      'SELECT status, tenant_id FROM cipa_elections WHERE id = $1',
      [electionId],
    );
    const election = electionResult.rows[0];
    if (!election) throw new NotFoundException('Eleição não encontrada');
    if (election.status === 'concluida') {
      throw new ConflictException('Eleição já concluída — não é possível adicionar candidato');
    }

    // Achado da revisão final: employee_id é client-supplied — sem validar,
    // um id de funcionário de OUTRO tenant passa pelo FK-only (employees
    // existe, só isso, a checagem de FK roda com RLS bypassada) e o
    // conclude() trava pra sempre (COALESCE(emp.full_name, c.nome_livre)
    // vira NULL pro candidato porque o LEFT JOIN roda com RLS, violando
    // cipa_members.nome NOT NULL — 23502 não mapeado, 500 cru). Mesmo
    // padrão de MeetingsService.setParticipants — aqui é só um id, então um
    // SELECT simples basta, sem precisar de ANY($1).
    if (employeeId) {
      const empCheck = await client.query('SELECT id FROM employees WHERE id = $1 AND tenant_id = $2', [
        employeeId,
        election.tenant_id,
      ]);
      if ((empCheck.rowCount ?? 0) === 0) {
        throw new BadRequestException('Funcionário informado não pertence a este tenant');
      }
    }

    try {
      const result = await client.query<CipaElectionCandidate>(
        `INSERT INTO cipa_election_candidates (election_id, employee_id, nome_livre)
         VALUES ($1, $2, $3) RETURNING *`,
        [electionId, employeeId ?? null, nomeLivre ?? null],
      );
      return result.rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async updateCandidate(
    client: PoolClient,
    electionId: string,
    candidateId: string,
    data: { votos?: number; eleito?: boolean; titular_suplente?: string },
  ): Promise<CipaElectionCandidate> {
    const electionResult = await client.query<{ status: string }>(
      'SELECT status FROM cipa_elections WHERE id = $1',
      [electionId],
    );
    const election = electionResult.rows[0];
    if (!election) throw new NotFoundException('Eleição não encontrada');
    if (election.status === 'concluida') {
      throw new ConflictException('Eleição já concluída — não é possível editar candidato');
    }

    const currentResult = await client.query<CipaElectionCandidate>(
      'SELECT * FROM cipa_election_candidates WHERE id = $1 AND election_id = $2 FOR UPDATE',
      [candidateId, electionId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new NotFoundException('Candidato não encontrado');

    // Estado final calculado ANTES de gravar — cobre tanto "manda eleito
    // e titular_suplente juntos" quanto "titular_suplente já estava
    // setado de um PATCH anterior, manda só eleito: true agora".
    // Desmarcar eleito (eleito: false) sempre limpa titular_suplente —
    // não deixa um candidato não-eleito com titular_suplente "fantasma"
    // de antes.
    const finalEleito = data.eleito ?? current.eleito;
    const finalTitularSuplente = data.eleito === false ? null : data.titular_suplente ?? current.titular_suplente;
    if (finalEleito && !finalTitularSuplente) {
      throw new BadRequestException('Candidato eleito precisa de titular_suplente definido');
    }

    // Lista dinâmica de SET — mesmo padrão de MembersService.update, em
    // vez de COALESCE com parâmetro possivelmente `undefined` (o driver
    // `pg` não tem uma conversão undefined→NULL garantida/documentada
    // pra parâmetros de query — mais seguro só incluir no SET o que
    // veio de fato no payload).
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 3;
    if (data.votos !== undefined) {
      setClauses.push(`votos = $${i++}`);
      values.push(data.votos);
    }
    if (data.eleito !== undefined) {
      setClauses.push(`eleito = $${i++}`);
      values.push(data.eleito);
    }
    // titular_suplente grava o valor final calculado acima sempre que
    // `eleito` OU `titular_suplente` vierem no payload — inclusive pra
    // limpar (NULL) quando só `eleito: false` é enviado.
    if (data.eleito !== undefined || data.titular_suplente !== undefined) {
      setClauses.push(`titular_suplente = $${i++}`);
      values.push(finalTitularSuplente);
    }

    if (setClauses.length === 0) {
      return current;
    }

    try {
      const result = await client.query<CipaElectionCandidate>(
        `UPDATE cipa_election_candidates SET ${setClauses.join(', ')} WHERE id = $1 AND election_id = $2 RETURNING *`,
        [candidateId, electionId, ...values],
      );
      return result.rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async conclude(client: PoolClient, electionId: string): Promise<CipaElection> {
    const electionResult = await client.query<CipaElection>(
      'SELECT * FROM cipa_elections WHERE id = $1 FOR UPDATE',
      [electionId],
    );
    const electionRow = electionResult.rows[0];
    if (!electionRow) throw new NotFoundException('Eleição não encontrada');
    if (electionRow.status === 'concluida') {
      throw new ConflictException('Eleição já concluída');
    }
    const election = normalizeElection(electionRow);

    // Defesa em profundidade — updateCandidate já garante isso a cada
    // PATCH, mas concluir não confia cegamente num estado que pode ter
    // sido montado por chamadas fora de ordem.
    const invalidCheck = await client.query(
      `SELECT 1 FROM cipa_election_candidates WHERE election_id = $1 AND eleito = true AND titular_suplente IS NULL LIMIT 1`,
      [electionId],
    );
    if ((invalidCheck.rowCount ?? 0) > 0) {
      throw new BadRequestException('Há candidato eleito sem titular_suplente definido');
    }

    try {
      await client.query(`UPDATE cipa_elections SET status = 'concluida' WHERE id = $1`, [electionId]);
      // INSERT...SELECT único cobre os dois casos de origem do
      // candidato (employee_id ou nome_livre) via COALESCE/LEFT JOIN —
      // sem N+1 de queries pra cada eleito.
      await client.query(
        `INSERT INTO cipa_members (tenant_id, company_unit_id, nome, funcao_cipa, titular_suplente, representacao, inicio_mandato, fim_mandato)
         SELECT $2, $3, COALESCE(emp.full_name, c.nome_livre), 'membro', c.titular_suplente, 'empregados', $4, $5
         FROM cipa_election_candidates c
         LEFT JOIN employees emp ON emp.id = c.employee_id
         WHERE c.election_id = $1 AND c.eleito = true`,
        [electionId, election.tenant_id, election.company_unit_id, election.inicio_mandato, election.fim_mandato],
      );
    } catch (err) {
      mapPgError(err);
    }

    return this.findOne(client, electionId);
  }
}
