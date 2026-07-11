import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CatalogService } from "./catalog.service";
import { CatalogController } from "./catalog.controller";
import { MarketController } from "./market.controller";
import { EmbeddingPort } from "./embedding.port";
import { NullEmbeddingAdapter, RestEmbeddingAdapter } from "./embedding.adapters";

@Module({
  controllers: [CatalogController, MarketController],
  providers: [
    CatalogService,
    {
      provide: EmbeddingPort,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EmbeddingPort => {
        const url = config.get<string>("EMBEDDING_API_URL");
        return url
          ? new RestEmbeddingAdapter(url, config.get<string>("EMBEDDING_API_KEY") ?? "", config.get<string>("EMBEDDING_MODEL") ?? "text-embedding-3-small")
          : new NullEmbeddingAdapter();
      },
    },
  ],
  exports: [CatalogService, EmbeddingPort],
})
export class CatalogModule {}
