import { writeFile } from "node:fs/promises";
import { rng } from "../shared/render/painter";
import type { SfxEvent, SfxKind } from "../shared/sfx";

// Sound effects are synthesised here rather than shipped as samples: no asset licences to
// track, nothing to download, and the same project always produces the same audio.

export const SFX_RATE = 44100;
/** Effects sit well under the narration (which is loudness-normalised to -16 LUFS). */
const MASTER = 0.32;

function tone(sec: number, f: (t: number) => number, env: (t: number) => number, sr: number): Float32Array {
  const out = new Float32Array(Math.round(sec * sr));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    phase += (2 * Math.PI * f(t)) / sr;
    out[i] = Math.sin(phase) * env(t);
  }
  return out;
}

/** White noise through a one-pole low-pass whose cutoff follows `cut(t)` (0..1). */
function noise(sec: number, cut: (t: number) => number, env: (t: number) => number, sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(Math.round(sec * sr));
  let y = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    y += cut(t) * (r() * 2 - 1 - y);
    out[i] = y * env(t);
  }
  return out;
}

function sum(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(Math.max(...parts.map((p) => p.length)));
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
  return out;
}

const decay = (k: number) => (t: number) => Math.exp(-t * k);
const attack = (a: number, k: number) => (t: number) => Math.min(1, t / a) * Math.exp(-t * k);

export function synthSfx(kind: SfxKind, sr = SFX_RATE): Float32Array {
  switch (kind) {
    case "pop":
      return tone(0.12, (t) => 900 - t * 5000, attack(0.003, 35), sr);
    case "whoosh":
      return noise(0.4, (t) => 0.04 + 0.25 * Math.sin((t / 0.4) * Math.PI), (t) => Math.sin((t / 0.4) * Math.PI) ** 2 * 1.6, sr, 11);
    case "boing":
      return tone(0.4, (t) => 170 + 300 * Math.min(1, t / 0.12) + 25 * Math.sin(t * 60), attack(0.005, 9), sr);
    case "thud":
      return sum(tone(0.3, (t) => 95 - t * 120, attack(0.002, 14), sr), noise(0.08, () => 0.12, decay(50), sr, 7));
    case "ding":
      return sum(
        tone(1, () => 1318.5, attack(0.002, 4.5), sr),
        tone(1, () => 2637, (t) => 0.35 * attack(0.002, 7)(t), sr),
        tone(1, () => 1975.5, (t) => 0.25 * attack(0.002, 6)(t), sr),
      );
    case "hit":
      return sum(noise(0.07, () => 0.5, decay(60), sr, 3), tone(0.12, (t) => 160 - t * 400, attack(0.002, 30), sr));
    case "kick":
      return sum(tone(0.18, (t) => 140 - t * 300, attack(0.001, 25), sr), noise(0.05, () => 0.35, decay(80), sr, 21));
    case "crowd": {
      // Three seconds of stadium murmur: band-limited noise with a slow swell, overlapping the next.
      const a = noise(3.4, () => 0.08, (t) => Math.min(1, t / 0.4, (3.4 - t) / 0.6) * (0.9 + 0.25 * Math.sin(t * 2.3)) * 2.2, sr, 31);
      const b = noise(3.4, () => 0.02, (t) => Math.min(1, t / 0.4, (3.4 - t) / 0.6) * 3, sr, 37);
      return sum(a, b);
    }
    case "whistle":
      // Referee's pea whistle: a high tone with a fast trill, two short blasts.
      return tone(0.75, (t) => 2900 + 220 * Math.sin(t * 2 * Math.PI * 28), (t) => (t < 0.28 || (t > 0.38 && t < 0.72) ? 0.6 : 0) * Math.min(1, (t % 0.38) / 0.01), sr);
    case "boom": {
      // "Vine boom": a deep pitched-down hit with a long, slightly distorted tail.
      const body = tone(1.6, (t) => 55 + 70 * Math.exp(-t * 18), (t) => Math.min(1, t / 0.004) * Math.exp(-t * 2.2), sr);
      for (let i = 0; i < body.length; i++) body[i] = Math.tanh(body[i] * 2.2) * 0.9;
      return sum(body, noise(0.12, () => 0.2, decay(30), sr, 41));
    }
    case "trombone": {
      // Sad trombone "wah wah wah waaah": four falling notes, the last one wobbling.
      const notes = [[0, 0.32, 293.7], [0.36, 0.32, 277.2], [0.72, 0.32, 261.6], [1.08, 1.0, 246.9]] as const;
      return sum(...notes.map(([at, len, f], i) => {
        const last = i === 3;
        return tone(at + len, (t) => (t < at ? f : f * (1 + (last ? 0.03 * Math.sin((t - at) * 2 * Math.PI * 6) : 0)) * (1 - (t - at) * 0.04)),
          (t) => (t < at ? 0 : Math.min(1, (t - at) / 0.04) * Math.min(1, (at + len - t) / 0.08) * 0.6), sr);
      }).map((x) => {
        // Brassy: add the 2nd and 3rd harmonic by soft clipping.
        for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * 3) * 0.5;
        return x;
      }));
    }
    case "airhorn": {
      // Three stabs of a detuned, square-ish horn chord.
      const stab = (at: number, len: number) => sum(...[466, 470, 698].map((f) =>
        tone(at + len, () => f, (t) => (t < at ? 0 : Math.min(1, (t - at) / 0.01) * Math.min(1, (at + len - t) / 0.03) * 0.35), sr)));
      const x = sum(stab(0, 0.14), stab(0.18, 0.14), stab(0.36, 0.55));
      for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * 4) * 0.55;
      return x;
    }
    case "scratch":
      // Record scratch: a fast up-down sweep of filtered noise.
      return noise(0.45, (t) => 0.05 + 0.6 * Math.abs(Math.sin(t * Math.PI * 4.4)), (t) => Math.min(1, t / 0.01) * (t < 0.4 ? 1.4 : 0), sr, 53);
    case "sparkle": {
      const r = rng(5);
      const pings = Array.from({ length: 5 }, (_, k) => {
        const f = 2000 + r() * 1800;
        const at = k * 0.07;
        return tone(at + 0.25, () => f, (t) => (t < at ? 0 : 0.35 * Math.exp(-(t - at) * 18)), sr);
      });
      return sum(...pings);
    }
  }
}

/** All events mixed into one mono track of `totalSec`. */
export function mixSfx(events: SfxEvent[], totalSec: number, sr = SFX_RATE): Float32Array {
  const out = new Float32Array(Math.ceil(totalSec * sr));
  const cache = new Map<SfxKind, Float32Array>();
  for (const e of events) {
    let clip = cache.get(e.kind);
    if (!clip) cache.set(e.kind, (clip = synthSfx(e.kind, sr)));
    const at = Math.round(e.t * sr);
    const g = e.gain * MASTER;
    for (let i = 0; i < clip.length && at + i < out.length; i++) out[at + i] += clip[i] * g;
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}

/** 16-bit PCM mono WAV. */
export async function writeWav(file: string, samples: Float32Array, sr = SFX_RATE): Promise<void> {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(samples[i] * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  await writeFile(file, Buffer.concat([h, data]));
}
