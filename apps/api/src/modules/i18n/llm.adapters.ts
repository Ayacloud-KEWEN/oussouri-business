import { Logger } from "@nestjs/common";
import { LlmPort } from "./llm.port";

const LOCALE_NAMES: Record<string, string> = { "zh-CN": "Simplified Chinese", en: "English", fr: "French" };

/** 开发/未配置密钥：生成带标记的伪译文，管道可演示，复核时一眼可辨 */
export class FakeLlmAdapter extends LlmPort {
  async translate(text: string, _source: string, targetLocale: string): Promise<string> {
    return `[${targetLocale}] ${text}`;
  }
}

/** DeepSeek chat completions（OpenAI 兼容） */
export class DeepSeekLlmAdapter extends LlmPort {
  private readonly logger = new Logger("Llm");

  constructor(
    private readonly apiKey: string,
    private readonly apiUrl = "https://api.deepseek.com",
    private readonly model = "deepseek-chat",
  ) {
    super();
  }

  async translate(text: string, sourceLocale: string, targetLocale: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.apiUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: `You translate caviar/aquaculture B2B product copy from ${LOCALE_NAMES[sourceLocale] ?? sourceLocale} to ${LOCALE_NAMES[targetLocale] ?? targetLocale}. Reply with the translation only, no explanations.`,
            },
            { role: "user", content: text.slice(0, 4000) },
          ],
        }),
      });
      if (!res.ok) {
        this.logger.warn(`LLM API ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return json.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (err) {
      this.logger.warn(`LLM API error: ${(err as Error).message}`);
      return null;
    }
  }
}
