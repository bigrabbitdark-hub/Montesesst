import { IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class CreateDocumentDto {
  // 'relatorio_visita' foi acrescentada na Etapa 1 do Relatório de
  // Visita Técnica: é a única categoria aceita pelo
  // DocumentsService.upload que ainda não estava no @IsIn (estava só
  // na constante ALLOWED_CATEGORIES do service, usada pelo caminho
  // interno InspectionsService.conclude() -> documents.upload() que
  // não passa por DTO). Sem isso, o upload manual via /documents
  // com category=relatorio_visita era rejeitado em 400. As
  // categorias 'cipa_*' continuam fora do @IsIn de propósito — ver
  // comentário equivalente em DocumentsPanel.tsx.
  @IsIn(['pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento', 'ltcat', 'lip', 'relatorio_visita'])
  category: string;

  @IsString()
  @MaxLength(200)
  title: string;

  // Data de início da vigência (opcional). Validamos com isDateOnly no
  // controller antes de chamar o service — o IsISO8601 aceitava timestamp
  // com hora/fuso, e o contrato é estritamente 'AAAA-MM-DD'.
  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  valid_from?: string | null;

  // Vencimento manual (opcional). Mesma regra: 'AAAA-MM-DD' ou null.
  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  expires_at?: string | null;

  // Só é lido quando quem envia é role 'tecnico' ou 'parceiro' (empresa
  // sempre usa o próprio tenant_id do token).
  @IsOptional()
  @IsUUID()
  tenant_id?: string;

  // Opcional — documento sem isso é considerado "não especificado" (não
  // é obrigatório escolher matriz/filial pra continuar enviando).
  @IsOptional()
  @IsUUID()
  company_unit_id?: string;

  // Etapa 1 do Relatório de Visita Técnica: vínculo opcional a uma
  // inspeção já existente. Quando presente, o DocumentsService
  // valida que a inspeção (a) existe e (b) pertence ao mesmo tenant
  // do documento — defense in depth, já que a FK no banco só
  // garante (a). Sem esse campo o documento é gravado sem vínculo
  // (preserva o comportamento atual de todas as outras categorias).
  @IsOptional()
  @IsUUID()
  inspection_id?: string;
}
