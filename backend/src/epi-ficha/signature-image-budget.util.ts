// Orçamento TOTAL de imagens de assinatura por emissão da ficha. O pdfkit decodifica e recomprime cada PNG RGBA de forma
// custosa (100 imagens 2000x1000 chegaram a ~10 s de CPU e ~1 GB de RSS), e isso roda sob a trava do funcionário e com a
// conexão do pool presa. Por isso, além do teto por imagem, há um teto somado de megapixels e de bytes lidos.
import { ihdrSize } from '../common/pdf/safe-png.util';
import { sha256Hex } from './canonical-json.util';

export const MAX_IMAGE_BYTES = 256 * 1024; // um objeto maior que isso nunca é um canonical válido (MAX_CANONICAL_BYTES)
export const MAX_TOTAL_PIXELS = 12_000_000; // 12 megapixels somados (largura*altura lida do IHDR)
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024; // 8 MB lidos do R2

export interface ImageRead {
  receipt_code: string;
  signature_sha256: string; // hash esperado (epi_signatures.signature_sha256)
  buf: Buffer | null; // null = ausente no R2
}

export interface ImageSelection {
  included: Map<string, Buffer>; // imagens conferidas e dentro do orçamento
  unavailable: string[]; // ausente, grande demais, hash divergente ou cabeçalho implausível
  omitted: string[]; // íntegras, mas fora do orçamento do documento ("imagem não incluída (limite do documento)")
}

// Ordem dos itens = ordem do anexo. Ordem das checagens: tamanho do objeto (ANTES do SHA-256, para não hashear lixo grande),
// hash, cabeçalho, orçamento. O orçamento de bytes conta tudo o que foi lido; estourou, o restante fica omitido.
export function selectImagesWithinBudget(reads: ImageRead[]): ImageSelection {
  const out: ImageSelection = { included: new Map(), unavailable: [], omitted: [] };
  let pixels = 0;
  let bytes = 0;
  for (const r of reads) {
    if (!r.buf) { out.unavailable.push(r.receipt_code); continue; }
    if (r.buf.length > MAX_IMAGE_BYTES) { out.unavailable.push(r.receipt_code); continue; }
    bytes += r.buf.length;
    if (bytes > MAX_TOTAL_BYTES) { out.omitted.push(r.receipt_code); continue; }
    if (sha256Hex(r.buf) !== r.signature_sha256) { out.unavailable.push(r.receipt_code); continue; }
    const dims = ihdrSize(r.buf);
    if (!dims) { out.unavailable.push(r.receipt_code); continue; }
    const px = dims.width * dims.height;
    if (pixels + px > MAX_TOTAL_PIXELS) { out.omitted.push(r.receipt_code); continue; }
    pixels += px;
    out.included.set(r.receipt_code, r.buf);
  }
  return out;
}
