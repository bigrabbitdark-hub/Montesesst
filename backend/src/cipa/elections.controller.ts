import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { ElectionsService } from './elections.service';
import { CreateElectionDto } from './dto/create-election.dto';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { UpdateCandidateDto } from './dto/update-candidate.dto';

@Controller('cipa/elections')
export class ElectionsController {
  constructor(private readonly elections: ElectionsService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateElectionDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.elections.create(
        client,
        req.user.tenantId,
        dto.company_unit_id,
        dto.ano,
        dto.data_eleicao,
        dto.inicio_mandato,
        dto.fim_mandato,
      ),
    );
  }

  @Get()
  findAll(@Query('company_unit_id') companyUnitId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.elections.findAll(client, companyUnitId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.elections.findOne(client, id));
  }

  @Get(':id/candidates')
  findCandidates(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.elections.findCandidates(client, id));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/candidates')
  addCandidate(@Param('id') id: string, @Body() dto: CreateCandidateDto, @Req() req: any) {
    // Mesma checagem manual de MeetingsController.setParticipants —
    // exatamente um entre employee_id e nome_livre.
    if ((!dto.employee_id && !dto.nome_livre) || (dto.employee_id && dto.nome_livre)) {
      throw new BadRequestException('Cada candidato precisa de exatamente um entre employee_id e nome_livre');
    }
    return req.withTenantContext((client: any) =>
      this.elections.addCandidate(client, id, dto.employee_id, dto.nome_livre),
    );
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/candidates/:candidateId')
  updateCandidate(
    @Param('id') id: string,
    @Param('candidateId') candidateId: string,
    @Body() dto: UpdateCandidateDto,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) => this.elections.updateCandidate(client, id, candidateId, dto));
  }

  @Roles('empresa')
  @Post(':id/concluir')
  conclude(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.elections.conclude(client, id));
  }
}
