import { describe, expect, it } from "vitest";
import { comicBulletin, detectTopic, footageFor, isSerious, type ComicOptions } from "../server/news-bulletin";
import { sceneCues } from "../shared/timeline";
import { jsonPromptToDraft, parseJsonPrompt } from "../server/planner/json-prompt";
import { normalizeDraft } from "../shared/draft";
import { Scene, type VideoSettings } from "../shared/schema";
import { newsHeadlines } from "../shared/render/news";
import type { NewsItem } from "../shared/news-brief";

const light: NewsItem = { title: "Kayıp kedi belediye otobüsüyle şehir turu attı", summary: "Bir kedi otobüse binip şehri dolaştı. Şoför onu son durakta sahibine teslim etti.", link: "https://ex.org/1", source: "Ajans" };
const child: NewsItem = { title: "Çocuklar okulda dev pasta yaptı", summary: "Öğrenciler sınıfta birlikte dev bir pasta hazırlayıp kutladı.", link: "https://ex.org/2", source: "Gazete" };
const grave: NewsItem = { title: "Trafik kazasında 2 kişi yaralandı", summary: "Kavşakta meydana gelen kazada 2 kişi yaralandı.", link: "https://ex.org/3", source: "Ajans" };
const o: ComicOptions = { title: "Komik Haberler", anchor: "Deniz", presenter: "erkek", aspect: "16:9", language: "tr", mode: "comic" };
const settings: VideoSettings = { durationSec: 60, aspect: "16:9", style: "news", language: "tr", voiceover: true, subtitles: true };

function storyboard(brief: object) {
  const jp = parseJsonPrompt(JSON.stringify(brief))!;
  const s = { ...settings, ...jp.settings };
  return normalizeDraft(jsonPromptToDraft(jp, s), s);
}

describe("comic news bulletin", () => {
  it("never plays serious news for laughs", () => {
    expect(isSerious(grave)).toBe(true);
    expect(isSerious(light)).toBe(false);
  });

  it("casts generic roles from the story, not real names", () => {
    const f = footageFor(child);
    expect(f.setting).toBe("classroom");
    expect(f.actors.map((a) => a.role)).toContain("Çocuk");
    expect(f.actors[0].actions).toContain("cheer");
  });

  it("builds anchor → re-enactment → reaction for light items and a plain read for serious ones", async () => {
    const { brief, notes } = await comicBulletin([light, grave], o);
    expect(notes.join()).toMatch(/1 haber trajik/);
    const n = storyboard(brief);
    for (const s of n.scenes) expect(() => Scene.parse(s)).not.toThrow();
    const where = n.scenes.map((s) => s.setting);
    // intro, anchor, footage, reaction, serious anchor, outro
    expect(where).toEqual(["news-studio", "news-studio", "city", "news-studio", "news-studio", "news-studio"]);
    expect(n.scenes[1].narration).toMatch(/İşte o görüntüler!$/);
    expect(n.scenes[2].narration).toBe("Bir kedi otobüse binip şehri dolaştı. Şoför onu son durakta sahibine teslim etti.");
    expect(n.scenes[4].narration).not.toMatch(/görüntüler/);
    // The presenter is never in the re-enactment; the extras never in the studio.
    const anchorId = n.characters.find((c) => c.name === "Deniz")!.id;
    expect(n.scenes[2].actors.every((a) => a.characterId !== anchorId)).toBe(true);
    expect(n.scenes[1].actors.map((a) => a.characterId)).toEqual([anchorId]);
    expect(n.characters.length).toBeLessThanOrEqual(6);
    const project = { ...n, id: "x", story: "", settings, planner: "offline" as const, createdAt: "", updatedAt: "" };
    // Each story's headline appears once in the ticker although it spans several scenes.
    expect(newsHeadlines(project)).toEqual([light.title, grave.title, "Ajans"]);
  });

  it("uses the LLM's jokes when valid, keeps facts from the feed and falls back per story", async () => {
    const writer = async () => ({
      intro: "Hoş geldiniz, bugün haberler biraz tuhaf!",
      outro: "Ayrıntılar kaynaklarda, hoşça kalın.",
      stories: [
        { serious: false, anchor: "Bir kedi toplu taşımayı bizden iyi kullanıyor", reaction: "Biletini de almış mı?", footage: { setting: "city", camera: "pan-right", actors: [{ role: "Esnaf", actions: ["sit", "talk"], emotion: "happy", prop: "none" }, { role: "Recep Bey", actions: ["walk"] }] } },
        { serious: false, anchor: "Kaza haberi ama komik", footage: { actors: [{ role: "Vatandaş", actions: ["fall"] }] } },
      ],
    });
    const { brief, notes } = await comicBulletin([light, grave], o, writer);
    const n = storyboard(brief);
    expect(n.scenes[0].narration).toBe("Hoş geldiniz, bugün haberler biraz tuhaf!");
    expect(n.scenes[1].narration).toBe("Bir kedi toplu taşımayı bizden iyi kullanıyor. İşte o görüntüler!");
    expect(n.scenes[2].setting).toBe("city");
    // Invented real-person roles are dropped; only the known extras act.
    expect(n.scenes[2].actors.map((a) => n.characters.find((c) => c.id === a.characterId)!.name)).toEqual(["Esnaf"]);
    expect(n.scenes[3].narration).toBe("Biletini de almış mı?");
    // The keyword check overrules an LLM that wants to joke about an accident.
    expect(n.scenes[4].narration).toBe("Kavşakta meydana gelen kazada 2 kişi yaralandı.");
    expect(notes.join()).toMatch(/trajik/);
  });

  it("falls back to built-in lines when the LLM fails", async () => {
    const { notes, brief } = await comicBulletin([light], o, async () => {
      throw new Error("zaman aşımı");
    });
    expect(notes[0]).toMatch(/zaman aşımı/);
    expect(storyboard(brief).scenes).toHaveLength(5);
  });

  it("matches tragedies as whole words, not inside sports words", () => {
    const t = (title: string) => isSerious({ title, summary: "", link: "", source: "" });
    expect([t("Bursaspor kazandığı şampiyonlukla"), t("Bomba gibi gol"), t("Şampiyonluk savaşı kızıştı"), t("Davet edildi")]).toEqual([false, false, false, false]);
    expect([t("Trafik kazasında 2 yaralı"), t("Kazada 3 kişi öldü"), t("Füze saldırısı"), t("Dava açıldı")]).toEqual([true, true, true, true]);
  });
});

