import { Module } from "@nestjs/common";
import { FulfillmentService } from "./fulfillment.service";
import { FulfillmentController } from "./fulfillment.controller";
import { CommunicationModule } from "../communication/communication.module";

@Module({
  imports: [CommunicationModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
