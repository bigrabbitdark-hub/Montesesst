import { Body, Controller, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { NormativeAssistantService } from './normative-assistant.service';
import { NormativeQueryDto } from './dto/normative-query.dto';

@Controller('assistant')
export class NormativeAssistantController {
  constructor(private readonly assistant: NormativeAssistantService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('normative-query')
  query(@Body() dto: NormativeQueryDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.assistant.query(client, dto.question));
  }
}
