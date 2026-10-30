import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { QwenPlanner, sanitizePlan } from "../server/planner/qwen";
import { DeepSeekPlanner } from "../server/planner/deepseek";
import { normalizeDraft } from "../shared/draft";
import { Scene, type VideoSettings } from "../shared/schema";

const settings: VideoSettings = { durationSec: 20, aspect: "16:9", style: "cozy", language: "tr", voiceover: false, subtitles: true };

// A plan with the kind of near-misses JSON mode lets through: wrong case, spaces, unknown values.
export const qwenPlan = {
  title: "Parkta",
  characters: [{ name: "Ali", hat: "Cap", tall: false }, { name: "Ayşe", hat: "sombrero", tall: "yes" }],
  scenes: [
    {
      title: "Karşılaşma",
      narration: "Ali parkta yürürken Ayşe'yi gördü.",
      visualNote: "Ali yürüyor, Ayşe bankta oturuyor.",
      setting: "Park",
      timeOfDay: "day",
      camera: "pan right",
      transition: "cut",
      actors: [
        { character: "Ali", actions: ["walk", "wave", "moonwalk"], fromX: 0.1, toX: "0.5", facing: "right", emotion: "happy", prop: "none" },
        { character: "Ayşe", actions: "sit", fromX: 0.75, toX: 0.75, facing: "left", emotion: "joyful", prop: "cup" },
      ],
    },
    {
      title: "Sohbet",
      narration: "İkisi uzun uzun konuştu.",
      visualNote: "",
      setting: "moon",
      timeOfDay: "night",
      camera: "close",
      transition: "fade",
      actors: [{ character: "Ali", actions: ["talk"], fromX: 0.4, toX: 0.4, facing: "right", emotion: "neutral", prop: "none" }],
    },
  ],
};

let server: Server;
let base: string;
const seen: { auth?: string; body?: any }[] = [];
let mode: "ok" | "fenced" | "unauthorized" | "truncated" = "ok";
let wholePlan = false;
let wholePlanBody: unknown = null;

beforeAll(async () => {
  const mock = express();
  mock.use(express.json());
  mock.post("/v1/chat/completions", (req, res) => {
    seen.push({ auth: req.headers.authorization, body: req.body });
    if (mode === "unauthorized") return res.status(401).json({ error: { message: "Incorrect API key provided.", code: "invalid_api_key" } });
    const wantsScene = String(req.body.messages[1].content).includes("Rewrite scene");
    let content = JSON.stringify(wantsScene && !wholePlan ? { scene: qwenPlan.scenes[1] } : (wholePlanBody ?? qwenPlan));
    if (mode === "fenced") content = "```json\n" + content + "\n```";
    res.json({ choices: [{ index: 0, finish_reason: mode === "truncated" ? "length" : "stop", message: { role: "assistant", content } }] });
  });
  await new Promise<void>((r) => {
    server = mock.listen(0, "127.0.0.1", () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => server?.close());

describe("Qwen planner", () => {
  it("calls the OpenAI-compatible endpoint in JSON mode with the key and schema", async () => {
    mode = "ok";
    const plan = await new QwenPlanner("sk-test", base, "qwen-plus").plan({ story: "Ali parkta yürüdü.", settings });
    const req = seen[seen.length - 1];
    expect(req.auth).toBe("Bearer sk-test");
    expect(req.body.model).toBe("qwen-plus");
    expect(req.body.response_format).toEqual({ type: "json_object" });
    expect(req.body.messages[0].content).toContain("JSON Schema");
    expect(req.body.messages[1].content).toContain("Ali parkta yürüdü.");
    expect(plan.scenes).toHaveLength(2);
  });

  it("snaps near-miss enum values instead of failing", async () => {
    mode = "fenced";
    const plan = await new QwenPlanner("k", base).plan({ story: "Ali parkta yürüdü.", settings });
    const [s1, s2] = plan.scenes;
    expect(s1.setting).toBe("park");
    expect(s1.camera).toBe("pan-right");
    expect(s1.actors[0].actions).toEqual(["walk", "wave", "idle"]);
    expect(s1.actors[0].toX).toBe(0.5);
    expect(s1.actors[1].actions).toEqual(["sit"]);
    expect(s1.actors[1].emotion).toBe("neutral");
    expect(s2.setting).toBe("blank");
    expect(plan.characters[0].hat).toBe("cap");
    expect(plan.characters[1]).toEqual({ name: "Ayşe", hat: "none", hair: "short", outfit: "casual", tall: false });

    const n = normalizeDraft(plan, settings);
    for (const s of n.scenes) expect(() => Scene.parse(s)).not.toThrow();
  });

  it("regenerates one scene, unwrapping {scene: ...}", async () => {
    mode = "ok";
    const project = {
      ...normalizeDraft(sanitizePlan(qwenPlan) as any, settings),
      id: "p", story: "Ali parkta yürüdü.", settings, planner: "qwen" as const, createdAt: "", updatedAt: "",
    };
    const scene = await new QwenPlanner("k", base).regenerateScene({ project, index: 1, instruction: "daha komik" });
    expect(scene.title).toBe("Sohbet");
    expect(seen[seen.length - 1].body.messages[1].content).toContain("daha komik");
  });

  it("picks the right scene when Qwen returns the whole plan, and rejects empty scenes", async () => {
    mode = "ok";
    const project = {
      ...normalizeDraft(sanitizePlan(qwenPlan) as any, settings),
      id: "p", story: "x", settings, planner: "qwen" as const, createdAt: "", updatedAt: "",
    };
    wholePlan = true;
    try {
      const scene = await new QwenPlanner("k", base).regenerateScene({ project, index: 1 });
      expect(scene.title).toBe("Sohbet");
      wholePlanBody = { title: "boş" };
      await expect(new QwenPlanner("k", base).regenerateScene({ project, index: 0 })).rejects.toThrow(/geçerli bir sahne/);
    } finally {
      wholePlan = false;
      wholePlanBody = null;
    }
  });

  it("reports a bad key and truncation in Turkish", async () => {
    mode = "unauthorized";
    await expect(new QwenPlanner("bad", base).plan({ story: "x", settings })).rejects.toThrow(/anahtarı geçersiz/);
    mode = "truncated";
    await expect(new QwenPlanner("k", base).plan({ story: "x", settings })).rejects.toThrow(/yarıda kesildi/);
  });

  it("works for DeepSeek through the same OpenAI-compatible client, naming it in errors", async () => {
    mode = "ok";
    const plan = await new DeepSeekPlanner("ds-key", base, "deepseek-flash").plan({ story: "Ali parkta yürüdü.", settings });
    expect(plan.scenes).toHaveLength(2);
    const req = seen[seen.length - 1];
    expect(req.auth).toBe("Bearer ds-key");
    expect(req.body.model).toBe("deepseek-flash");
    mode = "unauthorized";
    await expect(new DeepSeekPlanner("bad", base).plan({ story: "x", settings })).rejects.toThrow(/DeepSeek API anahtarı geçersiz/);
  });

  it("reports an unreachable server", async () => {
    await expect(new QwenPlanner("k", "http://127.0.0.1:9/v1").plan({ story: "x", settings })).rejects.toThrow(/bağlanılamadı/);
    await expect(new QwenPlanner("k", "http://yok.invalid/v1").plan({ story: "x", settings })).rejects.toThrow(/VPN/);
  });
});
