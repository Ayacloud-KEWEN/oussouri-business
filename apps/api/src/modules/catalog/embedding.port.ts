/**
 * 文本向量化端口（语义搜索/撮合共用）。
 * DeepSeek 暂无 embedding API（决策 D3），默认 Null 适配器 → 语义搜索自动降级全文；
 * 配置 EMBEDDING_API_URL（OpenAI 兼容 /embeddings）后启用真实向量。
 */
export abstract class EmbeddingPort {
  /** 返回 1536 维向量；未配置提供方时返回 null（调用方降级） */
  abstract embed(text: string): Promise<number[] | null>;
}
