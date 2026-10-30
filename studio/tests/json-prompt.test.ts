import { describe, expect, it } from "vitest";
import { applyJsonPrompt, jsonBrief, jsonPromptToDraft, parseJsonPrompt } from "../server/planner/json-prompt";
import { normalizeDraft, type DraftPlan } from "../shared/draft";
import { Scene, type VideoSettings } from "../shared/schema";

const settings: VideoSettings = { durationSec: 30, aspect: "16:9", style: "cozy", language: "tr", voiceover: false, subtitles: true };

const turkish = `\`\`\`json
{
  "baslik": "Samurayın Sözü",
  "stil": "sinematik",
  "format": "dikey",
  "süre": "45 saniye",
  "karakterler": [
    { "isim": "Hiro", "kıyafet": "kimono", "saç": "topknot" },
    { "isim": "Yuki", "açıklama": "kimonolu, topuz saçlı, uzun boylu genç kadın" }
  ],
  "sahneler": [
    { "anlatım": "Hiro gece evinde kılıcına bakıp düşünüyordu.", "mekan": "samuray evi", "zaman": "gece", "kamera": "yakın çekim",
      "karakterler": [{ "isim": "Hiro", "eylem": ["sit", "think"], "duygu": "üzgün", "nesne": "kılıç" }] },
    { "anlatım": "Sabah Yuki köy yolunda ona koşup bir mektup verdi.", "mekan": "köy",
      "karakterler": ["Yuki (koşar, mektup)", "Hiro (şaşkın)"], "süre": 6 }
  ]
}
\`\`\``;

describe("JSON prompt reader", () => {
  it("ignores prose and broken JSON", () => {
    expect(parseJsonPrompt("Ali parkta yürüdü.")).toBeNull();
    expect(parseJsonPrompt("{ bozuk json")).toBeNull();
  });

  it("reads Turkish keys, free-text values and video settings", () => {
    const jp = parseJsonPrompt(turkish)!;
    expect(jp.title).toBe("Samurayın Sözü");
    expect(jp.settings).toEqual({ style: "cinematic", aspect: "9:16", durationSec: 45 });
    expect(jp.characters[0]).toMatchObject({ name: "Hiro", outfit: "kimono", hair: "topknot" });
    expect(jp.characters[1]).toMatchObject({ name: "Yuki", outfit: "kimono", hair: "bun", tall: true });
    const [s1, s2] = jp.scenes!;
    expect(s1).toMatchObject({ setting: "japanese-room", time: "night", camera: "close" });
    expect(s1.actors![0]).toMatchObject({ name: "Hiro", actions: ["sit", "think"], emotion: "sad", prop: "sword" });
    expect(s2.setting).toBe("village");
    expect(s2.durationSec).toBe(6);
    expect(s2.actors![0]).toMatchObject({ name: "Yuki", actions: ["run"], prop: "book" });
    expect(s2.actors![1]).toMatchObject({ name: "Hiro", emotion: "surprised" });
    expect(jsonBrief(jp)).toContain("exactly 2 scenes");
  });

  it("reads the narrator voice and per-scene voices", () => {
    const jp = parseJsonPrompt(JSON.stringify({ ses: "erkek", sahneler: [{ anlatim: "Bir.", ses: "çocuk" }, { anlatim: "İki.", voice: "female" }, { anlatim: "Üç." }] }))!;
    expect(jp.settings.voice).toBe("erkek");
    expect(jp.scenes!.map((s) => s.voice)).toEqual(["cocuk", "kadin", undefined]);
    expect(jp.scenes![0].narration).toBe("Bir.");
  });

  it("reads English keys and a bare scene array", () => {
    const jp = parseJsonPrompt(JSON.stringify([
      { narration: "Ali walks into the office.", location: "office", shot: "wide" },
      { narration: "He finds a great idea.", camera: "zoom in" },
    ]))!;
    expect(jp.scenes).toHaveLength(2);
    expect(jp.scenes![1].camera).toBe("zoom-in");
  });

  it("builds a valid storyboard from the brief alone, honouring every explicit value", () => {
    const jp = parseJsonPrompt(turkish)!;
    const n = normalizeDraft(jsonPromptToDraft(jp, { ...settings, ...jp.settings }), { ...settings, ...jp.settings });
    expect(n.title).toBe("Samurayın Sözü");
    expect(n.scenes).toHaveLength(2);
    for (const s of n.scenes) expect(() => Scene.parse(s)).not.toThrow();
    expect(n.scenes[0].narration).toBe("Hiro gece evinde kılıcına bakıp düşünüyordu.");
    expect(n.scenes[0]).toMatchObject({ setting: "japanese-room", timeOfDay: "night", camera: "close" });
    expect(n.scenes[0].actors[0]).toMatchObject({ actions: ["sit", "think"], emotion: "sad", prop: "sword" });
    expect(n.scenes[1].actors.map((a) => a.characterId)).toEqual(["yuki", "hiro"]);
    expect(n.characters.find((c) => c.name === "Yuki")).toMatchObject({ outfit: "kimono", hair: "bun", scale: 1.08 });
  });

  it("overrides an LLM draft where the brief is explicit and keeps the rest", () => {
    const jp = parseJsonPrompt(turkish)!;
    const fallback = jsonPromptToDraft(jp, settings);
    const llm: DraftPlan = {
      title: "LLM başlığı",
      characters: [{ name: "Hiro", hat: "none", hair: "short", outfit: "casual", tall: false }],
      scenes: [
        { ...fallback.scenes[0], narration: "Başka bir anlatım.", setting: "park", camera: "wide", visualNote: "LLM notu" },
        { ...fallback.scenes[1], camera: "pan-left" },
        { ...fallback.scenes[1], title: "fazladan sahne" },
      ],
    };
    const out = applyJsonPrompt(llm, jp, fallback);
    expect(out.title).toBe("Samurayın Sözü");
    expect(out.scenes).toHaveLength(2);
    expect(out.scenes[0]).toMatchObject({ narration: "Hiro gece evinde kılıcına bakıp düşünüyordu.", setting: "japanese-room", camera: "close" });
    expect(out.scenes[1].camera).toBe("pan-left");
    expect(out.characters.find((c) => c.name === "Hiro")).toMatchObject({ outfit: "kimono", hair: "topknot" });
    expect(out.characters.map((c) => c.name)).toContain("Yuki");
  });
});
