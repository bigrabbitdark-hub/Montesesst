import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength,
} from 'class-validator';
import { TRAINING_TYPES } from '../../../cipa/trainings.service';
import { AVALIACOES, CATEGORIAS_PERIGO, IsPsicossocial } from './perigo.dto';

export const MAX_PERIGOS_POR_REQUISICAO = 100;
export const EXPOSICOES = ['habitual_permanente', 'intermitente', 'eventual'] as const;
export const STATUS_RISCO = ['rascunho', 'completo'] as const;
export const TIPOS_CONTROLE = ['epc', 'epi', 'administrativa', 'treinamento'] as const;
export const STATUS_CONTROLE = ['existente', 'planejado', 'nao_implementado'] as const;
export const EFICACIAS = ['eficaz', 'ineficaz', 'nao_avaliada'] as const;

const em = (l: readonly string[]) => l as unknown as string[];
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// Cria riscos copiando os VALORES de perigos da biblioteca. Sem campos de conteúdo: tudo vem do perigo.
export class CriarRiscosDto {
  @IsArray() @ArrayMinSize(1, { message: 'Informe ao menos 1 perigo' })
  @ArrayMaxSize(MAX_PERIGOS_POR_REQUISICAO) @IsUUID('all', { each: true })
  hazard_ids!: string[];

  // O perigo da biblioteca não traz exposição; omitido ⇒ nulo (nenhum dado técnico presumido).
  @IsOptional() @IsIn(em(EXPOSICOES)) exposure_type?: string;
}

// Todos opcionais; o serviço recusa corpo vazio, nulos em campos obrigatórios e só toca colunas da lista branca.
export class AtualizarRiscoDto {
  @IsOptional() @IsIn(em(CATEGORIAS_PERIGO), { message: 'categoria inválida' }) category?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) sources?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) health_effects?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(100, { each: true }) exposure_routes?: string[] | null;
  @IsOptional() @IsString() @MaxLength(500) tolerance_limit?: string | null;
  @IsOptional() @IsString() @MaxLength(500) tolerance_reference?: string | null;
  @IsOptional() @IsPsicossocial() psychosocial?: Record<string, unknown> | null;
  @IsOptional() @IsString() @MaxLength(4000) activity?: string | null;
  @IsOptional() @IsIn(em(EXPOSICOES)) exposure_type?: string;
  @IsOptional() @IsString() @MaxLength(20, { message: 'esocial_code deve ter no máximo 20 caracteres' }) esocial_code?: string | null;
  @IsOptional() @IsIn(em(AVALIACOES)) assessment_type?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) assessment_notes?: string | null;
  @IsOptional() @IsIn(em(STATUS_RISCO)) status?: string;
}

export class CriarControleDto {
  @IsIn(em(TIPOS_CONTROLE)) kind!: string;
  @IsString() @MinLength(1) @MaxLength(2000) description!: string;
  @IsIn(em(STATUS_CONTROLE)) status!: string; // sem padrão: o sócio informa se o controle existe, é planejado ou não implementado
  @IsOptional() @IsIn(em(EFICACIAS)) effectiveness?: string;
  @IsOptional() @IsUUID() epi_catalog_item_id?: string | null;
  @IsOptional() @IsIn(em(TRAINING_TYPES), { message: 'training_tipo inválido' }) training_tipo?: string | null;
}

export class AtualizarControleDto {
  @IsOptional() @IsIn(em(TIPOS_CONTROLE)) kind?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) description?: string;
  @IsOptional() @IsIn(em(STATUS_CONTROLE)) status?: string;
  @IsOptional() @IsIn(em(EFICACIAS)) effectiveness?: string;
  @IsOptional() @IsUUID() epi_catalog_item_id?: string | null;
  @IsOptional() @IsIn(em(TRAINING_TYPES), { message: 'training_tipo inválido' }) training_tipo?: string | null;
}

// Medição quantitativa: só guarda o que foi informado (nenhum limite/nível de ação é calculado).
export class CriarMedicaoDto {
  @IsString() @MinLength(1) @MaxLength(200) agent!: string;
  @IsOptional() @IsString() @MaxLength(500) value?: string | null;
  @IsOptional() @IsString() @MaxLength(100) unit?: string | null;
  @IsOptional() @IsString() @MaxLength(500) tolerance_limit?: string | null;
  @IsOptional() @IsString() @MaxLength(500) reference?: string | null;
  @IsOptional() @IsString() @MaxLength(500) methodology?: string | null;
  @IsOptional() @IsString() @MaxLength(200) equipment?: string | null;
  @IsOptional() @IsString() @MaxLength(100) equipment_serial?: string | null;
  @IsOptional() @Matches(DATA, { message: 'calibration_date deve ser AAAA-MM-DD' }) @IsISO8601({ strict: true }) calibration_date?: string | null;
  @IsOptional() @Matches(DATA, { message: 'evaluated_on deve ser AAAA-MM-DD' }) @IsISO8601({ strict: true }) evaluated_on?: string | null;
  @IsOptional() @IsString() @MaxLength(200) responsible_name?: string | null;
  @IsOptional() @IsUUID() professional_registration_id?: string | null;
  @IsOptional() @IsUUID() document_id?: string | null;
}

export class AtualizarMedicaoDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) agent?: string;
  @IsOptional() @IsString() @MaxLength(500) value?: string | null;
  @IsOptional() @IsString() @MaxLength(100) unit?: string | null;
  @IsOptional() @IsString() @MaxLength(500) tolerance_limit?: string | null;
  @IsOptional() @IsString() @MaxLength(500) reference?: string | null;
  @IsOptional() @IsString() @MaxLength(500) methodology?: string | null;
  @IsOptional() @IsString() @MaxLength(200) equipment?: string | null;
  @IsOptional() @IsString() @MaxLength(100) equipment_serial?: string | null;
  @IsOptional() @Matches(DATA, { message: 'calibration_date deve ser AAAA-MM-DD' }) @IsISO8601({ strict: true }) calibration_date?: string | null;
  @IsOptional() @Matches(DATA, { message: 'evaluated_on deve ser AAAA-MM-DD' }) @IsISO8601({ strict: true }) evaluated_on?: string | null;
  @IsOptional() @IsString() @MaxLength(200) responsible_name?: string | null;
  @IsOptional() @IsUUID() professional_registration_id?: string | null;
  @IsOptional() @IsUUID() document_id?: string | null;
}

export class CopiarRiscosDto {
  @IsUUID() from_ghe_id!: string;
}
