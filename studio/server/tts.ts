import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ffmpegPath, probeDuration } from "./ffmpeg";
import { VOICE_PRESETS, type VoiceId } from "../shared/schema";
import type { WordTime } from "../shared/timeline";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface Clip {
  /** Seconds of audio written. */
  duration: number;
  /** When each spoken word is heard, if the engine knows (EMA does, macOS say doesn't). */
  words?: WordTime[];
}

export interface TtsEngine {
  readonly name: string;
  /** True if the engine honours the narrator voice choice (kadın, erkek, …); false/absent = one voice. */
  readonly voices?: boolean;
  /** Writes speech to `outWav`. Engines without voices ignore `voice`. */
  synthesize(text: string, language: string, outWav: string, voice?: VoiceId): Promise<Clip>;
}

const MAC_VOICES: Record<string, string> = { tr: "Yelda", en: "Samantha" };

/** Free, offline TTS using the macOS `say` command. */
export class MacSayTts implements TtsEngine {
  readonly name = "macos-say";

  async synthesize(text: string, language: string, outWav: string): Promise<Clip> {
    const voice = MAC_VOICES[language] ?? MAC_VOICES.en;
    const aiff = outWav.replace(/\.wav$/, ".aiff");
    // Text is passed as an argument (never through a shell), so no escaping issues.
    await run("say", ["-v", voice, "-o", aiff, "--", text]);
    await run(ffmpegPath(), ["-y", "-loglevel", "error", "-i", aiff, "-ar", "44100", "-ac", "1", outWav]);
    return { duration: await probeDuration(outWav) };
  }
}

type Pending = { resolve: (words: WordTime[]) => void; reject: (e: Error) => void };

type Preset = { pitch: number; formant: number; speed: number };

/**
 * A TTS model in a long-lived Python worker (one JSON object per line), so the model loads once
 * per server run instead of once per scene. The worker restarts on the next request if it dies.
 */
