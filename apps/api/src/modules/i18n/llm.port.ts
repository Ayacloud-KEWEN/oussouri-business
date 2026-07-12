/** LLM 端口（决策 D3：DeepSeek；OpenAI 兼容协议，可替换） */
export abstract class LlmPort {
  /** 翻译一段文本；不可用时返回 null（调用方跳过） */
  abstract translate(text: string, sourceLocale: string, targetLocale: string): Promise<string | null>;
}
