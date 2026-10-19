import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ColumnMapping } from './spreadsheet-import.util';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';
import { Employee, EmployeesService } from './employees.service';
import { maskCpf } from '../epi-ficha/cpf-mask.util';
import { AuditService } from '../common/audit/audit.service';
import { normalizeEmployeeInput } from './employee-fields.util';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { BulkUpdateEmployeesDto } from './dto/bulk-update-employees.dto';
import { EmployeeIngestionService } from './employee-ingestion.service';
import { ResolveExtractionDto } from './dto/resolve-extraction.dto';
import { DocumentsService } from '../documents/documents.service';
import { sanitizeTitle } from './employee-text-sanitize';
import { DOCX_MIME_TYPE } from '../common/docx/docx-text.util';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EMPLOYEE_ID_PIPE = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException('Identificador de funcionário inválido') });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
    private readonly ingestion: EmployeeIngestionService,
    private readonly documents: DocumentsService,
  ) {}

  private readonly logger = new Logger(EmployeesController.name);

  // Só `empresa`: o DocumentsService.upload não aceita uploadedByRole 'admin' e o admin não sobe documentos em outro fluxo.
  // Duas transações: o documento fica gravado mesmo que a extração falhe.
  @Roles('empresa')
  // Cada upload dispara parse da planilha e gravação no R2: teto por IP, como nas outras rotas de upload.
  @RateLimit({
    limit: envInt('EMPLOYEE_DOCUMENTS_RATE_LIMIT_MAX', 20),
    windowSeconds: envInt('EMPLOYEE_DOCUMENTS_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body('company_unit_id') companyUnitId: unknown,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
      // Imagem não é lida (sem OCR): recusar evita guardar um arquivo com dados pessoais que ninguém consegue ler.
      throw new BadRequestException('Imagens ainda não são lidas para o cadastro. Envie a planilha modelo (.xlsx), um PDF com texto ou um DOCX.');
    }
    if (file.mimetype !== XLSX_MIME && file.mimetype !== 'application/pdf' && file.mimetype !== DOCX_MIME_TYPE) {
      throw new BadRequestException('Formato não aceito. Envie a planilha modelo (.xlsx), um PDF com texto ou um DOCX.');
    }
    if (companyUnitId !== undefined && companyUnitId !== '' && (typeof companyUnitId !== 'string' || !UUID_RE.test(companyUnitId))) {
      throw new BadRequestException('Filial inválida');
    }
    const unitId = typeof companyUnitId === 'string' && companyUnitId ? companyUnitId : null;
    const user = req.user;
    const hash = EmployeeIngestionService.hash(file.buffer);
    // Sem controles nem RTL/ZWSP; trim ANTES do fallback (título em branco não chega ao banco).
    // O multer entrega o nome em latin1: reinterpreta como UTF-8 (senão o RTL/ZWSP chega como lixo e escapa do filtro).
    const decoded = Buffer.from(file.originalname || '', 'latin1').toString('utf8');
    const title = sanitizeTitle(decoded.includes('\uFFFD') ? file.originalname || '' : decoded).replace(/\.[^.]*$/, '').trim().slice(0, 200).trim() || 'cadastro';

    // Transação 1: dedupe por conteúdo + documento + extração 'processando'.
    const started: { reused: any } | { extractionId: string } = await req.withTenantContext(async (client: any) => {
      const reused = await this.ingestion.findReusable(client, user.tenantId, hash);
      if (reused) return { reused };
      const doc = await this.documents.upload(client, {
        tenantId: user.tenantId,
        category: 'cadastro_funcionarios',
        title,
        file: { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, size: file.size },
        uploadedByUserId: user.id,
        uploadedByRole: 'empresa',
        companyUnitId: unitId ?? undefined,
      });
      const extractionId = await this.ingestion.createProcessing(client, { tenantId: user.tenantId, documentId: doc.id, hash, actorUserId: user.id });
      return { extractionId };
    });
    if ('reused' in started) {
      res.status(200);
      return started.reused;
    }

    // Fora de transação: leitura do texto e IA opcional (nenhuma conexão presa durante a chamada externa).
    // Transação 2 grava. Se algo falhar, transação 3 marca 'erro' (best-effort) e o erro original é relançado.
    try {
      const prepared = await this.ingestion.prepare({
        tenantId: user.tenantId, extractionId: started.extractionId, mimeType: file.mimetype, buffer: file.buffer,
        runTx: (fn) => req.withTenantContext(fn),
      });
      return await req.withTenantContext((client: any) =>
        this.ingestion.extract(client, {
          tenantId: user.tenantId, extractionId: started.extractionId, prepared, companyUnitId: unitId,
          actorUserId: user.id, actorRole: user.role,
        }),
      );
    } catch (err) {
      // Nunca a mensagem do erro (pode conter dados do arquivo): só nome, código e id da extração.
      this.logger.error(`Falha na extração ${started.extractionId}: ${(err as Error)?.name} ${(err as any)?.code ?? ''}`);
      try {
        const detail = file.mimetype === XLSX_MIME ? undefined : 'Falha ao processar o documento.'; // planilha: texto da Fatia 3 (default do serviço)
        await req.withTenantContext((client: any) => this.ingestion.markError(client, user.tenantId, started.extractionId, detail));
      } catch {
        // não mascara o erro original
      }
      throw err;
    }
  }

  @Roles('empresa', 'admin')
  @Get('extractions')
  listExtractions(@Query('status') status: unknown, @Query('tenant_id') tenantIdQ: unknown, @Req() req: any) {
    if (status !== undefined && status !== 'requer_revisao') throw new BadRequestException('status inválido');
    let tenantId: string = req.user.tenantId;
    if (req.user.role === 'admin') {
      if (typeof tenantIdQ !== 'string' || !UUID_RE.test(tenantIdQ)) throw new BadRequestException('tenant_id é obrigatório');
      tenantId = tenantIdQ;
    }
    return req.withTenantContext(async (client: any) => ({ items: await this.ingestion.listPending(client, tenantId) }));
  }

  @Roles('empresa', 'admin')
  @Get('extractions/:id')
  getExtraction(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.ingestion.get(client, id));
  }

  // Só `empresa` (admin apenas lê). Tenant vem do contexto do token; a linha é filtrada por RLS.
  @Roles('empresa')
  @Post('extractions/:id/resolve')
  @HttpCode(200)
  resolveExtraction(@Param('id') id: string, @Body() dto: ResolveExtractionDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.ingestion.resolve(client, id, dto?.decisions, { userId: req.user.id, tenantId: req.user.tenantId, role: req.user.role }),
    );
  }

  @Roles('empresa', 'admin')
  @Post()
  create(@Body() dto: CreateEmployeeDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'admin' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.employees.create(
        client,
        tenantId,
        {
          full_name: dto.full_name,
          cpf: dto.cpf,
          birth_date: dto.birth_date,
          position: dto.position,
          admission_date: dto.admission_date,
          company_unit_id: dto.company_unit_id,
          registration_number: dto.registration_number,
          department: dto.department,
          sex: dto.sex,
          cbo_code: dto.cbo_code,
          activity_description: dto.activity_description,
        },
        user.role,
      ),
    );
  }

  @Roles('empresa', 'admin')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importCsv(
    @UploadedFile() file: Express.Multer.File,
    @Query('tenant_id') tenantIdParam: string | undefined,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    const tenantId = req.user.role === 'admin' ? tenantIdParam : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.employees.importCsv(client, tenantId, file.buffer.toString('utf-8'), req.user.role),
    );
  }

  @Roles('empresa', 'admin')
  @Post('import-preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async previewImport(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    return this.employees.previewSpreadsheet(file.buffer, file.mimetype, file.originalname);
  }

  @Roles('empresa', 'admin')
  @Post('import-mapped')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  importMapped(
    @UploadedFile() file: Express.Multer.File,
    @Body('mapping') mappingRaw: string,
    @Query('tenant_id') tenantIdParam: string | undefined,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    let mapping: ColumnMapping;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      throw new BadRequestException('Mapeamento de colunas inválido');
    }
    const tenantId = req.user.role === 'admin' ? tenantIdParam : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.employees.importMapped(
        client,
        tenantId,
        file.buffer,
        file.mimetype,
        mapping,
        file.originalname,
        req.user.role,
      ),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if ((req.user.role === 'tecnico' || req.user.role === 'parceiro') && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req
      .withTenantContext((client: any) => this.employees.findAll(client, tenantId))
      .then((rows: Employee[]) => rows.map((r) => this.cpfForRole(r, req.user.role)));
  }

  // Técnico e parceiro recebem o CPF mascarado (mesma máscara da ficha de EPI); empresa e admin, o completo.
  // Nenhuma tela de técnico/parceiro usa o CPF de /employees (conferido no frontend em 2026-10-19).
  private cpfForRole<T extends { cpf: string }>(row: T, role: string): T {
    return role === 'empresa' || role === 'admin' ? row : { ...row, cpf: maskCpf(row.cpf) };
  }

  // Rotas estáticas ('table', 'bulk') DEVEM vir antes de ':id', senão viram parâmetro.
  // Tabela oficial (CPF completo e dados pessoais): só empresa e admin; técnico/parceiro recebem 403.
  @Roles('empresa', 'admin')
  @Get('table')
  findTable(
    @Query() q: { tenant_id?: string; company_unit_id?: string; limit?: string; offset?: string },
    @Req() req: any,
  ) {
    const toInt = (v: string | undefined, label: string): number | undefined => {
      if (v === undefined || v === '') return undefined;
      if (!/^\d+$/.test(v)) throw new BadRequestException(`${label} inválido`);
      return Number(v);
    };
    const limit = toInt(q.limit, 'limit');
    const offset = toInt(q.offset, 'offset');
    return req.withTenantContext((client: any) =>
      this.employees.findTable(client, {
        tenantId: q.tenant_id || undefined,
        companyUnitId: q.company_unit_id || undefined,
        limit,
        offset,
      }),
    );
  }

  @Roles('empresa', 'admin')
  @Get(':id/history')
  history(@Param('id') id: string, @Query('limit') limit: string, @Query('offset') offset: string, @Req() req: any) {
    const parse = (v: string | undefined, def: number) =>
      v === undefined ? def : /^\d+$/.test(v) ? Number(v) : NaN;
    const l = parse(limit, 50);
    const o = parse(offset, 0);
    if (!Number.isSafeInteger(l) || l < 1 || l > 200 || !Number.isSafeInteger(o)) {
      throw new BadRequestException('limit deve ser de 1 a 200 e offset deve ser 0 ou maior');
    }
    return req.withTenantContext((client: any) => this.employees.history(client, id, l, o));
  }

  @Roles('empresa', 'admin')
  @Patch('bulk')
  async bulkUpdate(@Body() dto: BulkUpdateEmployeesDto, @Req() req: any) {
    const changes = dto.changes ?? [];
    const result = await req.withTenantContext((client: any) =>
      this.employees.bulkUpdate(client, changes, req.user.role),
    );
    // O interceptor genérico só vê "PATCH /employees/bulk" (sem id). Aqui, depois do commit,
    // registra-se um evento por funcionário com os NOMES dos campos alterados — nunca os valores
    // (CPF e dados pessoais não entram no log). AuditService.log nunca lança.
    for (const change of changes) {
      const names = Object.keys(normalizeEmployeeInput(change.fields ?? {}).values);
      if (names.length === 0) continue;
      await this.audit.log({
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
        actorTenantId: req.user?.tenantId ?? null,
        action: 'bulk_update',
        resourceType: 'employees',
        resourceId: String(change.id).toLowerCase(),
        method: 'PATCH',
        path: '/employees/bulk',
        statusCode: 200,
        ipAddress: req.ip ?? null,
        detail: `campos: ${names.join(', ')}`,
      });
    }
    return result;
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req
      .withTenantContext((client: any) => this.employees.findOne(client, id))
      .then((row: Employee) => this.cpfForRole(row, req.user.role));
  }

  @Roles('empresa', 'admin')
  @Patch(':id')
  // id que não é UUID vira 400 aqui (antes chegava ao pg como 22P02 e podia virar 500).
  update(@Param('id', EMPLOYEE_ID_PIPE) id: string, @Body() dto: UpdateEmployeeDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.employees.update(client, id, dto, req.user.role));
  }

  @Roles('empresa', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.employees.remove(client, id));
  }
}
