import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SettlementService } from "./settlement.service";
import { SettlementController } from "./settlement.controller";
import { StripePort } from "./stripe.port";
import { FakeStripeAdapter, RestStripeAdapter } from "./stripe.adapters";
import { TradingModule } from "../trading/trading.module";

@Module({
  imports: [TradingModule],
  controllers: [SettlementController],
  providers: [
    SettlementService,
    {
      provide: StripePort,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StripePort => {
        const key = config.get<string>("STRIPE_SECRET_KEY") ?? "";
        const isPlaceholder = !key || key === "sk_test_xxx";
        if (isPlaceholder && config.get("NODE_ENV") === "production") {
          throw new Error("生产环境必须配置真实 STRIPE_SECRET_KEY");
        }
        return isPlaceholder
          ? new FakeStripeAdapter()
          : new RestStripeAdapter(
              key,
              config.get<string>("STRIPE_WEBHOOK_SECRET") ?? "",
              config.get<string>("STRIPE_PUBLISHABLE_KEY") ?? "",
            );
      },
    },
  ],
  exports: [SettlementService],
})
export class SettlementModule {}
