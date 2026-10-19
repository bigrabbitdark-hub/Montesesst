import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CertificatesService } from './certificates.service';
import { UploadCertificateDto } from './dto/upload-certificate.dto';
import { Roles } from '../../common/decorators/roles.decorator';

// Limite alinhado com outros controllers que recebem upload de mídias (Cipa, FireSafety,
// PreventionChecklist): 10MB é folgado para um PKCS#12 típico (~5KB) e bloqueia abuso.
// Validação real do conteúdo (.pfx/.p12 válido, senha correta, não expirado) acontece
// dentro do CertificatesService.upload via parsePkcs12 — defesa em profundidade.
const MAX_PFX_BYTES = 10 * 1024 * 1024;

@Controller('esocial/certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Post()
  @Roles('empresa')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PFX_BYTES } }))
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadCertificateDto,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo do certificado (.pfx/.p12) é obrigatório');
    }
    return req.withTenantContext((client: any) =>
      this.certificates.upload(client, file.buffer, dto, req.user.id),
    );
  }

  @Get()
  @Roles('empresa', 'tecnico', 'admin')
  list(@Req() req: any) {
    return req.withTenantContext((client: any) => this.certificates.list(client));
  }

  @Delete(':id')
  @Roles('empresa')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.certificates.remove(client, id));
  }
}