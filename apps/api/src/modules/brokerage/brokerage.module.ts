import { Module } from "@nestjs/common";
import { BrokerageService } from "./brokerage.service";
import { MatchmakingService } from "./matchmaking.service";
import { BrokerageController } from "./brokerage.controller";
import { InventoryModule } from "../inventory/inventory.module";
import { CommunicationModule } from "../communication/communication.module";

@Module({
  imports: [InventoryModule, CommunicationModule],
  controllers: [BrokerageController],
  providers: [BrokerageService, MatchmakingService],
})
export class BrokerageModule {}
