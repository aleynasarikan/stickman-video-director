import {
  ACTIONS, ASPECTS, CAMERAS, EMOTIONS, HAIRS, HATS, OUTFITS, PROPS, SETTINGS, STYLES, TIMES_OF_DAY, TRANSITIONS,
  VOICES, type VoiceId, type ActionId, type CameraId, type EmotionId, type HairId, type OutfitId, type PropId, type SettingId, type StyleId,
} from "../../shared/schema";

// Turkish/English words → the renderer's fixed vocabularies. Shared by the offline planner,
// the grounding pass that checks every planner's output against its narration, and the
// JSON-prompt reader that turns free-text values ("samuray evi", "yakın çekim") into enums.

/** Lowercase (Turkish rules), apostrophes dropped so "Mısır'da" reads as "mısırda". */
export function fold(text: string): string {
  return text.toLocaleLowerCase("tr").replace(/['’`]/g, "");
}

// Turkish case/plural/possessive endings. A noun stem matches only when followed by up to
// three of these, so "kale" matches "kalede"/"kalesine" but not "kalem", and "ev" not "evet".
const SUFFIX =
  "(?:lar|ler|ları|leri|da|de|ta|te|dan|den|tan|ten|ya|ye|yı|yi|yu|yü|na|ne|nı|ni|nu|nü|nda|nde|ndan|nden|nın|nin|nun|nün|ın|in|un|ün|sı|si|su|sü|yla|yle|la|le|ki|ca|ce|a|e|ı|i|u|ü)";

/** Nouns: whole word plus Turkish endings. */
function n(stems: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${stems})${SUFFIX}?${SUFFIX}?${SUFFIX}?(?![\\p{L}\\p{N}])`, "u");
}

/** Verbs and adjectives: any word starting with one of the stems. */
function p(stems: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${stems})`, "u");
}

const both = (a: RegExp, b: RegExp) => ({ test: (s: string) => a.test(s) || b.test(s) }) as RegExp;

type Table<T> = [RegExp, T][];

export const ACTION_WORDS: Table<ActionId> = [
  // Order matters: "düşün" (think) must be checked before "düş" (fall).
  [p("düşün|merak et|karar ver|plan yap|tasarla|hayal et|tasarl|think|wonder|ponder|imagin"), "think"],
  [p("koş|kaçtı|kaçıyor|kaçar|kaçmak|kaçış|kaçarak|acele|hızla|run\\b|ran\\b|running|flee|fled|rush"), "run"],
  [p("zıpla|atla|hopla|sıçra|jump|leap|hop\\b"), "jump"],
  [p("dans|halay|dance|danc"), "dance"],
  [p("el salla|selamla|selam ver|veda et|hoşça kal|wave|waving|greet"), "wave"],
  [p("düştü|düşüyor|düşer\\b|düşerek|düşmüş|düşmek|yere düş|yuvarlan|tökezle|kaydı|fell\\b|fall|trip|stumbl|slip"), "fall"],
  [p("uyu|uyku|yattı|yatağa|horla|sleep|slept|nap\\b|asleep"), "sleep"],
  [p("otur|bekle|sit\\b|sits|sitting|sat\\b|wait"), "sit"],
  [p("ağla|gözyaş|hıçkır|cry|cried|crying|tears|sob"), "cry"],
  [p("sevin|kutla|alkış|zafer|kazandı|kazanmış|kazanınca|başardı|başarmış|başarıyla|yaşasın|cheer|celebrat|won\\b|win\\b|victory|hooray"), "cheer"],
  [p("uzaya yolla|uzaya gönder|auta at|auta gön|tribüne gön|tribünlere gön|ıska|boş kaleye vuramadı|blazed"), "miss"],
  [p("şut|gol at|golü at|topa vur|frikik|penaltı at|pas ver|vole|röveşata|kick|shoot|shot\\b|scored|scores"), "kick"],
  [p("kavga|dövüş|savaş|vurdu|vuruş|saldır|düello|çarpış|fight|attack|battl|duel|strike|struck"), "fight"],
  [p("itti|itiyor|ittir|iterek|itmek|taşıdı|taşıyor|taşımak|push|carr"), "push"],
  [p("göster|işaret|point|show"), "point"],
  [
    p("konuş|söyle|sordu|soruyor|sorar|sormak|dedi|diyor|der ki|anlattı|anlatıyor|cevap|yanıt|bağır|fısılda|seslen|çağır|tartış|sohbet|talk|said|say\\b|says|told|tell|ask|shout|whisper|argu|chat|speak|spoke|repl"),
    "talk",
  ],
  [
    p("yürü|gitti|gidiyor|gider|gitmek|giderek|yola çık|dolaş|gezdi|geziyor|gezinti|ilerle|yaklaş|uzaklaş|geldi|geliyor|girdi|giriyor|çıktı|döndü|walk|went\\b|goes\\b|go\\b|came\\b|comes|enter|stroll|approach|leav|left\\b|arriv|return"),
    "walk",
  ],
];

