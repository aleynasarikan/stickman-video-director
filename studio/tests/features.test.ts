import { describe, expect, it } from "vitest";
import { narrationWordTimes, sceneCues } from "../shared/timeline";
import { sfxEvents } from "../shared/sfx";
import { mixSfx, synthSfx } from "../server/sfx";
import { SFX_KINDS, type SfxKind } from "../shared/sfx";
import { eraOf, groundDraft, periodSettings } from "../server/planner/grounding";
import type { DraftPlan, DraftScene } from "../shared/draft";
import type { Scene } from "../shared/schema";

describe("karaoke subtitles", () => {
  it("uses the engine's word times when they match the narration", () => {
    const w = narrationWordTimes("Merhaba güzel dünya.", 2, [
      { text: "Merhaba", start: 0.1, end: 0.6 }, { text: "güzel", start: 0.7, end: 1 }, { text: "dünya", start: 1.1, end: 1.6 },
    ]);
    expect(w.map((x) => [x.text, x.start])).toEqual([["Merhaba", 0.1], ["güzel", 0.7], ["dünya.", 1.1]]);
  });

  it("fits estimated times into the spoken span when the engine normalised words (5 → beş)", () => {
    const w = narrationWordTimes("Saat 5 oldu.", 3, [{ text: "Saat", start: 0.2, end: 0.5 }, { text: "beş", start: 0.6, end: 0.9 }, { text: "oldu", start: 1, end: 1.4 }, { text: "x", start: 1.5, end: 2.2 }]);
    expect(w).toHaveLength(3);
    expect(w[0].start).toBeCloseTo(0.2);
    expect(w[2].start).toBeGreaterThan(w[1].start);
  });

  it("splits into short phrases with absolute word times and no gaps", () => {
    const cues = sceneCues("Bir varmış bir yokmuş, evvel zaman içinde kalbur saman içinde bir köy varmış.", 10, 6);
    expect(cues.length).toBeGreaterThan(1);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeCloseTo(cues[i - 1].end);
    for (const c of cues) {
      expect(c.text.length).toBeLessThanOrEqual(40);
      expect(c.words![0].start).toBeGreaterThanOrEqual(10);
    }
  });
});

const scene = (over: Partial<Scene>): Scene => ({
  id: "s", title: "", narration: "", visualNote: "", durationSec: 4, setting: "park", timeOfDay: "day", camera: "wide", transition: "cut", approved: true,
  actors: [{ characterId: "a", actions: ["idle"], fromX: 0.5, toX: 0.5, facing: "right", emotion: "neutral", prop: "none" }], ...over,
});

describe("sound effects", () => {
  it("lands on the rig's action timing", () => {
    const ev = sfxEvents([
      scene({ id: "1", actors: [{ characterId: "a", actions: ["walk", "fall"], fromX: 0.2, toX: 0.6, facing: "right", emotion: "neutral", prop: "lightbulb" }] }),
      scene({ id: "2", headline: "Sonunda!" }),
    ]);
    expect(ev).toContainEqual({ t: 2.8, kind: "thud", gain: 0.9 });
    expect(ev).toContainEqual({ t: 0.4, kind: "ding", gain: 0.6 });
    expect(ev).toContainEqual({ t: 4, kind: "whoosh", gain: 0.35 });
    expect(ev).toContainEqual({ t: 4.2, kind: "pop", gain: 0.7 });
  });

  it("synthesises every effect as audible, clipped-free audio", () => {
    for (const k of SFX_KINDS as readonly SfxKind[]) {
      const a = synthSfx(k);
      const peak = a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak, k).toBeGreaterThan(0.05);
    }
    const track = mixSfx([{ t: 0.5, kind: "thud", gain: 1 }], 2);
    expect(track.length).toBe(88200);
    expect(track.every((v) => v >= -1 && v <= 1)).toBe(true);
  });
});

describe("period sets", () => {
  const draft = (outfits: DraftPlan["characters"][number]["outfit"][], setting: DraftScene["setting"], narration = "Hiro yürüdü."): DraftPlan => ({
    title: "t",
    characters: outfits.map((outfit, i) => ({ name: ["Hiro", "Yuki"][i], hat: "none", hair: "short", outfit, tall: false })),
    scenes: [{ title: "", narration, visualNote: "", setting, timeOfDay: "day", camera: "wide", transition: "cut", actors: [{ character: "Hiro", actions: ["walk"], fromX: 0.2, toX: 0.6, facing: "right", emotion: "neutral", prop: "none" }] }],
  });

  it("reads the era from the cast's clothes", () => {
    expect(eraOf(["hakama", "kimono"])).toBe("japan");
    expect(eraOf(["tunic", "casual"])).toBe("egypt");
    expect(eraOf(["casual", "suit", "kimono"])).toBeNull();
  });

  it("puts an Edo village on a Japanese street, also when the narration names it", () => {
    expect(groundDraft(draft(["hakama", "kimono"], "village"), { aspect: "16:9" }).draft.scenes[0].setting).toBe("japanese-street");
    expect(groundDraft(draft(["hakama"], "park", "Hiro köye gitti."), { aspect: "16:9" }).draft.scenes[0].setting).toBe("japanese-street");
    expect(periodSettings(draft(["tunic"], "street")).scenes[0].setting).toBe("egypt-market");
    expect(groundDraft(draft(["casual"], "village"), { aspect: "16:9" }).draft.scenes[0].setting).toBe("village");
  });

  it("leaves a news bulletin's studio alone whatever the items say", () => {
    const d = draft(["suit"], "news-studio", "Bakan köye koşarak gitti.");
    expect(groundDraft(d, { aspect: "16:9", style: "news" }).draft.scenes[0]).toMatchObject({ setting: "news-studio", actors: [{ actions: ["walk"] }] });
  });
});
