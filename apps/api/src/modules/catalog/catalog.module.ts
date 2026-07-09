import { Module } from "@nestjs/common";
import { CatalogService } from "./catalog.service";
import { CatalogController } from "./catalog.controller";
import { MarketController } from "./market.controller";

@Module({
  controllers: [CatalogController, MarketController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
