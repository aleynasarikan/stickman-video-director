import { bulletinBrief, shortHeadline, spokenSummary, type BulletinOptions, type NewsItem } from "../shared/news-brief";
import type { ActionId, CameraId, EmotionId, MemeSfxId, PropId, SettingId, VoiceId } from "../shared/schema";
import { fixTurkishLines } from "./planner/turkish";
import { ACTION_WORDS, EMOTION_WORDS, PROP_WORDS, SETTING_WORDS, all, first, fold, resolveActions, resolveCamera, resolveEmotion, resolveProp, resolveSetting } from "./planner/lexicon";

// Funny bulletins built on the regular storyboard pipeline (they come out as a JSON brief).
//
// "comic": for every light news item the presenter gives a witty lead-in ending with "İşte o
// görüntüler!", the item is re-enacted by stick figures (labelled CANLANDIRMA on screen) while
// the publisher's summary is read as voice-over, and the presenter reacts.
// "interview": the presenter hands over to a reporter with a microphone who asks made-up
// passers-by (or fans, players, a referee...) about each item or a free topic; every speaker has
// their own voice.
//
// Two rules hold in every mode: tragedies (deaths, injuries, violence, disasters, criminal cases)
// are never played for laughs, and real people are never put on screen or given invented words:
// re-enactments and interviews use generic roles only.

export type Topic = "general" | "football";

export interface ComicOptions extends BulletinOptions {
  mode: "classic" | "comic" | "interview" | "meme";
  /** Cast and places; "auto" picks football when most items are about it. */
  topic?: Topic | "auto";
  /** Free interview subject, used when no items are chosen (interview mode). */
  subject?: string;
}

/** JSON writer from an LLM planner, for the jokes; without one, built-in lines are used. */
export type JsonWriter = (system: string, user: string, temperature?: number) => Promise<unknown>;

interface CastMember {
  kiyafet: string;
  sac: string;
  voice: VoiceId;
  /** Words that cast this role from a news item. */
  words?: RegExp;
}

/** Recurring extras per topic (a project holds at most 6 characters, the presenter included). */
const CASTS: Record<Topic, Record<string, CastMember>> = {
  general: {
    "Vatandaş": { kiyafet: "casual", sac: "short", voice: "erkek" },
    "Teyze": { kiyafet: "dress", sac: "bun", voice: "kadin-olgun", words: /kadın|anne|teyze|nine|kız|büyükanne|woman|mother|grandma|girl/u },
    "Yetkili": { kiyafet: "suit", sac: "none", voice: "erkek-kalin", words: /bakan|başkan|müdür|vali|kaymakam|belediye|yetkili|polis|jandarma|ekip|görevli|memur|doktor|uzman|bilim insan|minister|mayor|official|police|officer|doctor|expert/u },
    "Çocuk": { kiyafet: "hoodie", sac: "spiky", voice: "cocuk", words: /çocuk|öğrenci|bebek|minik|kid|child|student|baby/u },
    "Esnaf": { kiyafet: "casual", sac: "curly", voice: "erkek-kalin", words: /esnaf|satıcı|dükkan|pazarcı|çiftçi|üretici|şoför|balıkçı|fırıncı|aşçı|seller|farmer|driver|shop|baker|chef|fisher/u },
  },
  football: {
    "Futbolcu": { kiyafet: "jersey", sac: "short", voice: "erkek", words: /futbolcu|oyuncu|forvet|golcü|orta saha|defans|yıldız|transfer|kaptan|gol|player|striker|captain|scor/u },
    "Kaleci": { kiyafet: "jersey", sac: "spiky", voice: "erkek", words: /kaleci|kurtarış|penaltı|goalkeeper|keeper|save/u },
    "Teknik Direktör": { kiyafet: "suit", sac: "curly", voice: "erkek-kalin", words: /teknik direktör|hoca|antrenör|teknik adam|coach|manager/u },
    "Hakem": { kiyafet: "referee", sac: "none", voice: "erkek", words: /hakem|var\b|ofsayt|kart|faul|referee|offside|foul/u },
    "Taraftar": { kiyafet: "hoodie", sac: "curly", voice: "erkek", words: /taraftar|tribün|seyirci|fan\b|fans|supporter|stand/u },
  },
};

const REPORTER = "Muhabir";
const FOOTBALL = /futbol|maç|gol\b|goll|golcü|derbi|lig\b|ligi|süper lig|transfer|teknik direktör|kaleci|kale(de|ye|si)?\b|hakem|penaltı|stadyum|tribün|taraftar|deplasman|şampiyon|kulüp|forvet|(?<!\d)\d{1,2}-\d{1,2}(?!\d)|football|soccer|match|league|goal|derby|striker|coach|referee|stadium/u;

export function detectTopic(items: NewsItem[], subject = ""): Topic {
  const texts = [...items.map((i) => fold(`${i.title} ${i.summary}`)), ...(subject ? [fold(subject)] : [])];
  const n = texts.filter((t) => FOOTBALL.test(t)).length;
  return texts.length && n * 2 >= texts.length ? "football" : "general";
}

