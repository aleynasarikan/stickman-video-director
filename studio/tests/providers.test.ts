import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { FallbackTts, PocketTts, detectTts, pocketPython, type Clip, type TtsEngine } from "../server/tts";
import { Txt2ImgProvider, assetProviderFromEnv, isImage, isLocalUrl, saveAsset } from "../server/assets";
import { WorkQueue } from "../server/gate";
import { renderVideo } from "../server/render";
import { createApp } from "../server/app";
import { ProjectStore } from "../server/store";
import type { Project } from "../shared/schema";

// ---- TTS provider selection and fallback --------------------------------------------------

/** A test engine (not a model): fails the first `fails` calls, then reports a fixed duration. */
class FlakyEngine implements TtsEngine {
  calls = 0;
  constructor(readonly name: string, private fails: number, private duration = 1) {}
  async synthesize(): Promise<Clip> {
    this.calls++;
    if (this.calls <= this.fails) throw new Error(`${this.name} çalışmadı`);
    return { duration: this.duration };
  }
}

describe("TTS provider fallback", () => {
  it("falls back to the next engine and remembers a repeatedly failing one", async () => {
    const broken = new FlakyEngine("pocket-tts", Infinity);
    const ema = new FlakyEngine("ema-lightning", 0, 2);
    const chain = () => new FallbackTts([broken, ema]);
    for (let i = 0; i < 4; i++) expect((await chain().synthesize("x", "tr", "/dev/null")).duration).toBe(2);
    // Tried twice, then skipped while resting, even across new chains (detectTts builds one per request).
    expect(broken.calls).toBe(2);
    expect(ema.calls).toBe(4);
  });

  it("still tries a resting engine when it is the last one left", async () => {
    const only = new FlakyEngine("ema-lightning", 2);
    const chain = new FallbackTts([only]);
    await expect(chain.synthesize("x", "tr", "/dev/null")).rejects.toThrow();
    await expect(chain.synthesize("x", "tr", "/dev/null")).rejects.toThrow();
    expect((await chain.synthesize("x", "tr", "/dev/null")).duration).toBe(1);
  });

  it("reports voice support from the first engine", () => {
    const say: TtsEngine = { name: "macos-say", synthesize: async () => ({ duration: 1 }) };
    const ema: TtsEngine = { name: "ema-lightning", voices: true, synthesize: async () => ({ duration: 1 }) };
    expect(new FallbackTts([ema, say]).voices).toBe(true);
    expect(new FallbackTts([say, ema]).voices).toBe(false);
  });
});

describe("TTS_ENGINE selection", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("never picks Pocket or Freya automatically", async () => {
    process.env.TTS_ENGINE = "";
    const tts = await detectTts("tr");
    expect(["pocket-tts", "freya-tts"]).not.toContain(tts?.name);
  });

  it("an optional engine that is not installed falls back to the automatic chain", async () => {
    process.env.TTS_ENGINE = "";
    const auto = await detectTts("tr");
    // A Python that does not exist = not installed (the Freya worker script does not exist at all).
    process.env.TTS_ENGINE = "pocket";
    process.env.POCKET_PYTHON = "/yok/.venv-pocket/bin/python";
    expect((await detectTts("tr"))?.name).toBe(auto?.name);
    process.env.TTS_ENGINE = "freya,pocket";
    expect((await detectTts("tr"))?.name).toBe(auto?.name);
  });

  it.runIf(Boolean(pocketPython()))("an installed Pocket goes first, with the automatic chain behind it", async () => {
    process.env.TTS_ENGINE = "pocket";
    const tts = await detectTts("tr");
    expect(tts?.name).toBe("pocket-tts");
    expect(tts?.voices).toBe(true);
    process.env.TTS_ENGINE = "";
    expect((await detectTts("tr"))?.name).not.toBe("pocket-tts"); // never automatic
  });

  it("keeps none = no narration", async () => {
    process.env.TTS_ENGINE = "none";
    expect(await detectTts("tr")).toBeNull();
  });
});

describe("optional worker engines without word timings", () => {
  // Same JSON-lines protocol as the EMA worker, but the reply has no words (like Pocket/Freya).
  const dir = mkdtempSync(path.join(os.tmpdir(), "pocket-test-"));
  const script = path.join(dir, "worker.py");
  writeFileSync(
    script,
    `import json, sys, wave
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    req = json.loads(line)
    with wave.open(req["out"], "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(b"\\0\\0" * 24000)
    print(json.dumps({"id": req["id"], "duration": 1.0}), flush=True)
`,
  );
  const engine = new PocketTts("python3", script, 20_000);
  afterAll(() => engine.close());

  it("returns audio with no word list, so the exporter aligns it", async () => {
    const clip = await engine.synthesize("Merhaba dünya.", "tr", path.join(dir, "a.wav"));
    expect(clip.duration).toBeCloseTo(1, 1);
    expect(clip.words).toBeUndefined();
    expect(engine.name).toBe("pocket-tts");
  });
});

