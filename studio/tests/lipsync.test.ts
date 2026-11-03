import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Project } from "../shared/schema";
import { SPEECH_LEAD, mouthAt, sceneWords, type WordTime } from "../shared/timeline";
import { renderVideo } from "../server/render";
import { ffmpeg } from "../server/ffmpeg";
import type { Clip, TtsEngine } from "../server/tts";

describe("mouthAt", () => {
  const words: WordTime[] = [
    { text: "Merhaba,", start: 0.5, end: 1.1 },
    { text: "dünya", start: 1.3, end: 1.7 },
  ];

  it("keeps the mouth closed before, between and after words", () => {
    expect(mouthAt(words, 0.2)).toBe(0);
    expect(mouthAt(words, 1.2)).toBe(0);
    expect(mouthAt(words, 2)).toBe(0);
  });

  it("opens the mouth while a word is spoken", () => {
    // "Merhaba" has three syllables: the middle of the first one is wide open.
    expect(mouthAt(words, 0.5 + 0.1 - 0.04)).toBeGreaterThan(0.9);
    expect(mouthAt(words, 1.5)).toBeGreaterThan(0.2);
  });
});

describe("sceneWords", () => {
  it("returns only the scene's words, relative to its start", () => {
    const cues = [
      { start: 0.15, end: 1, text: "a", words: [{ text: "a", start: 0.15, end: 0.5 }] },
      { start: 3.15, end: 4, text: "b", words: [{ text: "b", start: 3.15, end: 3.6 }] },
    ];
    expect(sceneWords(cues, { start: 3, end: 5 })).toEqual([{ text: "b", start: expect.closeTo(0.15), end: expect.closeTo(0.6) }]);
  });
});

/** Writes `sec` of tone after `silence` seconds and reports one word over the tone. */
class FakeTts implements TtsEngine {
  readonly name = "fake";
  constructor(private silence: number, private sec: number, private reportWords = true) {}
  async synthesize(text: string, _l: string, out: string): Promise<Clip> {
    const total = this.silence + this.sec + 0.5;
    await ffmpeg([
      "-f", "lavfi", "-i", `sine=frequency=220:duration=${this.sec}`,
      "-af", `adelay=${Math.round(this.silence * 1000)},apad`, "-t", String(total), "-ar", "44100", "-ac", "1", out,
    ]);
    return { duration: total, words: this.reportWords ? [{ text, start: this.silence, end: this.silence + this.sec }] : undefined };
  }
}

describe("spoken scene timing", () => {
  it("shrinks a long planned scene to its line and trims the engine's silence", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lipsync-"));
    try {
      const project: Project = {
        id: "t", title: "t", story: "", planner: "offline", createdAt: "", updatedAt: "",
        settings: { durationSec: 6, aspect: "16:9", style: "classic-light", language: "tr", voiceover: true, subtitles: false, sfx: false },
        characters: [{ id: "a", name: "A", color: "#e63946", hat: "none", scale: 1, hair: "short", outfit: "casual" }],
        scenes: [{
          id: "s1", title: "", narration: "Merhaba", visualNote: "", durationSec: 6, setting: "blank", timeOfDay: "day",
          camera: "wide", transition: "cut", approved: true,
          actors: [{ characterId: "a", actions: ["talk"], fromX: 0.5, toX: 0.5, facing: "right", emotion: "neutral", prop: "none" }],
        }],
      };
      const r = await renderVideo(project, dir, new FakeTts(0.4, 1.2), () => {});
      // 1.2 s of speech (+ margins) instead of the planned 6 s, and the 0.4 s of leading silence is gone.
      expect(r.durationSec).toBeLessThan(1.2 + 0.1 + SPEECH_LEAD + 1);
      expect(r.durationSec).toBeGreaterThanOrEqual(1.2 + SPEECH_LEAD + 0.35);
      // An engine without word timings (macOS say, Pocket, Freya) gets the same trim through
      // silence-aware alignment of its audio.
      const r2 = await renderVideo(structuredClone(project), dir, new FakeTts(0.4, 1.2, false), () => {});
      expect(r2.durationSec).toBeCloseTo(r.durationSec, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