export const SETTING_WORDS: Table<SettingId> = [
  [n("uzay|yörünge|gezegen|nasa|astronot|galaksi|space|orbit|planet|galaxy|astronaut"), "space"],
  [n("stadyum|stad|saha|futbol|maç|derbi|gol|penaltı|ofsayt|tribün|taraftar|lig|süper lig|şampiyonlar ligi|futbolcu|teknik direktör|hakem|kaleci|stadium|football|soccer|match|goal|penalty|derby|league|pitch|referee|goalkeeper"), "stadium"],
  [n("haber stüdyosu|stüdyo|spiker|haber bülteni|bülten|newsroom|news studio|anchor desk|newscaster|news anchor"), "news-studio"],
  [n("japon kalesi|japon şatosu|şogun kalesi|şogunun kalesi|edo kalesi|osaka kalesi|himeji|tenshu|japanese castle"), "japanese-castle"],
  [n("dojo|dōjō|terakoya|kendo salonu|antrenman salonu|dövüş okulu|training hall"), "dojo"],
  [n("edo sokağı|edo sokak|japon sokağı|japon köyü|japon kasabası|edo kasabası|edo çarşısı|japanese street|japanese village|japanese town"), "japanese-street"],
  [n("mısır pazarı|mısır çarşısı|kahire pazarı|egyptian market|egyptian bazaar|souk"), "egypt-market"],
  [n("japon|japonya|samuray|edo|şogun|tatami|ninja|geyşa|japan|japanese|samurai|shogun|geisha"), "japanese-room"],
  [n("mısır|firavun|mumya|tapınak|tapınağ|sfenks|hiyeroglif|egypt|egyptian|pharaoh|mummy|temple|sphinx"), "egypt-temple"],
  [n("çöl|piramit|vaha|deve|desert|pyramid|oasis|camel|dune"), "desert"],
  [n("kale|şato|saray|şövalye|kral|kraliçe|prens|prenses|taht|castle|knight|king|queen|palace|prince|princess|throne"), "castle"],
  [n("köy|çiftlik|tarla|ahır|kasaba|village|farm|barn|field"), "village"],
  [n("park|bahçe|çimen|çimenlik|garden|lawn|playground"), "park"],
  [n("okul|sınıf|ders|öğretmen|öğrenci|school|class|classroom|teacher|student|lesson"), "classroom"],
  [n("ofis|işyeri|iş yeri|patron|toplantı|şirket|hastane|laboratuvar|office|boss|meeting|company|hospital|lab|laboratory"), "office"],
  [n("mutfak|mutfağ|yemek|kahvaltı|restoran|lokanta|kafe|kafeterya|kitchen|breakfast|dinner|restaurant|cafe|café"), "kitchen"],
  [n("oda|ev|yatak|salon|yatak odası|room|home|house|bedroom|living room"), "room"],
  [n("orman|ağaç|ağac|koru|forest|tree|woods|jungle"), "forest"],
  [n("deniz|plaj|sahil|kumsal|liman|gemi|tekne|iskele|ada|göl|nehir|beach|sea|ocean|harbor|harbour|port|ship|boat|island|lake|river|shore"), "beach"],
  [n("dağ|tepe|zirve|uçurum|yayla|mountain|hill|peak|cliff|summit"), "mountain"],
  [n("mağara|mağar|kamp ateşi|ateş başı|cave|campfire|cavern"), "cave"],
  [n("sahne|konser|gösteri|tiyatro|kürsü|stage|concert|theater|theatre|show|podium"), "stage"],
  [n("şehir|şehr|kent|bina|gökdelen|metropol|city|town|building|skyscraper|downtown"), "city"],
  [n("sokak|sokağ|cadde|yol|kaldırım|çarşı|pazar yeri|dükkan|mağaza|durak|street|road|sidewalk|market|bazaar|shop|store"), "street"],
];

