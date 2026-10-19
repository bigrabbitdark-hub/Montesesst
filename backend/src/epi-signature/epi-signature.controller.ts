import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateSignatureRequestDto } from './dto/create-signature-request.dto';
import { InPersonDto } from './dto/in-person.dto';
import { ListPendingQueryDto } from './dto/list-pending-query.dto';
import { ListRequestsQueryDto } from './dto/list-requests-query.dto';
import { resolveTenantScope } from '../epi/tenant-scope.util';
import { EpiSignatureService } from './epi-signature.service';
import { buildReceiptPdf } from './receipt-pdf.util';

// Rotas autenticadas do responsável. O tenant vem do JWT/RLS (req.withTenantContext); ids da URL ou do corpo nunca decidem tenant.
// As rotas fixas (requests, in-person) ficam antes de qualquer rota com :id.
@Controller('epi-signatures')
export class EpiSignatureController {
  constructor(private readonly signatures: EpiSignatureService) {}

  // A resposta traz token e código em claro uma única vez: nunca pode ser guardada em cache.
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('requests')
  async create(@Body() dto: CreateSignatureRequestDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const out = await req.withTenantContext((client: any) => this.signatures.createRequest(client, dto, req.user.id));
    res.set('Cache-Control', 'no-store');
    return out;
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Get('requests')
  list(@Query() q: ListRequestsQueryDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.signatures.listRequests(client, q.employee_id));
  }

  // Entregas aguardando assinatura (pendentes/recusadas) de UMA empresa, com o link ativo (sem token, código nem hash).
  // tenant_id obrigatório para técnico/parceiro/admin; a RLS continua decidindo o que é visível.
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Get('pending')
  pending(@Query() q: ListPendingQueryDto, @Req() req: any) {
    const tenantId = resolveTenantScope(req.user, q.tenant_id);
    return req.withTenantContext((client: any) =>
      this.signatures.listPending(client, tenantId, { employeeId: q.employee_id, page: q.page ?? 1, pageSize: q.page_size ?? 25 }),
    );
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Post('requests/:id/revoke')
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.signatures.revoke(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('in-person')
  inPerson(@Body() dto: InPersonDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.signatures.registerInPerson(client, dto, req.user.id));
  }

  // Comprovante em PDF gerado SOB DEMANDA (nada no R2). `:id` = id da epi_signatures; o tenant vem do JWT/RLS.
  // O banco é lido numa transação curta; a transação fecha ANTES de gerar o PDF. Nome do arquivo = código gerado pelo servidor.
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Get(':id/receipt.pdf')
  async receipt(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Res() res: any) {
    const data = await req.withTenantContext((client: any) => this.signatures.getReceiptData(client, id));
    const pdf = await buildReceiptPdf(data);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${data.receipt_code}.pdf"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(pdf);
  }
}
