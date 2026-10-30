import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { DraftPlan, DraftScene } from "../../shared/draft";
import type { Planner, PlanInput, SceneRegenInput } from "./types";
import { planRequest, regenRequest, systemPrompt } from "./prompt";

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

export class ClaudePlanner implements Planner {
  readonly kind = "claude" as const;
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  private async parse<T>(format: ReturnType<typeof zodOutputFormat<any>>, user: string): Promise<T> {
    const response = await this.client.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format },
      system: systemPrompt(),
      messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") throw new Error("Claude bu isteği işlemeyi reddetti.");
    if (response.stop_reason === "max_tokens") throw new Error("Claude yanıtı yarıda kesildi (hikâye çok uzun olabilir).");
    if (!response.parsed_output) throw new Error("Claude geçerli bir storyboard döndürmedi.");
    return response.parsed_output as T;
  }

  async writeJson(system: string, user: string): Promise<unknown> {
    const response = await this.client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: `${system}\n\nReply with a single JSON object and nothing else.`,
      messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") throw new Error("Claude bu isteği işlemeyi reddetti.");
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    try {
      return JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
    } catch {
      throw new Error("Claude geçerli JSON döndürmedi.");
    }
  }

  async plan(input: PlanInput): Promise<DraftPlan> {
    return this.parse<DraftPlan>(zodOutputFormat(DraftPlan), planRequest(input));
  }

  async regenerateScene(input: SceneRegenInput): Promise<DraftScene> {
    return this.parse<DraftScene>(zodOutputFormat(DraftScene), regenRequest(input));
  }
}
