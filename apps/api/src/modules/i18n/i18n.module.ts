import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TranslationService } from "./translation.service";
import { TranslationController } from "./translation.controller";
import { LlmPort } from "./llm.port";
import { DeepSeekLlmAdapter, FakeLlmAdapter } from "./llm.adapters";

@Module({
  controllers: [TranslationController],
  providers: [
    TranslationService,
    {
      provide: LlmPort,
      inject: [ConfigService],
      useFactory: (config: ConfigService): LlmPort => {
        const key = config.get<string>("DEEPSEEK_API_KEY") ?? "";
        const isPlaceholder = !key || key === "sk-xxx";
        return isPlaceholder ? new FakeLlmAdapter() : new DeepSeekLlmAdapter(key);
      },
    },
  ],
  exports: [TranslationService],
})
export class I18nModule {}
