import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateNormativeRuleDto } from './dto/create-normative-rule.dto';
import { ReviewNormativeRuleDto } from './dto/review-normative-rule.dto';
import { SetRuleProvisionsDto } from './dto/set-rule-provisions.dto';
import { UpdateNormativeRuleDto } from './dto/update-normative-rule.dto';
import { NormativeRulesService } from './normative-rules.service';

const PIPE = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

@Controller('normative-rules')
export class NormativeRulesController {
  constructor(private readonly rules: NormativeRulesService) {}

  @Roles('admin')
  @Get()
  list(
    @Query('area') area: string | undefined,
    @Query('categoria') categoria: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) => this.rules.list(client, { area, categoria, status }));
  }

  @Roles('admin')
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.findOne(client, id));
  }

  @Roles('admin')
  @UsePipes(PIPE)
  @Post()
  create(@Body() dto: CreateNormativeRuleDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.create(client, dto));
  }

  @Roles('admin')
  @UsePipes(PIPE)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNormativeRuleDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.update(client, id, dto));
  }

  @Roles('admin')
  @UsePipes(PIPE)
  @Put(':id/provisions')
  setProvisions(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRuleProvisionsDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.setProvisions(client, id, dto.links));
  }

  @Roles('admin')
  @UsePipes(PIPE)
  @Post(':id/review')
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewNormativeRuleDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.review(client, id, req.user.id, dto.registro));
  }

  @Roles('admin')
  @Post(':id/retire')
  retire(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.retire(client, id));
  }
}
