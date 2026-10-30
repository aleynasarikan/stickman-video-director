import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { FPS, canvasSize, type Project } from "../shared/schema";
import { buildTimeline, buildCues, estimateSpeechSec, narrationWordTimes, type SubtitleCue, type WordTime } from "../shared/timeline";
import { sfxEvents } from "../shared/sfx";
import { mixSfx, writeWav } from "./sfx";
import { registerFonts } from "./fonts";
import { renderFrame } from "../shared/render/frame";
import type { Ctx } from "../shared/render/painter";
import { ffmpeg, ffmpegPath } from "./ffmpeg";
import type { TtsEngine } from "./tts";

export type RenderPhase = "voice" | "frames" | "encode";

export interface RenderOptions {
  /** Render only about this many seconds from the start (a quick check with sound), as preview-*.mp4. */
  previewSec?: number;
}

export interface RenderResult {
  file: string;
  srt: string;
  durationSec: number;
  voice: boolean;
  notes: string[];
  preview: boolean;
}

const SPEECH_LEAD = 0.3; // seconds of silence before each scene's narration
const SPEECH_TAIL = 0.6;

function srtTime(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: SubtitleCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

async function buildNarration(project: Project, tts: TtsEngine, work: string, onProgress: (k: number) => void) {
  const speech: number[] = [];
  const words: (WordTime[] | undefined)[] = [];
  const scenes = project.scenes;
  for (let i = 0; i < scenes.length; i++) {
    const text = scenes[i].narration.trim();
    if (!text) {
      speech.push(0);
      words.push(undefined);
      continue;
    }
    const voice = scenes[i].voice ?? project.settings.voice ?? "kadin";
    const clip = await tts.synthesize(text, project.settings.language, path.join(work, `voice-${i}.wav`), voice);
    speech.push(clip.duration);
    words.push(narrationWordTimes(scenes[i].narration, clip.duration, clip.words));
    onProgress((i + 1) / scenes.length);
  }
  // Scenes stretch so narration always fits; they never shrink below the planned length.
  scenes.forEach((s, i) => {
    if (speech[i] > 0) s.durationSec = Math.max(s.durationSec, Math.ceil((speech[i] + SPEECH_LEAD + SPEECH_TAIL) * 10) / 10);
  });

  const padded: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const out = path.join(work, `pad-${i}.wav`);
    const d = scenes[i].durationSec.toFixed(3);
    if (speech[i] > 0) {
      const lead = Math.round(SPEECH_LEAD * 1000);
      await ffmpeg(["-i", path.join(work, `voice-${i}.wav`), "-af", `adelay=${lead},apad`, "-t", d, "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", out]);
    } else {
      await ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", d, "-c:a", "pcm_s16le", out]);
    }
    padded.push(out);
  }
  const list = path.join(work, "concat.txt");
  await writeFile(list, padded.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const narration = path.join(work, "narration.wav");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c:a", "pcm_s16le", narration]);
  return { narration, speech, words };
}

/** The scenes that start within the first `sec` seconds (at least one). */
function previewScenes(project: Project, sec: number) {
  let t = 0;
  const keep = project.scenes.filter((s) => {
    const inside = t < sec;
    t += s.durationSec;
    return inside;
  });
  project.scenes = keep.length ? keep : project.scenes.slice(0, 1);
}

/**
 * Renders the project to an MP4 using the same drawing code as the browser preview.
 * Frames are produced locally with @napi-rs/canvas and piped into FFmpeg (H.264 + AAC).
 */
export async function renderVideo(
  source: Project,
  outDir: string,
  tts: TtsEngine | null,
  onProgress: (phase: RenderPhase, k: number) => void,
  signal?: AbortSignal,
  opts: RenderOptions = {},
): Promise<RenderResult> {
  registerFonts();
  const project: Project = structuredClone(source);
  const notes: string[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (opts.previewSec) previewScenes(project, opts.previewSec);
  const work = path.join(outDir, `.work-${stamp}`);
  await mkdir(work, { recursive: true });

  try {
    let narration: string | null = null;
    let speech: number[] = project.scenes.map((s) => estimateSpeechSec(s.narration, project.settings.language));
    let words: (WordTime[] | undefined)[] = [];
    if (project.settings.voiceover) {
      if (tts) {
        onProgress("voice", 0);
        const r = await buildNarration(project, tts, work, (k) => onProgress("voice", k));
        narration = r.narration;
        speech = r.speech;
        words = r.words;
      } else {
        notes.push("Bu sistemde Türkçe seslendirme motoru bulunamadı; video sessiz üretildi.");
      }
    }

    const { spans, total: full } = buildTimeline(project.scenes);
    const total = opts.previewSec ? Math.min(full, opts.previewSec) : full;
    const cues = buildCues(spans, (s) => speech[s.index], (s) => words[s.index]);
    const { width, height } = canvasSize(project.settings.aspect);
    const frames = Math.ceil(total * FPS);

    // Sound effects (on unless turned off) go under the narration, or alone in a silent video.
    let sfx: string | null = null;
    if (project.settings.sfx ?? true) {
      const events = sfxEvents(project.scenes);
      if (events.length) {
        sfx = path.join(work, "sfx.wav");
        await writeWav(sfx, mixSfx(events, total));
      }
    }
    const audio = [narration, sfx].filter((a): a is string => a !== null);
    const mix = audio.length === 2 ? ["-filter_complex", "[1:a][2:a]amix=inputs=2:duration=first:normalize=0[a]", "-map", "0:v", "-map", "[a]"] : [];

    const file = path.join(outDir, `${opts.previewSec ? "preview" : "video"}-${stamp}.mp4`);
    const args = [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(FPS), "-i", "pipe:0",
      ...audio.flatMap((a) => ["-i", a]),
      ...mix,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      ...(audio.length ? ["-c:a", "aac", "-b:a", "160k", "-shortest"] : []),
      "-movflags", "+faststart", file,
    ];
    const proc = spawn(ffmpegPath(), args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    const exited = new Promise<number>((resolve) => proc.on("close", (code) => resolve(code ?? 1)));
    proc.stdin.on("error", () => {}); // reported via exit code below

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d") as unknown as Ctx;
    for (let f = 0; f < frames; f++) {
      if (signal?.aborted) {
        proc.kill("SIGKILL");
        throw new Error("Üretim iptal edildi.");
      }
      renderFrame(ctx, project, f / FPS, { width, height, cues, subtitles: project.settings.subtitles });
      const buf = Buffer.from(ctx.getImageData(0, 0, width, height).data.buffer);
      if (!proc.stdin.write(buf)) await new Promise<void>((r) => proc.stdin.once("drain", () => r()));
      if (f % 15 === 0) onProgress("frames", f / frames);
    }
    proc.stdin.end();
    onProgress("encode", 1);
    const code = await exited;
    if (code !== 0) throw new Error(`FFmpeg hata verdi (kod ${code}): ${stderr.slice(-500)}`);

    const srt = file.replace(/\.mp4$/, ".srt");
    await writeFile(srt, toSrt(cues));
    return { file, srt, durationSec: total, voice: Boolean(narration), notes, preview: Boolean(opts.previewSec) };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
