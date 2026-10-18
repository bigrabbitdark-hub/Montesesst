import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { ProvisionsService } from './provisions.service';

@Controller('normative-provisions')
export class ProvisionsController {
  constructor(private readonly provisions: ProvisionsService) {}

  @Roles('admin')
  @Get()
  list(
    @Query('documentId') documentId: string | undefined,
    @Query('norma') norma: string | undefined,
    @Query('anexo') anexo: string | undefined,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) =>
      this.provisions.list(client, {
        documentId,
        norma,
        anexo,
        status: status === 'obsoleto' ? 'obsoleto' : 'ativo',
        limit: limit ? Number(limit) || undefined : undefined,
      }),
    );
  }

  @Roles('admin')
  @Post('generate/:documentId')
  generate(@Param('documentId', ParseUUIDPipe) documentId: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.provisions.generate(client, documentId));
  }
}
