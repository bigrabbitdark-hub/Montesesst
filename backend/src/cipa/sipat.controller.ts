import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SipatService } from './sipat.service';
import { CreateSipatEditionDto } from './dto/create-sipat-edition.dto';
import { CreateSipatActivityDto } from './dto/create-sipat-activity.dto';
import { UpdateSipatActivityDto } from './dto/update-sipat-activity.dto';

@Controller('cipa/sipat/editions')
export class SipatController {
  constructor(private readonly sipat: SipatService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  createEdition(@Body() dto: CreateSipatEditionDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.sipat.createEdition(client, req.user.tenantId, dto.company_unit_id, dto.ano, dto.periodo_inicio, dto.periodo_fim, dto.tema),
    );
  }

  @Get()
  findEditions(@Query('company_unit_id') companyUnitId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.sipat.findEditions(client, companyUnitId));
  }

  @Roles('empresa')
  @Delete(':id')
  removeEdition(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.sipat.removeEdition(client, id));
  }

  @Get(':id/activities')
  findActivities(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.sipat.findActivities(client, id));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/activities')
  addActivity(@Param('id') id: string, @Body() dto: CreateSipatActivityDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.sipat.addActivity(client, id, dto.data, dto.titulo, dto.responsavel, dto.publico_alvo),
    );
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/activities/:activityId')
  updateActivity(
    @Param('id') id: string,
    @Param('activityId') activityId: string,
    @Body() dto: UpdateSipatActivityDto,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) =>
      this.sipat.updateActivity(client, id, activityId, { status: dto.status, numeroParticipantes: dto.numero_participantes }),
    );
  }
}
