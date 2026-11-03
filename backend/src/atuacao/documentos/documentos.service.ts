import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { createHash, randomUUID } from 'crypto';
import { R2Service } from '../../common/r2/r2.service';
import { mapPgError } from '../../common/pg-error.util';
import { DOCX_MIME_TYPE } from '../../common/docx/docx-text.util';
import { XLSX_MIME_TYPE } from '../../common/xlsx/xlsx-text.util';
import { verifyFileContent } from '../../common/files/file-content.util';
import {
  AVISO_ASSINATURA_INTERNA,
  MSG_ACAO_NAO_HABILITADA,
  avaliarAcao,
  avaliarCancelamento,
  estadoAposNovaVersao,
  type AvaliacaoAcao,
  type DocAcao,
  type DocStatus,
} from './documento-fluxo';
import type { CreateCorrecaoDto, CreateDocumentoDto, ListDocumentosQuery, UpdateCorrecaoDto } from './dto/documentos.dto';
import { gravarBase, obterBaseEDerivados, listarTecnicosDaEmpresa, traduzirBase, CATEGORIAS_COM_BASE } from './vinculo-base';
import { itensBloqueantesPendentes } from '../checklists/completude';
import {
  atualizarCorrecao, exigirSemPendentes, inserirCorrecao, listarCorrecoes, registrarCorrecao,
} from './correcoes';

// Mesmos tipos aceitos em `documents` (documents.service.ts; lá a constante não é exportada).
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', DOCX_MIME_TYPE, XLSX_MIME_TYPE];
export const MAX_ARQUIVO_BYTES = 10 * 1024 * 1024;
const MSG_ESTADO = 'Ação não permitida no estado atual do documento.';

export type ContextoTx = <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
export type NomeAcao = 'nova_versao' | 'enviar_revisao' | 'devolver' | 'aprovar' | 'assinar' | 'publicar' | 'cancelar';

