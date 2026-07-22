import { Module } from "@nestjs/common";
import { FulfillmentService } from "./fulfillment.service";
import { DocumentRedactor } from "./document-redactor";
import { FulfillmentController } from "./fulfillment.controller";
import { CommunicationModule } from "../communication/communication.module";

@Module({
  imports: [CommunicationModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService, DocumentRedactor],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
