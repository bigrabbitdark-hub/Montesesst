import { Body, Controller, Get, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { AsoService } from './aso.service';
import { CreateAsoRecordDto } from './dto/create-aso-record.dto';
import { CreatePcmsoPhysicianDto } from './dto/create-pcmso-physician.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('aso')
export class AsoController {
  constructor(private readonly aso: AsoService) {}

  @Post('records')
  @Roles('empresa', 'tecnico', 'admin')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  createRecord(@Body() dto: CreateAsoRecordDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.aso.createRecord(client, dto, req.user.id),
    );
  }

  @Get('records')
  @Roles('empresa', 'tecnico', 'admin')
  findByEmployee(@Query('employeeId') employeeId: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.aso.findByEmployee(client, employeeId));
  }

  @Post('pcmso-physicians')
  @Roles('empresa', 'admin')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  createPhysician(@Body() dto: CreatePcmsoPhysicianDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.aso.createPhysician(client, dto));
  }
}
