import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AccidentDto } from './accident.dto';
import { AccidentsService } from './accidents.service';

// Dado de saúde (CAT): escrita só pela empresa; leitura pela empresa, técnico vinculado e admin.
// O tenant sai do JWT (req.withTenantContext), nunca do corpo.
@Controller('esocial/accidents')
export class AccidentsController {
  constructor(private readonly accidents: AccidentsService) {}

  @Post()
  @Roles('empresa')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  create(@Body() dto: AccidentDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.accidents.create(c, dto, req.user.id));
  }

  @Put(':id')
  @Roles('empresa')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AccidentDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.accidents.update(c, id, dto));
  }

  @Get()
  @Roles('empresa', 'tecnico', 'admin')
  list(@Req() req: any) {
    return req.withTenantContext((c: any) => this.accidents.list(c));
  }

  @Get(':id')
  @Roles('empresa', 'tecnico', 'admin')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.accidents.get(c, id));
  }
}
