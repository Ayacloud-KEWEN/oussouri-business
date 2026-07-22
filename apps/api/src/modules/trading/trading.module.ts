import { Module } from "@nestjs/common";
import { TradingService } from "./trading.service";
import { TradingController } from "./trading.controller";
import { RfqService } from "./rfq.service";
import { RfqController } from "./rfq.controller";
import { CommissionController } from "./commission.controller";
import { ContractService } from "./contract.service";
import { MilestoneService } from "./milestone.service";
import { DisputeService } from "./dispute.service";
import { InventoryModule } from "../inventory/inventory.module";
import { FulfillmentModule } from "../fulfillment/fulfillment.module";
import { CommunicationModule } from "../communication/communication.module";

@Module({
  imports: [InventoryModule, FulfillmentModule, CommunicationModule],
  controllers: [TradingController, RfqController, CommissionController],
  providers: [TradingService, RfqService, ContractService, MilestoneService, DisputeService],
  // MilestoneService 供 SettlementModule 归集分期付款
  exports: [TradingService, MilestoneService],
})
export class TradingModule {}
