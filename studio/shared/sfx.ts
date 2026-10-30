import type { Scene } from "./schema";
import { buildTimeline, punchAt } from "./timeline";

// When sound effects play, derived from the storyboard: the same action timing the rig uses
// (each actor's actions share the scene equally), so a thud lands when the figure hits the floor.

export const SFX_KINDS = ["pop", "whoosh", "boing", "thud", "ding", "hit", "sparkle", "kick", "crowd", "whistle", "boom", "trombone", "airhorn", "scratch"] as const;
export type SfxKind = (typeof SFX_KINDS)[number];

export interface SfxEvent {
  t: number;
  kind: SfxKind;
  /** 0..1 relative loudness. */
  gain: number;
}

const JUMP_CYCLE = 1.1; // rig: one jump every 1.1 s, feet leave the ground at 25 %
const PUNCH_EVERY = 1 / 3.6; // rig: fists alternate at 1.8 Hz each
const KICK_CYCLE = 1.4; // rig: one kick every 1.4 s, foot meets ball at 42 %

export function sfxEvents(scenes: Scene[]): SfxEvent[] {
  const out: SfxEvent[] = [];
  const add = (t: number, kind: SfxKind, gain: number, until: number) => {
    if (t < until) out.push({ t: Math.round(t * 1000) / 1000, kind, gain });
  };
  for (const span of buildTimeline(scenes).spans) {
    const { scene, start, end } = span;
    if (span.index > 0) add(start, "whoosh", 0.35, end);
    if (scene.headline?.trim()) add(start + 0.2, "pop", 0.7, end);
    // Meme stings ride on the caption's slam-in; a punch-in camera always lands with a boom.
    scene.stings?.forEach((k, i) => add(start + 0.3 + i * 0.9, k, 0.9, end));
    if (scene.camera === "punch-in") add(start + punchAt(scene), "boom", 1, end);
    // A stadium always has a crowd; it swells when someone scores or celebrates.
    if (scene.setting === "stadium") {
      const big = scene.actors.some((a) => a.actions.includes("kick") || a.actions.includes("miss") || a.actions.includes("cheer"));
      for (let k = 0; k * 3 < scene.durationSec; k++) add(start + k * 3, "crowd", big && k > 0 ? 0.8 : 0.45, end);
    }
    for (const actor of scene.actors) {
      const beat = scene.durationSec / actor.actions.length;
      actor.actions.forEach((action, j) => {
        const t0 = start + j * beat;
        const t1 = Math.min(end, t0 + beat);
        switch (action) {
          case "jump":
            for (let k = 0; k < 3; k++) add(t0 + k * JUMP_CYCLE + JUMP_CYCLE * 0.25, "boing", 0.6, t1);
            break;
          case "fall":
            add(t0 + 0.8, "thud", 0.9, t1);
            break;
          case "run":
            add(t0, "whoosh", 0.55, t1);
            break;
          case "fight":
            for (let k = 0; k < 4; k++) add(t0 + 0.14 + k * PUNCH_EVERY * 2, "hit", 0.55, t1);
            break;
          case "cheer":
            add(t0 + 0.1, "sparkle", 0.5, t1);
            break;
          case "kick":
          case "miss":
            for (let k = 0; k < 3; k++) add(t0 + k * KICK_CYCLE + KICK_CYCLE * 0.42, "kick", 0.8, t1);
            break;
        }
      });
      if (actor.prop === "lightbulb") add(start + 0.4, "ding", 0.6, end);
      if (actor.prop === "heart") add(start + 0.3, "pop", 0.5, end);
      if (actor.prop === "card") add(start + 0.3, "whistle", 0.7, end);
    }
  }
  // Two actors jumping together make one sound, not a flam.
  out.sort((a, b) => a.t - b.t);
  return out.filter((e, i) => !out.slice(0, i).some((x) => x.kind === e.kind && e.t - x.t < 0.12));
}
