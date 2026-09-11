import { BadRequestException, Body, Controller, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { PenteFinoComparisonService } from './pente-fino-comparison.service';
import { RunPenteFinoDto } from './dto/run-pente-fino.dto';

@Controller('pente-fino')
export class PenteFinoController {
  constructor(private readonly comparison: PenteFinoComparisonService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('run')
  run(@Body() dto: RunPenteFinoDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');
    return this.comparison.run(tenantId, user.id, user.role);
  }
}
