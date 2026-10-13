import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { R2Service } from '../../common/r2/r2.service';
import { parsePkcs12, InvalidCertificateError } from './pkcs12.util';
import { CertificateCryptoService } from './certificate-crypto.service';
import { UploadCertificateDto } from './dto/upload-certificate.dto';

export interface CertificateSummary {
  id: string;
  label: string;
  subjectCn: string;
  subjectDocument: string | null;
  notBefore: string;
  notAfter: string;
  status: string;
  thumbprintSha256: string;
}

function toSummary(row: any): CertificateSummary {
  return {
    id: row.id,
    label: row.label,
    subjectCn: row.subject_cn,
    subjectDocument: row.subject_document,
    notBefore: row.not_before,
    notAfter: row.not_after,
    status: row.status,
    thumbprintSha256: row.thumbprint_sha256,
  };
}

@Injectable()
export class CertificatesService {
  constructor(
    private readonly r2: R2Service,
    // Nomeado certCrypto (não crypto) para não sombrear o módulo nativo `crypto`
    // do Node, usado abaixo em crypto.randomUUID().
    private readonly certCrypto: CertificateCryptoService,
  ) {}

  async upload(
    client: PoolClient,
    pfxBuffer: Buffer,
    dto: UploadCertificateDto,
    userId: string,
  ): Promise<CertificateSummary> {
    let parsed;
    try {
      parsed = parsePkcs12(pfxBuffer, dto.password);
    } catch (err) {
      if (err instanceof InvalidCertificateError) throw new BadRequestException(err.message);
      throw err;
    }

    if (parsed.notAfter.getTime() < Date.now()) {
      throw new BadRequestException('Certificado expirado — envie um certificado válido');
    }

    const sealed = this.certCrypto.seal(pfxBuffer, dto.password);
    const r2Key = `esocial-certificates/${randomUUID()}.pfx.enc`;
    await this.r2.putObject(r2Key, sealed.encryptedPfx, 'application/octet-stream');

    const result = await client.query(
      `INSERT INTO esocial_certificates (
        tenant_id, label, subject_cn, subject_document, thumbprint_sha256,
        not_before, not_after, status, pfx_r2_key, encrypted_password, encrypted_data_key,
        uploaded_by_user_id
      ) VALUES (
        NULLIF(current_setting('app.tenant_id', true), '')::uuid,
        $1, $2, $3, $4, $5, $6, 'ativo', $7, $8, $9, $10
      ) RETURNING *`,
      [
        dto.label, parsed.subjectCn, parsed.subjectDocument, parsed.thumbprintSha256,
        parsed.notBefore, parsed.notAfter, r2Key, sealed.encryptedPassword,
        sealed.encryptedDataKey, userId,
      ],
    );
    return toSummary(result.rows[0]);
  }

  async list(client: PoolClient): Promise<CertificateSummary[]> {
    const result = await client.query(
      `SELECT * FROM esocial_certificates WHERE status <> 'removido' ORDER BY created_at DESC`,
    );
    return result.rows.map(toSummary);
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const result = await client.query(
      `UPDATE esocial_certificates SET status = 'removido' WHERE id = $1 RETURNING id`,
      [id],
    );
    if (result.rowCount === 0) throw new NotFoundException('Certificado não encontrado');
  }

  // Uso interno (Task 15, assinatura de XML) — nunca exposto via controller/resposta HTTP.
  async loadForSigning(client: PoolClient, id: string): Promise<{ certificatePem: string; privateKeyPem: string }> {
    const { pfxBuffer, password } = await this.loadRawPfxForTransmission(client, id);
    const parsed = parsePkcs12(pfxBuffer, password);
    return { certificatePem: parsed.certificatePem, privateKeyPem: parsed.privateKeyPem };
  }

  // Uso interno (Task 18, transmissão mTLS: o https.Agent precisa do .pfx bruto + senha,
  // não do PEM extraído) — nunca exposto via controller/resposta HTTP.
  async loadRawPfxForTransmission(client: PoolClient, id: string): Promise<{ pfxBuffer: Buffer; password: string }> {
    const result = await client.query(
      // E-05: certificado vencido nunca é usado para assinar nem para abrir a conexão mTLS.
      'SELECT pfx_r2_key, encrypted_password, encrypted_data_key FROM esocial_certificates WHERE id = $1 AND status = $2 AND not_after > now()',
      [id, 'ativo'],
    );
    if (result.rows.length === 0) throw new NotFoundException('Certificado ativo e dentro da validade não encontrado');
    const row = result.rows[0];
    const encryptedPfx = await this.r2.getObject(row.pfx_r2_key);
    return this.certCrypto.unseal({
      encryptedPfx: Buffer.isBuffer(encryptedPfx) ? encryptedPfx : Buffer.from(encryptedPfx as any),
      encryptedPassword: row.encrypted_password,
      encryptedDataKey: row.encrypted_data_key,
    });
  }
}
