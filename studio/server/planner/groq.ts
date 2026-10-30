import { OpenAICompatPlanner } from "./openai-compat";

// GroqCloud: free tier without a credit card, OpenAI-compatible, does not train on API data.
// Model ids: GET https://api.groq.com/openai/v1/models
export const GROQ_BASE_URL = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
export const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

export class GroqPlanner extends OpenAICompatPlanner {
  constructor(apiKey: string, baseUrl = GROQ_BASE_URL, model = GROQ_MODEL) {
    super("groq", apiKey, baseUrl, model);
  }
}
