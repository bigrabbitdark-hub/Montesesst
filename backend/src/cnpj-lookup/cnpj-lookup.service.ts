import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isValidCnpj, onlyDigits } from '../common/validators/cnpj.util';

export interface CnpjLookupResult {
  cnpj: string;
  razao_social: string | null;
  situacao: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  cnae_code: string | null;
  cnae_description: string | null;
}

// Fonte: BrasilAPI (gratuita, sem chave) — espelha a base cadastral da Receita
// Federal. Sem biblioteca nova: usa o fetch nativo do Node.
const BRASILAPI_URL = 'https://brasilapi.com.br/api/cnpj/v1';
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

// Limites iguais aos do UpdateTenantDto — a resposta externa nunca entra no
// formulário maior do que o servidor aceitaria depois.
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function digits(value: unknown, length: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const only = String(value).replace(/\D/g, '');
  return only.length === length ? only : null;
}

function uf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}

export function normalizeBrasilApiPayload(cnpj: string, payload: unknown): CnpjLookupResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ServiceUnavailableException('Resposta inesperada da fonte de dados cadastrais.');
  }
  const p = payload as Record<string, unknown>;
  return {
    cnpj,
    razao_social: text(p.razao_social, 200),
    situacao: text(p.descricao_situacao_cadastral, 50),
    address_street: text(p.logradouro, 200),
    address_number: text(p.numero, 20),
    address_complement: text(p.complemento, 200),
    address_neighborhood: text(p.bairro, 100),
    address_city: text(p.municipio, 100),
    address_state: uf(p.uf),
    address_zip: digits(p.cep, 8),
    cnae_code: digits(p.cnae_fiscal, 7),
    cnae_description: text(p.cnae_fiscal_descricao, 300),
  };
}

@Injectable()
export class CnpjLookupService {
  private readonly logger = new Logger(CnpjLookupService.name);
  private readonly cache = new Map<string, { expiresAt: number; value: CnpjLookupResult }>();

  async lookup(rawCnpj: string): Promise<CnpjLookupResult> {
    const cnpj = onlyDigits(rawCnpj ?? '');
    if (!isValidCnpj(cnpj)) throw new BadRequestException('CNPJ inválido.');

    const cached = this.cache.get(cnpj);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const value = await this.fetchFromSource(cnpj);
    this.remember(cnpj, value);
    return value;
  }

  private async fetchFromSource(cnpj: string): Promise<CnpjLookupResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${BRASILAPI_URL}/${cnpj}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'MonteseSST/1.0' },
      });
      if (res.status === 404 || res.status === 400) {
        throw new NotFoundException('Empresa não encontrada para este CNPJ.');
      }
      if (res.status === 429) {
        throw new HttpException(
          'Limite de consultas da fonte de dados atingido. Tente novamente em alguns minutos.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (!res.ok) {
        // Só o status — nunca o CNPJ nem o corpo da resposta nos logs.
        this.logger.warn(`Fonte de CNPJ respondeu HTTP ${res.status}`);
        throw new ServiceUnavailableException('Fonte de dados cadastrais indisponível no momento.');
      }
      const payload: unknown = await res.json().catch(() => null);
      return normalizeBrasilApiPayload(cnpj, payload);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Falha ao consultar a fonte de CNPJ: ${(err as Error).name}`);
      throw new ServiceUnavailableException('Fonte de dados cadastrais indisponível no momento.');
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(cnpj: string, value: CnpjLookupResult): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(cnpj, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  }
}
