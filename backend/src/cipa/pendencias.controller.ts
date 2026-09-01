import { Body, Controller, Get, Param, Patch, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { PendenciasService } from './pendencias.service';
import { CreatePendenciaDto } from './dto/create-pendencia.dto';
import { UpdatePendenciaDto } from './dto/update-pendencia.dto';

@Controller('cipa/pendencias')
export class PendenciasController {
  constructor(private readonly pendencias: PendenciasService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreatePendenciaDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.pendencias.create(
        client, req.user.tenantId, dto.company_unit_id, dto.meeting_id,
        dto.descricao, dto.responsavel_user_id, dto.prazo, dto.prioridade,
      ),
    );
  }

  @Get()
  findAll(@Query('company_unit_id') companyUnitId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.pendencias.findAll(client, companyUnitId));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePendenciaDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.pendencias.update(client, id, dto as Record<string, unknown>));
  }
}