export interface ArquivoVersao {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

interface RascunhoTravado {
  id: string; tenant_id: string; category: string; title: string; status: DocStatus;
  current_version_id: string | null; company_unit_id: string | null;
  elaboradores_ids: string[]; versao_numero: number | null; versao_sha256: string | null;
  versao_file_key: string | null; versao_file_name: string | null; versao_mime_type: string | null;
  versao_size_bytes: number | null;
}

const MAX_NOME_ARQUIVO = 120;

/** Nome seguro para armazenar: sem caminho, só [A-Za-z0-9._-], até 120 caracteres (mantém a extensão). */
export function sanitizeFileName(name: string): string {
  const base = (name.split(/[/\\]/).pop() ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!base || /^\.+$/.test(base)) throw new BadRequestException('Nome de arquivo inválido');
  if (base.length <= MAX_NOME_ARQUIVO) return base;
  const ext = /\.[A-Za-z0-9]{1,10}$/.exec(base)?.[0] ?? '';
  return base.slice(0, MAX_NOME_ARQUIVO - ext.length) + ext;
}

// Negações por regra do fluxo (matriz, estado, separação, registro): carregam o código para a
// auditoria 'document_draft.denied' feita pelo controller, sem mudar a resposta HTTP.
export type CodigoNegacao = 'MATRIZ' | 'ESTADO' | 'SEPARACAO' | 'REGISTRO';
export class NegacaoForbiddenException extends ForbiddenException {
  constructor(message: string, readonly codigoNegacao: CodigoNegacao, readonly acaoNegada: string) { super(message); }
}
export class NegacaoConflictException extends ConflictException {
  constructor(message: string, readonly codigoNegacao: CodigoNegacao, readonly acaoNegada: string) { super(message); }
}
const conflitoEstado = (msg: string, acao: string) => new NegacaoConflictException(msg, 'ESTADO', acao);

// Colunas do rascunho + da versão atual (autor, hash e arquivo), usadas no bloqueio e no detalhe.
const COLUNAS_RASCUNHO = `d.id, d.tenant_id, d.category, d.title, d.status, d.current_version_id, d.company_unit_id, d.base_draft_id,
  cv.created_at AS versao_em,
  ARRAY(
    SELECT d.created_by
    UNION SELECT vv.created_by FROM document_draft_versions vv WHERE vv.draft_id = d.id
    UNION SELECT ev.actor_user_id FROM document_draft_events ev WHERE ev.draft_id = d.id AND ev.type = 'submitted'
  ) AS elaboradores_ids, cv.version_number AS versao_numero, cv.sha256 AS versao_sha256,
  cv.file_key AS versao_file_key, cv.file_name AS versao_file_name, cv.mime_type AS versao_mime_type,
  cv.size_bytes AS versao_size_bytes`;

/**
 * Ações oferecidas ao usuário: a MESMA função pura `avaliarAcao` das transições, mais a permissão
 * RBAC da rota correspondente. Função pura (sem I/O).
 */
export function calcularAcoesPermitidas(i: {
  rascunho: Pick<RascunhoTravado, 'status' | 'current_version_id' | 'elaboradores_ids'>;
  usuarioId: string;
  matriz: ReadonlySet<string>;
  rbac: ReadonlySet<string>;
  registroConfirmado: boolean;
  assinaturaVigente: boolean;
}): NomeAcao[] {
  const { rascunho: r, usuarioId, matriz, rbac, registroConfirmado, assinaturaVigente } = i;
  const ok = (acao: DocAcao) =>
    avaliarAcao({
      acao, draftStatus: r.status, elaboradoresIds: r.elaboradores_ids ?? [], usuarioId,
      temPermissaoMatriz: matriz.has(acao), registroConfirmado,
    }).ok;
  const out: NomeAcao[] = [];
  if (rbac.has('documents.create_draft') && ok('elaborar')) out.push('nova_versao');
  if (rbac.has('documents.create_draft') && r.status === 'em_elaboracao' && r.current_version_id && ok('elaborar')) out.push('enviar_revisao');
  if (rbac.has('documents.review') && ok('revisar')) out.push('devolver');
  if (rbac.has('documents.approve') && ok('aprovar')) out.push('aprovar');
  if (rbac.has('documents.sign') && ok('assinar')) out.push('assinar');
  if (rbac.has('documents.publish') && assinaturaVigente && ok('publicar')) out.push('publicar');
  if (rbac.has('documents.cancel') && avaliarCancelamento({ draftStatus: r.status, matriz }).ok) out.push('cancelar');
  return out;
}

@Injectable()
export class DocumentosService {
  constructor(private readonly r2: R2Service) {}

  // ---- leitura ---------------------------------------------------------------------------

  async listar(client: PoolClient, f: ListDocumentosQuery) {
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (cond: (n: number) => string, v: unknown) => { params.push(v); where.push(cond(params.length)); };
    if (f.status) add((n) => `d.status = $${n}`, f.status);
    if (f.tenantId) add((n) => `d.tenant_id = $${n}`, f.tenantId);
    if (f.category) add((n) => `d.category = $${n}`, f.category);
    const res = await client.query(
      `SELECT d.id, d.tenant_id, t.name AS tenant_name, d.category, d.title, d.status, d.current_version_id,
              cv.version_number AS versao_atual, d.published_document_id, d.created_by, c.full_name AS created_by_name,
              d.created_at, d.updated_at
         FROM document_drafts d
         JOIN tenants t ON t.id = d.tenant_id
         LEFT JOIN document_draft_versions cv ON cv.id = d.current_version_id
         LEFT JOIN list_socios() c ON c.id = d.created_by
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY d.updated_at DESC, d.id
        LIMIT 200`,
      params,
    );
    return res.rows;
  }

