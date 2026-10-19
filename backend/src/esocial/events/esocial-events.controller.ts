import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { EsocialEventsService } from './esocial-events.service';
import { CreateEsocialEventDto } from './dto/create-esocial-event.dto';

// Leitura: empresa, técnico vinculado e admin. Ações que mudam estado ou usam o certificado do
// cliente: SOMENTE a empresa (o tenant sai do JWT via req.withTenantContext, nunca do corpo).
@Controller('esocial/events')
export class EsocialEventsController {
  constructor(private readonly events: EsocialEventsService) {}

  @Get('diagnostics')
  @Roles('empresa', 'tecnico', 'admin')
  diagnose(
    @Query('asoRecordId', new ParseUUIDPipe({ optional: true })) asoRecordId: string | undefined,
    @Query('certificateId') certificateId: string | undefined,
    @Query('accidentId', new ParseUUIDPipe({ optional: true })) accidentId: string | undefined,
    @Req() req: any,
  ) {
    if (!!asoRecordId === !!accidentId) throw new BadRequestException('Informe asoRecordId ou accidentId (um dos dois)');
    return req.withTenantContext((c: any) => this.events.diagnose(c, asoRecordId, certificateId, accidentId));
  }

  @Get()
  @Roles('empresa', 'tecnico', 'admin')
  list(@Req() req: any) {
    return req.withTenantContext((c: any) => this.events.list(c));
  }

  @Get(':id')
  @Roles('empresa', 'tecnico', 'admin')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.events.get(c, id));
  }

  @Get(':id/xml')
  @Roles('empresa', 'tecnico', 'admin')
  xml(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.events.xml(c, id));
  }

  @Post()
  @Roles('empresa')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  create(@Body() dto: CreateEsocialEventDto, @Req() req: any) {
    if (!!dto.asoRecordId === !!dto.accidentId) throw new BadRequestException('Informe asoRecordId ou accidentId (um dos dois)');
    return req.withTenantContext((c: any) =>
      dto.accidentId
        ? this.events.createFromAccident(c, dto.accidentId, dto.certificateId, req.user.id)
        : this.events.create(c, dto.asoRecordId as string, dto.certificateId, req.user.id),
    );
  }

  // S-3000: cria o rascunho de exclusão de um evento já processado. certificateId é opcional (padrão: o do evento).
  @Post(':id/exclusion')
  @Roles('empresa')
  exclude(@Param('id', ParseUUIDPipe) id: string, @Body() body: { certificateId?: string }, @Req() req: any) {
    const certificateId = typeof body?.certificateId === 'string' && /^[0-9a-f-]{36}$/i.test(body.certificateId) ? body.certificateId : undefined;
    return req.withTenantContext((c: any) => this.events.createExclusion(c, id, certificateId, req.user.id));
  }

  @Post(':id/authorize')
  @Roles('empresa')
  authorize(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.events.authorize(c, id, req.user.id));
  }

  @Post(':id/transmit')
  @Roles('empresa')
  transmit(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.events.transmit(c, id, req.user.id));
  }

  @Post(':id/consult')
  @Roles('empresa')
  consult(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.events.consult(c, id, req.user.id));
  }
}