/** News that must not be played for laughs. Sports metaphors ("şampiyonluk savaşı") don't count. */
// Each term must start a word ("kaza" is an accident, "kazandı" a win); Turkish endings may follow.
const SERIOUS = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:" +
    [
      "öl(?:dü|üm|en|müş|dür)", "hayatını kaybet", "yaşamını yitir", "cenaze", "yaralan", "yaralı", "saldırı", "savaş", "çatışma", "deprem",
      "sel(?:\\s|$|de|e\\b)", "sel felaket", "kaza(?:da|sı|sında|ya|lar|ların|nın)?(?![\\p{L}])", "cinayet", "terör", "şehit", "katliam",
      "bombalı", "yangın", "intihar", "taciz", "istismar", "şiddet", "gözaltı", "tutuklan", "soruşturma", "rüşvet",
      "dava(?:sı|da|ya|lar|nın)?(?![\\p{L}])", "mahkeme", "kanser", "salgın", "can kaybı", "kayıp ver", "kaçırıl", "soykırım", "mülteci", "açlık",
      "died", "death", "killed", "kill(?:s|ing)?\\b", "injur", "attack", "war\\b", "earthquake", "flood", "crash", "murder", "terror", "bomb(?:ing|ed)?\\b",
      "fire\\b", "suicide", "abuse", "arrest", "trial", "court", "cancer", "famine", "genocide",
    ].join("|") +
    ")",
  "u",
);
const SPORTS_METAPHOR = /(şampiyonluk|liderlik|zirve|küme|ligde kalma|play-off|kupa|koltuk|forma|ilk 11|kadro|yer|gol) (savaşı|savaş)|saldırı (hattı|oyuncusu|futbolu)|attacking|attacker/gu;

export function isSerious(item: NewsItem): boolean {
  return SERIOUS.test(fold(`${item.title} ${item.summary}`).replace(SPORTS_METAPHOR, ""));
}

const OPENERS: Record<Topic, string[]> = {
  general: ["Sıradaki haberimiz gerçekten ilginç.", "Evet, yanlış duymadınız.", "Bu haberi okurken ben de gülümsedim.", "Gelelim günün en sıra dışı haberine.", "Şimdi sıkı durun.", "Bunu da gördük."],
  football: ["Yeşil sahalardan sıcak gelişme!", "Futbol, sürprizlerle dolu bir oyun.", "Tribünler bu haberi konuşuyor.", "Topun yuvarlak olduğunu bir kez daha gördük.", "Maç bitti ama olay bitmedi.", "Taraftarlar şimdiden yorum yarışında."],
};
const REACTIONS: Record<Topic, string[]> = {
  general: ["Hayırlı olsun!", "Neyse, biz devam edelim.", "Ben de tam bunu bekliyordum.", "İlginç bir gün daha.", "Gözlerimize inanamadık.", "Böyle haber her gün gelmiyor."],
  football: ["VAR'a gitmeye gerek yok, net!", "Top yuvarlak dostlar.", "Taraftar bunu unutmaz.", "Hoca ne der acaba?", "Tribünler ayakta!", "Bu da futbolun güzelliği."],
};
const QUESTIONS: Record<Topic, string[]> = {
  general: ["Bu haberi duyunca ne düşündünüz?", "Sizce bundan sonra ne olur?", "Son olarak eklemek istediğiniz bir şey var mı?"],
  football: ["Bu gelişmeyi nasıl yorumluyorsunuz?", "Sizce takım bundan sonra ne yapmalı?", "Taraftara bir mesajınız var mı?"],
};
const ANSWERS: Record<Topic, string[]> = {
  general: ["Valla ben duyunca çayımı döktüm.", "Biz bunu mahallede çoktan konuşuyorduk.", "Ne diyeyim, hayırlısı olsun!", "Ben de televizyona çıkacağımı hiç düşünmemiştim.", "Annem izliyorsa selamlar!", "Bence herkes biraz sakin olsun."],
  football: ["Ben stattaydım, hâlâ sesim kısık!", "Hakemi değil, kendimizi konuşalım.", "Seneye şampiyonuz, yazın bir kenara!", "Bu maçtan sonra üç gün uyuyamam.", "Formayı yıkamadım, uğur getiriyor.", "Hocam bir şans versin, ben de oynarım!"],
};

type Role = string;

interface Footage {
  setting: SettingId;
  camera: CameraId;
  actors: { role: Role; actions: ActionId[]; emotion: EmotionId; prop: PropId }[];
}

const PERIOD = (s: SettingId) => s === "news-studio" || s.startsWith("japanese") || s === "dojo" || s.startsWith("egypt");

/** Keyword re-enactment: the place, who is involved and what they do, read from the item. */
export function footageFor(item: NewsItem, topic: Topic = "general"): Footage {
  const text = `${item.title} ${item.summary}`;
  const t = fold(text);
  const cast = CASTS[topic];
  const names = Object.keys(cast);
  const place = all(text, SETTING_WORDS).find((s) => !PERIOD(s)) ?? (topic === "football" ? "stadium" : "street");
  const roles: Role[] = names.filter((r) => cast[r].words?.test(t));
  const fallbackRoles = topic === "football" ? ["Futbolcu", "Taraftar"] : ["Vatandaş", "Teyze"];
  for (const r of fallbackRoles) if (roles.length < 2 && !roles.includes(r)) roles.push(r);
  const acts = all(text, ACTION_WORDS).filter((a) => a !== "idle");
  const lead: ActionId[] = acts.length ? acts.slice(0, 2) : topic === "football" ? ["kick", "cheer"] : ["walk", "talk"];
  const emotion = first<EmotionId | null>(text, EMOTION_WORDS, null) ?? "surprised";
  const prop = all(text, PROP_WORDS).find((p) => p !== "microphone") ?? "none";
  const second: ActionId[] = roles[1] === "Hakem" ? ["point"] : roles[1] === "Kaleci" ? ["jump", "fall"] : roles[1] === "Taraftar" ? ["cheer"] : ["idle", "talk"];
  return {
    setting: place,
    camera: "wide",
    actors: [
      { role: roles[0], actions: lead, emotion: emotion === "neutral" ? "happy" : emotion, prop: roles[0] === "Hakem" ? "card" : prop },
      { role: roles[1], actions: second, emotion: "surprised", prop: roles[1] === "Hakem" ? "card" : "none" },
    ],
  };
}

