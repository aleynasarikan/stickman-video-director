import { describe, expect, it } from "vitest";
import { groundDraft, groundScene } from "../server/planner/grounding";
import { all, fold, resolveCamera, resolveHair, resolveOutfit, resolveProp, resolveSetting } from "../server/planner/lexicon";
import { ACTION_WORDS, SETTING_WORDS } from "../server/planner/lexicon";
import type { DraftPlan, DraftScene } from "../shared/draft";

const scene = (over: Partial<DraftScene>): DraftScene => ({
  title: "t", narration: "", visualNote: "", setting: "park", timeOfDay: "day", camera: "wide", transition: "cut",
  actors: [{ character: "Ali", actions: ["idle"], fromX: 0.5, toX: 0.5, facing: "right", emotion: "neutral", prop: "none" }],
  ...over,
});
const wide = { aspect: "16:9" as const };

describe("lexicon", () => {
  it("matches Turkish nouns with endings but not unrelated words that share letters", () => {
    expect(all("Hiro kalesine döndü", SETTING_WORDS)).toContain("castle");
    expect(all("Hiro kalemini aldı", SETTING_WORDS)).not.toContain("castle");
    expect(all("Evet, dedi", SETTING_WORDS)).not.toContain("room");
    expect(all("Ali evine koştu", SETTING_WORDS)).toContain("room");
    expect(all("Mısır'daki tapınağa vardı", SETTING_WORDS)).toEqual(expect.arrayContaining(["egypt-temple"]));
    expect(all("Kız arkadaşı geldi", ACTION_WORDS)).not.toContain("fight");
  });

  it("maps free-text values to the nearest enum", () => {
    expect(resolveSetting("samuray evi")).toBe("japanese-room");
    expect(resolveSetting("hastane koridoru")).toBe("office");
    expect(resolveSetting("Pan Right")).toBeNull();
    expect(resolveCamera("yakın çekim")).toBe("close");
    expect(resolveCamera("pan right")).toBe("pan-right");
    expect(resolveProp("mektup")).toBe("book");
    expect(resolveOutfit("takım elbise")).toBe("suit");
    expect(resolveOutfit("elbise")).toBe("dress");
    expect(resolveHair("at kuyruğu")).toBe("ponytail");
    expect(fold("İstanbul'da")).toBe("istanbulda");
  });
});

describe("grounding", () => {
  it("puts characters the narration mentions on screen", () => {
    const r = groundScene(scene({ narration: "Ali, Ayşe ile parkta konuştu." }), ["Ali", "Ayşe"], wide);
    expect(r.scene.actors.map((a) => a.character)).toEqual(["Ali", "Ayşe"]);
    expect(r.scene.actors[1].actions).toEqual(["talk"]);
    expect(r.scene.actors[0].facing).not.toBe(r.scene.actors[1].facing);
  });

  it("respects the portrait actor limit", () => {
    const r = groundScene(scene({ narration: "Ali, Ayşe ve Mert buluştu." }), ["Ali", "Ayşe", "Mert"], { aspect: "9:16" });
    expect(r.scene.actors).toHaveLength(2);
  });

  it("fixes setting, action, prop, emotion and time that ignore the narration", () => {
    const r = groundScene(
      scene({ narration: "Gece Ali korkuyla mağaraya koştu, elinde bir mızrak vardı.", setting: "office" }),
      ["Ali"],
      wide,
    );
    const s = r.scene;
    expect(s.setting).toBe("cave");
    expect(s.timeOfDay).toBe("night");
    expect(s.actors[0].actions).toContain("run");
    expect(s.actors[0].prop).toBe("spear");
    expect(s.actors[0].emotion).toBe("scared");
  });

  it("leaves choices that agree with the text alone", () => {
    const ok = scene({
      narration: "Ali ormanda yürüdü.",
      setting: "forest",
      actors: [{ character: "Ali", actions: ["walk", "wave"], fromX: 0.2, toX: 0.6, facing: "right", emotion: "happy", prop: "flower" }],
    });
    const r = groundScene(ok, ["Ali"], wide);
    expect(r.fixes).toEqual([]);
    expect(r.scene).toEqual(ok);
  });

  it("does not read a character's name as a keyword", () => {
    const r = groundScene(scene({ narration: "Deniz odasında kitap okudu.", setting: "room", actors: [] }), ["Deniz"], wide);
    expect(r.scene.setting).toBe("room");
    expect(r.scene.actors[0].character).toBe("Deniz");
    expect(r.scene.actors[0].prop).toBe("book");
  });

  it("keeps an unnamed subject on screen from the previous scene", () => {
    const plan: DraftPlan = {
      title: "x",
      characters: [{ name: "Hiro", hat: "none", hair: "topknot", outfit: "kimono", tall: false }],
      scenes: [scene({ narration: "Hiro bahçede oturdu.", actors: [{ character: "Hiro", actions: ["sit"], fromX: 0.4, toX: 0.4, facing: "right", emotion: "neutral", prop: "none" }] }),
        scene({ narration: "Sonra ağlamaya başladı.", actors: [] })],
    };
    const g = groundDraft(plan, wide);
    expect(g.draft.scenes[1].actors[0].character).toBe("Hiro");
    expect(g.draft.scenes[1].actors[0].actions).toContain("cry");
    expect(g.draft.scenes[1].actors[0].emotion).toBe("sad");
  });
});
