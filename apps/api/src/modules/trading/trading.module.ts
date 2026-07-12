import { Module } from "@nestjs/common";
import { TradingService } from "./trading.service";
import { TradingController } from "./trading.controller";
import { RfqService } from "./rfq.service";
import { RfqController } from "./rfq.controller";
import { CommissionController } from "./commission.controller";
import { InventoryModule } from "../inventory/inventory.module";
import { FulfillmentModule } from "../fulfillment/fulfillment.module";

@Module({
  imports: [InventoryModule, FulfillmentModule],
  controllers: [TradingController, RfqController, CommissionController],
  providers: [TradingService, RfqService],
  exports: [TradingService],
})
export class TradingModule {}