export const EMOTION_WORDS: Table<EmotionId> = [
  [p("mutlu|sevin|gülümse|güldü|gülüyor|kahkaha|neşe|keyif|happy|smil|laugh|joy|glad|cheerful"), "happy"],
  [p("üzgün|üzül|ağla|hüzün|hüzünl|yalnız|keder|mutsuz|sad\\b|sadly|cry|lonely|unhappy|grief"), "sad"],
  [p("kızdı|kızgın|kızmış|kızar|öfke|sinirl|sinirlen|hiddet|angry|anger|furious|mad\\b|rage"), "angry"],
  [p("şaşır|şaşkın|hayret|inanama|birden|aniden|surpris|shock|suddenly|astonish"), "surprised"],
  [p("kork|ürk|endişe|panik|dehşet|scared|afraid|fear|terrif|panic|worr"), "scared"],
  [p("düşün|merak|tasarla|thinking|wonder|ponder|curious"), "thinking"],
];

export const PROP_WORDS: Table<PropId> = [
  [n("mikrofon|röportaj|muhabir|microphone|mic|interview|reporter"), "microphone"],
  [n("kupa|şampiyonluk|madalya|ödül|trophy|medal|award"), "trophy"],
  [n("sarı kart|kırmızı kart|kart|yellow card|red card|card"), "card"],
  [n("telefon|cep telefonu|mesaj|phone|smartphone|message"), "phone"],
  [both(n("kitap|kitab|defter|mektup|kağıt|harita|parşömen|gazete|book|letter|map|scroll|newspaper|notebook"), p("okudu|okuyor|okumak|read\\b|reading")), "book"],
  [n("kahve|çay|fincan|bardak|içecek|su|coffee|tea|cup|mug|drink|glass"), "cup"],
  [n("top|futbol|basketbol|ball|football|soccer|basketball"), "ball"],
  [n("çanta|bavul|valiz|heybe|sırt çantası|bag|suitcase|backpack|luggage"), "bag"],
  [n("çiçek|gül|buket|lale|flower|rose|bouquet|tulip"), "flower"],
  [n("bilgisayar|laptop|dizüstü|tablet|ekran|computer|screen"), "laptop"],
  [n("şemsiye|yağmur|umbrella|rain"), "umbrella"],
  [n("hediye|paket|armağan|kutu|para|altın|hazine|gift|present|package|box|money|gold|treasure"), "gift"],
  [n("kılıç|katana|hançer|bıçak|sword|katana|dagger|knife|blade"), "sword"],
  [n("mızrak|kargı|asa|sopa|spear|staff|stick|lance"), "spear"],
  [both(n("fikir|fikr|ampul|çözüm|idea|solution|bulb"), p("aklına gel|aklına bir|keşfett|discover|realiz|figured out")), "lightbulb"],
  [both(n("aşk|kalp|sevgi|sevgili|love|heart|darling"), p("aşık|sevdi|seviyor|sevmek|loves|loved|in love")), "heart"],
];

export const TIME_WORDS: Table<"night" | "sunset"> = [
  [p("gece|karanlık|yıldız|ay ışığ|gece yarısı|night|midnight|dark|stars|moonlight"), "night"],
  [p("akşam|gün batım|günbatım|alacakaranlık|şafak|gün doğum|sunset|evening|dusk|dawn|sunrise"), "sunset"],
];

// Era → wardrobe, so historical stories are dressed right without an LLM.
// Outfits and hairs are cycled per character (the first character gets the first of each).
export const ERA_WORDS: Table<{ outfit: OutfitId[]; hair: HairId[]; hat?: "headband" }> = [
  [n("japon|japonya|samuray|edo|şogun|ninja|geyşa|japan|japanese|samurai|shogun"), { outfit: ["hakama", "kimono"], hair: ["topknot", "bun"] }],
  [n("mısır|firavun|mumya|egypt|egyptian|pharaoh"), { outfit: ["tunic"], hair: ["bob", "short"], hat: "headband" }],
  [n("roma|romalı|sezar|yunan|antik|rome|roman|greek|ancient"), { outfit: ["toga"], hair: ["curly", "short"] }],
  [n("taş devri|mağara|ilkel|mağara adamı|stone age|caveman|prehistoric"), { outfit: ["pelt"], hair: ["spiky", "long"] }],
  [n("şövalye|asker|savaş|kale|ordu|knight|soldier|army|war"), { outfit: ["armor"], hair: ["short", "ponytail"] }],
  [n("ofis|patron|şirket|toplantı|office|boss|company|meeting"), { outfit: ["suit"], hair: ["short", "bob"] }],
  [n("doktor|hastane|bilim|bilim insanı|laboratuvar|doctor|hospital|scientist|lab"), { outfit: ["labcoat"], hair: ["short", "ponytail"] }],
];

