import { OpenAICompatPlanner } from "./openai-compat";

export { sanitizePlan } from "./openai-compat";

// Alibaba Cloud Model Studio (DashScope), OpenAI-compatible endpoint. International region by
// default; mainland China accounts use https://dashscope.aliyuncs.com/compatible-mode/v1.
export const QWEN_BASE_URL = process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
export const QWEN_MODEL = process.env.QWEN_MODEL || "qwen-plus";

export class QwenPlanner extends OpenAICompatPlanner {
  constructor(apiKey: string, baseUrl = QWEN_BASE_URL, model = QWEN_MODEL) {
    super("qwen", apiKey, baseUrl, model);
  }
}
