import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { ReferenceDocumentsService } from './reference-documents.service';
import { CreateReferenceDocumentDto } from './dto/create-reference-document.dto';
import { RejectDocumentDto } from '../normative/dto/reject-document.dto';

@Controller('reference-documents')
export class ReferenceDocumentsController {
  constructor(private readonly referenceDocuments: ReferenceDocumentsService) {}

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateReferenceDocumentDto,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    return req.withTenantContext((client: any) =>
      this.referenceDocuments.create(client, {
        title: dto.title,
        category: dto.category,
        originNote: dto.origin_note,
        file: { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname },
        uploadedByUserId: req.user.id,
      }),
    );
  }

  @Roles('admin')
  @Get()
  findAll(@Query('status') status: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.referenceDocuments.findByStatus(client, status));
  }

  @Roles('admin')
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.referenceDocuments.findOne(client, id));
  }

  // Mesmo motivo da divisão em 3 chamadas de NormativeDocumentsController.approve
  // (ver comentário lá): nunca segurar conexão do pool durante a chamada de
  // embedding, que é HTTP externa e lenta.
  @Roles('admin')
  @Post(':id/approve')
  async approve(@Param('id') id: string, @Req() req: any) {
    const doc = await req.withTenantContext((client: any) => this.referenceDocuments.prepareApproval(client, id));
    const embeddedChunks = await this.referenceDocuments.computeEmbeddedChunks(doc.raw_text);
    return req.withTenantContext((client: any) =>
      this.referenceDocuments.finalizeApproval(client, id, req.user.id, embeddedChunks),
    );
  }

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectDocumentDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.referenceDocuments.reject(client, id, req.user.id, dto.reason));
  }

  @Roles('admin')
  @Post(':id/reindex')
  async reindex(@Param('id') id: string, @Req() req: any) {
    const doc = await req.withTenantContext((client: any) => this.referenceDocuments.prepareReindex(client, id));
    const embeddedChunks = await this.referenceDocuments.computeEmbeddedChunks(doc.raw_text);
    return req.withTenantContext((client: any) => this.referenceDocuments.finalizeReindex(client, id, embeddedChunks));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Get(':id/download')
  download(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.referenceDocuments.getDownloadUrl(client, id));
  }
}
