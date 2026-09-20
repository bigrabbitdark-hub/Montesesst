import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SstChecklistService } from './sst-checklist.service';
import { CreateSstChecklistItemDto } from './dto/create-sst-checklist-item.dto';
import { UpdateSstChecklistItemDto } from './dto/update-sst-checklist-item.dto';

@Controller('sst-checklist')
export class SstChecklistController {
  constructor(private readonly checklist: SstChecklistService) {}

  @Roles('admin')
  @Get()
  findAll(@Query('nr_code') nrCode: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.checklist.findAll(client, nrCode));
  }

  @Roles('admin')
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.checklist.findOne(client, id));
  }

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateSstChecklistItemDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.checklist.create(client, dto));
  }

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSstChecklistItemDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.checklist.update(client, id, dto));
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.checklist.remove(client, id));
  }
}
