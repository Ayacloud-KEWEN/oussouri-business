import { Module } from "@nestjs/common";
import { PartyService } from "./party.service";
import { PartyController } from "./party.controller";

@Module({
  controllers: [PartyController],
  providers: [PartyService],
  exports: [PartyService],
})
export class PartyModule {}
