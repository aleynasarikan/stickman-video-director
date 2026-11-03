import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { z, ZodError } from "zod";
import { AI_PLANNERS, ASSET_FILE_RE, CreateProjectRequest, PLANNER_LABEL, Project, type AiPlannerKind } from "../shared/schema";
import { newId, normalizeDraft, normalizeScene, sceneDuration, type DraftPlan } from "../shared/draft";
import type { Planner } from "./planner/types";
import { OfflinePlanner } from "./planner/offline";
import { eraOf, groundDraft, groundScene, periodSettings } from "./planner/grounding";
import { fixTurkishLines } from "./planner/turkish";
import { applyJsonPrompt, jsonBrief, jsonPromptToDraft, parseJsonPrompt } from "./planner/json-prompt";
import type { ProjectStore } from "./store";
import type { TtsEngine } from "./tts";
import { renderVideo, type RenderPhase } from "./render";
import { NewsError, fetchNews } from "./news";
import { comicBulletin } from "./news-bulletin";
import { WorkQueue } from "./gate";
import { findAsset, saveAsset, type AssetConfig } from "./assets";

export interface AppDeps {
  store: ProjectStore;
  /** Configured LLM planners (only those with an API key). */
  ai: Partial<Record<AiPlannerKind, { planner: Planner; model: string; paid: boolean }>>;
  tts: (language: string) => Promise<TtsEngine | null>;
  /** Built web app (npm run build) served from the same port, with SPA fallback. */
  webDist?: string;
  /** Development: serves the web app instead of webDist (Vite middleware with live reload), same port. */
  frontend?: RequestHandler;
  /** Renders and image generation share this queue (one at a time by default). */
  heavy?: WorkQueue;
  /** Optional local image service for scene backgrounds; absent/null = drawn backgrounds only. */
  assets?: AssetConfig;
  /** Which TTS engines are installed (shown in /api/status). */
  ttsInventory?: () => Record<string, boolean>;
}

interface Job {
  id: string;
  projectId: string;
  status: "running" | "done" | "error";
  phase: RenderPhase | "queued";
  progress: number;
  error?: string;
  result?: { url: string; srtUrl: string; durationSec: number; voice: boolean; notes: string[]; preview: boolean };
  startedAt: number;
}

const FILE_RE = /^(video|preview)-[\w-]+\.(mp4|srt)$/;
/** Length of the quick preview render: enough to judge voice, timing, captions and effects. */
export const PREVIEW_SEC = 20;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Restores Turkish letters in an LLM draft's spoken and on-screen text, using the story's own spelling. */
async function fixDraftSpelling(draft: DraftPlan, story: string, planner: Planner): Promise<DraftPlan> {
  const fields = ["narration", "title", "headline", "caption"] as const;
  const refs: [DraftPlan["scenes"][number], (typeof fields)[number]][] = [];
  for (const sc of draft.scenes) for (const f of fields) if (sc[f]) refs.push([sc, f]);
  const fixed = await fixTurkishLines([draft.title, ...refs.map(([sc, f]) => sc[f] as string)], story, planner.writeJson?.bind(planner));
  const scenes = draft.scenes.map((sc) => ({ ...sc }));
  refs.forEach(([sc, f], i) => (scenes[draft.scenes.indexOf(sc)][f] = fixed[i + 1]));
  return { ...draft, title: fixed[0], scenes };
}

