import { Body, Controller, Get, Param, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { NormativeDocumentsService } from './normative-documents.service';
import { RejectDocumentDto } from './dto/reject-document.dto';

@Controller('normative-documents')
export class NormativeDocumentsController {
  constructor(private readonly documents: NormativeDocumentsService) {}

  @Roles('admin')
  @Get()
  findAll(@Query('status') status: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.findByStatus(client, status));
  }

  @Roles('admin')
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.findOneWithPrevious(client, id));
  }

  @Roles('admin')
  @Post(':id/approve')
  approve(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.approve(client, id, req.user.id));
  }

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectDocumentDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.reject(client, id, req.user.id, dto.reason));
  }

  @Roles('admin')
  @Post(':id/reindex')
  reindex(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.reindex(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Get(':id/download')
  download(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.getDownloadUrl(client, id));
  }
}
