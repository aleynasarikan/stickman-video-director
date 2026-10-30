import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../server/app";
import { ProjectStore } from "../server/store";
import type { Planner } from "../server/planner/types";
import { OfflinePlanner } from "../server/planner/offline";
import { probeDuration } from "../server/ffmpeg";
import type { Project } from "../shared/schema";

const failingClaude: Planner = {
  kind: "claude",
  plan: async () => {
    throw new Error("ağ hatası");
  },
  regenerateScene: async () => {
    throw new Error("ağ hatası");
  },
};

// Stands in for a reachable Qwen: returns the offline draft, tagged as Qwen's.
const offline = new OfflinePlanner();
const workingQwen: Planner = {
  kind: "qwen",
  plan: (input) => offline.plan(input),
  regenerateScene: (input) => offline.regenerateScene(input),
};

let dir: string;
let server: Server;
let base: string;

async function json(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const settings = { durationSec: 10, aspect: "16:9", style: "classic-light", language: "tr", voiceover: false, subtitles: true };
const story = "Ali parkta yürüdü. Sonra Ayşe ile konuştu ve birlikte dans ettiler.";

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "stickman-test-"));
  const app = createApp({
    store: new ProjectStore(dir),
    ai: {
      claude: { planner: failingClaude, model: "claude-test", paid: true },
      qwen: { planner: workingQwen, model: "qwen-test", paid: false },
    },
    tts: async () => null,
  });
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await rm(dir, { recursive: true, force: true });
});

