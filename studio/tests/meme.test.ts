import { describe, expect, it } from "vitest";
import { comicBulletin, gagFor, type ComicOptions } from "../server/news-bulletin";
import { jsonPromptToDraft, parseJsonPrompt } from "../server/planner/json-prompt";
import { normalizeDraft } from "../shared/draft";
import { sfxEvents } from "../shared/sfx";
import { synthSfx } from "../server/sfx";
import { punchAt } from "../shared/timeline";
import { sequencePose } from "../shared/rig";
import { Scene, type VideoSettings } from "../shared/schema";
import type { NewsItem } from "../shared/news-brief";

// Made-up club and players: tests never attribute anything to real people.
const miss: NewsItem = { title: "Hayalspor golcüsü Topaç Ali boş kaleye vuramadı", summary: "Topaç Ali 89. dakikada boş kalede topu tribüne gönderdi.", link: "https://ex.org/1", source: "Örnek Spor" };
const win: NewsItem = { title: "Kurgu FK deplasmanda 3-0 kazandı", summary: "Kurgu FK, Uydurma Gücü'nü 3-0 yendi.", link: "https://ex.org/2", source: "Örnek Spor" };
const o: ComicOptions = { title: "Futbol Memeleri", anchor: "Deniz", presenter: "erkek", aspect: "16:9", language: "tr", mode: "meme" };
const settings: VideoSettings = { durationSec: 60, aspect: "16:9", style: "news", language: "tr", voiceover: true, subtitles: true };

function build(brief: object) {
  const jp = parseJsonPrompt(JSON.stringify(brief))!;
  const s = { ...settings, ...jp.settings };
  const n = normalizeDraft(jsonPromptToDraft(jp, s), s);
  return { jp, s, n };
}

describe("meme bulletin", () => {
  it("picks a gag from what happened", () => {
    expect(gagFor(miss)).toBe("skyball");
    expect(gagFor(win)).toBe("hype");
  });

  it("sends a missed shot into orbit, with captions, stings and a satire label", async () => {
    const { brief } = await comicBulletin([miss, win], o);
    const { s, n } = build(brief);
    expect(s.satire).toBe(true);
    for (const sc of n.scenes) expect(() => Scene.parse(sc)).not.toThrow();
    const kick = n.scenes.find((x) => x.setting === "stadium" && x.actors.some((a) => a.actions.includes("miss")))!;
    expect(kick.caption).toBeTruthy();
    expect(kick.stings).toEqual(["scratch"]);
    const orbit = n.scenes[n.scenes.indexOf(kick) + 1];
    expect(orbit).toMatchObject({ setting: "space", actors: [], caption: "TOP ŞU AN BURADA", stings: ["boom"] });
    expect(n.scenes[n.scenes.indexOf(orbit) + 1].camera).toBe("punch-in");
    const hype = n.scenes.find((x) => x.stings?.includes("airhorn") && x.setting === "stadium")!;
    expect(hype.actors.some((a) => a.actions.includes("cheer"))).toBe(true);
  });

  it("names only people the item itself names", async () => {
    const writer = async () => ({
      stories: [
        { serious: false, anchor: "Topaç Ali yine şutu uzaya yolladı! İşte o anlar!", gag: "skyball", caption: "NASA ARIYOR", voiceover: "Top hâlâ dönüyor.", star: "Topaç Ali", reaction: "Houston?" },
        { serious: false, anchor: "Kurgu FK coştu! İşte o anlar!", gag: "hype", caption: "İŞTE BU", star: "Uydurulmuş Yıldız", reaction: "Ayaktayız." },
      ],
    });
    const { brief } = await comicBulletin([miss, win], o, writer);
    const { n } = build(brief);
    const kickers = n.scenes.filter((x) => x.setting === "stadium").map((x) => x.title);
    expect(kickers).toEqual(["Topaç Ali", "Örnek Spor"]);
    expect(n.scenes.some((x) => x.caption === "NASA ARIYOR")).toBe(true);
  });
});

describe("meme effects", () => {
  it("lands a boom on the punch-in and plays requested stings", () => {
    const scene = Scene.parse({
      id: "s", title: "", narration: "", visualNote: "", durationSec: 6, setting: "stadium", timeOfDay: "day", camera: "punch-in", transition: "cut",
      approved: true, actors: [], stings: ["trombone", "airhorn"],
    });
    const ev = sfxEvents([scene]);
    expect(ev.find((e) => e.kind === "boom")!.t).toBeCloseTo(punchAt(scene), 3);
    expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(["trombone", "airhorn"]));
    for (const k of ["boom", "trombone", "airhorn", "scratch"] as const) expect(synthSfx(k).some((v) => Math.abs(v) > 0.1), k).toBe(true);
  });

  it("swings the leg for a miss exactly like a shot", () => {
    expect(sequencePose(["miss"], 0.6, 3).pose).toEqual(sequencePose(["kick"], 0.6, 3).pose);
  });

  it("reads meme fields from a hand-written JSON brief", () => {
    const jp = parseJsonPrompt(JSON.stringify({ mizah: true, sahneler: [{ anlatim: "Bir.", caps: "olmadı be", efekt: "hüzünlü trombon, vine boom", kamera: "dramatik zoom" }] }))!;
    expect(jp.settings.satire).toBe(true);
    expect(jp.scenes![0]).toMatchObject({ caption: "olmadı be", stings: ["trombone", "boom"], camera: "punch-in" });
  });
});
