import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { ACTIONS, CAMERAS, Character, HAIRS, HATS, OUTFITS, PROPS, SETTINGS, STYLES, type Project } from "../shared/schema";
import { actionPose, sequencePose } from "../shared/rig";
import { renderFrame } from "../shared/render/frame";
import type { Ctx } from "../shared/render/painter";
import { buildTimeline, sceneCues } from "../shared/timeline";

function project(overrides: Partial<Project["scenes"][number]> = {}, style: Project["settings"]["style"] = "cozy"): Project {
  return {
    id: "t", title: "t", story: "", planner: "offline", createdAt: "", updatedAt: "",
    settings: { durationSec: 10, aspect: "16:9", style, language: "tr", voiceover: false, subtitles: true },
    characters: [{ id: "a", name: "A", color: "#e63946", hat: "beanie", scale: 1, hair: "short", outfit: "casual" }],
    scenes: [{
      id: "s1", title: "", narration: "Merhaba dünya", visualNote: "", durationSec: 4, setting: "park", timeOfDay: "day",
      camera: "wide", transition: "fade", approved: true,
      actors: [{ characterId: "a", actions: ["walk", "wave"], fromX: 0.2, toX: 0.8, facing: "right", emotion: "happy", prop: "cup" }],
      ...overrides,
    }],
  };
}

describe("rig", () => {
  it("returns finite poses for every action over time", () => {
    for (const a of ACTIONS)
      for (let t = 0; t < 5; t += 0.37) {
        const p = actionPose(a, t);
        for (const v of [p.hipY, p.rot, p.lean, ...p.armBack, ...p.armFront, ...p.legBack, ...p.legFront]) expect(Number.isFinite(v)).toBe(true);
      }
  });

  it("travels only during locomotion beats", () => {
    expect(sequencePose(["idle", "walk"], 1, 4).travel).toBe(0);
    expect(sequencePose(["idle", "walk"], 3, 4).travel).toBeCloseTo(0.5);
    expect(sequencePose(["idle", "walk"], 4, 4).travel).toBe(1);
    expect(sequencePose(["talk"], 2, 4).travel).toBe(0);
  });
});

describe("timeline", () => {
  it("lays scenes back to back", () => {
    const p = project();
    p.scenes.push({ ...p.scenes[0], id: "s2", durationSec: 6 });
    const { spans, total } = buildTimeline(p.scenes);
    expect(total).toBe(10);
    expect(spans[1].start).toBe(4);
  });

  it("splits long narration into timed subtitle cues", () => {
    const cues = sceneCues("Bu çok uzun bir cümle ve altyazıda tek satıra sığmaması gerekiyor. İkinci cümle de burada.", 1, 6);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0].start).toBe(1);
    expect(cues[cues.length - 1].end).toBeCloseTo(7);
  });
});

describe("renderer", () => {
  const W = 320;
  const H = 180;

  function draw(p: Project, t: number) {
    const c = createCanvas(W, H);
    const ctx = c.getContext("2d") as unknown as Ctx;
    ctx.scale(W / 1280, H / 720);
    renderFrame(ctx, p, t, { width: 1280, height: 720, subtitles: true, cues: [{ start: 0, end: 10, text: "Altyazı çğüşıö" }] });
    return ctx.getImageData(0, 0, W, H).data;
  }

  it("draws every style and setting without throwing", () => {
    for (const style of STYLES)
      for (const setting of SETTINGS)
        for (const timeOfDay of ["day", "night"] as const) {
          const px = draw(project({ setting, timeOfDay }, style), 2);
          expect(px.length).toBe(W * H * 4);
        }
  });

  it("draws every action, prop and camera", () => {
    const props = PROPS;
    const cams = CAMERAS;
    ACTIONS.forEach((a, i) => {
      const p = project({ camera: cams[i % cams.length], actors: [{ characterId: "a", actions: [a], fromX: 0.5, toX: 0.5, facing: i % 2 ? "left" : "right", emotion: "surprised", prop: props[i % props.length] }] });
      draw(p, 1.5);
    });
  });

  it("actually puts a figure on screen (frame differs from an empty scene)", () => {
    const withFigure = draw(project({ setting: "blank" }, "classic-light"), 2);
    const empty = draw(project({ setting: "blank", actors: [] }, "classic-light"), 2);
    let diff = 0;
    for (let i = 0; i < withFigure.length; i += 4) if (withFigure[i] !== empty[i]) diff++;
    expect(diff).toBeGreaterThan(200);
  });

  it("draws every hair, outfit and hat in the cinematic style, in every pose", () => {
    OUTFITS.forEach((outfit, i) => {
      const p = project({ setting: "blank" }, "cinematic");
      p.characters[0] = { ...p.characters[0], outfit, hair: HAIRS[i % HAIRS.length], hat: HATS[i % HATS.length] };
      for (const a of ACTIONS) {
        p.scenes[0].actors[0].actions = [a];
        draw(p, 1.3);
      }
    });
    for (const setting of ["japanese-room", "park"] as const) {
      const p = project({ setting, actors: [{ characterId: "a", actions: ["sit"], fromX: 0.5, toX: 0.5, facing: "left", emotion: "sad", prop: "none" }] }, "cinematic");
      draw(p, 1);
    }
  });

  it("draws portrait cinematic frames", () => {
    const p = project({ setting: "egypt-temple" }, "cinematic");
    p.settings.aspect = "9:16";
    const c = createCanvas(90, 160);
    const ctx = c.getContext("2d") as unknown as Ctx;
    ctx.scale(90 / 720, 160 / 1280);
    renderFrame(ctx, p, 1, { width: 720, height: 1280 });
  });

  it("keeps projects saved before hair/outfit existed valid", () => {
    const old = Character.parse({ id: "a", name: "A", color: "#e63946", hat: "none", scale: 1 });
    expect(old.hair).toBe("short");
    expect(old.outfit).toBe("casual");
  });

  it("is deterministic", () => {
    const p = project();
    expect(Buffer.from(draw(p, 1.234)).equals(Buffer.from(draw(p, 1.234)))).toBe(true);
  });
});
