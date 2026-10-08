import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { UnsafeUrlError, assertPublicUrl } from '../common/url/public-url.util';
import { OfficialSourcesService } from './official-sources.service';
import { NormativeMonitorService } from './normative-monitor.service';
import { CreateOfficialSourceDto } from './dto/create-official-source.dto';
import { UpdateOfficialSourceDto } from './dto/update-official-source.dto';
import { PreviewSourceDto } from './dto/preview-source.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

// A URL cadastrada é buscada pelo servidor (monitor, "Verificar agora", pré-visualização): a guarda contra
// SSRF roda ao gravar e a cada requisição.
async function exigirUrlPublica(url: string): Promise<void> {
  try {
    await assertPublicUrl(url);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new BadRequestException(err.message);
    throw err;
  }
}

// code é UNIQUE (migration 0052): violação vira 409.
async function comTratamentoDeCodigo<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err: any) {
    if (err?.code === '23505') throw new ConflictException('Já existe uma fonte com este código');
    throw err;
  }
}

@Controller('normative-sources')
export class OfficialSourcesController {
  constructor(
    private readonly sources: OfficialSourcesService,
    private readonly monitor: NormativeMonitorService,
  ) {}

  @Roles('admin')
  @UsePipes(pipe)
  @Post()
  async create(@Body() dto: CreateOfficialSourceDto, @Req() req: any) {
    await exigirUrlPublica(dto.official_url);
    return comTratamentoDeCodigo(() => req.withTenantContext((client: any) => this.sources.create(client, dto)));
  }

  @Roles('admin')
  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.sources.findAll(client));
  }

  // Pré-visualização: lê e extrai a URL sem gravar nada. Declarada antes das rotas com :id.
  @Roles('admin')
  @RateLimit({ limit: 30, windowSeconds: 3600, keyBy: 'ip' })
  @UsePipes(pipe)
  @Post('preview')
  async preview(@Body() dto: PreviewSourceDto, @Req() req: any) {
    await exigirUrlPublica(dto.official_url);
    const result = await this.monitor.previewUrl(dto.official_url);
    const duplicate = await req.withTenantContext((client: any) => this.sources.findByUrl(client, dto.official_url));
    return { ...result, duplicate_of: duplicate };
  }

  @Roles('admin')
  @UsePipes(pipe)
  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOfficialSourceDto, @Req() req: any) {
    if (dto.official_url !== undefined) await exigirUrlPublica(dto.official_url);
    const updated = await comTratamentoDeCodigo(() => req.withTenantContext((client: any) => this.sources.update(client, id, dto)));
    if (!updated) throw new NotFoundException('Fonte não encontrada');
    return updated;
  }

  @Roles('admin')
  @RateLimit({ limit: 20, windowSeconds: 3600, keyBy: 'ip' })
  @Post(':id/check-now')
  checkNow(@Param('id', ParseUUIDPipe) id: string) {
    return this.monitor.checkSource(id);
  }
}