const OUTFIT_WORDS: Table<OutfitId> = [
  [p("hakem|referee"), "referee"],
  [p("forma|futbolcu|jersey|football shirt|footballer|soccer player"), "jersey"],
  [p("hakama|samuray kıyafeti|samurai outfit"), "hakama"],
  [p("kimono|yukata"), "kimono"],
  [p("takım elbise|ceket|kravat|smokin|suit|blazer|tuxedo|business"), "suit"],
  [p("elbise|etek|gelinlik|dress|gown|skirt"), "dress"],
  [p("kapüşon|sweatshirt|hoodie|sweater|kazak"), "hoodie"],
  [p("önlük|lab coat|labcoat|doktor|bilim|doctor|scientist|nurse|hemşire"), "labcoat"],
  [p("tunik|keten|tunic|linen"), "tunic"],
  [p("toga|roma|yunan|roman|greek"), "toga"],
  [p("zırh|şövalye|asker|armor|armour|knight|soldier|üniforma|uniform"), "armor"],
  [p("post|kürk|deri|hayvan derisi|pelt|fur|hide|caveman|mağara"), "pelt"],
  [p("günlük|tişört|t-shirt|kot|jean|casual|gömlek|shirt"), "casual"],
];

const HAIR_WORDS: Table<HairId> = [
  [p("kel|saçsız|bald|shaved"), "none"],
  [p("samuray topuz|chonmage|topknot|top knot"), "topknot"],
  [p("at kuyruğu|atkuyruğu|ponytail|pony tail"), "ponytail"],
  [p("topuz|bun\\b|bun\\s"), "bun"],
  [p("kıvırcık|bukle|curly|afro|curls"), "curly"],
  [p("diken|spiky|punk|mohawk"), "spiky"],
  [p("küt|bob\\b"), "bob"],
  [p("uzun|long"), "long"],
  [p("kısa|short"), "short"],
];

const HAT_WORDS: Table<(typeof HATS)[number]> = [
  [p("bere|beanie|kukuleta"), "beanie"],
  [p("taç|crown|tiara"), "crown"],
  [p("fiyonk|kurdele|bow\\b"), "bow"],
  [p("silindir|top hat|tophat"), "tophat"],
  [p("bandana|alın bandı|kafa bandı|headband"), "headband"],
  [p("hasır|straw"), "straw"],
  [p("şapka|kasket|kep|cap\\b|hat\\b"), "cap"],
];

const CAMERA_WORDS: Table<CameraId> = [
  [p("punch|dramatik zoom|şok zoom|ani zoom|meme zoom|vine zoom|snap zoom"), "punch-in"],
  [p("zoom out|zoom-out|uzaklaş|geri çekil|pull back"), "zoom-out"],
  [p("zoom|yakınlaş|push in|dolly in"), "zoom-in"],
  [p("pan left|pan-left|sola kay|sola pan|sola doğru"), "pan-left"],
  [p("pan|sağa kay|sağa pan|takip|tracking|follow"), "pan-right"],
  [p("yakın|close|detay|detail|portrait"), "close"],
  [p("orta|medium|mid\\b|mid-shot|bel çekim"), "medium"],
  [p("geniş|genel|uzak|wide|establishing|long shot|total"), "wide"],
];

const TRANSITION_WORDS: Table<"cut" | "fade"> = [
  [p("fade|kararma|kararar|soluk|erime|dissolve|yumuşak"), "fade"],
  [p("cut|kesme|sert|hard"), "cut"],
];