  async obter(client: PoolClient, userId: string, id: string) {
    const cab = await client.query(
      `SELECT ${COLUNAS_RASCUNHO}, t.name AS tenant_name, d.published_document_id, d.created_by,
              c.full_name AS created_by_name, d.created_at, d.updated_at
         FROM document_drafts d
         JOIN tenants t ON t.id = d.tenant_id
         LEFT JOIN document_draft_versions cv ON cv.id = d.current_version_id
         LEFT JOIN list_socios() c ON c.id = d.created_by
        WHERE d.id = $1`,
      [id],
    );
    if (cab.rowCount === 0) throw new NotFoundException('Documento não encontrado');
    const row = cab.rows[0];

    const versoes = await client.query(
      `SELECT v.id, v.version_number, v.file_name, v.mime_type, v.size_bytes, v.sha256, v.note, v.created_by, a.full_name AS created_by_name, v.created_at FROM document_draft_versions v LEFT JOIN list_socios() a ON a.id = v.created_by WHERE v.draft_id = $1 ORDER BY v.version_number`,
      [id],
    );
    const eventos = await client.query(
      `SELECT e.id, e.type, e.version_id, e.actor_user_id, a.full_name AS actor_name, e.note, e.created_at FROM document_draft_events e LEFT JOIN list_socios() a ON a.id = e.actor_user_id WHERE e.draft_id = $1 ORDER BY e.created_at, e.id`,
      [id],
    );
    const sigs = await client.query(
      `SELECT s.id, s.version_id, v.version_number, s.signer_user_id, a.full_name AS signer_name, s.council, s.registration_number, s.uf, s.version_sha256, s.signed_at FROM document_draft_signatures s JOIN document_draft_versions v ON v.id = s.version_id LEFT JOIN list_socios() a ON a.id = s.signer_user_id WHERE s.draft_id = $1 ORDER BY s.signed_at, s.id`,
      [id],
    );
    // Uma assinatura só vale para a versão a que se refere: vigente = é a versão atual.
    // Conselho/número/UF só com documents.view_registration; sem ela, apenas o nome e registro_confirmado
    // (toda assinatura exige registro confirmado no banco).
    const rbac = await this.permissoesRbac(client, userId);
    const veRegistro = rbac.has('documents.view_registration');
    const assinaturas = sigs.rows.map((s) => {
      const { council, registration_number, uf, ...resto } = s;
      return {
        ...resto,
        ...(veRegistro ? { council, registration_number, uf } : {}),
        registro_confirmado: true,
        vigente: s.version_id === row.current_version_id,
      };
    });

    const correcoes = await listarCorrecoes(client, id);
    const matriz = await this.matriz(client, row.category, userId);
    const registro = await this.registroConfirmado(client, userId);
    const acoes = calcularAcoesPermitidas({
      rascunho: row, usuarioId: userId, matriz, rbac,
      registroConfirmado: registro !== null,
      assinaturaVigente: assinaturas.some((s) => s.vigente),
    });

    const vinculo = await obterBaseEDerivados(client, id, row.base_draft_id ?? null, { status: row.status, versao_em: row.versao_em ?? null });

    const {
      elaboradores_ids, versao_numero, versao_sha256, versao_file_key, versao_file_name, versao_mime_type,
      versao_size_bytes, versao_em, ...cabecalho
    } = row;
    void versao_em;
    void elaboradores_ids; void versao_file_key; void versao_file_name; void versao_mime_type; void versao_size_bytes;
    return {
      ...cabecalho,
      versao_atual: versao_numero ?? null,
      versao_atual_sha256: versao_sha256 ?? null,
      versoes: versoes.rows,
      eventos: eventos.rows,
      correcoes,
      correcoes_pendentes: correcoes.filter((c) => c.status === 'aberta' || c.status === 'corrigida').length,
      ...vinculo,
      assinaturas,
      aviso_assinatura: AVISO_ASSINATURA_INTERNA,
      acoes_permitidas: acoes,
    };
  }

