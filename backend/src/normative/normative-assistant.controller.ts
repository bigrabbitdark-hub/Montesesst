import { Body, Controller, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';
import { NormativeAssistantService } from './normative-assistant.service';
import { NormativeQueryDto } from './dto/normative-query.dto';

@Controller('assistant')
export class NormativeAssistantController {
  constructor(private readonly assistant: NormativeAssistantService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @RateLimit({
    limit: envInt('ASSISTANT_RATE_LIMIT_MAX', 20),
    windowSeconds: envInt('ASSISTANT_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('normative-query')
  query(@Body() dto: NormativeQueryDto) {
    return this.assistant.query(dto.question);
  }
}
