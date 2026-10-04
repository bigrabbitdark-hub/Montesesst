import { Module } from '@nestjs/common';
import { PenteFinoController } from './pente-fino.controller';
import { PenteFinoComparisonService } from './pente-fino-comparison.service';
import { PenteFinoExtractorService } from './pente-fino-extractor.service';
import { DocumentChecklistExtractorService } from './document-checklist-extractor.service';
import { FUNCTION_EXTRACTION_PROVIDER } from './function-extraction-provider.interface';
import { MiniMaxFunctionExtractionService } from './minimax-function-extraction.service';
import { DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER } from './document-checklist-provider.interface';
import { MiniMaxDocumentChecklistService } from './minimax-document-checklist.service';
import { LipAgentExtractorService } from './lip-agent-extractor.service';
import { LIP_AGENT_EXTRACTION_PROVIDER } from './lip-agent-provider.interface';
import { MiniMaxLipAgentService } from './minimax-lip-agent.service';
import { SstAuditFactsService } from './sst-audit-facts.service';
import { MiniMaxSstAuditFactsProviderService } from './minimax-sst-audit-facts-provider.service';
import { SST_AUDIT_FACTS_PROVIDER } from './sst-audit-facts-provider.interface';

@Module({
  controllers: [PenteFinoController],
  providers: [
    PenteFinoComparisonService,
    PenteFinoExtractorService,
    DocumentChecklistExtractorService,
    LipAgentExtractorService,
    MiniMaxFunctionExtractionService,
    { provide: FUNCTION_EXTRACTION_PROVIDER, useClass: MiniMaxFunctionExtractionService },
    MiniMaxDocumentChecklistService,
    { provide: DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER, useClass: MiniMaxDocumentChecklistService },
    MiniMaxLipAgentService,
    { provide: LIP_AGENT_EXTRACTION_PROVIDER, useClass: MiniMaxLipAgentService },
    SstAuditFactsService,
    MiniMaxSstAuditFactsProviderService,
    { provide: SST_AUDIT_FACTS_PROVIDER, useClass: MiniMaxSstAuditFactsProviderService },
  ],
})
export class PenteFinoModule {}
