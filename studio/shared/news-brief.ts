import type { VideoSettings } from "./schema";

// Turns selected news items into a JSON brief for the regular storyboard pipeline: a presenter
// at the studio desk opens the bulletin, reads one short item per scene (the publisher's own
// summary, trimmed to a spoken length), and closes. Each scene's lower third shows the source
// and the headline, so every item stays attributed.

export interface NewsItem {
  title: string;
  /** The publisher's short description from the feed or page (never the full article). */
  summary: string;
  link: string;
  source: string;
  published?: string;
}

export interface BulletinOptions {
  title: string;
  anchor: string;
  /** Presenter look and narrator voice. */
  presenter: "kadin" | "erkek";
  aspect: VideoSettings["aspect"];
  language: VideoSettings["language"];
}

/** About 14 seconds of speech: the most one scene comfortably holds. */
const MAX_WORDS = 30;
/** A single long lead sentence is still read whole up to this length (the scene stretches to fit). */
const MAX_FIRST_SENTENCE = 42;
const HEADLINE_CHARS = 46;

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** Whole sentences of the summary up to the spoken limit; the headline when even one sentence is too long. */
export function spokenSummary(item: NewsItem): string {
  const title = item.title.trim();
  const sentences = item.summary.trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (words(next).length > MAX_WORDS) break;
    out = next;
  }
  if (!out && sentences[0] && words(sentences[0]).length <= MAX_FIRST_SENTENCE) out = sentences[0];
  if (!out) out = words(title).length <= MAX_WORDS ? title : `${words(title).slice(0, MAX_WORDS).join(" ")}…`;
  return /[.!?…]$/.test(out) ? out : `${out}.`;
}

/** Headline cut at a word boundary to fit the lower third. */
export function shortHeadline(title: string): string {
  const t = title.trim().replace(/\s+/g, " ");
  if (t.length <= HEADLINE_CHARS) return t;
  let out = "";
  for (const w of words(t)) {
    if ((out ? `${out} ${w}` : w).length > HEADLINE_CHARS - 1) break;
    out = out ? `${out} ${w}` : w;
  }
  return `${out || t.slice(0, HEADLINE_CHARS - 1)}…`;
}

export function bulletinBrief(items: NewsItem[], o: BulletinOptions) {
  const tr = o.language === "tr";
  const anchorActor = (actions: string[], emotion = "neutral") => [{ isim: o.anchor, eylem: actions, duygu: emotion, konum: 0.5 }];
  const studio = (s: object) => ({ mekan: "news-studio", ...s });
  const n = items.length;
  const scenes = [
    studio({
      baslik: tr ? "Gündem" : "Headlines",
      ekranyazisi: o.title,
      anlatim: tr ? `Merhaba, ${o.title} ile karşınızdayız. İşte öne çıkan ${n} haber.` : `Hello, this is ${o.title}. Here are today's top ${n} stories.`,
      kamera: "wide",
      karakterler: anchorActor(["talk"], "happy"),
    }),
    ...items.map((item, i) =>
      studio({
        baslik: item.source,
        ekranyazisi: shortHeadline(item.title),
        anlatim: spokenSummary(item),
        kamera: i % 2 ? "close" : "medium",
        gecis: "cut",
        karakterler: anchorActor(i % 3 === 2 ? ["talk", "point"] : ["talk"]),
        kaynak: item.link,
      }),
    ),
    studio({
      baslik: tr ? "Kaynaklar" : "Sources",
      ekranyazisi: [...new Set(items.map((i) => i.source))].join(" · ").slice(0, 46),
      anlatim: tr ? "Haberlerin ayrıntıları kaynaklarında. İyi günler dileriz." : "Full stories are at their sources. Have a good day.",
      kamera: "wide",
      karakterler: anchorActor(["talk", "wave"], "happy"),
    }),
  ];
  return {
    baslik: o.title,
    stil: "news",
    format: o.aspect,
    dil: o.language,
    ses: o.presenter,
    sure: Math.min(300, Math.max(10, scenes.length * 10)),
    karakterler: [
      o.presenter === "kadin"
        ? { isim: o.anchor, kiyafet: "suit", sac: "bob" }
        : { isim: o.anchor, kiyafet: "suit", sac: "short" },
    ],
    sahneler: scenes,
  };
}
