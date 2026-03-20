import { ChatOpenAI } from "@langchain/openai";

export const llm = new ChatOpenAI({
  model: "z-ai/glm-4.5-air:free",
  apiKey: process.env.OPENROUTER_API_KEY!,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
  temperature: 0,
});
