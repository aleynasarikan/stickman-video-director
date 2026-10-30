import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const run = promisify(execFile);

export function ffmpegPath(): string {
  const p = process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string | null);
  if (!p) throw new Error("FFmpeg bulunamadı. FFMPEG_PATH ayarlayın veya ffmpeg-static paketini kurun.");
  return p;
}

/** Reads a media file's duration from ffmpeg's stderr (ffmpeg-static ships without ffprobe). */
export async function probeDuration(file: string): Promise<number> {
  try {
    await run(ffmpegPath(), ["-hide_banner", "-i", file]);
  } catch (e) {
    const stderr = String((e as { stderr?: string }).stderr ?? "");
    const m = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  throw new Error(`Süre okunamadı: ${file}`);
}

export async function ffmpeg(args: string[]): Promise<void> {
  await run(ffmpegPath(), ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 16 * 1024 * 1024 });
}