// ---- Heavy work queue -----------------------------------------------------------------------

describe("WorkQueue", () => {
  it("runs one job at a time by default, in order", async () => {
    const q = new WorkQueue();
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const job = (name: string, ms: number) =>
      q.run(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        log.push(`${name}+`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`${name}-`);
        active--;
        return name;
      });
    const results = await Promise.all([job("render", 30), job("image", 10), job("render2", 5)]);
    expect(results).toEqual(["render", "image", "render2"]);
    expect(maxActive).toBe(1);
    expect(log).toEqual(["render+", "render-", "image+", "image-", "render2+", "render2-"]);
  });

  it("frees the slot when a job throws", async () => {
    const q = new WorkQueue();
    await expect(q.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await q.run(async () => 1)).toBe(1);
    expect(q.size).toBe(0);
  });
});

// ---- AssetProvider --------------------------------------------------------------------------

function png(): Buffer {
  const c = createCanvas(64, 36);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#3a7bd5";
  ctx.fillRect(0, 0, 64, 36);
  return c.toBuffer("image/png");
}

async function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe("AssetProvider", () => {
  it("accepts only loopback URLs", () => {
    for (const ok of ["http://127.0.0.1:7860", "http://localhost:8188/", "http://[::1]:7860"]) expect(isLocalUrl(ok)).toBe(true);
    for (const bad of ["http://192.168.1.5:7860", "https://example.com", "http://localhost.evil.com", "http://u:p@localhost:7860", "file:///etc/passwd", "ftp://127.0.0.1", "nonsense"])
      expect(isLocalUrl(bad)).toBe(false);
    expect(() => new Txt2ImgProvider("http://10.0.0.2:7860")).toThrow(/yalnızca bu bilgisayarda/);
  });

  it("is off unless configured, and refuses remote or unsupported services", () => {
    expect(assetProviderFromEnv({}).provider).toBeNull();
    expect(assetProviderFromEnv({ ASSET_PROVIDER: "none" }).provider).toBeNull();
    const remote = assetProviderFromEnv({ ASSET_PROVIDER: "drawthings", ASSET_URL: "http://192.168.1.20:7860" });
    expect(remote.provider).toBeNull();
    expect(remote.problem).toMatch(/yalnızca bu bilgisayarı/);
    expect(assetProviderFromEnv({ ASSET_PROVIDER: "comfyui" }).problem).toMatch(/ComfyUI/);
    expect(assetProviderFromEnv({ ASSET_PROVIDER: "drawthings" }).provider?.name).toBe("drawthings");
  });

  it("reports an unreachable service as unavailable and fails generation with a clear error", async () => {
    const { server, url } = await listen(() => {});
    await new Promise<void>((r) => server.close(() => r()));
    const p = new Txt2ImgProvider(url);
    expect(await p.available()).toBe(false);
    await expect(p.generate({ prompt: "park", width: 64, height: 36 })).rejects.toThrow(/bağlanılamadı/);
  });

  it("returns only real image bytes from a local txt2img endpoint", async () => {
    let reply: unknown = { images: [png().toString("base64")] };
    const { server, url } = await listen((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url === "/sdapi/v1/txt2img" ? reply : {}));
    });
    try {
      const p = new Txt2ImgProvider(url);
      expect(await p.available()).toBe(true);
      expect(isImage(await p.generate({ prompt: "park", width: 64, height: 36 }))).toBe(true);
      reply = { images: [Buffer.from("<html>error</html>").toString("base64")] };
      await expect(p.generate({ prompt: "park", width: 64, height: 36 })).rejects.toThrow(/PNG\/JPEG değil/);
      reply = { error: "model yok" };
      await expect(p.generate({ prompt: "park", width: 64, height: 36 })).rejects.toThrow(/görsel döndürmedi/);
    } finally {
      server.close();
    }
  });
});

// ---- Rendering never depends on assets -------------------------------------------------------

function project(background?: { file: string; prompt: string }): Project {
  return {
    id: "prj_asset", title: "t", story: "", planner: "offline", createdAt: "", updatedAt: "",
    settings: { durationSec: 10, aspect: "16:9", style: "classic-light", language: "tr", voiceover: false, subtitles: false, sfx: false },
    characters: [{ id: "a", name: "A", color: "#e63946", hat: "none", scale: 1, hair: "short", outfit: "casual" }],
    scenes: [{
      id: "s1", title: "Park", narration: "", visualNote: "", durationSec: 3, setting: "park", timeOfDay: "day",
      camera: "wide", transition: "cut", approved: true, background,
      actors: [{ characterId: "a", actions: ["idle"], fromX: 0.5, toX: 0.5, facing: "right", emotion: "neutral", prop: "none" }],
    }],
  };
}

