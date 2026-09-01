import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { MeetingsService } from './meetings.service';
import { CreateExtraordinariaDto } from './dto/create-extraordinaria.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { SetParticipantsDto } from './dto/set-participants.dto';

@Controller('cipa/meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateExtraordinariaDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.meetings.createExtraordinaria(
        client, req.user.tenantId, dto.committee_id, dto.titulo, dto.data, dto.hora,
        dto.local, dto.modalidade, dto.motivo, dto.responsavel_user_id,
      ),
    );
  }

  @Get()
  findAll(@Query('committee_id') committeeId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.findAll(client, committeeId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.findOne(client, id));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMeetingDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.update(client, id, dto as Record<string, unknown>));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Put(':id/participants')
  setParticipants(@Param('id') id: string, @Body() dto: SetParticipantsDto, @Req() req: any) {
    for (const p of dto.participants) {
      if ((!p.cipa_member_id && !p.nome_livre) || (p.cipa_member_id && p.nome_livre)) {
        throw new BadRequestException('Cada participante precisa de exatamente um entre cipa_member_id e nome_livre');
      }
    }
    return req.withTenantContext((client: any) => this.meetings.setParticipants(client, id, dto.participants));
  }
}
