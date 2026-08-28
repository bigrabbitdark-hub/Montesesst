import { Body, Controller, Get, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { OfficialSourcesService } from './official-sources.service';
import { CreateOfficialSourceDto } from './dto/create-official-source.dto';

@Controller('normative-sources')
export class OfficialSourcesController {
  constructor(private readonly sources: OfficialSourcesService) {}

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateOfficialSourceDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.sources.create(client, dto));
  }

  @Roles('admin')
  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.sources.findAll(client));
  }
}