const STYLE_WORDS: Table<StyleId> = [
  [p("news|haber|bülten|spiker|tv"), "news"],
  [p("prehistoric|tarih öncesi|taş devri|mağara"), "prehistoric"],
  [p("classic-dark|koyu|siyah|dark|karanlık"), "classic-dark"],
  [p("sketch|el çizimi|elle çizilmiş|karalama|kareli|defter|hand-drawn|hand drawn|doodle|whiteboard"), "sketch"],
  [p("classic|klasik|minimal|sade|beyaz|white|line"), "classic-light"],
  [p("modern|pop|renkli|colorful"), "modern-pop"],
  [p("cozy|sıcak|samimi|warm"), "cozy"],
  [p("cinematic|sinematik|sinema|film|cartoon|çizgi film|anime|detaylı|detailed"), "cinematic"],
];

export function first<T>(text: string, table: [RegExp, T][], fallback: T): T {
  const t = fold(text);
  for (const [re, v] of table) if (re.test(t)) return v;
  return fallback;
}

export function all<T>(text: string, table: [RegExp, T][]): T[] {
  const t = fold(text);
  return [...new Set(table.filter(([re]) => re.test(t)).map(([, v]) => v))];
}

/** Exact enum value (any case, spaces/underscores as dashes) or null. */
export function exact<T extends string>(list: readonly T[], v: unknown): T | null {
  if (typeof v !== "string") return null;
  const k = v.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return (list as readonly string[]).includes(k) ? (k as T) : null;
}

/** An enum value, or the first keyword match in free text, or null. */
function resolver<T extends string>(list: readonly T[], table: Table<T>) {
  return (v: unknown): T | null => {
    if (typeof v !== "string" || !v.trim()) return null;
    return exact(list, v) ?? first<T | null>(v, table, null);
  };
}

export const resolveSetting = resolver(SETTINGS, SETTING_WORDS);
export const resolveAction = resolver(ACTIONS, ACTION_WORDS);
export const resolveEmotion = resolver(EMOTIONS, EMOTION_WORDS);
export const resolveProp = resolver(PROPS, PROP_WORDS);
export const resolveOutfit = resolver(OUTFITS, OUTFIT_WORDS);
export const resolveHair = resolver(HAIRS, HAIR_WORDS);
export const resolveHat = resolver(HATS, HAT_WORDS);
export const resolveCamera = resolver(CAMERAS, CAMERA_WORDS);
export const resolveTransition = resolver(TRANSITIONS, TRANSITION_WORDS);
export const resolveStyle = resolver(STYLES, STYLE_WORDS);

const VOICE_WORDS: Table<VoiceId> = [
  [p("erkek \\(kalın\\)|kalın|derin|bas\\b|yaşlı adam|dede|deep|old man|bass"), "erkek-kalin"],
  [p("erkek|adam|bay\\b|male|man\\b|boy\\b"), "erkek"],
  [p("çocuk|kız çocu|oğlan|child|kid"), "cocuk"],
  [p("olgun|yaşlı kadın|nine|anne|mature|older woman|grandma"), "kadin-olgun"],
  [p("kadın|bayan|kız|female|woman|girl"), "kadin"],
];
export const resolveVoice = resolver(VOICES, VOICE_WORDS);

export function resolveTime(v: unknown): (typeof TIMES_OF_DAY)[number] | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const e = exact(TIMES_OF_DAY, v);
  if (e) return e;
  const t = first<"night" | "sunset" | null>(v, TIME_WORDS, null);
  if (t) return t;
  return p("gündüz|sabah|öğle|day|morning|noon|afternoon").test(fold(v)) ? "day" : null;
}

export function resolveAspect(v: unknown): (typeof ASPECTS)[number] | null {
  if (typeof v !== "string") return null;
  const e = exact(ASPECTS, v.replace(/\s/g, ""));
  if (e) return e;
  const t = fold(v);
  if (p("dikey|portrait|vertical|reels|shorts|tiktok|story").test(t)) return "9:16";
  if (p("yatay|landscape|horizontal|youtube|widescreen").test(t)) return "16:9";
  return null;
}

/** All distinct actions mentioned in a value: an enum list, one enum, or free text. */
export function resolveActions(v: unknown): ActionId[] {
  const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\s*(?:,|;|->|→|\bve\b|\bthen\b|\bsonra\b)\s*/) : [];
  const out: ActionId[] = [];
  for (const item of items) {
    const a = exact(ACTIONS, item) ?? (typeof item === "string" ? all(item, ACTION_WORDS)[0] : undefined);
    if (a && !out.includes(a)) out.push(a);
  }
  return out.slice(0, 3);
}
