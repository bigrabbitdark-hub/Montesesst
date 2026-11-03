import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { IsDataReal } from '../../dto/validators';
import { DOC_STATUS } from '../documento-fluxo';

// Mesmo domínio de documents.category e dos CHECKs da migration 0096 (12 valores).
export const CATEGORIAS_DOCUMENTO = [
  'pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento',
  'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo',
  'ltcat', 'lip', 'relatorio_visita',
] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateDocumentoDto {
  @IsUUID() tenant_id!: string;
  @IsIn(CATEGORIAS_DOCUMENTO as unknown as string[]) category!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsUUID() company_unit_id?: string;
}

// Corpo multipart da nova versão: o arquivo vem em `file`; só a nota é campo de texto.
export class NovaVersaoDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) note?: string;
}

// Transições sem corpo (enviar-revisao, aprovar, assinar): qualquer propriedade (tenant_id,
// created_by, status, actor...) é rejeitada pelo ValidationPipe global (forbidNonWhitelisted).
export class TransicaoSemCorpoDto {}

// devolver e cancelar: a nota é obrigatória.
export class TransicaoComNotaDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) note!: string;
}

export class PublicarDocumentoDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDataReal() expires_at?: string;
}

export class ListDocumentosQuery {
  @IsOptional() @IsIn(DOC_STATUS as unknown as string[]) status?: string;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsIn(CATEGORIAS_DOCUMENTO as unknown as string[]) category?: string;
}

// devolver: nota obrigatória (vira a descrição da correção) + responsável (sócio ativo) e prazo opcionais.
export class DevolverDocumentoDto extends TransicaoComNotaDto {
  @IsOptional() @IsUUID() responsavel_id?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDataReal() prazo?: string;
}

// Correção pedida pelo cliente ou identificada internamente, sem devolver o documento.
export class CreateCorrecaoDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) description!: string;
  @IsIn(['cliente', 'interna']) origin!: 'cliente' | 'interna';
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) requester_label?: string;
  @IsOptional() @IsUUID() responsavel_id?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDataReal() prazo?: string;
}

export const ACOES_CORRECAO = ['corrigir', 'verificar', 'reabrir', 'cancelar', 'ajustar'] as const;
export class UpdateCorrecaoDto {
  @IsIn(ACOES_CORRECAO as unknown as string[]) acao!: (typeof ACOES_CORRECAO)[number];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) nota?: string;
  @IsOptional() @IsUUID() responsavel_id?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDataReal() prazo?: string;
}