export class WorkerTts implements TtsEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  readonly voices = true;

  constructor(
    readonly name: string,
    /** Shown in error messages. */
    private label: string,
    private python: string,
    private script: string,
    private startTimeoutMs = 180_000,
    /** Pitch/formant/speed per voice, relative to the model's own speaker. */
    private presets: Record<VoiceId, Preset> = VOICE_PRESETS,
  ) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const proc = spawn(this.python, [this.script], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    this.proc = proc;
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));

    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error(`${this.label} zamanında başlamadı.`)), this.startTimeoutMs);
      const fail = (e: Error) => {
        clearTimeout(timer);
        reject(e);
        if (this.proc === proc) this.stop(e);
      };
      createInterface({ input: proc.stdout }).on("line", (line) => {
        let msg: { ready?: boolean; fatal?: string; id?: number; error?: string; words?: unknown };
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.ready) {
          clearTimeout(timer);
          resolve();
        } else if (msg.fatal) fail(new Error(`${this.label} yüklenemedi: ${msg.fatal}`));
        else if (msg.id != null) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error != null) p?.reject(new Error(`${this.label} seslendiremedi: ${msg.error}`));
          else p?.resolve(parseWords(msg.words));
        }
      });
      proc.on("error", (e) => fail(new Error(`${this.label} başlatılamadı (${this.python}): ${e.message}`)));
      proc.on("exit", (code) => fail(new Error(`${this.label} beklenmedik şekilde kapandı (kod ${code}). ${stderr.trim().split("\n").pop() ?? ""}`)));
    });
    return this.ready;
  }

  private stop(reason: Error) {
    if (!this.proc) return;
    const proc = this.proc;
    this.proc = null;
    this.ready = null;
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
    if (proc.exitCode == null) proc.kill();
  }

  async synthesize(text: string, _language: string, outWav: string, voice: VoiceId = "kadin"): Promise<Clip> {
    await this.start();
    const raw = outWav.replace(/\.wav$/, ".raw.wav");
    const id = this.nextId++;
    const done = new Promise<WordTime[]>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.proc!.stdin.write(JSON.stringify({ id, text, out: raw, voice, ...(this.presets[voice] ?? this.presets.kadin) }) + "\n");
    const words = await done;
    // Same format as the other engines (the models write 48 kHz), at a consistent speech loudness.
    await run(ffmpegPath(), ["-y", "-loglevel", "error", "-i", raw, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", "-ac", "1", outWav]);
    return { duration: await probeDuration(outWav), words: words.length ? words : undefined };
  }

  close() {
    this.stop(new Error(`${this.label} kapatıldı.`));
  }
}

/** EMA Lightning (Turkish only, offline, Apache-2.0): one female voice, the others derived with WORLD. */
export class EmaTts extends WorkerTts {
  constructor(python: string, script = path.join(root, "scripts", "ema_tts_worker.py"), startTimeoutMs = 180_000) {
    super("ema-lightning", "EMA Lightning", python, script, startTimeoutMs);
  }
}

/**
 * Kızağan voices relative to the model's male speaker (~105 Hz): "erkek" is the natural voice,
 * the others are WORLD conversions unless a reference recording is set for them
 * (KIZAGAN_REF_KADIN, ...), in which case the worker clones that recording instead.
 */
export const KIZAGAN_PRESETS: Record<VoiceId, Preset> = {
  kadin: { pitch: 2.2, formant: 1.17, speed: 1 },
  "kadin-olgun": { pitch: 1.9, formant: 1.12, speed: 1 },
  erkek: { pitch: 1, formant: 1, speed: 1 },
  "erkek-kalin": { pitch: 0.86, formant: 0.94, speed: 1 },
  cocuk: { pitch: 2.75, formant: 1.25, speed: 1 },
};

/** Kızağan TTS (Turkish VoxCPM2 fine-tune, Apache-2.0): ~2.3B parameters, so a long start-up. */
export class KizaganTts extends WorkerTts {
  constructor(python: string, script = path.join(root, "scripts", "kizagan_tts_worker.py"), startTimeoutMs = 600_000) {
    super("kizagan", "Kızağan TTS", python, script, startTimeoutMs, KIZAGAN_PRESETS);
  }
}

/**
 * Pocket TTS Turkish (CC-BY-4.0 weights, Apache-2.0 code; credit Kyutai and the Turkish fine-tune).
 * Optional and off unless TTS_ENGINE names it. Runs in its own Python env (studio/.venv-pocket)
 * through scripts/pocket_tts_worker.py, which speaks the same JSON-lines protocol as EMA's worker.
 * It reports no word timings, so the exporter aligns its words to the audio (server/align.ts).
 */
export class PocketTts extends WorkerTts {
  constructor(python: string, script = path.join(root, "scripts", "pocket_tts_worker.py"), startTimeoutMs = 120_000) {
    super("pocket-tts", "Pocket TTS", python, script, startTimeoutMs);
  }
}

/** FreyaTTS-small (Apache-2.0): optional, same protocol, own env (studio/.venv-freya), no word timings. */
export class FreyaTts extends WorkerTts {
  constructor(python: string, script = path.join(root, "scripts", "freya_tts_worker.py"), startTimeoutMs = 120_000) {
    super("freya-tts", "FreyaTTS", python, script, startTimeoutMs);
  }
}

/** The worker sends words as [text, start, end]; anything malformed is dropped. */
function parseWords(raw: unknown): WordTime[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((w) =>
    Array.isArray(w) && typeof w[0] === "string" && Number.isFinite(w[1]) && Number.isFinite(w[2]) ? [{ text: w[0], start: Number(w[1]), end: Number(w[2]) }] : [],
  );
}

/**
 * Engines that failed several clips in a row are skipped for a while, so a broken optional
 * provider (one that hangs at start-up, say) costs one timeout rather than one per scene.
 * Kept per engine object because detectTts() builds a new chain for every request.
 */
const BREAKER_FAILS = 2;
const BREAKER_MS = 5 * 60_000;
const failures = new WeakMap<TtsEngine, { count: number; until: number }>();

function resting(engine: TtsEngine, now = Date.now()): boolean {
  const f = failures.get(engine);
  return Boolean(f && f.count >= BREAKER_FAILS && now < f.until);
}

/** Tries the preferred engine and, if it fails, falls back to the next one for that clip. */
export class FallbackTts implements TtsEngine {
  constructor(private engines: TtsEngine[]) {}

  get name() {
    return this.engines[0].name;
  }

  get voices() {
    return Boolean(this.engines[0].voices);
  }

  async synthesize(text: string, language: string, outWav: string, voice?: VoiceId): Promise<Clip> {
    let last: unknown;
    // A resting engine is still tried if it is the only one left.
    const usable = this.engines.filter((e, i) => !resting(e) || i === this.engines.length - 1);
    for (const [i, engine] of usable.entries()) {
      try {
        const clip = await engine.synthesize(text, language, outWav, voice);
        failures.delete(engine);
        return clip;
      } catch (e) {
        last = e;
        const f = failures.get(engine) ?? { count: 0, until: 0 };
        f.count++;
        f.until = Date.now() + BREAKER_MS;
        failures.set(engine, f);
        if (i < usable.length - 1) console.warn(`${engine.name} başarısız, ${usable[i + 1].name} deneniyor: ${(e as Error).message}`);
      }
    }
    throw last;
  }
}

export function emaPython(): string | null {
  const p = process.env.EMA_PYTHON || path.join(root, ".venv-tts", "bin", "python");
  return existsSync(p) && existsSync(path.join(root, "scripts", "ema_tts_worker.py")) ? p : null;
}

/** Kızağan's Python (studio/.venv-kizagan) when the model has been downloaded too. */
export function kizaganPython(): string | null {
  const p = process.env.KIZAGAN_PYTHON || path.join(root, ".venv-kizagan", "bin", "python");
  const model = process.env.KIZAGAN_MODEL || path.join(root, "models", "Kizagan-TTS-v1.0");
  return existsSync(p) && existsSync(path.join(model, "model.safetensors")) ? p : null;
}

/** An optional provider's Python, if both it and its worker script are present. */
function optionalPython(envVar: string, venv: string, script: string): string | null {
  const p = process.env[envVar] || path.join(root, venv, "bin", "python");
  return existsSync(p) && existsSync(path.join(root, "scripts", script)) ? p : null;
}

export const pocketPython = () => optionalPython("POCKET_PYTHON", ".venv-pocket", "pocket_tts_worker.py");
export const freyaPython = () => optionalPython("FREYA_PYTHON", ".venv-freya", "freya_tts_worker.py");

let ema: EmaTts | null = null;
let kizagan: KizaganTts | null = null;
let pocket: PocketTts | null = null;
let freya: FreyaTts | null = null;

/** Which engines are installed on this machine (for /api/status); nothing is started. */
export function ttsInventory(): Record<string, boolean> {
  return {
    kizagan: Boolean(kizaganPython()),
    "ema-lightning": Boolean(emaPython()),
    "pocket-tts": Boolean(pocketPython()),
    "freya-tts": Boolean(freyaPython()),
    "macos-say": process.platform === "darwin",
  };
}

/** Stops every TTS worker process (server shutdown). They restart on the next request. */
export function closeTtsWorkers() {
  for (const w of [ema, kizagan, pocket, freya]) w?.close();
}

async function detectMacSay(language: string): Promise<MacSayTts | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await run("say", ["-v", "?"]);
    const voice = MAC_VOICES[language] ?? MAC_VOICES.en;
    return stdout.includes(voice) ? new MacSayTts() : null;
  } catch {
    return null;
  }
}

