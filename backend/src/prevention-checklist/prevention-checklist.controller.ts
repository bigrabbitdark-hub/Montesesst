import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { PreventionChecklistService } from './prevention-checklist.service';
import { CreatePreventionChecklistDto } from './dto/create-prevention-checklist.dto';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';

@Controller('prevention-checklists')
export class PreventionChecklistController {
  constructor(private readonly checklists: PreventionChecklistService) {}

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreatePreventionChecklistDto, @Req() req: any) {
    const user = req.user;
    const tenantId = dto.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.checklists.create(client, tenantId, dto.company_unit_id, user.id, dto.data_realizacao),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.checklists.findAll(client, tenantId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.checklists.findOne(client, id));
  }

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) => this.checklists.updateItem(client, id, itemId, dto));
  }

  @Roles('tecnico', 'parceiro')
  @Post(':id/items/:itemId/foto')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadItemPhoto(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    return req.withTenantContext((client: any) => this.checklists.uploadItemPhoto(client, id, itemId, file));
  }

  @Get(':id/items/:itemId/foto')
  getItemFoto(@Param('id') id: string, @Param('itemId') itemId: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.checklists.getItemFotoUrl(client, id, itemId));
  }

  @Roles('tecnico', 'parceiro')
  @Post(':id/concluir')
  concluir(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.checklists.concluir(client, id));
  }
}
