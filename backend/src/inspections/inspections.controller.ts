import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';
import { InspectionsService } from './inspections.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { UpdateInspectionDto } from './dto/update-inspection.dto';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';
import { AiDraftDto } from './dto/ai-draft.dto';
import { FIELD_REPORT_EXTRACTOR, FieldReportExtractor } from '../ai-copilot/field-report-extractor.interface';

@Controller('inspections')
export class InspectionsController {
  constructor(
    private readonly inspections: InspectionsService,
    @Inject(FIELD_REPORT_EXTRACTOR) private readonly extractor: FieldReportExtractor,
  ) {}

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateInspectionDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.inspections.create(client, dto.tenant_id, req.user.id, dto.visited_at, dto.company_unit_id, dto.started_at, dto.ended_at),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if ((req.user.role === 'tecnico' || req.user.role === 'parceiro') && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.inspections.findAll(client, tenantId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.inspections.findOne(client, id));
  }

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateInspectionDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.inspections.update(client, id, dto));
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
    return req.withTenantContext((client: any) => this.inspections.updateItem(client, id, itemId, dto));
  }

  @Roles('tecnico', 'parceiro')
  @RateLimit({
    limit: envInt('AI_DRAFT_RATE_LIMIT_MAX', 20),
    windowSeconds: envInt('AI_DRAFT_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/ai-draft')
  async aiDraft(@Param('id') id: string, @Body() dto: AiDraftDto, @Req() req: any) {
    await req.withTenantContext((client: any) => this.inspections.findOne(client, id));
    return this.extractor.extract(dto.report_text);
  }

  @Roles('tecnico', 'parceiro')
  @Post(':id/concluir')
  conclude(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.inspections.conclude(client, id, req.user.id, req.user.role),
    );
  }
}