const OPTIONAL = ["pocket", "freya"] as const;

/** The optional engine named `kind`, or null if it is not installed. */
function optionalEngine(kind: (typeof OPTIONAL)[number]): TtsEngine | null {
  if (kind === "pocket") {
    const p = pocketPython();
    return p ? (pocket ??= new PocketTts(p)) : null;
  }
  const p = freyaPython();
  return p ? (freya ??= new FreyaTts(p)) : null;
}

/**
 * TTS_ENGINE:
 * - empty: best available for Turkish (Kızağan, then EMA Lightning, then macOS say, each falling
 *   back to the next for a failed clip). Pocket and Freya are never picked automatically.
 * - "kizagan", "ema" or "say": that engine only (unchanged behaviour).
 * - "pocket" / "freya", or a list such as "freya,pocket": those first, in that order, then the
 *   automatic chain as a safety net. A missing one is skipped with a log line.
 * - "none": no narration.
 */
export async function detectTts(language: string): Promise<TtsEngine | null> {
  const choice = (process.env.TTS_ENGINE || "").trim().toLowerCase();
  if (choice === "none") return null;
  const listed = choice.split(",").map((c) => c.trim()).filter(Boolean);
  if (listed.length && listed.every((c) => (OPTIONAL as readonly string[]).includes(c))) {
    const preferred: TtsEngine[] = [];
    if (language === "tr") {
      for (const kind of listed as (typeof OPTIONAL)[number][]) {
        const e = optionalEngine(kind);
        if (e) preferred.push(e);
        else warnOnce(`TTS_ENGINE=${kind} seçili ama kurulu değil; EMA Lightning kullanılacak.`);
      }
    }
    return chain([...preferred, ...(await autoChain(language))]);
  }
  return chain(await autoChain(language, choice));
}

function chain(engines: TtsEngine[]): TtsEngine | null {
  if (!engines.length) return null;
  return engines.length === 1 ? engines[0] : new FallbackTts(engines);
}

const warned = new Set<string>();
function warnOnce(msg: string) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(msg);
}

/** The original selection: Kızağan → EMA → say for "" (auto), or only the one engine named. */
async function autoChain(language: string, choice = ""): Promise<TtsEngine[]> {
  const engines: TtsEngine[] = [];
  if (language === "tr") {
    const kp = choice === "" || choice === "kizagan" ? kizaganPython() : null;
    if (kp) engines.push((kizagan ??= new KizaganTts(kp)));
    const ep = choice === "" || choice === "ema" ? emaPython() : null;
    if (ep) engines.push((ema ??= new EmaTts(ep)));
  }
  if (choice === "" || choice === "say" || language !== "tr") {
    const say = await detectMacSay(language);
    if (say) engines.push(say);
  }
  return engines;
}
