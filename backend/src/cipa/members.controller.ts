import { Body, Controller, Get, Param, Patch, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

@Controller('cipa/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateMemberDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.members.create(client, req.user.tenantId, dto as any));
  }

  @Get()
  findAll(@Query('company_unit_id') companyUnitId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.members.findAll(client, companyUnitId));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMemberDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.members.update(client, id, dto as Record<string, unknown>));
  }
}
