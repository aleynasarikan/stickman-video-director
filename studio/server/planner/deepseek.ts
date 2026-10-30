import { OpenAICompatPlanner } from "./openai-compat";

// DeepSeek's own API by default; point DEEPSEEK_BASE_URL at another OpenAI-compatible
// host (e.g. an in-house gateway) that serves a DeepSeek model.
export const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-flash";

export class DeepSeekPlanner extends OpenAICompatPlanner {
  constructor(apiKey: string, baseUrl = DEEPSEEK_BASE_URL, model = DEEPSEEK_MODEL) {
    super("deepseek", apiKey, baseUrl, model);
  }
}
