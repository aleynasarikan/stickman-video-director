import { z } from "zod";
import { DraftPlan, DraftScene } from "../../shared/draft";
import {
  ACTIONS, CAMERAS, EMOTIONS, HAIRS, HATS, MEME_SFX, OUTFITS, PLANNER_LABEL, PROPS, SETTINGS, TIMES_OF_DAY, TRANSITIONS, type AiPlannerKind,
} from "../../shared/schema";
import type { Planner, PlanInput, SceneRegenInput } from "./types";
import { planRequest, regenRequest, systemPrompt } from "./prompt";

// Any OpenAI-compatible /chat/completions endpoint (DashScope, DeepSeek, in-house gateways),
// called in JSON mode. Subclasses only fix the provider name and defaults.

const TIMEOUT_MS = 180_000;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

// JSON mode guarantees valid JSON, not schema adherence. Snap stray enum values to a safe
// default instead of failing the whole storyboard over one invented action name.
function pick<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback;
  const k = v.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return (list as readonly string[]).includes(k) ? (k as T) : fallback;
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function sanitizeScene(s: unknown): unknown {
  if (!isObj(s)) return s;
  const actors = Array.isArray(s.actors) ? s.actors.filter(isObj) : [];
  return {
    title: String(s.title ?? ""),
    narration: String(s.narration ?? ""),
    visualNote: String(s.visualNote ?? ""),
    ...(typeof s.headline === "string" && s.headline.trim() && { headline: s.headline }),
    ...(typeof s.caption === "string" && s.caption.trim() && { caption: s.caption }),
    ...(Array.isArray(s.stings) && { stings: s.stings.filter((x): x is (typeof MEME_SFX)[number] => (MEME_SFX as readonly unknown[]).includes(x)) }),
    setting: pick(SETTINGS, s.setting, "blank"),
    timeOfDay: pick(TIMES_OF_DAY, s.timeOfDay, "day"),
    camera: pick(CAMERAS, s.camera, "wide"),
    transition: pick(TRANSITIONS, s.transition, "cut"),
    actors: actors.map((a) => {
      const actions = (Array.isArray(a.actions) ? a.actions : [a.actions])
        .map((x) => pick(ACTIONS, x, "idle"))
        .slice(0, 3);
      const fromX = num(a.fromX, 0.5);
      return {
        character: String(a.character ?? ""),
        actions: actions.length ? actions : ["idle"],
        fromX,
        toX: num(a.toX, fromX),
        facing: a.facing === "left" ? "left" : "right",
        emotion: pick(EMOTIONS, a.emotion, "neutral"),
        prop: pick(PROPS, a.prop, "none"),
      };
    }),
  };
}

export function sanitizePlan(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const characters = Array.isArray(raw.characters) ? raw.characters.filter(isObj) : [];
  return {
    title: String(raw.title ?? ""),
    characters: characters.map((c) => ({
      name: String(c.name ?? ""),
      hat: pick(HATS, c.hat, "none"),
      hair: pick(HAIRS, c.hair, "short"),
      outfit: pick(OUTFITS, c.outfit, "casual"),
      tall: c.tall === true,
    })),
    scenes: Array.isArray(raw.scenes) ? raw.scenes.map(sanitizeScene) : [],
  };
}

function jsonInstructions(schema: z.ZodType): string {
  return `${systemPrompt()}

Reply with a single JSON object and nothing else. It must match this JSON Schema exactly, using only the listed enum values:
${JSON.stringify(z.toJSONSchema(schema))}`;
}

export class OpenAICompatPlanner implements Planner {
  constructor(
    readonly kind: AiPlannerKind,
    private apiKey: string,
    private baseUrl: string,
    private model: string,
  ) {}

  private get label() {
    return PLANNER_LABEL[this.kind];
  }

  private async complete(system: string, user: string, temperature = 0.4): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          // Low by default: the storyboard should follow the story, not improvise.
          temperature,
          max_tokens: 8192,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const timeout = e instanceof Error && e.name === "TimeoutError";
      if (timeout) throw new Error(`${this.label} zamanında yanıt vermedi.`);
      const code = (e as { cause?: { code?: string } }).cause?.code;
      if (code === "ENOTFOUND" || code === "EAI_AGAIN")
        throw new Error(`${this.label} sunucusunun adresi bulunamadı (${new URL(this.baseUrl).host}). Kurum içi bir sunucuysa kurum ağına veya VPN'e bağlı olduğunuzdan emin olun.`);
      throw new Error(`${this.label} sunucusuna bağlanılamadı (${code ?? (e as Error).message}).`);
    }
    const body = (await res.json().catch(() => null)) as Raw | null;
    if (!res.ok) {
      const err = isObj(body?.error) ? body.error : body;
      const msg = isObj(err) && typeof err.message === "string" ? err.message : `HTTP ${res.status}`;
      if (res.status === 401) throw new Error(`${this.label} API anahtarı geçersiz (${msg}).`);
      throw new Error(`${this.label} hatası: ${msg}`);
    }
    const choice = Array.isArray(body?.choices) && isObj(body.choices[0]) ? body.choices[0] : null;
    const message = choice && isObj(choice.message) ? choice.message : null;
    if (choice?.finish_reason === "length") throw new Error(`${this.label} yanıtı yarıda kesildi (hikâye çok uzun olabilir).`);
    if (typeof message?.content !== "string") throw new Error(`${this.label} boş yanıt döndürdü.`);
    try {
      // Some models still wrap JSON in a ```json fence despite JSON mode.
      return JSON.parse(message.content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
    } catch {
      throw new Error(`${this.label} geçerli JSON döndürmedi.`);
    }
  }

  writeJson(system: string, user: string, temperature = 0.4): Promise<unknown> {
    return this.complete(system, user, temperature);
  }

  async plan(input: PlanInput): Promise<DraftPlan> {
    const raw = await this.complete(jsonInstructions(DraftPlan), planRequest(input));
    const parsed = DraftPlan.safeParse(sanitizePlan(raw));
    if (!parsed.success || parsed.data.scenes.length === 0) throw new Error(`${this.label} geçerli bir storyboard döndürmedi.`);
    return parsed.data;
  }

  async regenerateScene(input: SceneRegenInput): Promise<DraftScene> {
    const raw = await this.complete(jsonInstructions(DraftScene), regenRequest(input));
    // Tolerate {"scene": {...}} and whole-plan {"scenes": [...]} replies.
    let scene = raw;
    if (isObj(raw) && isObj(raw.scene)) scene = raw.scene;
    else if (isObj(raw) && Array.isArray(raw.scenes)) scene = raw.scenes.length === 1 ? raw.scenes[0] : raw.scenes[input.index];
    const parsed = DraftScene.safeParse(sanitizeScene(scene));
    if (!parsed.success || !parsed.data.narration.trim()) throw new Error(`${this.label} geçerli bir sahne döndürmedi.`);
    return parsed.data;
  }
}
