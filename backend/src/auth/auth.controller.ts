import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @RateLimit({
    limit: envInt('AUTH_RATE_LIMIT_MAX', 10),
    windowSeconds: envInt('AUTH_RATE_LIMIT_WINDOW_SECONDS', 900),
    keyBy: 'ip-email',
  })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.authService.login(dto.email, dto.password, req.ip);
  }

  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }
}
