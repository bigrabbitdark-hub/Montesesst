import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { EpiService } from './epi.service';
import { CreateEpiDto } from './dto/create-epi.dto';
import { CreateEpiDeliveryDto } from './dto/create-epi-delivery.dto';
import { CreateEpiAdjustmentDto } from './dto/create-epi-adjustment.dto';
import { ReverseEpiMovementDto } from './dto/reverse-epi-movement.dto';
import { CreateEpiMovementDto } from './dto/create-epi-movement.dto';
import { ListEpiMovementsQueryDto } from './dto/list-epi-movements-query.dto';
import { UpdateEpiDto } from './dto/update-epi.dto';
import { SearchEpisQueryDto } from './dto/search-epis-query.dto';
import { EpiStockService } from './epi-stock.service';
import { EpiDashboardService } from './epi-dashboard.service';
import { EpiDashboardQueryDto, TenantOnlyQueryDto } from './dto/epi-dashboard-query.dto';
import { UpdateEpiSettingsDto } from './dto/epi-settings.dto';
import { resolveTenantScope } from './tenant-scope.util';
import { ActingAllowed } from '../common/decorators/acting-allowed.decorator';

@Controller('epis')
@ActingAllowed()
export class EpisController {
  constructor(
    private readonly epi: EpiService,
    private readonly stock: EpiStockService,
    private readonly dashboardSvc: EpiDashboardService,
  ) {}

