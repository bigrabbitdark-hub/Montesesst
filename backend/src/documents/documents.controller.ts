import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Roles('empresa', 'tecnico')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File, @Body() dto: CreateDocumentDto, @Req() req: any) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    const user = req.user;
    const tenantId = user.role === 'tecnico' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.documents.upload(client, {
        tenantId,
        category: dto.category,
        title: dto.title,
        expiresAt: dto.expires_at,
        file: {
          buffer: file.buffer,
          mimetype: file.mimetype,
          originalname: file.originalname,
          size: file.size,
        },
        uploadedByUserId: user.id,
        uploadedByRole: user.role,
      }),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if (req.user.role === 'tecnico' && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.documents.findAll(client, tenantId));
  }

  @Get('compliance')
  compliance(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if (req.user.role === 'tecnico' && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.documents.getCompliance(client, tenantId));
  }

  @Get(':id/download')
  download(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.getDownloadUrl(client, id));
  }

  @Roles('empresa', 'tecnico', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    const user = req.user;
    return req.withTenantContext((client: any) =>
      this.documents.remove(client, id, user.id, user.role === 'admin'),
    );
  }
}
