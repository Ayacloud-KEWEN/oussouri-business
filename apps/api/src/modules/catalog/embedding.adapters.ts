import { Logger } from "@nestjs/common";
import { EmbeddingPort } from "./embedding.port";

/** 未配置提供方：返回 null，语义搜索降级为全文 */
export class NullEmbeddingAdapter extends EmbeddingPort {
  async embed(): Promise<null> {
    return null;
  }
}

/** OpenAI 兼容 /embeddings 端点（OVH AI Endpoints / OpenAI / 自建均可） */
export class RestEmbeddingAdapter extends EmbeddingPort {
  private readonly logger = new Logger("Embedding");

  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {
    super();
  }

  async embed(text: string): Promise<number[] | null> {
    try {
      const res = await fetch(`${this.apiUrl.replace(/\/$/, "")}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, input: text.slice(0, 8000) }),
      });
      if (!res.ok) {
        this.logger.warn(`embedding API ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { data?: { embedding?: number[] }[] };
      return json.data?.[0]?.embedding ?? null;
    } catch (err) {
      this.logger.warn(`embedding API error: ${(err as Error).message}`);
      return null;
    }
  }
}