  // tenant_id é opcional nas listagens: filtra quando presente; sem ele vale só a RLS. A empresa não filtra por outra empresa (400).
  private optionalTenantFilter(user: { role: string; tenantId: string | null }, requested?: string): string | undefined {
    if (!requested) return undefined;
    if (user.role === 'empresa') return resolveTenantScope(user, requested);
    return requested;
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateEpiDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.epi.create(client, {
        tenantId,
        epiCatalogItemId: dto.epi_catalog_item_id,
        caNumber: dto.ca_number,
        caValidUntil: dto.ca_valid_until,
        manufacturer: dto.manufacturer,
        model: dto.model,
        unit: dto.unit,
        minStock: dto.min_stock,
        maxStock: dto.max_stock,
        unitCost: dto.unit_cost,
        controlsLot: dto.controls_lot,
        replacementDays: dto.replacement_days,
        createdByUserId: user.id,
      }),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.findAll(client, tenantId));
  }

  // Listagem paginada com filtros e alertas (GET /epis segue devolvendo array).
  // Declarada antes das rotas com :id. Parâmetro desconhecido ou inválido -> 400.
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Get('search')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  search(@Query() q: SearchEpisQueryDto, @Req() req: any) {
    const tenantId = this.optionalTenantFilter(req.user, q.tenant_id);
    return req.withTenantContext((client: any) =>
      this.epi.search(client, {
        tenantId,
        q: q.q,
        status: q.status,
        category: q.category,
        stockBand: q.stock_band,
        caAlert: q.ca_alert,
        page: q.page ?? 1,
        pageSize: q.page_size ?? 25,
      }),
    );
  }

  // Declarada antes das rotas com :id para 'movements' não ser lido como id.
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Get('movements')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  listMovements(@Query() q: ListEpiMovementsQueryDto, @Req() req: any) {
    const tenantId = this.optionalTenantFilter(req.user, q.tenant_id);
    const page = q.page ?? 1;
    const pageSize = q.page_size ?? 25;
    return req.withTenantContext((client: any) =>
      this.stock.listMovements(client, {
        tenantId,
        tenantEpiId: q.tenant_epi_id,
        employeeId: q.employee_id,
        type: q.type,
        from: q.from,
        to: q.to,
        page,
        pageSize,
      }),
    );
  }

  // Indicadores agregados de UMA empresa (tenant_id obrigatório para técnico/parceiro/admin). Antes de :id.
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Get('dashboard')
  dashboard(@Query() q: EpiDashboardQueryDto, @Req() req: any) {
    const tenantId = resolveTenantScope(req.user, q.tenant_id);
    return req.withTenantContext((client: any) =>
      this.dashboardSvc.getDashboard(client, tenantId, {
        from: q.from, to: q.to, epiId: q.epi_id, employeeId: q.employee_id,
      }),
    );
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Get('settings')
  getSettings(@Query() q: TenantOnlyQueryDto, @Req() req: any) {
    const tenantId = resolveTenantScope(req.user, q.tenant_id);
    return req.withTenantContext(async (client: any) => {
      const r = await client.query('SELECT COALESCE(epi_alert_days, 30) AS epi_alert_days FROM tenants WHERE id = $1', [tenantId]);
      if (!r.rows[0]) throw new NotFoundException('Empresa não encontrada');
      return r.rows[0];
    });
  }

  // Dias de aviso de vencimento: só empresa e admin alteram (técnico/parceiro recebem 403 do RolesGuard).
  @Roles('empresa', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch('settings')
  updateSettings(@Query() q: TenantOnlyQueryDto, @Body() dto: UpdateEpiSettingsDto, @Req() req: any) {
    const tenantId = resolveTenantScope(req.user, q.tenant_id);
    req.auditResourceId = tenantId; // auditoria: o recurso alterado é a empresa-alvo
    return req.withTenantContext(async (client: any) => {
      const r = await client.query('UPDATE tenants SET epi_alert_days = $2 WHERE id = $1 RETURNING epi_alert_days', [tenantId, dto.epi_alert_days]);
      if (!r.rows[0]) throw new NotFoundException('Empresa não encontrada');
      return r.rows[0];
    });
  }

  // Edição parcial: o tenant vem da linha (RLS), nunca do corpo; saldo não é editável.
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEpiDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.update(client, id, dto, req.user.id));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Get(':id/lots')
  lots(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.listLots(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.remove(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/deliveries')
  createDelivery(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEpiDeliveryDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.epi.createDelivery(client, id, {
        employeeId: dto.employee_id,
        deliveredAt: dto.delivered_at,
        signedByName: dto.signed_by_name,
        createdByUserId: req.user.id,
      }),
    );
  }

  // 201 para movimento novo; 200 quando é repetição idempotente (mesma chave).
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/movements')
  async registerMovement(
    @Param('id') id: string,
    @Body() dto: CreateEpiMovementDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    if (!isUUID(id)) throw new BadRequestException('id inválido');
    const role = req.user.role;
    if (dto.type === 'abertura' && role !== 'empresa' && role !== 'admin') {
      throw new ForbiddenException('Somente a empresa ou o administrador registra a abertura de estoque');
    }
    const result = await req.withTenantContext((client: any) =>
      this.stock.registerMovement(client, id, dto, req.user.id),
    );
    res.status(result.replayed ? 200 : 201);
    return result.movement;
  }

  // Ajuste manual: somente empresa e admin (técnico/parceiro recebem 403 do RolesGuard).
  // O tenant vem da linha do EPI, nunca do corpo da requisição.
  @Roles('empresa', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/adjustments')
  async adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateEpiAdjustmentDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const result = await req.withTenantContext((client: any) =>
      this.stock.applyMovement(client, {
        tenantEpiId: id,
        type: 'ajuste',
        direction: dto.direction === 'mais' ? 1 : -1,
        quantity: dto.quantity,
        reason: dto.reason,
        lotId: dto.lot_id,
        idempotencyKey: dto.idempotency_key,
        userId: req.user.id,
      }),
    );
    res.status(result.replayed ? 200 : 201);
    return result.movement;
  }

  // Estorno: cria a movimentação inversa; a original permanece no histórico.
  @Roles('empresa', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('movements/:movementId/reversal')
  async reverse(
    @Param('movementId', ParseUUIDPipe) movementId: string,
    @Body() dto: ReverseEpiMovementDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const result = await req.withTenantContext((client: any) =>
      this.stock.reverse(client, movementId, {
        reason: dto.reason,
        idempotencyKey: dto.idempotency_key,
        userId: req.user.id,
      }),
    );
    res.status(result.replayed ? 200 : 201);
    return result.movement;
  }

  @Get(':id/deliveries')
  findDeliveries(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.findDeliveries(client, id));
  }
}