  async definirBase(client: PoolClient, userId: string, id: string, baseId: string | null) {
    const d = await this.travar(client, id);
    const matriz = await this.matriz(client, d.category, userId);
    if (!matriz.has('elaborar')) throw new NegacaoForbiddenException(MSG_ACAO_NAO_HABILITADA, 'MATRIZ', 'elaborar');
    if (baseId && !(CATEGORIAS_COM_BASE as readonly string[]).includes(d.category)) {
      throw new BadRequestException('Só LTCAT, LIP e laudo têm PGR-base.');
    }
    if (d.status !== 'em_elaboracao') throw new ConflictException(MSG_ESTADO);
    await gravarBase(client, id, baseId);
    return { id, tenant_id: d.tenant_id, status: d.status, base_draft_id: baseId };
  }

  async tecnicosDaEmpresa(client: PoolClient, tenantId: string) {
    const t = await client.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId]);
    if (t.rowCount === 0) throw new NotFoundException('Empresa não encontrada');
    return listarTecnicosDaEmpresa(client, tenantId);
  }

  async downloadVersao(client: PoolClient, draftId: string, versionId: string): Promise<{ url: string; file_name: string }> {
    // Sob RLS: versão de rascunho de outro tenant (técnico) ou inexistente => 404.
    const v = await client.query<{ file_key: string; file_name: string }>(
      'SELECT file_key, file_name FROM document_draft_versions WHERE id = $1 AND draft_id = $2',
      [versionId, draftId],
    );
    if (v.rowCount === 0) throw new NotFoundException('Versão não encontrada');
    const url = await this.r2.getPresignedDownloadUrl(v.rows[0].file_key);
    return { url, file_name: v.rows[0].file_name };
  }

  // ---- escrita ---------------------------------------------------------------------------

  async criar(client: PoolClient, userId: string, dto: CreateDocumentoDto) {
    const matriz = await this.matriz(client, dto.category, userId);
    if (!matriz.has('elaborar')) throw new NegacaoForbiddenException(MSG_ACAO_NAO_HABILITADA, 'MATRIZ', 'elaborar');
    const t = await client.query('SELECT id FROM tenants WHERE id = $1', [dto.tenant_id]);
    if (t.rowCount === 0) throw new NotFoundException('Cliente não encontrado');
    if (dto.company_unit_id) {
      const u = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2', [dto.company_unit_id, dto.tenant_id]);
      if (u.rowCount === 0) throw new BadRequestException('Filial/matriz inválida para esta empresa');
    }
    let id: string;
    try {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO document_drafts (tenant_id, category, title, company_unit_id, created_by, base_draft_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [dto.tenant_id, dto.category, dto.title, dto.company_unit_id ?? null, userId, dto.base_draft_id ?? null],
      );
      id = ins.rows[0].id;
    } catch (err) {
      if (dto.base_draft_id) traduzirBase(err);
      mapPgError(err);
    }
    await this.evento(client, id, dto.tenant_id, null, userId, 'created', null);
    return this.obter(client, userId, id);
  }

  /**
   * Nova versão em fases, sem segurar conexão nem o lock do rascunho durante a rede:
   *  1. transação curta: trava, avalia ação/estado (nada toca o R2 se negado);
   *  2. fora de transação: valida o arquivo, calcula o SHA-256 e envia ao R2 (chave só com uuid);
   *  3. transação curta: trava de novo, revalida, calcula version_number, grava versão, rascunho e evento.
   * Falha na fase 3 apaga o objeto enviado (best-effort).
   */
  async novaVersao(ctx: ContextoTx, userId: string, id: string, file: ArquivoVersao, note?: string | null) {
    const pre = await ctx(async (client) => {
      const d = await this.travar(client, id);
      await this.exigir(client, userId, d, 'elaborar');
      this.novoEstado(d.status);
      return d;
    });

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Tipo de arquivo não permitido (só PDF, JPG, PNG, DOCX ou XLSX)');
    }
    if (!file.buffer || file.buffer.length === 0) throw new BadRequestException('Arquivo vazio');
    if (file.buffer.length > MAX_ARQUIVO_BYTES) throw new BadRequestException('Arquivo maior que 10 MB');
    const problema = await verifyFileContent(file.buffer, file.mimetype);
    if (problema) throw new BadRequestException(problema);
    const nome = sanitizeFileName(file.originalname);

    // Cadeia de custódia: o hash vem do conteúdo recebido, nunca do cliente.
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const fileKey = `documents-fluxo/${pre.tenant_id}/${id}/${randomUUID()}`;
    const nota = note?.trim() || null;

    await this.r2.putObject(fileKey, file.buffer, file.mimetype);
    try {
      await ctx(async (client) => {
        const d = await this.travar(client, id);
        await this.exigir(client, userId, d, 'elaborar');
        const novoEstado = this.novoEstado(d.status);
        const prox = await client.query<{ proximo: number }>(
          'SELECT COALESCE(MAX(version_number), 0) + 1 AS proximo FROM document_draft_versions WHERE draft_id = $1',
          [id],
        );
        const ins = await client.query<{ id: string }>(
          `INSERT INTO document_draft_versions (draft_id, tenant_id, version_number, file_key, file_name, mime_type, size_bytes, sha256, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [id, d.tenant_id, Number(prox.rows[0].proximo), fileKey, nome, file.mimetype, file.buffer.length, sha256, nota, userId],
        );
        const versionId = ins.rows[0].id;
        // Nova versão invalida revisão/aprovação/assinatura anteriores: o estado volta a
        // em_elaboracao; as linhas antigas permanecem (só valem para a versão a que se referem).
        await client.query('UPDATE document_drafts SET current_version_id = $2, status = $3 WHERE id = $1', [id, versionId, novoEstado]);
        await this.evento(client, id, d.tenant_id, versionId, userId, 'version_added', nota);
      });
    } catch (err) {
      // O objeto já está no R2; sem isto ele ficaria órfão se a transação falhar.
      try { await this.r2.deleteObject(fileKey); } catch { /* best-effort */ }
      mapPgError(err);
    }
    return ctx((client) => this.obter(client, userId, id));
  }

  async enviarRevisao(client: PoolClient, userId: string, id: string) {
    const d = await this.travar(client, id);
    if (d.status !== 'em_elaboracao') throw conflitoEstado(MSG_ESTADO, 'enviar_revisao');
    await this.exigir(client, userId, d, 'elaborar');
    if (!d.current_version_id) throw conflitoEstado('Envie ao menos uma versão antes de enviar para revisão.', 'enviar_revisao');
    const faltam = await itensBloqueantesPendentes(client, d.id);
    if (faltam > 0) {
      throw conflitoEstado(`Checklist incompleto: ${faltam === 1 ? '1 item obrigatório sem resposta' : `${faltam} itens obrigatórios sem resposta`}.`, 'enviar_revisao');
    }
    return this.transicionar(client, userId, d, 'em_revisao', 'submitted', null);
  }

  // A nota vira a descrição de uma correção estruturada (E2). Responsável padrão = autor da versão atual
  // (ou, sem versão, quem criou o rascunho); prazo opcional.
  async devolver(client: PoolClient, userId: string, id: string, note: string, extra: { responsavelId?: string; prazo?: string } = {}) {
    const d = await this.travar(client, id);
    await this.exigir(client, userId, d, 'revisar');
    const nota = this.notaObrigatoria(note);
    const responsavel = extra.responsavelId ?? (await this.autorDaVersaoAtual(client, d)) ?? userId;
    await inserirCorrecao(client, d, {
      descricao: nota, origem: 'revisao', solicitadoPor: userId, responsavel, prazo: extra.prazo ?? null,
    });
    return this.transicionar(client, userId, d, 'em_elaboracao', 'returned', nota);
  }

  private async autorDaVersaoAtual(client: PoolClient, d: RascunhoTravado): Promise<string | null> {
    if (!d.current_version_id) return null;
    const r = await client.query<{ created_by: string }>('SELECT created_by FROM document_draft_versions WHERE id = $1', [d.current_version_id]);
    return r.rows[0]?.created_by ?? null;
  }

  async registrarCorrecao(client: PoolClient, userId: string, id: string, dto: CreateCorrecaoDto) {
    const d = await this.travar(client, id);
    if (d.status === 'publicado' || d.status === 'cancelado') throw conflitoEstado(MSG_ESTADO, 'corrigir');
    await registrarCorrecao(client, userId, d, dto);
    return this.obter(client, userId, id);
  }

  async atualizarCorrecao(client: PoolClient, userId: string, id: string, correcaoId: string, dto: UpdateCorrecaoDto) {
    const d = await this.travar(client, id);
    const rbac = await this.permissoesRbac(client, userId);
    await atualizarCorrecao(client, userId, rbac, d.id, correcaoId, dto);
    return this.obter(client, userId, id);
  }

  async aprovar(client: PoolClient, userId: string, id: string) {
    const d = await this.travar(client, id);
    await this.exigir(client, userId, d, 'aprovar');
    await exigirSemPendentes(client, d.id, (m) => conflitoEstado(m, 'aprovar'));
    return this.transicionar(client, userId, d, 'aprovado', 'approved', null);
  }

  async assinar(client: PoolClient, userId: string, id: string, origem: { ip?: string | null; userAgent?: string | null }) {
    const d = await this.travar(client, id);
    const registro = await this.exigir(client, userId, d, 'assinar');
    if (!registro || !d.current_version_id || !d.versao_sha256) throw conflitoEstado(MSG_ESTADO, 'assinar');
    await exigirSemPendentes(client, d.id, (m) => conflitoEstado(m, 'assinar'));
    try {
      await client.query(
        `INSERT INTO document_draft_signatures
           (draft_id, tenant_id, version_id, signer_user_id, registration_id, council, registration_number, uf, version_sha256, ip, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id, d.tenant_id, d.current_version_id, userId, registro.id, registro.council, registro.registration_number,
          registro.uf, d.versao_sha256, (origem.ip ?? null)?.slice(0, 64) ?? null, (origem.userAgent ?? null)?.slice(0, 300) ?? null,
        ],
      );
    } catch (err) {
      mapPgError(err);
    }
    return this.transicionar(client, userId, d, 'assinado', 'signed', null);
  }

  /**
   * Publicação em DUAS fases, para não segurar conexão do pool durante rede (R2):
   *  1. transação curta: trava o rascunho, avalia a ação e confere a assinatura da versão atual;
   *  2. FORA de transação: lê o objeto da versão, confere o SHA-256 registrado e copia para uma
   *     chave NOVA no padrão de `documents` (a chave da versão no fluxo nunca muda nem é apagada,
   *     pois `DocumentsService.remove` apagaria o objeto pela file_key);
   *  3. transação curta: trava de novo, revalida estado e versão, grava publish_file_key, insere
   *     em `documents` com a chave nova, marca `publicado` e registra o evento.
   * Falha na fase 3 apaga a cópia (best-effort). Nova chamada após falha parcial gera outra chave:
   * nada é duplicado em `documents` (a fase 3 é atômica) e nada se perde (a versão segue intacta).
   */
  async publicar(ctx: ContextoTx, userId: string, id: string, expiresAt?: string | null) {
    const prep = await ctx(async (client) => {
      const d = await this.travar(client, id);
      await this.exigir(client, userId, d, 'publicar');
      await this.exigirAssinaturaVigente(client, d);
      await exigirSemPendentes(client, d.id, (m) => conflitoEstado(m, 'publicar'));
      return d;
    });
    if (!prep.versao_file_key || !prep.versao_sha256) throw conflitoEstado(MSG_ESTADO, 'publicar');

    const corpo = await this.r2.getObject(prep.versao_file_key);
    if (createHash('sha256').update(corpo).digest('hex') !== prep.versao_sha256) {
      throw new ConflictException('O arquivo da versão não confere com o hash registrado.');
    }
    const documentId = randomUUID();
    const novaChave = `tenants/${prep.tenant_id}/documents/${documentId}/${sanitizeFileName(prep.versao_file_name ?? 'arquivo')}`;
    await this.r2.putObject(novaChave, corpo, prep.versao_mime_type ?? 'application/octet-stream');
    try {
      return await ctx((client) => this.gravarPublicacao(client, userId, id, prep.current_version_id, documentId, novaChave, expiresAt));
    } catch (err) {
      try { await this.r2.deleteObject(novaChave); } catch { /* best-effort */ }
      throw err;
    }
  }

  private async exigirAssinaturaVigente(client: PoolClient, d: RascunhoTravado) {
    if (!d.current_version_id) throw conflitoEstado(MSG_ESTADO, 'publicar');
    const sig = await client.query('SELECT 1 FROM document_draft_signatures WHERE draft_id = $1 AND version_id = $2 LIMIT 1', [d.id, d.current_version_id]);
    if (sig.rowCount === 0) throw conflitoEstado('A versão atual não possui registro de assinatura interna.', 'publicar');
  }

  private async gravarPublicacao(
    client: PoolClient, userId: string, id: string, versionId: string | null, documentId: string,
    novaChave: string, expiresAt?: string | null,
  ) {
    const d = await this.travar(client, id);
    await this.exigir(client, userId, d, 'publicar');
    if (d.current_version_id !== versionId) throw conflitoEstado('A versão mudou durante a publicação; tente novamente.', 'publicar');
    await this.exigirAssinaturaVigente(client, d);
    await exigirSemPendentes(client, d.id, (m) => conflitoEstado(m, 'publicar'));
    // Ordem obrigatória (trigger trg_a_guard_documents_socio_publish): com o rascunho ainda
    // 'assinado' e publish_file_key definido, insere-se o documento; só depois o rascunho vira 'publicado'.
    try {
      await client.query('UPDATE document_drafts SET publish_file_key = $2 WHERE id = $1', [id, novaChave]);
      await client.query(
        `INSERT INTO documents (id, tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role, company_unit_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'socio',$11)`,
        [
          documentId, d.tenant_id, d.category, d.title, novaChave, d.versao_file_name, d.versao_mime_type,
          d.versao_size_bytes, expiresAt ?? null, userId, d.company_unit_id,
        ],
      );
      await client.query('UPDATE document_drafts SET status = $2, published_document_id = $3 WHERE id = $1', [id, 'publicado', documentId]);
    } catch (err) {
      mapPgError(err);
    }
    await this.evento(client, id, d.tenant_id, d.current_version_id, userId, 'published', null);
    return this.obter(client, userId, id);
  }

  async cancelar(client: PoolClient, userId: string, id: string, note: string) {
    const d = await this.travar(client, id);
    const matriz = await this.matriz(client, d.category, userId);
    const av = avaliarCancelamento({ draftStatus: d.status, matriz });
    if (!av.ok) throw this.negar(av, 'cancelar');
    const nota = `(origem: ${d.status}) ${this.notaObrigatoria(note)}`;
    return this.transicionar(client, userId, d, 'cancelado', 'cancelled', nota);
  }

  // ---- internos --------------------------------------------------------------------------

  private async travar(client: PoolClient, id: string): Promise<RascunhoTravado> {
    const r = await client.query<RascunhoTravado>(
      `SELECT ${COLUNAS_RASCUNHO}
         FROM document_drafts d
         LEFT JOIN document_draft_versions cv ON cv.id = d.current_version_id
        WHERE d.id = $1
          FOR UPDATE OF d`,
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Documento não encontrado');
    return r.rows[0];
  }

  private async matriz(client: PoolClient, category: string, userId: string): Promise<Set<string>> {
    // Só as linhas do próprio usuário (a RLS do socio já restringe a isso).
    const r = await client.query<{ action: string }>(
      'SELECT action FROM document_type_permissions WHERE category = $1 AND user_id = $2',
      [category, userId],
    );
    return new Set(r.rows.map((x) => x.action));
  }

  private async permissoesRbac(client: PoolClient, userId: string): Promise<Set<string>> {
    const r = await client.query<{ permission: string }>('SELECT permission FROM socio_permissions WHERE user_id = $1', [userId]);
    return new Set(r.rows.map((x) => x.permission));
  }

  private async registroConfirmado(client: PoolClient, userId: string) {
    const r = await client.query<{ id: string; council: string; registration_number: string; uf: string }>(
      `SELECT id, council, registration_number, uf FROM professional_registrations
        WHERE user_id = $1 AND status = 'confirmado' ORDER BY confirmed_at DESC, id LIMIT 1`,
      [userId],
    );
    return r.rows[0] ?? null;
  }

  // estado -> matriz -> separação de funções -> registro (ordem de avaliarAcao). Devolve o registro
  // confirmado quando a ação é 'assinar' (para o snapshot).
  private async exigir(client: PoolClient, userId: string, d: RascunhoTravado, acao: DocAcao) {
    const matriz = await this.matriz(client, d.category, userId);
    const registro = acao === 'assinar' ? await this.registroConfirmado(client, userId) : null;
    const r = avaliarAcao({
      acao, draftStatus: d.status, elaboradoresIds: d.elaboradores_ids ?? [], usuarioId: userId,
      temPermissaoMatriz: matriz.has(acao), registroConfirmado: registro !== null,
    });
    if (!r.ok) throw this.negar(r, acao);
    return registro;
  }

  private negar(r: Extract<AvaliacaoAcao, { ok: false }>, acao: string) {
    return r.codigo === 'MATRIZ' || r.codigo === 'REGISTRO'
      ? new NegacaoForbiddenException(r.mensagem, r.codigo, acao)
      : new NegacaoConflictException(r.mensagem, r.codigo, acao);
  }

  private novoEstado(status: DocStatus): DocStatus {
    try {
      return estadoAposNovaVersao(status);
    } catch {
      throw conflitoEstado(MSG_ESTADO, 'elaborar');
    }
  }

  private notaObrigatoria(note: string | null | undefined): string {
    const n = note?.trim();
    if (!n) throw new BadRequestException('Informe a nota (motivo).');
    return n;
  }

  private async transicionar(
    client: PoolClient, userId: string, d: RascunhoTravado, para: DocStatus,
    tipo: 'submitted' | 'returned' | 'approved' | 'signed' | 'cancelled', nota: string | null,
  ) {
    // O evento (e, em 'assinar', a assinatura) entra ANTES da mudança de status: os triggers de
    // document_drafts exigem a evidência da versão atual para entrar em aprovado/assinado.
    await this.evento(client, d.id, d.tenant_id, d.current_version_id, userId, tipo, nota);
    await client.query('UPDATE document_drafts SET status = $2 WHERE id = $1', [d.id, para]);
    return this.obter(client, userId, d.id);
  }

  // created_at = clock_timestamp() mantém a ordem dos eventos dentro da mesma transação.
  private async evento(
    client: PoolClient, draftId: string, tenantId: string, versionId: string | null, actorId: string,
    tipo: 'created' | 'version_added' | 'submitted' | 'returned' | 'approved' | 'signed' | 'published' | 'cancelled',
    nota: string | null,
  ) {
    await client.query(
      `INSERT INTO document_draft_events (draft_id, tenant_id, version_id, actor_user_id, type, note, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp())`,
      [draftId, tenantId, versionId, actorId, tipo, nota],
    );
  }
}
