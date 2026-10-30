import { describe, expect, it } from "vitest";
import { fetchNews, parseArticle, parseFeed, plainText, shortSource } from "../server/news";
import { bulletinBrief, shortHeadline, spokenSummary, type NewsItem } from "../shared/news-brief";
import { jsonPromptToDraft, parseJsonPrompt } from "../server/planner/json-prompt";
import { normalizeDraft } from "../shared/draft";
import { Scene, type VideoSettings } from "../shared/schema";

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>TRT Haber Manşet Haberleri</title><link>https://example.com</link>
<item><title><![CDATA[Kabine yoğun gündemle toplanacak]]></title>
<description><![CDATA[<p>Kabine bugün <b>Beştepe'de</b> toplanacak. Ekonomi öncelikli gündem.</p>]]></description>
<link>https://example.com/haber/1</link><pubDate>Mon, 26 Oct 2026 08:00:00 +0300</pubDate></item>
<item><title>Çiftçilere &amp; üreticilere destek</title><description>&lt;img src="x.jpg"/&gt;Destek paketi açıklandı.</description><link>/haber/2</link></item>
</channel></rss>`;

const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Örnek Ajans</title>
<entry><title>Atom başlığı</title><link rel="alternate" href="https://ex.org/a"/><summary>Kısa özet.</summary><updated>2026-10-26</updated></entry></feed>`;

describe("news reader", () => {
  it("reads RSS items: CDATA, escaped HTML, entities, relative links", () => {
    const f = parseFeed(rss, "https://example.com/rss")!;
    expect(f.source).toBe("TRT Haber");
    expect(f.items).toHaveLength(2);
    expect(f.items[0]).toMatchObject({ title: "Kabine yoğun gündemle toplanacak", summary: "Kabine bugün Beştepe'de toplanacak. Ekonomi öncelikli gündem.", link: "https://example.com/haber/1" });
    expect(f.items[1]).toMatchObject({ title: "Çiftçilere & üreticilere destek", summary: "Destek paketi açıklandı.", link: "https://example.com/haber/2" });
  });

  it("reads Atom entries and single article pages", () => {
    expect(parseFeed(atom, "https://ex.org/feed")!.items[0]).toMatchObject({ title: "Atom başlığı", summary: "Kısa özet.", link: "https://ex.org/a", source: "Örnek Ajans" });
    const page = `<html><head><meta property="og:title" content="Sayfa başlığı"><meta property="og:site_name" content="Anadolu Ajansı Güncel Haberler"><meta name="description" content="Sayfa &quot;özeti&quot;."></head></html>`;
    expect(parseArticle(page, "https://aa.com.tr/x")!.items[0]).toMatchObject({ title: "Sayfa başlığı", summary: 'Sayfa "özeti".', source: "Anadolu Ajansı" });
    expect(parseFeed("<html>yok</html>", "https://x.org")).toBeNull();
    expect(plainText("a&#39;b &#x131;")).toBe("a'b ı");
    expect(shortSource("Örnek Gazete - Son Dakika")).toBe("Örnek Gazete");
  });

  it("refuses local and non-http addresses before connecting", async () => {
    await expect(fetchNews("http://127.0.0.1:5174/api/status")).rejects.toThrow(/Yerel/);
    await expect(fetchNews("http://localhost/")).rejects.toThrow(/Yerel/);
    await expect(fetchNews("http://192.168.1.5/rss")).rejects.toThrow(/Yerel/);
    await expect(fetchNews("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(fetchNews("https://user:pw@example.com/")).rejects.toThrow(/parola/);
  });
});

describe("news bulletin", () => {
  const item = (title: string, summary: string): NewsItem => ({ title, summary, link: "https://ex.org", source: "Ajans" });
  const settings: VideoSettings = { durationSec: 30, aspect: "16:9", style: "cinematic", language: "tr", voiceover: true, subtitles: true };

  it("reads whole sentences up to a spoken length", () => {
    expect(spokenSummary(item("Başlık", "Bir cümle. İki cümle. " + "uzun ".repeat(40) + "son."))).toBe("Bir cümle. İki cümle.");
    expect(spokenSummary(item("Sadece başlık", ""))).toBe("Sadece başlık.");
    expect(spokenSummary(item("Başlık", "kelime ".repeat(60) + "."))).toBe("Başlık.");
    expect(shortHeadline("Bu çok uzun bir haber başlığı ve alt banda sığmaması gerekiyor kesinlikle")).toMatch(/^.{1,46}…$/);
  });

  it("becomes a news storyboard: presenter at the desk, one attributed scene per item", () => {
    const brief = bulletinBrief([item("Kabine toplanıyor", "Kabine bugün toplanacak."), item("Yağmur geliyor", "Hafta sonu yağış bekleniyor.")], {
      title: "Akşam Bülteni", anchor: "Deniz", presenter: "erkek", aspect: "16:9", language: "tr",
    });
    const jp = parseJsonPrompt(JSON.stringify(brief))!;
    expect(jp.settings).toMatchObject({ style: "news", voice: "erkek" });
    const s = { ...settings, ...jp.settings };
    const n = normalizeDraft(jsonPromptToDraft(jp, s), s);
    expect(n.scenes).toHaveLength(4);
    for (const sc of n.scenes) {
      expect(() => Scene.parse(sc)).not.toThrow();
      expect(sc.setting).toBe("news-studio");
      expect(sc.actors[0]).toMatchObject({ fromX: 0.5, toX: 0.5 });
    }
    expect(n.scenes[1]).toMatchObject({ title: "Ajans", headline: "Kabine toplanıyor", narration: "Kabine bugün toplanacak." });
    expect(n.characters[0]).toMatchObject({ name: "Deniz", outfit: "suit" });
  });
});
