/**
 * Pocket TTS Turkish. The first test runs everywhere (Python stdlib only). The others drive the
 * real model through scripts/pocket_tts_worker.py and are skipped when studio/.venv-pocket or the
 * pinned model snapshot is not installed (see README, "Pocket TTS Turkish").
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FallbackTts, PocketTts, pocketPython, type TtsEngine } from "../server/tts";
import { alignClipWords, parseWav } from "../server/align";

const root = path.resolve(__dirname, "..");

describe("Pocket pre-normalization (scripts/voice_tools.py)", () => {
  it("spells acronyms with suffixes and writes ordinals before words; leaves the rest to Pocket", () => {
    const py = `import sys; sys.path.insert(0, "scripts"); from voice_tools import pocket_prenormalize as p
for s in ["TBMM'de oylama.", "AB'ye üyelik.", "89. dakikada gol!", "1. Lig'de 3. sırada.", "15.10.2026 saat 14:30'da", "NATO zirvesi.", "Çiğdem'le İzmir'de"]: print(p(s))`;
    const out = execFileSync("python3", ["-c", py], { cwd: root, encoding: "utf8" }).trim().split("\n");
    expect(out).toEqual([
      "te be me me de oylama.",
      "a be ye üyelik.",
      "seksen dokuzuncu dakikada gol!",
      "birinci Lig'de üçüncü sırada.",
      "15.10.2026 saat 14:30'da",
      "NATO zirvesi.",
      "Çiğdem'le İzmir'de",
    ]);
  });
});

const installed = Boolean(pocketPython());

describe.runIf(installed)("Pocket TTS worker (real model)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pocket-real-"));
  const engines: PocketTts[] = [];
  afterAll(() => engines.forEach((e) => e.close()));

  it("speaks Turkish offline at 24 kHz, without word timings, and aligns to the audio", async () => {
    const tts = new PocketTts(pocketPython()!);
    engines.push(tts);
    const text = "Çiğdem, ılık bir öğle güneşinde Ömer'le buluştu.";
    const out = path.join(dir, "a.wav");
    const clip = await tts.synthesize(text, "tr", out, "kadin");
    expect(clip.words).toBeUndefined();
    expect(clip.duration).toBeGreaterThan(1.5);
    expect(clip.duration).toBeLessThan(8);
    // The worker's own file is 24 kHz; the engine converts it to the common 44.1 kHz mono format.
    expect(parseWav(readFileSync(out.replace(/\.wav$/, ".raw.wav")))?.sampleRate).toBe(24000);
    expect(parseWav(readFileSync(out))?.sampleRate).toBe(44100);
    const words = await alignClipWords(out, text);
    expect(words?.map((w) => w.text)).toEqual(text.split(" "));
    expect(words![0].start).toBeLessThan(0.5);
    // Same worker, second voice: no reload.
    const t0 = Date.now();
    await tts.synthesize("Kısa bir cümle.", "tr", path.join(dir, "b.wav"), "erkek");
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 180_000);

  it("a Pocket that cannot load falls back to the next engine without crashing", async () => {
    const prev = process.env.POCKET_MODEL_DIR;
    process.env.POCKET_MODEL_DIR = path.join(dir, "yok"); // the worker reads it at start-up
    try {
      const broken = new PocketTts(pocketPython()!);
      engines.push(broken);
      const backup: TtsEngine = { name: "ema-lightning", synthesize: async () => ({ duration: 2 }) };
      const clip = await new FallbackTts([broken, backup]).synthesize("Merhaba.", "tr", path.join(dir, "c.wav"));
      expect(clip.duration).toBe(2);
      await expect(broken.synthesize("Merhaba.", "tr", path.join(dir, "d.wav"))).rejects.toThrow(/Pocket TTS yüklenemedi: model not found/);
    } finally {
      if (prev === undefined) delete process.env.POCKET_MODEL_DIR;
      else process.env.POCKET_MODEL_DIR = prev;
    }
  }, 120_000);
});

it.skipIf(installed)("Pocket TTS is not installed here (real-model tests skipped)", () => {
  expect(existsSync(path.join(root, ".venv-pocket"))).toBe(false);
});
