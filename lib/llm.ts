import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export type Provider = "openrouter" | "nvidia";

export interface LLMConfig {
  provider: Provider;
  apiKey: string;
  model: string;
}

const DEFAULT_OPENROUTER_MODEL = "z-ai/glm-4.5-air:free";
const DEFAULT_NVIDIA_MODEL = "openai/gpt-oss-120b";

export function createLLM(config: LLMConfig): BaseChatModel {
  if (config.provider === "nvidia") {
    return new ChatOpenAI({
      model: config.model || DEFAULT_NVIDIA_MODEL,
      apiKey: config.apiKey,
      configuration: {
        baseURL: "https://integrate.api.nvidia.com/v1",
      } as Record<string, unknown>,
      temperature: 0,
    });
  }

  return new ChatOpenAI({
    model: config.model || DEFAULT_OPENROUTER_MODEL,
    apiKey: config.apiKey,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
    } as Record<string, unknown>,
    temperature: 0,
  });
}