const goal: NewsItem = { title: "Göztepe sahasında 2-0 kazandı", summary: "Süper Lig'in 9. haftasında Göztepe rakibini 2-0 mağlup etti. Kaleci zor anlar yaşadı.", link: "https://ex.org/g", source: "AA" };

describe("football and interviews", () => {
  it("detects football news and casts footballers at the stadium", () => {
    expect(detectTopic([goal, light])).toBe("football");
    expect(detectTopic([light, child])).toBe("general");
    const f = footageFor(goal, "football");
    expect(f.setting).toBe("stadium");
    expect(f.actors.map((a) => a.role).sort()).toEqual(["Futbolcu", "Kaleci"]);
  });

  it("dresses the football cast and keeps ordinals inside one subtitle", async () => {
    const { brief } = await comicBulletin([goal], { ...o, topic: "auto" });
    const n = storyboard(brief);
    const byName = Object.fromEntries(n.characters.map((c) => [c.name, c]));
    expect(byName["Futbolcu"]).toMatchObject({ outfit: "jersey" });
    expect(n.scenes.some((s) => s.setting === "stadium")).toBe(true);
    const cues = sceneCues("Süper Lig'in 9. haftasında Göztepe kazandı.", 0, 4);
    expect(cues.some((c) => c.text.endsWith("9."))).toBe(false);
  });

  it("stages an interview: reporter with a microphone, each guest with their own voice", async () => {
    const { brief } = await comicBulletin([], { ...o, mode: "interview", subject: "Derbi sonrası taraftar ne diyor?" });
    const n = storyboard(brief);
    // Per-scene voices are applied from the brief when the project is created (server/app.ts).
    parseJsonPrompt(JSON.stringify(brief))!.scenes!.forEach((spec, i) => spec.voice && (n.scenes[i].voice = spec.voice));
    const reporter = n.characters.find((c) => c.name === "Muhabir")!;
    const talk = n.scenes.filter((s) => s.actors.some((a) => a.characterId === reporter.id));
    expect(talk.length).toBe(6);
    for (const s of talk) {
      expect(s.setting).toBe("stadium");
      expect(s.actors.find((a) => a.characterId === reporter.id)!.prop).toBe("microphone");
      expect(s.voice).toBeDefined();
    }
    expect(talk[0].voice).toBe("kadin"); // the reporter sounds different from the male presenter
    expect(n.scenes[1].narration).toMatch(/İşte o röportaj!$/);
  });

  it("keeps an LLM interview to the known roles and at most 6 characters", async () => {
    const roles = ["Taraftar", "Futbolcu", "Hakem", "Kaleci", "Teknik Direktör"];
    const writer = async () => ({
      stories: [{
        serious: false, anchor: "Tribünler konuşuyor", reaction: "Ne maçtı!", place: "stadium",
        interview: roles.flatMap((r) => [{ role: "Muhabir", text: "Ne düşünüyorsunuz?" }, { role: r, text: "Harika bir maçtı!" }]).concat([{ role: "Cristiano", text: "Uydurma söz" }]),
      }],
    });
    const { brief } = await comicBulletin([goal], { ...o, mode: "interview" }, writer);
    const n = storyboard(brief);
    expect(n.characters.length).toBeLessThanOrEqual(6);
    expect(n.characters.map((c) => c.name)).not.toContain("Cristiano");
    expect(n.scenes.flatMap((s) => s.narration)).not.toContain("Uydurma söz");
    for (const s of n.scenes) expect(s.actors.length).toBeGreaterThan(0);
  });
});
