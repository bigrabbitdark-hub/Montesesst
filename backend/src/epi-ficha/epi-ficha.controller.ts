import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { EpiFichaService } from './epi-ficha.service';
import { FichaQueryDto } from './dto/ficha-query.dto';
import { IssueFichaDto } from './dto/issue-ficha.dto';
import { SignatureStatus } from './epi-ficha.types';
import { buildFichaPdf } from './ficha-pdf.util';

@Controller('epi-fichas')
export class EpiFichaController {
  constructor(private readonly ficha: EpiFichaService) {}

  // O tenant vem do JWT (req.withTenantContext + RLS); o employeeId da URL nunca decide o tenant.
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Get('employees/:employeeId')
  getFicha(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() q: FichaQueryDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.ficha.getFicha(client, employeeId, {
        from: q.from,
        to: q.to,
        signature_status: q.signature_status as SignatureStatus | undefined,
      }),
    );
  }

  // Prévia em PDF (não emitida): só leitura, não grava em epi_ficha_documents e não gera código/versão.
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Get('employees/:employeeId/preview.pdf')
  async previewPdf(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() q: FichaQueryDto, @Req() req: any, @Res() res: any) {
    const ficha = await req.withTenantContext((client: any) =>
      this.ficha.getFicha(client, employeeId, {
        from: q.from,
        to: q.to,
        signature_status: q.signature_status as SignatureStatus | undefined,
      }),
    );
    const pdf = await buildFichaPdf(ficha, { preview: true });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="ficha-epi-previa.pdf"',
      'Cache-Control': 'private, no-store',
    });
    res.send(pdf);
  }

  // Emissão: grava uma nova versão imutável. 201 na primeira vez; 200 quando a mesma idempotency_key repete.
  // O tenant do documento vem da linha do funcionário (RLS), nunca do corpo.
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('employees/:employeeId/issue')
  async issue(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() dto: IssueFichaDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const { doc, replayed } = await req.withTenantContext((client: any) => this.ficha.issue(client, employeeId, dto, req.user.id));
    res.status(replayed ? 200 : 201);
    return doc;
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Get('employees/:employeeId/documents')
  documents(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.ficha.listDocuments(client, employeeId));
  }

  // Download pelo backend (sem URL pública do R2).
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Get('documents/:documentId/download')
  async download(@Param('documentId', ParseUUIDPipe) documentId: string, @Req() req: any, @Res() res: any) {
    // Banco numa transação curta; o R2 é lido depois, fora dela (R2 lento nunca prende o pool).
    const ref = await req.withTenantContext((client: any) => this.ficha.findDocumentRef(client, documentId));
    const { buffer, code } = await this.ficha.getDocumentFile(ref);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${code}.pdf"`, 'Cache-Control': 'private, no-store' });
    res.send(buffer);
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Get('documents/:documentId/verify')
  async verify(@Param('documentId', ParseUUIDPipe) documentId: string, @Req() req: any) {
    const ref = await req.withTenantContext((client: any) => this.ficha.findDocumentRef(client, documentId));
    return this.ficha.verify(ref);
  }
}
