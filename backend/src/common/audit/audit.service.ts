import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface AuditEntry {
  actorUserId?: string | null;
  actorRole?: string | null;
  actorTenantId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  method: string;
  path: string;
  statusCode: number;
  ipAddress?: string | null;
  detail?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly db: DatabaseService) {}

  // Nunca lança: uma falha ao gravar auditoria não pode derrubar a
  // requisição original que está sendo auditada.
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.db.withoutTenantContext((client) =>
        client.query(
          `INSERT INTO audit_log
             (actor_user_id, actor_role, actor_tenant_id, action, resource_type,
              resource_id, method, path, status_code, ip_address, detail)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            entry.actorUserId ?? null,
            entry.actorRole ?? null,
            entry.actorTenantId ?? null,
            entry.action,
            entry.resourceType,
            entry.resourceId ?? null,
            entry.method,
            entry.path,
            entry.statusCode,
            entry.ipAddress ?? null,
            entry.detail ?? null,
          ],
        ),
      );
    } catch (err) {
      this.logger.error('Falha ao gravar log de auditoria', err as Error);
    }
  }
}
