import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './common/database/database.module';
import { AuditModule } from './common/audit/audit.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ContactModule } from './contact/contact.module';
import { PaymentsModule } from './payments/payments.module';
import { EmployeesModule } from './employees/employees.module';
import { TechniciansModule } from './technicians/technicians.module';
import { PartnersModule } from './partners/partners.module';
import { TenantsModule } from './tenants/tenants.module';
import { CompanyUnitsModule } from './company-units/company-units.module';
import { TenantTechniciansModule } from './tenant-technicians/tenant-technicians.module';
import { DocumentsModule } from './documents/documents.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RedisModule } from './common/redis/redis.module';
import { EmailModule } from './common/email/email.module';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    EmailModule,
    AuditModule,
    HealthModule,
    AuthModule,
    ContactModule,
    PaymentsModule,
    EmployeesModule,
    TechniciansModule,
    PartnersModule,
    TenantsModule,
    CompanyUnitsModule,
    TenantTechniciansModule,
    DocumentsModule,
  ],
  providers: [
    // Ordem importa: RateLimitGuard barra abuso antes de qualquer auth;
    // JwtAuthGuard popula request.user antes do RolesGuard checar @Roles().
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
