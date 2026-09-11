import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
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
import { InspectionsModule } from './inspections/inspections.module';
import { EpiModule } from './epi/epi.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { OverviewModule } from './overview/overview.module';
import { SystemStatusModule } from './system-status/system-status.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NormativeModule } from './normative/normative.module';
import { VisitsModule } from './visits/visits.module';
import { CipaModule } from './cipa/cipa.module';
import { CaepiModule } from './caepi/caepi.module';
import { PositionsModule } from './positions/positions.module';
import { PenteFinoModule } from './pente-fino/pente-fino.module';
import { FireSafetyEquipmentModule } from './fire-safety-equipment/fire-safety-equipment.module';
import { FireBrigadeModule } from './fire-brigade/fire-brigade.module';
import { PreventionCorrectiveActionsModule } from './prevention-corrective-actions/prevention-corrective-actions.module';
import { PreventionChecklistModule } from './prevention-checklist/prevention-checklist.module';
import { EmergencyDrillModule } from './emergency-drill/emergency-drill.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RedisModule } from './common/redis/redis.module';
import { EmailModule } from './common/email/email.module';
import { R2Module } from './common/r2/r2.module';
import { EmbeddingModule } from './common/embedding/embedding.module';
import { AiUsageModule } from './common/ai-usage/ai-usage.module';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    DatabaseModule,
    ScheduleModule.forRoot(),
    RedisModule,
    EmailModule,
    R2Module,
    EmbeddingModule,
    AiUsageModule,
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
    InspectionsModule,
    EpiModule,
    AuditLogModule,
    OverviewModule,
    SystemStatusModule,
    DashboardModule,
    NormativeModule,
    VisitsModule,
    CipaModule,
    CaepiModule,
    PositionsModule,
    PenteFinoModule,
    FireSafetyEquipmentModule,
    FireBrigadeModule,
    PreventionCorrectiveActionsModule,
    PreventionChecklistModule,
    EmergencyDrillModule,
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
