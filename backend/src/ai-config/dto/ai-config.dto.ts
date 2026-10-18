import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { AI_PROVIDERS, AiProviderId } from '../ai-config.types';

export class UpdateAiConfigDto {
  // Chave é string pura (não confidenciais especiais de provider). Limite
  // superior cobre até tokens longos (OpenRouter já emite ~80 chars). Sem
  // limite inferior rígido: providers diferentes usam prefixos e tamanhos
  // próprios — uma validação mais específica quebraria a troca de provedor.
  // O NUNCA aparece em log (ver redactor no AiConfigService).
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  apiKey: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model: string;
}

export class AiProviderParamDto {
  @IsIn(AI_PROVIDERS as readonly string[], {
    message: `provider deve ser um de: ${AI_PROVIDERS.join(', ')}`,
  })
  provider: AiProviderId;
}
