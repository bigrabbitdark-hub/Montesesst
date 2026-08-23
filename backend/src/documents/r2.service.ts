import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Mesmo padrão de fallback já usado em EmailService/MercadoPagoService —
// não deixa a ausência de credencial derrubar o boot da aplicação, a
// falha real acontece na chamada, não na configuração.
@Injectable()
export class R2Service {
  private readonly client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT || 'https://missing-r2-endpoint.example.com',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || 'missing-access-key',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || 'missing-secret-key',
    },
  });

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  }
}
