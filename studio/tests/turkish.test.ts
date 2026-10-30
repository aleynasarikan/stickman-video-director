import { describe, expect, it } from "vitest";
import { asciiFold, buildVocab, fixTurkishLines, restoreTurkish, strippedScore } from "../server/planner/turkish";

const source = "Sergen Yalçın A Milli Takım'ın 48. teknik direktörü oldu. Trabzonspor Beşiktaş'ı 2-0 yendi.";
const v = buildVocab(source);

describe("Turkish letter repair", () => {
  it("puts back letters an LLM dropped (the lines from a real bulletin)", () => {
    expect(restoreTurkish("Hocamiz masadan kalkti, kahvesi daha sicakken haberler uzaya yikildi, hadi bakalim neler basmis.", v)).toBe(
      "Hocamız masadan kalktı, kahvesi daha sıcakken haberler uzaya yıkıldı, hadi bakalım neler basmış.",
    );
    expect(restoreTurkish("Sergen Yalçin A Milli Takim'a geldi, Ay-Yildiz artik uydudan yonetiliyor, 4 yillik kontrat imzalandi.", v)).toBe(
      "Sergen Yalçın A Milli Takım'a geldi, Ay-Yıldız artık uydudan yönetiliyor, 4 yıllık kontrat imzalandı.",
    );
    expect(restoreTurkish("Takim'in yeni teknik direktoru, sozlesme, Besiktas'i, henuz, havasi baska, gercek, golu.", v)).toBe(
      "Takım'ın yeni teknik direktörü, sözleşme, Beşiktaş'ı, henüz, havası başka, gerçek, golü.",
    );
    expect(restoreTurkish("NASA'yi, Montella'nin, Galatasaray'in, Ali'nin; haftanin kapanis maçinda puanini, cikti.", v)).toBe(
      "NASA'yı, Montella'nın, Galatasaray'ın, Ali'nin; haftanın kapanış maçında puanını, çıktı.",
    );
    expect(restoreTurkish("NASA onayladi, yeni doneme hazirligimiz var.", v)).toBe("NASA onayladı, yeni döneme hazırlığımız var.");
  });

  it("leaves names, loanwords and look-alike words alone", () => {
    const line = "Ali gece Macaristan'a gitti, dakikalar geçti, kitap okudu, basketbol oynadı, rakip turnuva hizmet tarih kirli Atilla, kalite taksi katil.";
    expect(restoreTurkish(line, v)).toBe(line);
  });

  it("never turns one real word into another or undoes correct letters", () => {
    const line = "Hakemi belli oldu, on kişi geldi, ısı arttı, Gündem Bülteni, öne çıktı, Galatasaray mağlup oldu.";
    expect(restoreTurkish(line, v)).toBe(line);
  });

  it("measures how stripped a text still is", () => {
    expect(strippedScore(["Hocamiz masadan kalkti kahvesi daha sicakken haberler uzaya yikildi hadi bakalim neler basmis"])).toBeGreaterThan(0.5);
    expect(strippedScore(["Hocamız masadan kalktı, kahvesi daha sıcakken haberler uzaya yıkıldı, hadi bakalım neler basmış."])).toBe(0);
  });

  it("lets an LLM fix only the letters, never the words", async () => {
    const lines = ["Kadro cok genis ve oyuncular cok hizli kosuyor bu sezon", "Teknik ekip yarin aciklama yapacak dedi kulup yonetimi"];
    const writer = async () => ({
      lines: ["Kadro çok geniş ve oyuncular çok hızlı koşuyor bu sezon", "Teknik ekip bugün açıklama yapacak dedi kulüp yönetimi"],
    });
    const out = await fixTurkishLines(lines, "", writer);
    expect(out[0]).toBe("Kadro çok geniş ve oyuncular çok hızlı koşuyor bu sezon");
    // "yarin" → "bugün" is a different word: rejected, the local repair stays.
    expect(asciiFold(out[1])).toBe(asciiFold(lines[1]));
  });

  it("rejects an LLM fix that turns a real word into its twin (oldu → öldü)", async () => {
    const lines = ["Hakemi belli oldu ve tribunler cok mutlu bekliyor simdi gercekten"];
    const out = await fixTurkishLines(lines, "", async () => ({ lines: ["Hakemi belli öldü ve tribünler çok mutlu bekliyor şimdi gerçekten"] }));
    expect(out[0]).toContain("oldu");
  });
});
