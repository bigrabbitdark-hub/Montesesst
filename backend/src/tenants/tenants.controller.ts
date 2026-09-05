import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { DatabaseService } from '../common/database/database.service';
import { TenantsService, Tenant } from './tenants.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';

function withHasLogo(tenant: Tenant) {
  const { logo_file_key, ...rest } = tenant;
  return { ...rest, has_logo: !!logo_file_key };
}

@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly db: DatabaseService,
  ) {}

  // Lista completa (todos os tenants, com vínculos agregados) — só admin,
  // ver findAll() abaixo. findMe/updateMe seguem exclusivos de 'empresa',
  // sempre resolvendo o próprio tenantId do JWT, nunca um id vindo do
  // cliente.
  @Roles('empresa')
  @Get('me')
  async findMe(@Req() req: any) {
    const tenant = await req.withTenantContext((client: any) => this.tenants.findOne(client, req.user.tenantId));
    return withHasLogo(tenant);
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch('me')
  async updateMe(@Body() dto: UpdateTenantDto, @Req() req: any) {
    const tenant = await req.withTenantContext((client: any) =>
      this.tenants.update(client, req.user.tenantId, dto),
    );
    return withHasLogo(tenant);
  }

  @Roles('empresa')
  @Post('me/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadLogo(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    return req.withTenantContext((client: any) =>
      this.tenants.uploadLogo(client, req.user.tenantId, {
        buffer: file.buffer,
        mimetype: file.mimetype,
      }),
    );
  }

  @Roles('empresa')
  @Delete('me/logo')
  removeLogo(@Req() req: any) {
    return req.withTenantContext((client: any) => this.tenants.removeLogo(client, req.user.tenantId));
  }

  @Public()
  @Get(':id/logo')
  async getLogo(
    @Param('id', new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('Empresa não encontrada') }))
    id: string,
    @Res() res: Response,
  ) {
    const url = await this.db.withoutTenantContext((client) => this.tenants.getLogoRedirectUrl(client, id));
    res.redirect(302, url);
  }

  // 'tenants' não tem RLS própria — @Roles('admin') é a única barreira
  // pra esta lista completa, sem filtro nenhum. Ver Global Constraints do
  // plano da Fase 7 sub-projeto A.
  @Roles('admin')
  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.tenants.findAllWithLinks(client));
  }

  @Roles('admin')
  @Get(':id/detail')
  findDetail(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.tenants.findDetail(client, id));
  }
}
