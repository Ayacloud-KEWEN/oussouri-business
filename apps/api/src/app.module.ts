import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { validateEnv } from "./kernel/config/env.validation";
import { PrismaModule } from "./kernel/prisma/prisma.module";
import { KernelModule } from "./kernel/kernel.module";
import { HealthController } from "./kernel/health/health.controller";
import { IamModule } from "./modules/iam/iam.module";
import { PartyModule } from "./modules/party/party.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { InventoryModule } from "./modules/inventory/inventory.module";
import { TradingModule } from "./modules/trading/trading.module";
import { SettlementModule } from "./modules/settlement/settlement.module";
import { CommunicationModule } from "./modules/communication/communication.module";
import { BrokerageModule } from "./modules/brokerage/brokerage.module";
import { FulfillmentModule } from "./modules/fulfillment/fulfillment.module";
import { TraceabilityModule } from "./modules/traceability/traceability.module";
import { FilesModule } from "./modules/files/files.module";
import { I18nModule } from "./modules/i18n/i18n.module";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { VisibilityInterceptor } from "./kernel/visibility/visibility.interceptor";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    PrismaModule,
    KernelModule,
    IamModule,
    PartyModule,
    CatalogModule,
    InventoryModule,
    TradingModule,
    SettlementModule,
    CommunicationModule,
    BrokerageModule,
    FulfillmentModule,
    TraceabilityModule,
    FilesModule,
    I18nModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: VisibilityInterceptor },
  ],
})
export class AppModule {}
