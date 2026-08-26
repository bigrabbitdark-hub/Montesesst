import { Controller, Get, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditLogService } from './audit-log.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseOffset(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Roles('admin')
  @Get()
  findAll(
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Query('resource_type') resourceType: string | undefined,
    @Query('tenant_id') tenantId: string | undefined,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) =>
      this.auditLog.findAll(client, {
        limit: parseLimit(limit),
        offset: parseOffset(offset),
        resourceType,
        tenantId,
      }),
    );
  }
}
