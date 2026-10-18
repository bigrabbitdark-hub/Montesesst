import { Injectable } from '@nestjs/common';
import { DatabaseService, TenantContext } from '../common/database/database.service';
import { Document } from '../documents/documents.service';
import { PenteFinoReport } from './pente-fino-comparison.service';
import { SstAuditFactsService } from './sst-audit-facts.service';
import { assembleSstAuditInput, SstAuditAssemblerDocument, SstAuditDocType } from './sst-audit-assembler';
import { buildSstAuditReport, SstAuditReport } from './sst-audit-report.service';

const DOC_TYPES: SstAuditDocType[] = ['pgr', 'pcmso', 'ltcat', 'lip'];

@Injectable()
export class SstAuditService {
  constructor(
    private readonly db: DatabaseService,
    private readonly facts: SstAuditFactsService,
  ) {}

  // `report` já passou pela autorização de PenteFinoComparisonService.run; aqui
  // só se usam os ids de documento dele. O `ctx` vem do JWT (nunca do tenantId
  // alvo) e a leitura continua sob RLS.
  async build(
    ctx: TenantContext,
    tenantId: string,
    report: PenteFinoReport,
    now: Date = new Date(),
  ): Promise<SstAuditReport> {
    const refs: Record<SstAuditDocType, { id: string } | null> = {
      pgr: report.pgr_document,
      pcmso: report.pcmso_document,
      ltcat: report.ltcat_document,
      lip: report.lip_document,
    };
    const ids = DOC_TYPES.map((type) => refs[type]?.id).filter((id): id is string => Boolean(id));

    const { documents, companyName } = await this.db.withTenantContext(ctx, async (client) => {
      const docs = ids.length
        ? await client.query<Document>(
            `SELECT * FROM documents WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
            [ids, tenantId],
          )
        : { rows: [] as Document[] };
      const tenant = await client.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenantId]);
      return { documents: docs.rows, companyName: tenant.rows[0]?.name ?? 'Empresa' };
    });

    const byId = new Map(documents.map((document) => [document.id, document]));
    const assembled: SstAuditAssemblerDocument[] = [];
    const missingTypes: SstAuditDocType[] = [];
    for (const type of DOC_TYPES) {
      const ref = refs[type];
      const document = ref ? byId.get(ref.id) : undefined;
      if (!document) {
        missingTypes.push(type);
        continue;
      }
      assembled.push({ type, id: document.id, title: document.title, extraction: await this.facts.getFacts(ctx, document) });
    }

    return buildSstAuditReport(
      assembleSstAuditInput({
        auditDate: now,
        company: { id: tenantId, name: companyName },
        documents: assembled,
        missingTypes,
      }),
    );
  }
}
