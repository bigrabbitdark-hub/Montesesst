import { Body, Controller, Get, Param, Patch, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PlansService } from './plans.service';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Public()
  @Get()
  async findAll(@Query('audience') audience: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.plans.findAll(client, audience));
  }

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.plans.update(client, id, dto));
  }
}