interface Line {
  role: Role;
  text: string;
}

interface Story {
  serious: boolean;
  anchor: string;
  footage?: Footage;
  interview?: Line[];
  reaction?: string;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const cap = (s: string) => s.charAt(0).toLocaleUpperCase("tr") + s.slice(1);

function templateInterview(topic: Topic, i: number): Line[] {
  const people = topic === "football" ? ["Taraftar", "Futbolcu", "Taraftar"] : ["Vatandaş", "Teyze", "Esnaf"];
  return QUESTIONS[topic].flatMap((q, k) => [
    { role: REPORTER, text: q },
    { role: people[(i + k) % people.length], text: ANSWERS[topic][(i * 3 + k) % ANSWERS[topic].length] },
  ]);
}

function templateStory(item: NewsItem, i: number, o: Required<Pick<ComicOptions, "mode">> & { topic: Topic }): Story {
  if (isSerious(item)) return { serious: true, anchor: spokenSummary(item) };
  const head = shortHeadline(item.title).replace(/…$/, "");
  if (o.mode === "interview")
    return {
      serious: false,
      anchor: `${head}. Peki ${o.topic === "football" ? "taraftar" : "vatandaş"} ne diyor? Muhabirimiz sordu. İşte o röportaj!`,
      interview: templateInterview(o.topic, i),
      reaction: REACTIONS[o.topic][i % REACTIONS[o.topic].length],
    };
  return {
    serious: false,
    anchor: `${OPENERS[o.topic][i % OPENERS[o.topic].length]} ${head}. İşte o görüntüler!`,
    footage: footageFor(item, o.topic),
    reaction: REACTIONS[o.topic][i % REACTIONS[o.topic].length],
  };
}

const ACT_LIST = "idle, walk, run, jump, wave, talk, point, think, sit, sleep, dance, cheer, cry, fall, push, fight, kick, miss (a shot sent sky-high)";
const PROP_LIST = "none, phone, book, cup, ball, bag, flower, laptop, umbrella, gift, lightbulb, heart, trophy, card";
const SET_LIST = "stadium, park, street, city, room, office, classroom, kitchen, forest, beach, mountain, village, stage, blank";

function comicSystem(mode: "comic" | "interview", topic: Topic): string {
  const roles = Object.keys(CASTS[topic]).join(", ");
  const subject = topic === "football" ? "football news" : "news";
  const common = `You write a Turkish TV comedy bulletin of ${subject} for a cartoon presenter, staged with stick figures. Be genuinely funny: playful, absurd, punny, warm.
Rules:
- Facts come only from the given titles and summaries. Never invent facts, scores, numbers or events.
- Never quote or impersonate real people, and never put real names on the figures: every on-screen person is a generic role from: ${roles}${mode === "interview" ? `, plus the reporter "${REPORTER}"` : ""}. Real names may appear only where the facts mention them, in the presenter's own lines.
- Jokes never target victims, religions, ethnicities, disabilities or anyone's private life or appearance.
- Mark a story "serious": true if it involves death, injury, violence, war, terrorism, disaster, crime, arrests, court cases, illness or other suffering (sports metaphors like "şampiyonluk savaşı" are not serious). Serious stories get a plain, respectful "anchor" line in neutral words and nothing else.
- "intro": one cheerful Turkish sentence opening the bulletin; "outro": one Turkish sentence closing it, noting the details are at the sources.
- "reaction": the presenter's dry 2-8 word Turkish reaction after the segment.
${TURKISH_RULE}`;
  if (mode === "comic")
    return `${common}
- "anchor": 12-28 Turkish words, a witty lead-in stating what happened, ending exactly with "İşte o görüntüler!".
- "footage" re-enacts the story: 1-3 roles; setting one of: ${SET_LIST}; actions per role (1-3, in order): ${ACT_LIST}; emotion: neutral, happy, sad, angry, surprised, scared, thinking; prop: ${PROP_LIST} (card = referee's card, red when the referee is angry); camera: wide, medium, pan-left, pan-right, zoom-in.
Reply as JSON: {"intro": "...", "outro": "...", "stories": [{"serious": false, "anchor": "...", "reaction": "...", "footage": {"setting": "...", "camera": "...", "actors": [{"role": "...", "actions": ["..."], "emotion": "...", "prop": "..."}]}}]} with exactly one story per item, in order.`;
  return `${common}
- "anchor": 10-25 Turkish words introducing the topic and handing over to the reporter, ending exactly with "İşte o röportaj!".
- "interview": a street/stadium vox-pop of 4-8 lines alternating "${REPORTER}" questions and answers from made-up people (roles above; different people may answer different questions). Each line at most 18 Turkish words. Answers are funny opinions and reactions, never new facts. "place": stadium or street.
Reply as JSON: {"intro": "...", "outro": "...", "stories": [{"serious": false, "anchor": "...", "reaction": "...", "place": "...", "interview": [{"role": "${REPORTER}", "text": "..."}, {"role": "...", "text": "..."}]}]} with exactly one story per item, in order.`;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function roleOf(v: unknown, topic: Topic, withReporter: boolean): Role | null {
  const k = fold(str(v));
  if (withReporter && k === fold(REPORTER)) return REPORTER;
  return Object.keys(CASTS[topic]).find((r) => fold(r) === k) ?? null;
}

/** Validates one story from the LLM; anything unusable falls back to the template for that item. */
function readStory(raw: unknown, item: NewsItem, i: number, o: { mode: "comic" | "interview"; topic: Topic }): Story & { place?: SettingId } {
  const fallback = templateStory(item, i, o);
  if (!isObj(raw)) return fallback;
  // The keyword check can only make a story more serious, never less.
  if (raw.serious === true || fallback.serious) return { serious: true, anchor: spokenSummary(item) };
  const anchor = str(raw.anchor);
  if (!anchor || words(anchor) > 40) return fallback;
  const reaction = str(raw.reaction);
  const ending = o.mode === "interview" ? "İşte o röportaj!" : "İşte o görüntüler!";
  const story: Story & { place?: SettingId } = {
    serious: false,
    anchor: anchor.endsWith(ending) ? anchor : `${anchor.replace(/[.!]*$/, ".")} ${ending}`,
    reaction: reaction && words(reaction) <= 12 ? reaction : fallback.reaction,
  };
  if (o.mode === "interview") {
    const lines = (Array.isArray(raw.interview) ? raw.interview : []).filter(isObj).flatMap((l) => {
      const role = roleOf(l.role, o.topic, true);
      const text = str(l.text);
      return role && text && words(text) <= 30 ? [{ role, text }] : [];
    });
    story.interview = lines.length >= 2 ? lines.slice(0, 8) : fallback.interview;
    const place = resolveSetting(str(raw.place));
    story.place = place === "stadium" || place === "street" ? place : undefined;
    return story;
  }
  const f = isObj(raw.footage) ? raw.footage : {};
  const actors = (Array.isArray(f.actors) ? f.actors : []).filter(isObj).slice(0, 3).flatMap((a) => {
    const role = roleOf(a.role, o.topic, false);
    if (!role) return [];
    const actions = resolveActions(a.actions);
    return [{ role, actions: actions.length ? actions : (["talk"] as ActionId[]), emotion: resolveEmotion(str(a.emotion)) ?? "surprised", prop: resolveProp(str(a.prop)) ?? "none" }];
  });
  const setting = resolveSetting(str(f.setting));
  story.footage = actors.length
    ? { setting: setting && !PERIOD(setting) ? setting : fallback.footage!.setting, camera: resolveCamera(str(f.camera)) ?? "wide", actors: [...new Map(actors.map((a) => [a.role, a])).values()] }
    : fallback.footage!;
  return story;
}

const SLOTS = [0.25, 0.72, 0.5];

const TURKISH_RULE = `- Write proper Turkish orthography with every Turkish letter (ç, ğ, ı, İ, ö, ş, ü): "bakalım", "Yıldız", "başladı", never "bakalim", "Yildiz", "basladi". The text is read aloud by a Turkish TTS, so a missing letter is mispronounced.`;

/** Puts back Turkish letters the LLM dropped in spoken lines and captions (checked against the feed's own spelling). */
async function fixBriefSpelling(scenes: Record<string, unknown>[], items: NewsItem[], extra: string, writer?: JsonWriter) {
  const keys = ["anlatim", "caps"] as const;
  const refs: [Record<string, unknown>, string][] = [];
  for (const sc of scenes) for (const k of keys) if (typeof sc[k] === "string" && sc[k]) refs.push([sc, k]);
  const source = [...items.map((i) => `${i.title} ${i.summary}`), extra].join(" ");
  const fixed = await fixTurkishLines(refs.map(([sc, k]) => sc[k] as string), source, writer);
  refs.forEach(([sc, k], i) => (sc[k] = fixed[i]));
}

export async function comicBulletin(items: NewsItem[], o: ComicOptions, writer?: JsonWriter): Promise<{ brief: object; notes: string[] }> {
  if (o.mode === "classic") return { brief: bulletinBrief(items, o), notes: [] };
  if (o.mode === "meme") return memeBulletin(items, o, writer);
  const mode = o.mode;
  const subject = o.subject?.trim();
  // An interview can be about a free topic instead of news items.
  const topics: NewsItem[] = items.length ? items : subject ? [{ title: subject, summary: "", link: "", source: "Sokak röportajı" }] : [];
  if (!topics.length) throw new Error("Haber seçin ya da röportaj konusu yazın.");
  const topic: Topic = o.topic && o.topic !== "auto" ? o.topic : detectTopic(items, subject);
  const opts = { mode, topic };
  const notes: string[] = [];
  let stories: (Story & { place?: SettingId })[] = topics.map((it, i) => templateStory(it, i, opts));
  const tr = topic === "football" ? "futbol dünyasının" : "gündemin";
  let intro = `Merhaba, ${o.title} ile karşınızdayız. Bugün de ${tr} en ilginç haberleri bizde.`;
  let outro = "Bugünlük bu kadar. Haberlerin ayrıntıları kaynaklarında; gülümsemeyi unutmayın!";
  if (writer) {
    try {
      const facts = topics.map((it, i) => `${i + 1}. [${it.source}] ${it.title}\n${it.summary ? spokenSummary(it) : ""}`).join("\n\n");
      const raw = await writer(comicSystem(mode, topic), `Bulletin name: ${o.title}\nItems:\n\n${facts}`, 0.8);
      if (isObj(raw) && Array.isArray(raw.stories)) {
        stories = topics.map((it, i) => readStory((raw.stories as unknown[])[i], it, i, opts));
        if (str(raw.intro) && words(str(raw.intro)) <= 30) intro = str(raw.intro);
        if (str(raw.outro) && words(str(raw.outro)) <= 30) outro = str(raw.outro);
      } else notes.push("Yapay zekâ beklenen biçimde yanıt vermedi; hazır espri kalıpları kullanıldı.");
    } catch (e) {
      notes.push(`Yapay zekâ esprileri yazamadı (${(e as Error).message}); hazır kalıplar kullanıldı.`);
    }
  }
  const serious = stories.filter((s) => s.serious).length;
  if (serious) notes.push(`${serious} haber trajik ya da adli bir konu içerdiği için şakaya alınmadı; spiker düz okuyacak.`);

  const presenterVoice: VoiceId = o.presenter === "kadin" ? "kadin" : "erkek";
  const reporterVoice: VoiceId = o.presenter === "kadin" ? "erkek" : "kadin";
  const cast = CASTS[topic];
  const anchor = (actions: string[], emotion: string) => [{ isim: o.anchor, eylem: actions, duygu: emotion, konum: 0.5 }];
  const used = new Set<Role>();
  const scenes: Record<string, unknown>[] = [
    { baslik: "Gündem", ekranyazisi: o.title, anlatim: intro, mekan: "news-studio", kamera: "wide", karakterler: anchor(["talk", "wave"], "happy") },
  ];
  topics.forEach((item, i) => {
    const s = stories[i];
    const head = { baslik: item.source, ekranyazisi: shortHeadline(item.title), kaynak: item.link || undefined };
    scenes.push({ ...head, anlatim: s.anchor, mekan: "news-studio", kamera: s.serious ? "medium" : "zoom-in", karakterler: anchor(s.serious ? ["talk"] : ["talk", "point"], s.serious ? "neutral" : "happy") });
    if (s.footage) {
      scenes.push({
        ...head,
        anlatim: item.summary ? spokenSummary(item) : `${cap(item.title)}.`,
        gorsel: "Canlandırma",
        mekan: s.footage.setting,
        kamera: s.footage.camera,
        gecis: "fade",
        karakterler: s.footage.actors.map((a, k) => {
          used.add(a.role);
          const from = SLOTS[k];
          const moves = a.actions.some((x) => x === "walk" || x === "run" || x === "push");
          return { isim: a.role, eylem: a.actions, duygu: a.emotion, nesne: a.prop, konum: moves ? Math.max(0.1, from - 0.2) : from, hedef: from, yon: from > 0.5 ? "left" : "right" };
        }),
      });
    }
    if (s.interview) {
      used.add(REPORTER);
      const place = s.place ?? (topic === "football" ? "stadium" : "street");
      // Room for 4 interviewees (presenter + reporter + 4 = 6 characters): a fifth kind of
      // person is played by someone already cast.
      const castAs = (r: Role) => {
        const guests = [...used].filter((u) => u !== REPORTER);
        return guests.includes(r) || guests.length < 4 ? r : guests[0];
      };
      // The interviewee of a question stays on screen while the reporter asks the next one.
      let guest = castAs(s.interview.find((l) => l.role !== REPORTER)?.role ?? Object.keys(cast)[0]);
      s.interview.forEach((line, k) => {
        const reporterTalks = line.role === REPORTER;
        if (!reporterTalks) guest = castAs(line.role);
        else guest = castAs(s.interview!.slice(k + 1).find((l) => l.role !== REPORTER)?.role ?? guest);
        used.add(guest);
        scenes.push({
          baslik: reporterTalks ? REPORTER : guest,
          ekranyazisi: shortHeadline(item.title),
          anlatim: line.text,
          ses: reporterTalks ? reporterVoice : cast[guest]?.voice ?? "erkek",
          mekan: place,
          kamera: reporterTalks ? "medium" : k % 4 === 1 ? "close" : "medium",
          gecis: k === 0 ? "fade" : "cut",
          karakterler: [
            { isim: REPORTER, eylem: reporterTalks ? ["talk"] : ["idle"], duygu: "happy", nesne: "microphone", konum: 0.3, yon: "right" },
            { isim: guest, eylem: reporterTalks ? ["idle"] : k % 3 === 2 ? ["talk", "cheer"] : ["talk", "point"], duygu: reporterTalks ? "neutral" : k % 2 ? "happy" : "surprised", konum: 0.7, yon: "left" },
          ],
        });
      });
    }
    if (s.reaction) scenes.push({ ...head, anlatim: s.reaction, mekan: "news-studio", kamera: "close", gecis: "cut", karakterler: anchor(["talk"], i % 2 ? "surprised" : "happy") });
  });
  const sources = [...new Set(items.map((i) => i.source))].join(" · ").slice(0, 46);
  scenes.push({ baslik: sources ? "Kaynaklar" : "Kapanış", ekranyazisi: sources || o.title, anlatim: outro, mekan: "news-studio", kamera: "wide", karakterler: anchor(["talk", "wave"], "happy") });

  if (writer) await fixBriefSpelling(scenes, items, `${subject ?? ""} ${o.title}`, writer);

  // At most 6 characters: the presenter, the reporter if any, and the extras actually used.
  const presenter = o.presenter === "kadin" ? { isim: o.anchor, kiyafet: "suit", sac: "bob" } : { isim: o.anchor, kiyafet: "suit", sac: "short" };
  const extras = [...used].slice(0, 5).map((r) =>
    r === REPORTER ? { isim: REPORTER, kiyafet: "casual", sac: o.presenter === "kadin" ? "short" : "ponytail" } : { isim: r, kiyafet: cast[r].kiyafet, sac: cast[r].sac },
  );
  return {
    brief: {
      baslik: o.title,
      stil: "news",
      format: o.aspect,
      dil: o.language,
      ses: presenterVoice,
      sure: Math.min(300, Math.max(10, scenes.length * 6)),
      karakterler: [presenter, ...extras],
      sahneler: scenes,
    },
    notes,
  };
}

// ---------- meme bulletin ----------
//
// The news, told like a football meme page: "Son dakika! X yine şutu uzaya yolladı." Every
// light story gets one visual gag (the ball leaving for orbit, a snap zoom with a boom, sad
// trombone, airhorn hype, record-scratch chaos), an impact-font caption and a presenter
// comeback. Public figures may be named, but only if the item names them and only about what
// they did in public; jokes exaggerate into the obviously impossible ("uzaya", "NASA") rather
// than inventing plausible claims. The video is labelled MİZAH with a closing disclaimer.

export const GAGS = ["skyball", "punch", "sad", "hype", "chaos"] as const;
export type Gag = (typeof GAGS)[number];

const GAG_WORDS: [RegExp, Gag][] = [
  [/kaçırdı|kaçırdığı|harcadı|auta|üstünden|direğe|direkten|ıska|isabet bulmadı|tribüne|missed|over the bar|wide/u, "skyball"],
  [/yenildi|mağlup oldu|kaybetti|elendi|küme düş|puan kaybı|beraber|berabere|lost|defeat|eliminated|draw/u, "sad"],
  [/kazandı|galip|şampiyon|gol attı|hat-?trick|rekor|farklı|zafer|turladı|won|beat|record|champion/u, "hype"],
  [/kırmızı kart|kart gördü|var\b|penaltı|ofsayt|itiraz|gergin|kaos|red card|offside|chaos/u, "chaos"],
];

const MEME_LINES: Record<Gag, { caption: string[]; reaction: string[]; stings: MemeSfxId[] }> = {
  skyball: { caption: ["NASA DURUMDAN HABERDAR", "TOP HÂLÂ YÖRÜNGEDE", "HOUSTON, BİR TOPUMUZ VAR"], reaction: ["Top dönerse haber vereceğiz.", "Gökyüzü sınır değilmiş.", "Ay'dan selam var."], stings: ["scratch"] },
  punch: { caption: ["VE O AN...", "BEKLENMEDİK", "KİMSE BUNU BEKLEMİYORDU"], reaction: ["Ben de şoktayım.", "Bunu bir daha izleyelim mi?", "Tarih yazıldı mı, emin değilim."], stings: [] },
  sad: { caption: ["OLMADI BE", "BU DA BÖYLE BİR GÜN", "TRİBÜNLER SESSİZ"], reaction: ["Haftaya inşallah.", "Mendil dağıtıyoruz.", "Olsun, gönüller şampiyonu."], stings: ["trombone"] },
  hype: { caption: ["İŞTE BUUU!", "TRİBÜNLER YIKILDI", "EFSANE MOD AÇIK"], reaction: ["Ayakta alkışlıyoruz!", "Bu akşam kimse uyumaz.", "Tribünler hâlâ sallanıyor."], stings: ["airhorn"] },
  chaos: { caption: ["NE OLUYOR?!", "BİR DAKİKA...", "KONTROL KAYBOLDU"], reaction: ["Biz de hâlâ anlamaya çalışıyoruz.", "VAR bile şaşırdı.", "Sakin olalım dostlar."], stings: ["scratch"] },
};

interface MemeStory {
  serious: boolean;
  anchor: string;
  gag?: Gag;
  /** A public figure the item itself names, shown as the lower third's label on the gag scene. */
  star?: string;
  caption?: string;
  voiceover?: string;
  spaceLine?: string;
  reaction?: string;
  footage?: Footage;
}

export function gagFor(item: NewsItem): Gag {
  const t = fold(`${item.title} ${item.summary}`);
  return GAG_WORDS.find(([re]) => re.test(t))?.[1] ?? "punch";
}

function memeFootage(item: NewsItem, gag: Gag, topic: Topic): Footage {
  const base = footageFor(item, topic);
  const lead = base.actors[0];
  const other = base.actors[1];
  switch (gag) {
    case "skyball":
      return {
        setting: "stadium",
        camera: "wide",
        actors: [
          { role: topic === "football" ? "Futbolcu" : lead.role, actions: ["miss", "think"], emotion: "surprised", prop: "none" },
          { role: topic === "football" ? "Kaleci" : other.role, actions: ["idle", "cheer"], emotion: "happy", prop: "none" },
        ],
      };
    case "sad":
      return { ...base, camera: "zoom-in", actors: [{ ...lead, actions: ["cry"], emotion: "sad", prop: "none" }, { ...other, actions: ["sit"], emotion: "sad" }] };
    case "hype":
      return { ...base, camera: "pan-right", actors: [{ ...lead, actions: lead.actions.includes("kick") ? ["kick", "cheer"] : ["cheer", "dance"], emotion: "happy" }, { ...other, actions: ["jump", "cheer"], emotion: "happy" }] };
    case "chaos":
      return { ...base, camera: "punch-in", actors: [{ ...lead, actions: ["run", "fall"], emotion: "scared" }, { ...other, actions: ["point", "talk"], emotion: "angry" }] };
    default:
      return { ...base, camera: "punch-in", actors: [{ ...lead, emotion: "surprised" }, other] };
  }
}

function memeTemplate(item: NewsItem, i: number, topic: Topic): MemeStory {
  if (isSerious(item)) return { serious: true, anchor: spokenSummary(item) };
  const gag = gagFor(item);
  const lines = MEME_LINES[gag];
  return {
    serious: false,
    anchor: `Son dakika! ${shortHeadline(item.title).replace(/…$/, "")}. İşte o anlar!`,
    gag,
    caption: lines.caption[i % lines.caption.length],
    voiceover: item.summary ? spokenSummary(item) : `${cap(item.title)}.`,
    spaceLine: gag === "skyball" ? "Top şu an Dünya'nın yörüngesinde, gelişmeleri takip ediyoruz." : undefined,
    reaction: lines.reaction[i % lines.reaction.length],
    footage: memeFootage(item, gag, topic),
  };
}

function memeSystem(topic: Topic): string {
  const roles = Object.keys(CASTS[topic]).join(", ");
  return `You are the head writer of a Turkish ${topic === "football" ? "football " : ""}meme/comedy news show (think football meme pages and caps culture), voiced by a cartoon presenter and acted out by stick figures.
Tone: punchy, absurd, hyperbolic, internet-meme Turkish ("yine", "NASA", "uzaya yolladı", "tribünler yıkıldı"). Example of the voice: "Son dakika! Barış Alper Yılmaz yine şutu uzaya yolladı, NASA açıklama bekliyor."
Rules:
- Every story is built on its real facts (title + summary). Exaggerate them into the obviously impossible (space, orbit, NASA, the ball still flying) - never into a plausible false claim (no invented scores, transfers, fines, injuries, fights, quotes or statements).
- Public figures (players, coaches, clubs) may be named only if the item names them, and only about what they did on the pitch or in public. Never joke about private life, family, appearance, health, ethnicity, religion or politics. Never write quotes for real people.
- Mark a story "serious": true if it involves death, injury, violence, war, terrorism, disaster, crime, arrests, court cases, illness or other suffering (sports metaphors like "şampiyonluk savaşı" are not serious). Serious stories get only a plain, respectful "anchor" line.
- For each light story:
  "anchor": 8-22 Turkish words, a meme-style breaking-news line about what happened, ending with "İşte o anlar!".
  "gag": one of skyball (a shot or ball sent sky-high / missed badly -> the ball flies into space), punch (a shocking moment -> dramatic snap zoom with a boom), sad (a loss or letdown -> crying and sad trombone), hype (a win, goal or record -> celebration and airhorn), chaos (cards, VAR, penalties, confusion -> running, falling, record scratch).
  "caption": an all-caps meme caption, 2-6 Turkish words.
  "voiceover": 10-28 Turkish words read over the re-enactment: the real fact plus one absurd exaggeration.
  "spaceLine": only for skyball, 6-14 words said over the shot of the ball in orbit.
  "reaction": the presenter's dry 2-8 word comeback.
  "star": the main public figure's name exactly as written in the item, or "".
  "footage": {"setting": stadium|street|city|park|office|stage, "actors": [{"role": one of ${roles}, "actions": 1-3 of idle, walk, run, jump, wave, talk, point, think, sit, dance, cheer, cry, fall, push, fight, kick (a normal shot), miss (a shot that flies sky-high), "emotion": neutral|happy|sad|angry|surprised|scared|thinking, "prop": none|ball|trophy|card|phone|cup}]}
- "intro" and "outro": one meme-style Turkish sentence each; the outro reminds that it was all for laughs and the real news is at the sources.
${TURKISH_RULE}
Reply as JSON: {"intro": "...", "outro": "...", "stories": [{"serious": false, "anchor": "...", "gag": "...", "caption": "...", "voiceover": "...", "spaceLine": "...", "reaction": "...", "star": "...", "footage": {...}}]} with exactly one story per item, in order.`;
}

function readMeme(raw: unknown, item: NewsItem, i: number, topic: Topic): MemeStory {
  const fallback = memeTemplate(item, i, topic);
  if (!isObj(raw)) return fallback;
  if (raw.serious === true || fallback.serious) return { serious: true, anchor: spokenSummary(item) };
  const anchor = str(raw.anchor);
  if (!anchor || words(anchor) > 35) return fallback;
  const gag = (GAGS as readonly string[]).includes(str(raw.gag)) ? (str(raw.gag) as Gag) : fallback.gag!;
  const caption = str(raw.caption);
  const voiceover = str(raw.voiceover);
  const spaceLine = str(raw.spaceLine);
  const reaction = str(raw.reaction);
  // A named person must be named by the item itself: no invented people.
  const star = str(raw.star);
  const named = star && fold(`${item.title} ${item.summary}`).includes(fold(star)) ? star : undefined;
  let footage = memeFootage(item, gag, topic);
  const f = isObj(raw.footage) ? raw.footage : null;
  if (f && gag !== "skyball") {
    const actors = (Array.isArray(f.actors) ? f.actors : []).filter(isObj).slice(0, 3).flatMap((a) => {
      const role = roleOf(a.role, topic, false);
      if (!role) return [];
      const actions = resolveActions(a.actions);
      return [{ role, actions: actions.length ? actions : (["talk"] as ActionId[]), emotion: resolveEmotion(str(a.emotion)) ?? "surprised", prop: resolveProp(str(a.prop)) ?? "none" }];
    });
    const setting = resolveSetting(str(f.setting));
    if (actors.length) footage = { ...footage, setting: setting && !PERIOD(setting) && setting !== "space" ? setting : footage.setting, actors: [...new Map(actors.map((a) => [a.role, a])).values()] };
  }
  return {
    serious: false,
    anchor,
    gag,
    star: named,
    caption: caption && words(caption) <= 8 ? caption : fallback.caption,
    voiceover: voiceover && words(voiceover) <= 40 ? voiceover : fallback.voiceover,
    spaceLine: gag === "skyball" ? (spaceLine && words(spaceLine) <= 20 ? spaceLine : "Top şu an Dünya'nın yörüngesinde, gelişmeleri takip ediyoruz.") : undefined,
    reaction: reaction && words(reaction) <= 12 ? reaction : fallback.reaction,
    footage,
  };
}

async function memeBulletin(items: NewsItem[], o: ComicOptions, writer?: JsonWriter): Promise<{ brief: object; notes: string[] }> {
  if (!items.length) throw new Error("Haber seçin.");
  const topic: Topic = o.topic && o.topic !== "auto" ? o.topic : detectTopic(items);
  const notes: string[] = [];
  let stories = items.map((it, i) => memeTemplate(it, i, topic));
  let intro = `Merhaba! ${o.title} başlıyor; ${topic === "football" ? "yeşil sahaların" : "gündemin"} en efsane anları bizde.`;
  let outro = "Bugünlük bu kadar! Hepsi gülmek içindi; gerçek haberler kaynaklarında.";
  if (writer) {
    try {
      const facts = items.map((it, i) => `${i + 1}. [${it.source}] ${it.title}\n${it.summary ? spokenSummary(it) : ""}`).join("\n\n");
      const raw = await writer(memeSystem(topic), `Show name: ${o.title}\nItems:\n\n${facts}`, 0.8);
      if (isObj(raw) && Array.isArray(raw.stories)) {
        stories = items.map((it, i) => readMeme((raw.stories as unknown[])[i], it, i, topic));
        if (str(raw.intro) && words(str(raw.intro)) <= 30) intro = str(raw.intro);
        if (str(raw.outro) && words(str(raw.outro)) <= 30) outro = str(raw.outro);
      } else notes.push("Yapay zekâ beklenen biçimde yanıt vermedi; hazır meme kalıpları kullanıldı.");
    } catch (e) {
      notes.push(`Yapay zekâ esprileri yazamadı (${(e as Error).message}); hazır meme kalıpları kullanıldı.`);
    }
  }
  const serious = stories.filter((s) => s.serious).length;
  if (serious) notes.push(`${serious} haber trajik ya da adli bir konu içerdiği için şakaya alınmadı; spiker düz okuyacak.`);

  const anchor = (actions: string[], emotion: string) => [{ isim: o.anchor, eylem: actions, duygu: emotion, konum: 0.5 }];
  const used = new Set<Role>();
  const scenes: Record<string, unknown>[] = [
    { baslik: "Mizah", ekranyazisi: o.title, anlatim: intro, mekan: "news-studio", kamera: "wide", karakterler: anchor(["talk", "wave"], "happy"), efekt: ["airhorn"] },
  ];
  items.forEach((item, i) => {
    const s = stories[i];
    const head = { baslik: item.source, ekranyazisi: shortHeadline(item.title), kaynak: item.link || undefined };
    scenes.push({ ...head, anlatim: s.anchor, mekan: "news-studio", kamera: s.serious ? "medium" : "zoom-in", karakterler: anchor(s.serious ? ["talk"] : ["talk", "point"], s.serious ? "neutral" : "surprised") });
    if (s.serious || !s.footage || !s.gag) return;
    const kicker = s.star ? s.star : item.source;
    const lines = MEME_LINES[s.gag];
    scenes.push({
      ...head,
      baslik: kicker,
      anlatim: s.voiceover,
      caps: s.caption,
      efekt: lines.stings,
      gorsel: "Canlandırma",
      mekan: s.footage.setting,
      kamera: s.footage.camera,
      gecis: "cut",
      karakterler: s.footage.actors.map((a, k) => {
        used.add(a.role);
        const from = SLOTS[k];
        const moves = a.actions.some((x) => x === "walk" || x === "run" || x === "push");
        return { isim: a.role, eylem: a.actions, duygu: a.emotion, nesne: a.prop, konum: moves ? Math.max(0.1, from - 0.2) : from, hedef: from, yon: from > 0.5 ? "left" : "right" };
      }),
    });
    if (s.gag === "skyball")
      scenes.push({ ...head, baslik: "Uzay Ajansı", anlatim: s.spaceLine, caps: "TOP ŞU AN BURADA", efekt: ["boom"], mekan: "space", kamera: "zoom-out", gecis: "cut" });
    scenes.push({ ...head, anlatim: s.reaction, mekan: "news-studio", kamera: "punch-in", gecis: "cut", karakterler: anchor(["talk"], i % 2 ? "surprised" : "thinking") });
  });
  scenes.push({ baslik: "Mizah", ekranyazisi: [...new Set(items.map((i) => i.source))].join(" · ").slice(0, 46), anlatim: outro, mekan: "news-studio", kamera: "wide", karakterler: anchor(["talk", "wave"], "happy") });

  if (writer) await fixBriefSpelling(scenes, items, o.title, writer);
  const cast = CASTS[topic];
  const presenter = o.presenter === "kadin" ? { isim: o.anchor, kiyafet: "suit", sac: "bob" } : { isim: o.anchor, kiyafet: "suit", sac: "short" };
  return {
    brief: {
      baslik: o.title,
      stil: "news",
      mizah: true,
      format: o.aspect,
      dil: o.language,
      ses: o.presenter === "kadin" ? "kadin" : "erkek",
      sure: Math.min(300, Math.max(10, scenes.length * 6)),
      karakterler: [presenter, ...[...used].slice(0, 5).map((r) => ({ isim: r, kiyafet: cast[r].kiyafet, sac: cast[r].sac }))],
      sahneler: scenes,
    },
    notes,
  };
}