export function createApp(deps: AppDeps) {
  const app = express();
  const offline = new OfflinePlanner();
  const jobs = new Map<string, Job>();
  const activeByProject = new Map<string, string>();
  const heavy = deps.heavy ?? new WorkQueue(1);

  app.use(express.json({ limit: "1mb" }));

  function pickPlanner(requested: unknown): Planner {
    const kind = AI_PLANNERS.find((k) => k === requested);
    return (kind && deps.ai[kind]?.planner) || offline;
  }

  async function load(id: string): Promise<Project> {
    const p = await deps.store.get(id);
    if (!p) throw new HttpError(404, "Proje bulunamadı.");
    return p;
  }

  function mediaUrl(id: string, file: string) {
    return `/media/${id}/${file}`;
  }

  app.get("/api/status", wrap(async (_req, res) => {
    const [tr, en] = await Promise.all([deps.tts("tr"), deps.tts("en")]);
    const planners = Object.fromEntries(
      AI_PLANNERS.map((k) => {
        const p = deps.ai[k];
        return [k, p ? { model: p.model, paid: p.paid } : null];
      }),
    );
    // Voice choices need an engine with voices (EMA Lightning, Kızağan, …); macOS say has a single Turkish voice.
    const assets = { provider: deps.assets?.provider?.name ?? null, problem: deps.assets?.problem };
    const installed = deps.ttsInventory?.();
    res.json({ planners, tts: { tr: Boolean(tr), en: Boolean(en), voices: Boolean(tr?.voices), engine: tr?.name, ...(installed && { installed }) }, assets });
  }));

  // Headlines and short summaries from an RSS/Atom feed or an article page, for news bulletins.
  app.post("/api/news/fetch", wrap(async (req, res) => {
    const url = z.string().trim().min(8).max(2000).parse(req.body?.url);
    try {
      res.json(await fetchNews(url));
    } catch (e) {
      if (e instanceof NewsError) throw new HttpError(422, e.message);
      throw e;
    }
  }));

  // Builds a bulletin's JSON brief from chosen items; the comic mode can have an LLM write the jokes.
  const BulletinRequest = z.object({
    items: z.array(z.object({
      title: z.string().trim().min(1).max(300),
      summary: z.string().max(4000).default(""),
      link: z.string().max(2000).default(""),
      source: z.string().trim().min(1).max(120),
      published: z.string().max(100).optional(),
    })).max(8),
    title: z.string().trim().min(1).max(60),
    anchor: z.string().trim().min(1).max(30),
    presenter: z.enum(["kadin", "erkek"]),
    aspect: z.enum(["16:9", "9:16"]),
    language: z.enum(["tr", "en"]),
    mode: z.enum(["classic", "comic", "interview", "meme"]),
    topic: z.enum(["auto", "general", "football"]).default("auto"),
    subject: z.string().trim().max(200).optional(),
    planner: z.string().optional(),
  });
  app.post("/api/news/bulletin", wrap(async (req, res) => {
    const body = BulletinRequest.parse(req.body);
    if (!body.items.length && !(body.mode === "interview" && body.subject)) throw new HttpError(400, "Haber seçin ya da röportaj konusu yazın.");
    if (body.mode === "interview" && body.items.length > 3) throw new HttpError(400, "Röportaj bülteninde en fazla 3 haber seçilebilir.");
    const planner = pickPlanner(body.planner);
    const writer = planner.writeJson ? planner.writeJson.bind(planner) : undefined;
    res.json(await comicBulletin(body.items, body, writer));
  }));

  app.get("/api/projects", wrap(async (_req, res) => {
    res.json({ projects: await deps.store.list() });
  }));

  app.post("/api/projects", wrap(async (req, res) => {
    const body = CreateProjectRequest.parse(req.body);
    // A JSON brief may also choose the style, aspect ratio, length or language.
    const jp = parseJsonPrompt(body.story);
    const settings = jp ? { ...body.settings, ...jp.settings } : body.settings;
    const input = { story: jp ? jp.story : body.story, settings, brief: jp ? jsonBrief(jp) : undefined };
    const fromBrief = jp ? jsonPromptToDraft(jp, settings) : null;
    const planOffline = async () => fromBrief ?? offline.plan(input);
    let planner = pickPlanner(req.body?.planner);
    let warning: string | undefined;
    let draft: DraftPlan;
    try {
      draft = planner === offline ? await planOffline() : await planner.plan(input);
    } catch (e) {
      if (planner === offline) throw e;
      warning = `${PLANNER_LABEL[planner.kind]} ile planlama başarısız oldu (${errorMessage(e)}). Ücretsiz çevrimdışı planlayıcı kullanıldı.`;
      planner = offline;
      draft = await planOffline();
    }
    // LLMs sometimes drop Turkish letters ("bakalim"); the TTS would read exactly that.
    if (planner !== offline && settings.language === "tr") draft = await fixDraftSpelling(draft, body.story, planner);
    // Check every scene's visuals against its narration, then let the brief's explicit values win.
    const grounded = groundDraft(draft, settings);
    if (grounded.fixes.length) console.log(`[plan] ${grounded.fixes.length} görsel düzeltme:`, grounded.fixes.join("; "));
    draft = jp && fromBrief ? periodSettings(applyJsonPrompt(grounded.draft, jp, fromBrief)) : grounded.draft;
    const n = normalizeDraft(draft, settings);
    if (n.scenes.length === 0) throw new HttpError(422, "Hikâyeden sahne çıkarılamadı. Biraz daha uzun bir metin deneyin.");
    let notice: string | undefined;
    if (jp) {
      jp.scenes?.forEach((spec, i) => {
        if (spec.durationSec && n.scenes[i]) n.scenes[i].durationSec = sceneDuration(n.scenes[i].narration, settings.language, spec.durationSec);
        if (spec.voice && n.scenes[i]) n.scenes[i].voice = spec.voice;
      });
      const changed = Object.keys(jp.settings).length ? " Video ayarları JSON'daki değerlere göre güncellendi." : "";
      notice = `JSON girdi algılandı: ${n.scenes.length} sahne, ${n.characters.length} karakter.${changed}`;
    }
    const now = new Date().toISOString();
    const project = await deps.store.save({
      id: newId("prj").toLowerCase(),
      title: n.title,
      story: body.story,
      settings,
      characters: n.characters,
      scenes: n.scenes,
      planner: planner.kind,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ project, warning, notice });
  }));

  app.get("/api/projects/:id", wrap(async (req, res) => {
    const project = await load(String(req.params.id));
    const renders = (await deps.store.renders(project.id)).map((f) => ({
      file: f,
      url: mediaUrl(project.id, f),
      srtUrl: mediaUrl(project.id, f.replace(/\.mp4$/, ".srt")),
    }));
    res.json({ project, renders });
  }));

  app.put("/api/projects/:id", wrap(async (req, res) => {
    const existing = await load(String(req.params.id));
    const incoming = Project.parse(req.body?.project);
    if (incoming.id !== existing.id) throw new HttpError(400, "Proje kimliği uyuşmuyor.");
    const ids = new Set(incoming.characters.map((c) => c.id));
    for (const s of incoming.scenes)
      for (const a of s.actors) if (!ids.has(a.characterId)) throw new HttpError(400, `Sahnede bilinmeyen karakter: ${a.characterId}`);
    // Generated backgrounds are owned by the server (set and cleared only by their own endpoints),
    // so an autosave from a page that has not seen a fresh image yet can never drop it.
    const saved = new Map(existing.scenes.map((s) => [s.id, s.background]));
    const scenes = incoming.scenes.map(({ background: _ignored, ...s }) => (saved.get(s.id) ? { ...s, background: saved.get(s.id) } : s));
    const project = await deps.store.save({ ...incoming, scenes, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
    res.json({ project });
  }));

  app.post("/api/projects/:id/scenes/:index/regenerate", wrap(async (req, res) => {
    const project = await load(String(req.params.id));
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= project.scenes.length) throw new HttpError(400, "Geçersiz sahne.");
    const instruction = z.string().max(500).optional().parse(req.body?.instruction || undefined);
    let planner = pickPlanner(req.body?.planner);
    let warning: string | undefined;
    let draft;
    try {
      draft = await planner.regenerateScene({ project, index, instruction });
    } catch (e) {
      if (planner === offline) throw e;
      warning = `${PLANNER_LABEL[planner.kind]} ile yeniden üretim başarısız oldu (${errorMessage(e)}). Çevrimdışı planlayıcı kullanıldı.`;
      planner = offline;
      draft = await offline.regenerateScene({ project, index, instruction });
    }
    const names = project.characters.map((c) => c.name);
    if (planner !== offline && project.settings.language === "tr") draft = (await fixDraftSpelling({ title: "", characters: [], scenes: [draft] }, project.story, planner)).scenes[0];
    if (project.settings.style !== "news") draft = groundScene(draft, names, project.settings, undefined, eraOf(project.characters.map((c) => c.outfit))).scene;
    const old = project.scenes[index];
    const target = project.settings.durationSec / project.scenes.length;
    const scene = normalizeScene(draft, project.characters, project.settings, target, old.id);
    if (scene.actors.length === 0 && scene.setting !== "space") scene.actors = old.actors;
    res.json({ scene, warning });
  }));

  app.post("/api/projects/:id/render", wrap(async (req, res) => {
    const project = await load(String(req.params.id));
    const preview = req.body?.preview === true;
    const pending = project.scenes.findIndex((s) => !s.approved);
    if (pending >= 0) throw new HttpError(409, `Video üretmeden önce tüm sahneleri onaylayın (sahne ${pending + 1} onaylanmadı).`);
    const running = activeByProject.get(project.id);
    if (running && jobs.get(running)?.status === "running") {
      return res.status(202).json({ jobId: running });
    }
    const job: Job = { id: newId("job"), projectId: project.id, status: "running", phase: "queued", progress: 0, startedAt: Date.now() };
    // Finished jobs are kept an hour for late pollers, then dropped so the map does not grow forever.
    for (const [id, j] of jobs) if (j.status !== "running" && Date.now() - j.startedAt > 3_600_000) jobs.delete(id);
    jobs.set(job.id, job);
    activeByProject.set(project.id, job.id);
    res.status(202).json({ jobId: job.id });

    const outDir = deps.store.rendersDir(project.id);
    await mkdir(outDir, { recursive: true });
    const tts = project.settings.voiceover ? await deps.tts(project.settings.language) : null;
    // Waits (phase "queued") while another render or an image generation is running.
    heavy.run(() =>
      renderVideo(project, outDir, tts, (phase, k) => {
        job.phase = phase;
        job.progress = phase === "voice" ? k * 0.15 : phase === "frames" ? 0.15 + k * 0.8 : 0.97;
      }, undefined, { previewSec: preview ? PREVIEW_SEC : undefined, assetsDir: deps.store.assetsDir(project.id) }),
    )
      .then((r) => {
        const file = path.basename(r.file);
        job.status = "done";
        job.progress = 1;
        job.result = {
          url: mediaUrl(project.id, file),
          srtUrl: mediaUrl(project.id, path.basename(r.srt)),
          durationSec: r.durationSec,
          voice: r.voice,
          notes: r.notes,
          preview: r.preview,
        };
      })
      .catch((e) => {
        job.status = "error";
        job.error = errorMessage(e);
        console.error("[render]", e);
      });
  }));

  // Optional: generate a background image for one scene with the local image service.
  // Never needed to render; without a configured, running service this answers 503.
  app.post("/api/projects/:id/scenes/:index/background", wrap(async (req, res) => {
    const provider = deps.assets?.provider;
    if (!provider) throw new HttpError(503, deps.assets?.problem ?? "Görsel üretimi kapalı (ASSET_PROVIDER ayarlanmadı). Sahneler çizilen arka planla üretilir.");
    const project = await load(String(req.params.id));
    const index = Number(req.params.index);
    const scene = project.scenes[index];
    if (!Number.isInteger(index) || !scene) throw new HttpError(400, "Geçersiz sahne.");
    const prompt =
      z.string().trim().min(3).max(600).optional().parse(req.body?.prompt || undefined) ??
      `${scene.visualNote || scene.title}, empty background scene, no people, no text, flat illustration`;
    const portrait = project.settings.aspect === "9:16";
    const ask = { prompt, width: portrait ? 576 : 1024, height: portrait ? 1024 : 576 };
    const dir = deps.store.assetsDir(project.id);
    // Same prompt and size as an earlier image in this project: reuse it, no model run.
    let file = await findAsset(dir, ask);
    const reused = Boolean(file);
    if (!file) {
      if (!(await provider.available())) throw new HttpError(503, "Görsel servisi çalışmıyor; çizilen arka plan kullanılmaya devam edecek.");
      const img = await heavy.run(() => provider.generate(ask));
      file = await saveAsset(dir, ask, img);
    }
    // Re-read so edits saved while the image was generating are kept.
    const latest = await load(project.id);
    const target = latest.scenes.find((s) => s.id === scene.id);
    if (!target) throw new HttpError(409, "Sahne bu sırada silindi.");
    target.background = { file, prompt };
    await deps.store.save({ ...latest, updatedAt: new Date().toISOString() });
    res.json({ scene: target, reused });
  }));

  // Back to the drawn background. The image stays in the assets folder for reuse.
  app.delete("/api/projects/:id/scenes/:index/background", wrap(async (req, res) => {
    const project = await load(String(req.params.id));
    const scene = project.scenes[Number(req.params.index)];
    if (!scene) throw new HttpError(400, "Geçersiz sahne.");
    delete scene.background;
    await deps.store.save({ ...project, updatedAt: new Date().toISOString() });
    res.json({ scene });
  }));

  // Generated images, for the browser preview.
  app.get("/media/:id/assets/:file", (req, res, next) => {
    const file = String(req.params.file);
    if (!ASSET_FILE_RE.test(file)) return res.status(400).end();
    let dir: string;
    try {
      dir = deps.store.assetsDir(String(req.params.id));
    } catch {
      return res.status(400).end();
    }
    res.sendFile(path.join(dir, file), { maxAge: "1d", immutable: true }, (err?: Error) => {
      if (err && !res.headersSent) next(new HttpError(404, "Dosya bulunamadı."));
    });
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job) return res.status(404).json({ error: "İş bulunamadı: sunucu yeniden başlamış olabilir. Videoyu yeniden üretin." });
    res.json(job);
  });

  app.get("/media/:id/:file", (req, res, next) => {
    const file = String(req.params.file);
    if (!FILE_RE.test(file)) return res.status(400).end();
    let dir: string;
    try {
      dir = deps.store.rendersDir(String(req.params.id));
    } catch {
      return res.status(400).end();
    }
    const download = req.query.download === "1";
    const send = download ? res.download.bind(res) : res.sendFile.bind(res);
    send(path.join(dir, file), (err?: Error) => {
      if (err && !res.headersSent) next(new HttpError(404, "Dosya bulunamadı."));
    });
  });

  // An unknown API address answers JSON 404 instead of falling through to the web page.
  app.use("/api", (_req, res) => res.status(404).json({ error: "Bilinmeyen API adresi." }));

  // The web app on the same port as the API: no second server, no proxy, no CORS.
  if (deps.frontend) app.use(deps.frontend);
  else if (deps.webDist && existsSync(deps.webDist)) {
    app.use(express.static(deps.webDist));
    // Page addresses (/?p=…, any client path) get index.html; /api and /media never do.
    app.get(/^(?!\/api\/|\/media\/).*/, (_req, res) => res.sendFile(path.join(deps.webDist!, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Geçersiz veri.", details: err.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Beklenmeyen bir hata oluştu." });
  });

  return app;
}
