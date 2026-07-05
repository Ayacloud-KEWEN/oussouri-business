import { Module } from "@nestjs/common";
import { TradingService } from "./trading.service";
import { TradingController } from "./trading.controller";
import { RfqService } from "./rfq.service";
import { RfqController } from "./rfq.controller";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  imports: [InventoryModule],
  controllers: [TradingController, RfqController],
  providers: [TradingService, RfqService],
  exports: [TradingService],
})
export class TradingModule {}
