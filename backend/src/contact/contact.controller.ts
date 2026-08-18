import { Body, Controller, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactDto } from './dto/contact.dto';
import { Public } from '../common/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Public()
  @RateLimit({
    limit: envInt('CONTACT_RATE_LIMIT_MAX', 10),
    windowSeconds: envInt('CONTACT_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  async create(@Body() dto: ContactDto) {
    await this.contact.send(dto);
    return { message: 'Mensagem enviada — retornaremos em breve.' };
  }
}