describe("API", () => {
  it("rejects invalid input with a readable error", async () => {
    const r = await json("POST", "/api/projects", { story: "kısa", settings });
    expect(r.status).toBe(400);
    expect(r.body.error).toBeTruthy();
  });

  it("reports which AI planners are configured", async () => {
    const r = await json("GET", "/api/status");
    expect(r.body.planners).toEqual({ qwen: { model: "qwen-test", paid: false }, groq: null, deepseek: null, claude: { model: "claude-test", paid: true } });
  });

  it("plans with Qwen when requested", async () => {
    const r = await json("POST", "/api/projects", { story, settings, planner: "qwen" });
    expect(r.status).toBe(201);
    expect(r.body.project.planner).toBe("qwen");
    expect(r.body.warning).toBeUndefined();
  });

  it("falls back to the offline planner when Claude fails, and says so", async () => {
    const r = await json("POST", "/api/projects", { story, settings, planner: "claude" });
    expect(r.status).toBe(201);
    expect(r.body.project.planner).toBe("offline");
    expect(r.body.warning).toMatch(/Claude/);
  });

  it("requires approval, then renders a playable MP4", async () => {
    const created = await json("POST", "/api/projects", { story, settings, planner: "offline" });
    const project: Project = created.body.project;

    const blocked = await json("POST", `/api/projects/${project.id}/render`);
    expect(blocked.status).toBe(409);

    project.scenes.forEach((s) => (s.approved = true));
    const saved = await json("PUT", `/api/projects/${project.id}`, { project });
    expect(saved.status).toBe(200);

    const started = await json("POST", `/api/projects/${project.id}/render`);
    expect(started.status).toBe(202);

    let job;
    for (let i = 0; i < 200; i++) {
      job = (await json("GET", `/api/jobs/${started.body.jobId}`)).body;
      if (job.status !== "running") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(job.status).toBe("done");
    expect(job.result.notes).toEqual([]);

    const file = path.join(dir, project.id, "renders", path.basename(job.result.url));
    const head = (await readFile(file)).subarray(4, 8).toString("ascii");
    expect(head).toBe("ftyp");
    const expected = project.scenes.reduce((n, s) => n + s.durationSec, 0);
    expect(await probeDuration(file)).toBeCloseTo(expected, 0);

    const media = await fetch(base + job.result.url);
    expect(media.status).toBe(200);
    const srt = await (await fetch(base + job.result.srtUrl)).text();
    expect(srt).toContain("-->");
  });

  it("renders a short preview that is not listed with the finished videos", async () => {
    const created = await json("POST", "/api/projects", { story, settings: { ...settings, durationSec: 40 }, planner: "offline" });
    const project: Project = created.body.project;
    project.scenes.forEach((s) => (s.approved = true));
    await json("PUT", `/api/projects/${project.id}`, { project });
    const started = await json("POST", `/api/projects/${project.id}/render`, { preview: true });
    let job;
    for (let i = 0; i < 200; i++) {
      job = (await json("GET", `/api/jobs/${started.body.jobId}`)).body;
      if (job.status !== "running") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(job.status).toBe("done");
    expect(job.result.preview).toBe(true);
    expect(path.basename(job.result.url)).toMatch(/^preview-/);
    const file = path.join(dir, project.id, "renders", path.basename(job.result.url));
    expect(await probeDuration(file)).toBeLessThanOrEqual(20.1);
    expect((await fetch(base + job.result.url)).status).toBe(200);
    expect((await json("GET", `/api/projects/${project.id}`)).body.renders).toEqual([]);
  });

  it("builds a comic bulletin brief (built-in jokes when the planner can't write them)", async () => {
    const item = { title: "Kedi otobüse bindi", summary: "Bir kedi otobüsle şehri gezdi.", link: "https://ex.org", source: "Ajans" };
    const base = { title: "Komik Haberler", anchor: "Deniz", presenter: "kadin", aspect: "16:9", language: "tr", planner: "qwen" };
    const r = await json("POST", "/api/news/bulletin", { ...base, items: [item], mode: "comic" });
    expect(r.status).toBe(200);
    expect(r.body.brief.stil).toBe("news");
    expect(r.body.brief.sahneler.map((s: { mekan: string }) => s.mekan)).toEqual(["news-studio", "news-studio", "city", "news-studio", "news-studio"]);
    const created = await json("POST", "/api/projects", { story: JSON.stringify(r.body.brief), settings, planner: "offline" });
    expect(created.status).toBe(201);
    expect(created.body.project.settings.style).toBe("news");
    expect((await json("POST", "/api/news/bulletin", { ...base, items: [], mode: "comic" })).status).toBe(400);
  });

  it("refuses to fetch news from local addresses", async () => {
    const r = await json("POST", "/api/news/fetch", { url: "http://127.0.0.1:1/rss" });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/Yerel/);
  });

  it("rejects edits that reference unknown characters", async () => {
    const created = await json("POST", "/api/projects", { story, settings, planner: "offline" });
    const project: Project = created.body.project;
    project.scenes[0].actors[0].characterId = "yok";
    const r = await json("PUT", `/api/projects/${project.id}`, { project });
    expect(r.status).toBe(400);
  });

  it("regenerates a single scene and keeps its id", async () => {
    const created = await json("POST", "/api/projects", { story, settings, planner: "offline" });
    const project: Project = created.body.project;
    const r = await json("POST", `/api/projects/${project.id}/scenes/0/regenerate`, { planner: "claude" });
    expect(r.status).toBe(200);
    expect(r.body.scene.id).toBe(project.scenes[0].id);
    expect(r.body.warning).toMatch(/Claude/);
  });

  it("does not serve files outside the renders folder", async () => {
    const r = await fetch(`${base}/media/..%2F..%2Fetc/passwd`);
    expect(r.status).toBeGreaterThanOrEqual(400);
    const r2 = await fetch(`${base}/media/abc/project.json`);
    expect(r2.status).toBe(400);
  });
});

describe("JSON prompts", () => {
  const brief = JSON.stringify({
    baslik: "Mektup",
    format: "dikey",
    karakterler: [{ isim: "Hiro", kiyafet: "kimono" }],
    sahneler: [
      { anlatim: "Hiro gece evinde mektubu okudu.", mekan: "samuray evi", kamera: "yakın" },
      { anlatim: "Sonra ormana koştu.", sure: 5 },
    ],
  });

  it("plans from a JSON brief offline, applying its settings and explicit values", async () => {
    const r = await json("POST", "/api/projects", { story: brief, settings, planner: "offline" });
    expect(r.status).toBe(201);
    expect(r.body.notice).toMatch(/JSON girdi algılandı: 2 sahne/);
    const p = r.body.project as Project;
    expect(p.settings.aspect).toBe("9:16");
    expect(p.title).toBe("Mektup");
    expect(p.story).toBe(brief);
    expect(p.scenes[0]).toMatchObject({ setting: "japanese-room", camera: "close", timeOfDay: "night" });
    expect(p.scenes[0].actors[0].prop).toBe("book");
    expect(p.scenes[1].setting).toBe("forest");
    expect(p.scenes[1].actors[0].actions).toContain("run");
    expect(p.characters[0]).toMatchObject({ name: "Hiro", outfit: "kimono" });
  });

  it("passes the brief to an AI planner and still enforces it", async () => {
    const r = await json("POST", "/api/projects", { story: brief, settings, planner: "qwen" });
    expect(r.status).toBe(201);
    const p = r.body.project as Project;
    expect(p.planner).toBe("qwen");
    expect(p.scenes).toHaveLength(2);
    expect(p.scenes[0].narration).toBe("Hiro gece evinde mektubu okudu.");
  });
});
