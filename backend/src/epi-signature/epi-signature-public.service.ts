import {
  BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable, Logger,
  NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../common/database/database.service';
import { R2Service } from '../common/r2/r2.service';
import { sha256Hex } from '../epi-ficha/canonical-json.util';
import { EPI_TERM } from '../epi-ficha/epi-ficha-term';
import { PublicRefuseDto } from './dto/public-refuse.dto';
import { PublicSignDto } from './dto/public-sign.dto';
import { hashPin, hashToken, signatureTermAllowed, termTextSha256 } from './signature-secrets.util';
import { validateSignaturePng } from './signature-png.util';

// Mensagem ÚNICA para link inexistente, expirado, usado ou revogado: não revela qual dos casos ocorreu.
export const INVALID_LINK = 'Link inválido ou expirado';

const envMs = (name: string, def: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
};

// Rotas PÚBLICAS (sem JWT): o link e o código são a única credencial. Sem contexto de empresa (não há usuário); todo
// acesso a dados passa pelas funções SECURITY DEFINER epi_sig_* da migration 0083, que filtram por token/código e
// nunca devolvem CPF. Nada aqui registra token, código, base64 ou CPF em log.
@Injectable()
export class EpiSignaturePublicService {
  private readonly logger = new Logger(EpiSignaturePublicService.name);

  constructor(private readonly db: DatabaseService, private readonly r2: R2Service) {}

  async peek(token: string): Promise<{ usable: boolean; company_name?: string }> {
    const r = await this.db.withoutTenantContext((c) => c.query('SELECT * FROM epi_sig_peek($1)', [hashToken(token)]));
    return r.rows[0]?.usable ? { usable: true, company_name: r.rows[0].company_name } : { usable: false };
  }

  async open(token: string, code: string) {
    const r = await this.callOpen(token, code);
    return {
      employee_name: r.employee_name,
      expires_at: r.expires_at,
      items: r.items,
      term: { version: EPI_TERM.version, draft: EPI_TERM.draft, title: EPI_TERM.title, paragraphs: EPI_TERM.paragraphs },
      attempts_left: r.attempts_left,
    };
  }

  async sign(dto: PublicSignDto, ctx: { ip: string; userAgent: string }) {
    if (!signatureTermAllowed()) throw new ConflictException('Assinatura indisponível: o termo ainda não foi aprovado');
    if (dto.term_version !== EPI_TERM.version) throw new BadRequestException('Termo desatualizado: recarregue a página');
    if (dto.accepted !== true) throw new BadRequestException('É necessário aceitar o termo');
    // Link inexistente/expirado/usado/revogado -> 404 uniforme ANTES de gastar CPU decodificando o base64 e validando o PNG
    // (50-90 ms síncronos): quem não tem um link utilizável não consegue forçar esse custo. Não conta tentativa.
    if (!(await this.peek(dto.token)).usable) throw new NotFoundException(INVALID_LINK);
    // base64 estrito: Buffer.from é tolerante e ignoraria lixo; o comprimento tem de ser múltiplo de 4
    if (dto.signature_png_base64.length % 4 !== 0) throw new BadRequestException('Imagem da assinatura inválida');
    const png = Buffer.from(dto.signature_png_base64, 'base64');
    // 400 antes de gastar tentativa ou chamar o R2. Só o PNG canônico (regravado pelo validador) é guardado e hasheado:
    // nada do que o cliente enviou vai para o R2 nem para a evidência.
    const { canonical } = validateSignaturePng(png);

    const tokenHash = hashToken(dto.token);
    const pinHash = hashPin(dto.token, dto.code);
    // 1) confere token+código (conta tentativa se errado) e obtém o tenant para a chave do R2
    const o = await this.callOpen(dto.token, dto.code);
    // 2) imagem no R2 (chave imprevisível), com prazo. Falha: 502 e o link continua utilizável (nada foi consumido).
    const key = `tenants/${o.tenant_id}/epi-signatures/${randomUUID()}.png`;
    const put = this.putWithTimeout(key, canonical);
    try {
      await put.promise;
    } catch (err) {
      this.logger.error(`Falha ao gravar a assinatura no R2: ${(err as Error).message === 'timeout' ? 'tempo esgotado' : 'erro'}`);
      // o PUT pode ainda estar em voo (estouro do prazo): só apaga DEPOIS que ele liquidar, sem bloquear a resposta
      void put.settled.then(() => this.bestEffortDelete(key)).catch(() => undefined);
      throw new BadGatewayException('Não foi possível guardar a assinatura; tente novamente');
    }
    // 3) grava evidência e atualiza as entregas (atômico no banco); quem perde a corrida ou falha remove a imagem
    let s: any;
    try {
      s = (
        await this.db.withoutTenantContext((c) =>
          c.query('SELECT * FROM epi_sig_sign($1,$2,$3,$4,$5,$6,$7)', [tokenHash, pinHash, true, key, sha256Hex(canonical), ctx.ip, ctx.userAgent]),
        )
      ).rows[0];
    } catch (err) {
      // ambíguo: o banco pode ter comitado antes do erro. NÃO apaga (apagar poderia deixar a evidência sem imagem).
      this.logger.error(`Erro ao gravar a evidência; possível imagem órfã no R2: ${key}`);
      throw err;
    }
    if (!s || s.result !== 'ok') {
      await this.bestEffortDelete(key);
      this.throwIfNotOk({ result: s?.result ?? 'invalid', attempts_left: 0 });
    }
    return { receipt_code: s.receipt_code, signed_at: s.signed_at, evidence_sha256: s.evidence_sha256 };
  }

  async refuse(dto: PublicRefuseDto) {
    const r = (
      await this.db.withoutTenantContext((c) =>
        c.query('SELECT * FROM epi_sig_refuse($1,$2,$3)', [hashToken(dto.token), hashPin(dto.token, dto.code), dto.reason ?? null]),
      )
    ).rows[0];
    this.throwIfNotOk(r);
    return { status: 'recusada' };
  }

  // epi_sig_open + validações comuns. Devolve a linha só se o resultado for ok e o termo da requisição for o vigente.
  private async callOpen(token: string, code: string): Promise<any> {
    const r = (
      await this.db.withoutTenantContext((c) => c.query('SELECT * FROM epi_sig_open($1,$2)', [hashToken(token), hashPin(token, code)]))
    ).rows[0];
    this.throwIfNotOk(r);
    // termo desatualizado (versão OU hash do texto diferente do vigente): link inválido do ponto de vista do cliente
    if (r.term_version !== EPI_TERM.version || r.term_text_sha256 !== termTextSha256()) throw new NotFoundException(INVALID_LINK);
    return r;
  }

  private throwIfNotOk(r: { result?: string; attempts_left?: number } | undefined): void {
    switch (r?.result) {
      case 'ok':
        return;
      case 'wrong_code':
        throw new UnauthorizedException({ statusCode: 401, message: 'Código incorreto', error: 'Unauthorized', attempts_left: r.attempts_left });
      case 'locked':
        throw new ForbiddenException('Link bloqueado por tentativas incorretas');
      case 'conflict':
        throw new ConflictException('Estas entregas já foram tratadas');
      case 'not_accepted':
        throw new BadRequestException('É necessário aceitar o termo');
      default: // 'invalid' e qualquer resultado inesperado: mesma resposta uniforme
        throw new NotFoundException(INVALID_LINK);
    }
  }

  // Remove um arquivo do R2 sem nunca lançar e sem esperar além do prazo. Falha ou estouro só gera log (sem dado pessoal).
  private async bestEffortDelete(key: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), envMs('EPI_FICHA_R2_TIMEOUT_MS', 8000));
    });
    try {
      const del = Promise.resolve().then(() => this.r2.deleteObject(key)).then(() => 'ok' as const, () => 'erro' as const);
      const r = await Promise.race([del, timeout]);
      if (r !== 'ok') this.logger.error(`Arquivo órfão possível no R2 (${r === 'timeout' ? 'tempo esgotado' : 'erro'}): ${key}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // `promise` rejeita no erro ou no estouro do prazo; `settled` só resolve quando o PUT de fato terminou (ok ou erro).
  private putWithTimeout(key: string, png: Buffer): { promise: Promise<void>; settled: Promise<void> } {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error('timeout')), envMs('EPI_FICHA_R2_TIMEOUT_MS', 8000));
    });
    const put = Promise.resolve().then(() => this.r2.putObject(key, png, 'image/png'));
    const settled = put.then(() => undefined, () => undefined); // a promessa perdedora não gera unhandled rejection
    const promise = Promise.race([put, timeout]).finally(() => clearTimeout(timer));
    promise.catch(() => undefined);
    return { promise, settled };
  }
}
