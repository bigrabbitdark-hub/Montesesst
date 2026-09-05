import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';
import { RedisService } from '../common/redis/redis.service';
import { NormativeAssistantService } from './normative-assistant.service';
import { NormativeQueryDto } from './dto/normative-query.dto';

const ALLOWED_ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

@Controller('assistant')
export class NormativeAssistantController {
  constructor(
    private readonly assistant: NormativeAssistantService,
    private readonly redis: RedisService,
  ) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @RateLimit({
    limit: envInt('ASSISTANT_RATE_LIMIT_MAX', 20),
    windowSeconds: envInt('ASSISTANT_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @Post('normative-query')
  async query(
    @Body() dto: NormativeQueryDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: any,
  ) {
    if (file) {
      if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.mimetype)) {
        throw new BadRequestException('Tipo de arquivo não permitido (só PDF, JPG ou PNG)');
      }

      // Limite dedicado e mais apertado que ASSISTANT_RATE_LIMIT_MAX
      // (20/hora, cobre a rota inteira) — uma pergunta com anexo custa
      // bem mais tokens. @RateLimit acima é estático por rota, não
      // diferencia se ESTA chamada tem arquivo ou não, então esse
      // segundo contador roda manualmente aqui, com sua própria chave
      // Redis isolada (nunca dividida com o contador geral da rota),
      // usando o mesmo primitivo que o RateLimitGuard global usa.
      const limit = envInt('ASSISTANT_ATTACHMENT_RATE_LIMIT_MAX', 10);
      const windowSeconds = envInt('ASSISTANT_ATTACHMENT_RATE_LIMIT_WINDOW_SECONDS', 3600);
      const key = `ratelimit:AssistantAttachment:${req.ip ?? 'unknown'}`;
      const result = await this.redis.incrementWithWindow(key, windowSeconds);
      if (result.count > limit) {
        throw new HttpException(
          'Muitas perguntas com anexo, tente novamente mais tarde',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return this.assistant.query(
      dto.question,
      req.user,
      file ? { buffer: file.buffer, mimetype: file.mimetype } : undefined,
    );
  }
}
