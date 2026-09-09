import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { FireBrigadeService, FuncaoBrigada } from './fire-brigade.service';
import { CreateFireBrigadeMemberDto } from './dto/create-fire-brigade-member.dto';
import { UpdateFireBrigadeMemberDto } from './dto/update-fire-brigade-member.dto';
import { CreateFireBrigadeTrainingDto } from './dto/create-fire-brigade-training.dto';
import { SetCoverageTargetDto } from './dto/set-coverage-target.dto';

@Controller('fire-brigade')
export class FireBrigadeController {
  constructor(private readonly brigade: FireBrigadeService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('members')
  createMember(@Body() dto: CreateFireBrigadeMemberDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.brigade.createMember(client, {
        tenantId,
        companyUnitId: dto.company_unit_id,
        employeeId: dto.employee_id,
        funcaoBrigada: dto.funcao_brigada as FuncaoBrigada,
        turno: dto.turno,
        telefone: dto.telefone,
      }),
    );
  }

  @Get('members')
  findMembers(
    @Query('tenant_id') tenantId: string | undefined,
    @Query('company_unit_id') companyUnitId: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) =>
      this.brigade.findMembers(client, { tenantId, companyUnitId, status }),
    );
  }

  @Get('members/:id')
  findMember(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.brigade.findMember(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch('members/:id')
  updateMember(@Param('id') id: string, @Body() dto: UpdateFireBrigadeMemberDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.brigade.updateMember(client, id, dto));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Delete('members/:id')
  removeMember(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.brigade.removeMember(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('members/:id/trainings')
  @UseInterceptors(FileInterceptor('certificado', { limits: { fileSize: 10 * 1024 * 1024 } }))
  createTraining(
    @Param('id') memberId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateFireBrigadeTrainingDto,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) =>
      this.brigade.createTraining(client, memberId, req.user.id, req.user.role, {
        dataRealizacao: dto.data_realizacao,
        dataValidade: dto.data_validade,
        cargaHoraria: dto.carga_horaria,
        file: file
          ? { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, size: file.size }
          : undefined,
      }),
    );
  }

  @Get('members/:id/trainings')
  findTrainings(@Param('id') memberId: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.brigade.findTrainings(client, memberId));
  }

  @Get('coverage')
  getCoverage(@Query('company_unit_id') companyUnitId: string, @Req() req: any) {
    if (!companyUnitId) throw new BadRequestException('company_unit_id é obrigatório');
    return req.withTenantContext((client: any) => this.brigade.getCoverage(client, companyUnitId));
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Put('coverage-target')
  setCoverageTarget(@Body() dto: SetCoverageTargetDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.brigade.upsertCoverageTarget(client, tenantId, dto.company_unit_id, dto.quantidade_necessaria),
    );
  }
}
