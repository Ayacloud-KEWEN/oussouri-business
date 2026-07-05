import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BrokerageService } from "./brokerage.service";
import { MatchmakingService } from "./matchmaking.service";
import { BrokerageController, TwilioWebhookController } from "./brokerage.controller";
import { TelephonyPort, FakeTelephonyAdapter, TwilioRestAdapter } from "./telephony.port";
import { InventoryModule } from "../inventory/inventory.module";
import { CommunicationModule } from "../communication/communication.module";

@Module({
  imports: [InventoryModule, CommunicationModule],
  controllers: [BrokerageController, TwilioWebhookController],
  providers: [
    BrokerageService,
    MatchmakingService,
    {
      provide: TelephonyPort,
      inject: [ConfigService],
      useFactory: (config: ConfigService): TelephonyPort => {
        const sid = config.get<string>("TWILIO_ACCOUNT_SID") ?? "";
        const token = config.get<string>("TWILIO_AUTH_TOKEN") ?? "";
        const isPlaceholder = !sid || sid === "ACxxx" || !token || token === "xxx";
        if (isPlaceholder) return new FakeTelephonyAdapter();
        return new TwilioRestAdapter(
          sid,
          token,
          config.get<string>("TWILIO_FROM_NUMBER") ?? "",
          `${config.get<string>("WEB_URL") ?? ""}/api/v1/webhooks/twilio/call-status`,
        );
      },
    },
  ],
})
export class BrokerageModule {}
