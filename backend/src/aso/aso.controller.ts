import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { AsoService } from './aso.service';
import { CreateAsoRecordDto } from './dto/create-aso-record.dto';
import { CreatePcmsoPhysicianDto } from './dto/create-pcmso-physician.dto';
import { CreateAsoExamDto } from './dto/create-aso-exam.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('aso')
export class AsoController {
  constructor(private readonly aso: AsoService) {}

  @Post('records')
  @Roles('empresa')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  createRecord(@Body() dto: CreateAsoRecordDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.aso.createRecord(client, dto, req.user.id),
    );
  }

  @Get('records')
  @Roles('empresa', 'tecnico', 'admin')
  findByEmployee(@Query('employeeId', ParseUUIDPipe) employeeId: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.aso.findByEmployee(client, employeeId));
  }

  @Post('pcmso-physicians')
  @Roles('empresa')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  createPhysician(@Body() dto: CreatePcmsoPhysicianDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.aso.createPhysician(client, dto));
  }

  @Get('pcmso-physicians')
  @Roles('empresa', 'tecnico', 'admin')
  listPhysicians(@Req() req: any) {
    return req.withTenantContext((client: any) => this.aso.listPhysicians(client));
  }

  @Post('records/:id/exams')
  @Roles('empresa')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  addExam(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAsoExamDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.aso.addExam(client, id, dto));
  }

  @Get('records/:id/exams')
  @Roles('empresa', 'tecnico', 'admin')
  listExams(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.aso.listExams(client, id));
  }
}
