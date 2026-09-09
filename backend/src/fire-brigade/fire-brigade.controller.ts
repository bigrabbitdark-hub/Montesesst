import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { FireBrigadeService, FuncaoBrigada } from './fire-brigade.service';
import { CreateFireBrigadeMemberDto } from './dto/create-fire-brigade-member.dto';
import { UpdateFireBrigadeMemberDto } from './dto/update-fire-brigade-member.dto';

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
}
