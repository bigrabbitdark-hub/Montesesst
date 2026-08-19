import { Controller, Get, Query } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { Public } from '../common/decorators/public.decorator';

interface PlanRow {
  id: string;
  audience: string;
  slug: string;
  name: string;
  price_cents: number;
  employee_limit: number | null;
}

@Controller('plans')
export class PlansController {
  constructor(private readonly db: DatabaseService) {}

  @Public()
  @Get()
  async findAll(@Query('audience') audience?: string) {
    return this.db.withoutTenantContext(async (client) => {
      const result = audience
        ? await client.query<PlanRow>(
            'SELECT id, audience, slug, name, price_cents, employee_limit FROM plans WHERE active = true AND audience = $1 ORDER BY price_cents',
            [audience],
          )
        : await client.query<PlanRow>(
            'SELECT id, audience, slug, name, price_cents, employee_limit FROM plans WHERE active = true ORDER BY audience, price_cents',
          );
      return result.rows;
    });
  }
}
