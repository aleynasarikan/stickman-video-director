/**
 * Optional local image generation for scene backgrounds.
 *
 * Off by default: every scene is drawn by the Canvas renderer exactly as before. When a local
 * image service is configured (ASSET_PROVIDER + ASSET_URL), a background can be generated for a
 * scene, saved under data/projects/<id>/assets/ and referenced from scene.background. Rendering
 * never depends on it: a missing service, file or unreadable image falls back to the drawn scene.
 *
 * Only loopback addresses are accepted, so no prompt or image ever leaves the machine.
 */
import { createHash } from "node:crypto";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface AssetRequest {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
}

export interface AssetProvider {
  readonly name: string;
  /** Whether the service answers right now (short timeout). */
  available(): Promise<boolean>;
  /** One image (PNG or JPEG bytes). Throws with a readable Turkish message on failure. */
  generate(req: AssetRequest, signal?: AbortSignal): Promise<Buffer>;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** True only for http(s) URLs on this machine. */
export function isLocalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") && LOOPBACK.has(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Largest image response accepted (a 1024² PNG is ~1.5 MB; base64 adds a third). */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/** PNG or JPEG magic bytes, so an error page is never saved as an image. */
export function isImage(buf: Buffer): boolean {
  const png = buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
  const jpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  return png || jpg;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number, signal?: AbortSignal): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Services with the AUTOMATIC1111-style `POST /sdapi/v1/txt2img` endpoint, which is what the
 * Draw Things app's HTTP API server exposes (default port 7860, off until enabled in the app).
 * Not yet exercised against a running Draw Things instance (phase B).
 */
export class Txt2ImgProvider implements AssetProvider {
  readonly name = "drawthings";

  constructor(
    private baseUrl: string,
    private opts: { steps?: number; timeoutMs?: number } = {},
  ) {
    if (!isLocalUrl(baseUrl)) throw new Error(`Görsel servisi yalnızca bu bilgisayarda olabilir (127.0.0.1/localhost): ${baseUrl}`);
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async available(): Promise<boolean> {
    try {
      await fetchWithTimeout(this.baseUrl, { method: "GET" }, 1500);
      return true; // any HTTP answer means the server is up
    } catch {
      return false;
    }
  }

  async generate(req: AssetRequest, signal?: AbortSignal): Promise<Buffer> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${this.baseUrl}/sdapi/v1/txt2img`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: req.prompt,
            negative_prompt: req.negativePrompt ?? "",
            width: req.width,
            height: req.height,
            seed: req.seed ?? -1,
            steps: this.opts.steps ?? 20,
            batch_size: 1,
          }),
        },
        this.opts.timeoutMs ?? 300_000,
        signal,
      );
    } catch (e) {
      throw new Error(`Görsel servisine bağlanılamadı (${this.baseUrl}): ${(e as Error).message}`);
    }
    if (!res.ok) throw new Error(`Görsel servisi hata verdi (HTTP ${res.status}).`);
    const size = Number(res.headers.get("content-length") || 0);
    if (size > MAX_RESPONSE_BYTES) throw new Error("Görsel servisinin yanıtı çok büyük.");
    const body = (await res.json()) as { images?: unknown };
    const b64 = Array.isArray(body.images) && typeof body.images[0] === "string" ? body.images[0] : null;
    if (!b64 || b64.length > MAX_RESPONSE_BYTES) throw new Error("Görsel servisi bir görsel döndürmedi.");
    const img = Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    if (!isImage(img)) throw new Error("Görsel servisinin yanıtı PNG/JPEG değil.");
    return img;
  }
}

export interface AssetConfig {
  provider: AssetProvider | null;
  /** Why the configured provider is off (shown in /api/status and the server log). */
  problem?: string;
}

/**
 * ASSET_PROVIDER: empty/"none" = off (default); "drawthings" = Draw Things HTTP API (or any
 * service with the same txt2img endpoint). ASSET_URL defaults to http://127.0.0.1:7860.
 * "comfyui" is reserved for phase B (it needs a workflow file) and reported as not supported.
 */
export function assetProviderFromEnv(env: NodeJS.ProcessEnv = process.env): AssetConfig {
  const kind = (env.ASSET_PROVIDER || "none").trim().toLowerCase();
  if (kind === "none" || kind === "") return { provider: null };
  if (kind === "comfyui") return { provider: null, problem: "ComfyUI desteği henüz eklenmedi; çizilen arka planlar kullanılıyor." };
  if (kind !== "drawthings") return { provider: null, problem: `Bilinmeyen ASSET_PROVIDER: ${kind}` };
  const url = env.ASSET_URL || "http://127.0.0.1:7860";
  if (!isLocalUrl(url)) return { provider: null, problem: `ASSET_URL yalnızca bu bilgisayarı gösterebilir (127.0.0.1/localhost): ${url}` };
  return { provider: new Txt2ImgProvider(url, { steps: Number(env.ASSET_STEPS) || undefined }) };
}

/**
 * Content-addressed name: the same prompt at the same size always maps to the same file, so a
 * background already generated for one scene is reused by any other scene that asks for it.
 */
export function assetKey(req: Pick<AssetRequest, "prompt" | "width" | "height">): string {
  return `bg-${createHash("sha1").update(`${req.width}x${req.height}|${req.prompt}`).digest("hex").slice(0, 16)}`;
}

/** The already generated file for this request, if the project has one. */
export async function findAsset(assetsDir: string, req: Pick<AssetRequest, "prompt" | "width" | "height">): Promise<string | null> {
  for (const ext of ["png", "jpg"]) {
    const file = `${assetKey(req)}.${ext}`;
    try {
      await access(path.join(assetsDir, file));
      return file;
    } catch {
      /* not generated yet */
    }
  }
  return null;
}

/** Writes an image into the project's assets folder atomically and returns its file name. */
export async function saveAsset(assetsDir: string, req: Pick<AssetRequest, "prompt" | "width" | "height">, img: Buffer): Promise<string> {
  await mkdir(assetsDir, { recursive: true });
  const file = `${assetKey(req)}.${img[0] === 0xff ? "jpg" : "png"}`;
  const tmp = path.join(assetsDir, `${file}.tmp`);
  await writeFile(tmp, img);
  await rename(tmp, path.join(assetsDir, file));
  return file;
}
