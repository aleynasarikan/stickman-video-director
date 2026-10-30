import { describe, expect, it } from "vitest";
import { findNames, planOffline, splitSentences } from "../server/planner/offline";
import { normalizeDraft, type DraftPlan } from "../shared/draft";
import { MAX_SCENE_SEC, MIN_SCENE_SEC, Scene, type VideoSettings } from "../shared/schema";

const settings: VideoSettings = { durationSec: 30, aspect: "16:9", style: "cozy", language: "tr", voiceover: true, subtitles: true };
const story =
  "Ali sabah parkta yürüyordu. Birden Ayşe'yi gördü ve el salladı. Ayşe elinde bir kahve ile bankta oturuyordu. " +
  "İkisi uzun uzun konuştu. Gece olunca Ali evine koştu ve mutlu bir şekilde uyudu.";

describe("offline planner", () => {
  it("splits Turkish sentences", () => {
    expect(splitSentences(story)).toHaveLength(5);
  });

  it("finds character names, ignoring sentence-initial filler words", () => {
    expect(findNames(story)).toEqual(expect.arrayContaining(["Ali", "Ayşe"]));
    expect(findNames(story)).not.toContain("Birden");
    expect(findNames(story)).not.toContain("Gece");
  });

  it("produces scenes that validate against the project schema", () => {
    const n = normalizeDraft(planOffline(story, settings), settings);
    expect(n.scenes.length).toBeGreaterThan(1);
    for (const s of n.scenes) {
      expect(() => Scene.parse(s)).not.toThrow();
      expect(s.actors.length).toBeGreaterThan(0);
    }
  });

  it("maps keywords to settings, actions and time of day", () => {
    const n = normalizeDraft(planOffline(story, { ...settings, durationSec: 40 }), settings);
    expect(n.scenes[0].setting).toBe("park");
    expect(n.scenes[0].actors[0].actions).toContain("walk");
    const last = n.scenes[n.scenes.length - 1];
    expect(last.timeOfDay).toBe("night");
    expect(last.setting).toBe("room");
    expect(last.actors[0].actions).toEqual(expect.arrayContaining(["run", "sleep"]));
  });

  it("keeps characters on screen across scenes when they are not named again", () => {
    const n = normalizeDraft(planOffline(story, { ...settings, durationSec: 40 }), settings);
    const ali = n.characters.find((c) => c.name === "Ali")!;
    expect(n.scenes[1].actors.map((a) => a.characterId)).toContain(ali.id);
  });

  it("works for a story without names", () => {
    const n = normalizeDraft(planOffline("bir zamanlar küçük bir kedi vardı. her gün denize bakardı.", settings), settings);
    expect(n.characters).toHaveLength(1);
    expect(n.scenes.length).toBeGreaterThan(0);
  });
});

describe("normalizeDraft", () => {
  const draft: DraftPlan = {
    title: "Test",
    characters: [
      { name: "Zeynep", hat: "none", hair: "bob", outfit: "dress", tall: false },
      { name: "Zeynep", hat: "cap", hair: "short", outfit: "casual", tall: true },
    ],
    scenes: [
      {
        title: "a",
        narration: "kısa",
        visualNote: "",
        setting: "park",
        timeOfDay: "day",
        camera: "wide",
        transition: "cut",
        actors: [
          { character: "zeynep", actions: ["talk"], fromX: 0.1, toX: 0.9, facing: "right", emotion: "happy", prop: "none" },
          { character: "Bilinmeyen", actions: ["idle"], fromX: 0.5, toX: 0.5, facing: "left", emotion: "neutral", prop: "none" },
        ],
      },
      {
        title: "b",
        narration: Array(80).fill("kelime").join(" "),
        visualNote: "",
        setting: "office",
        timeOfDay: "day",
        camera: "close",
        transition: "fade",
        actors: [{ character: "Zeynep", actions: ["run"], fromX: 2, toX: 2, facing: "right", emotion: "neutral", prop: "none" }],
      },
    ],
  };

  it("gives duplicate names unique ids and drops unknown actors", () => {
    const n = normalizeDraft(draft, settings);
    expect(new Set(n.characters.map((c) => c.id)).size).toBe(2);
    expect(n.scenes[0].actors).toHaveLength(1);
  });

  it("only moves figures with a locomotion action", () => {
    const n = normalizeDraft(draft, settings);
    expect(n.scenes[0].actors[0].actions[0]).toBe("walk");
    const runner = n.scenes[1].actors[0];
    expect(runner.fromX).toBe(1);
    expect(Math.abs(runner.toX - runner.fromX)).toBeGreaterThan(0.05);
  });

  it("clamps scene durations to the renderer limits", () => {
    const n = normalizeDraft(draft, { ...settings, durationSec: 10 });
    for (const s of n.scenes) {
      expect(s.durationSec).toBeGreaterThanOrEqual(MIN_SCENE_SEC);
      expect(s.durationSec).toBeLessThanOrEqual(MAX_SCENE_SEC);
    }
    expect(n.scenes[1].durationSec).toBe(MAX_SCENE_SEC);
  });
});

describe("offline planner wardrobe", () => {
  it("dresses historical stories for their era and picks the matching set", () => {
    const edo = normalizeDraft(planOffline("Edo döneminde Hiro adında bir samuray evinde oturuyordu. Hiro çok üzgündü.", settings), settings);
    // A samurai lead wears hakama (kimono with wide trousers); the next character a plain kimono.
    expect(edo.characters[0]).toMatchObject({ outfit: "hakama", hair: "topknot" });
    expect(edo.scenes[0].setting).toBe("japanese-room");
    const egypt = normalizeDraft(planOffline("Antik Mısır'da Nefer kedisini aradı. Nefer firavunun tapınağına koştu.", settings), settings);
    expect(egypt.characters[0]).toMatchObject({ outfit: "tunic", hair: "bob", hat: "headband" });
    expect(egypt.scenes[0].setting).toBe("egypt-temple");
    expect(findNames("Antik Mısırda Nefer kedisini kaybetti. Nefer rahip Amun ile konuştu.")).toEqual(["Nefer", "Amun"]);
  });

  it("gives everyday characters different looks", () => {
    const n = normalizeDraft(planOffline(story, settings), settings);
    expect(n.characters[0].hair).not.toBe(n.characters[1].hair);
  });
});

describe("offline planner keywords", () => {
  const office = "Mert ofiste bilgisayarının başında düşünüyordu. Aklına harika bir fikir geldi! Hemen patronu Selin ile konuştu.";

  it("treats the story's first word as a likely protagonist", () => {
    expect(findNames(office)).toEqual(expect.arrayContaining(["Mert", "Selin"]));
    expect(findNames(office)).not.toContain("Aklına");
  });

  it("reads 'düşünüyordu' as thinking, not falling", () => {
    const n = normalizeDraft(planOffline(office, { ...settings, durationSec: 30 }), settings);
    expect(n.scenes[0].actors[0].actions).toContain("think");
    expect(n.scenes[0].actors[0].actions).not.toContain("fall");
    expect(n.scenes[0].setting).toBe("office");
  });
});