describe("rendering with optional backgrounds", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "assets-render-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("renders with the drawn background when the image file is missing", async () => {
    const r = await renderVideo(project({ file: "bg-s1-yok.png", prompt: "park" }), dir, null, () => {}, undefined, { assetsDir: path.join(dir, "assets") });
    expect(r.durationSec).toBe(3);
    expect(r.notes.join(" ")).toMatch(/arka plan görseli okunamadı/);
  }, 60_000);

  it("uses a saved image when present", async () => {
    const assets = path.join(dir, "assets");
    const file = await saveAsset(assets, { prompt: "park", width: 64, height: 36 }, png());
    expect(await readdir(assets)).toEqual([file]); // atomic write leaves no .tmp behind
    const r = await renderVideo(project({ file, prompt: "park" }), dir, null, () => {}, undefined, { assetsDir: assets });
    expect(r.notes).toEqual([]);
  }, 60_000);

  it("existing projects without the field render as before", async () => {
    const r = await renderVideo(project(), dir, null, () => {});
    expect(r.notes).toEqual([]);
  }, 60_000);
});

describe("background endpoint", () => {
  it("answers 503 and changes nothing when no image service is configured", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "assets-api-"));
    const store = new ProjectStore(dir);
    await store.save(project());
    const app = createApp({ store, ai: {}, tts: async () => null });
    const { server, url } = await new Promise<{ server: Server; url: string }>((r) => {
      const s = app.listen(0, "127.0.0.1", () => r({ server: s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` }));
    });
    try {
      const res = await fetch(`${url}/api/projects/prj_asset/scenes/0/background`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/Görsel üretimi kapalı/);
      expect((await store.get("prj_asset"))?.scenes[0].background).toBeUndefined();
      const status = await (await fetch(`${url}/api/status`)).json();
      expect(status.assets).toEqual({ provider: null });
    } finally {
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("background endpoints with a local image service", () => {
  it("generates once, reuses by prompt, survives autosave, serves the file and can be removed", async () => {
    let calls = 0;
    const { server: svc, url: svcUrl } = await listen((req, res) => {
      if (req.url === "/sdapi/v1/txt2img") calls++;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ images: [png().toString("base64")] }));
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), "assets-api2-"));
    const store = new ProjectStore(dir);
    const p = project();
    p.scenes.push({ ...p.scenes[0], id: "s2", title: "Park 2" });
    await store.save(p);
    const app = createApp({
      store, ai: {}, tts: async () => null,
      assets: { provider: new Txt2ImgProvider(svcUrl) },
      ttsInventory: () => ({ "ema-lightning": true, "pocket-tts": false }),
    });
    const { server, url } = await new Promise<{ server: Server; url: string }>((r) => {
      const s = app.listen(0, "127.0.0.1", () => r({ server: s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` }));
    });
    const post = (i: number, prompt: string) =>
      fetch(`${url}/api/projects/prj_asset/scenes/${i}/background`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) });
    try {
      const status = await (await fetch(`${url}/api/status`)).json();
      expect(status.assets).toEqual({ provider: "drawthings" });
      expect(status.tts.installed).toEqual({ "ema-lightning": true, "pocket-tts": false });

      const a = await (await post(0, "akşam sahil kasabası")).json();
      expect(a.reused).toBe(false);
      const b = await (await post(1, "akşam sahil kasabası")).json();
      expect(b.reused).toBe(true);
      expect(b.scene.background.file).toBe(a.scene.background.file);
      expect(calls).toBe(1);

      // A stale autosave (page without the new field) keeps the server's background...
      const stale = project();
      stale.scenes.push({ ...stale.scenes[0], id: "s2", title: "Park 2 düzenlendi" });
      const put = await fetch(`${url}/api/projects/prj_asset`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: stale }) });
      expect(put.status).toBe(200);
      const saved = (await store.get("prj_asset"))!;
      expect(saved.scenes[1].title).toBe("Park 2 düzenlendi");
      expect(saved.scenes[0].background?.file).toBe(a.scene.background.file);
      // ...and a save cannot point a scene at an arbitrary file.
      stale.scenes[0].background = { file: "baska.png", prompt: "x" };
      await fetch(`${url}/api/projects/prj_asset`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: stale }) });
      expect((await store.get("prj_asset"))!.scenes[0].background?.file).toBe(a.scene.background.file);

      const img = await fetch(`${url}/media/prj_asset/assets/${a.scene.background.file}`);
      expect(img.status).toBe(200);
      expect(isImage(Buffer.from(await img.arrayBuffer()))).toBe(true);
      expect((await fetch(`${url}/media/prj_asset/assets/..%2Fproject.json`)).status).toBe(400);

      const del = await fetch(`${url}/api/projects/prj_asset/scenes/0/background`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect((await store.get("prj_asset"))!.scenes[0].background).toBeUndefined();
      // The file stays in the project's library for reuse.
      expect(await readdir(path.join(dir, "prj_asset", "assets"))).toEqual([a.scene.background.file]);
    } finally {
      server.close();
      svc.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
