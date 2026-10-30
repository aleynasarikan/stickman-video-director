import type { DraftPlan, DraftScene } from "../../shared/draft";
import {
  LANGUAGES, MAX_SCENE_SEC, MIN_SCENE_SEC, clamp,
  MEME_SFX, type MemeSfxId, type ActionId, type CameraId, type EmotionId, type VoiceId, type HairId, type OutfitId, type PropId, type SettingId, type VideoSettings,
} from "../../shared/schema";
import {
  ERA_WORDS, SETTING_WORDS, first, fold, resolveActions, resolveAspect, resolveCamera, resolveEmotion, resolveHair, resolveHat,
  resolveOutfit, resolveProp, resolveSetting, resolveStyle, resolveTime, resolveTransition, resolveVoice, exact,
} from "./lexicon";
import { findNames, planOffline, planScene } from "./offline";

// Lets users paste a structured JSON brief instead of prose. Keys may be English or Turkish
// ("scenes"/"sahneler", "setting"/"mekan", ...), values may be exact enum names or free text
// ("samuray evi", "yakın çekim"). Whatever the brief states explicitly wins over the planner.

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function key(k: string): string {
  return fold(k)
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[^a-z0-9]/g, "");
}

function get(o: Raw, aliases: string[]): unknown {
  const want = new Set(aliases);
  for (const [k, v] of Object.entries(o)) if (want.has(key(k)) && v != null && v !== "") return v;
  return undefined;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v.trim() || undefined : typeof v === "number" ? String(v) : Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(" ").trim() || undefined : undefined;

const K = {
  title: ["title", "baslik", "videotitle", "videobasligi", "isim", "ad", "name"],
  story: ["story", "hikaye", "hikaya", "prompt", "ozet", "synopsis", "summary", "plot", "konu", "metin", "text", "description", "aciklama", "senaryo", "script"],
  characters: ["characters", "karakterler", "cast", "oyuncular", "kisiler", "karakter", "character"],
  scenes: ["scenes", "sahneler", "shots", "storyboard", "bolumler", "timeline", "beats", "sahne", "scene", "planlar"],
  name: ["name", "isim", "ad", "adi", "character", "karakter", "who", "kim"],
  look: ["description", "aciklama", "gorunum", "look", "appearance", "tarif", "ozellik", "ozellikler", "details", "detay"],
  outfit: ["outfit", "kiyafet", "giysi", "costume", "clothing", "clothes", "kostum", "elbise"],
  hair: ["hair", "sac", "hairstyle", "sacstili", "sacmodeli"],
  hat: ["hat", "sapka", "headwear", "baslik2", "aksesuar"],
  tall: ["tall", "boy", "height", "uzunboylu"],
  narration: ["narration", "anlatim", "seslendirme", "voiceover", "dialogue", "diyalog", "replik", "konusma", "text", "metin", "script", "dis ses", "disses"],
  visual: ["visual", "gorsel", "visualnote", "description", "aciklama", "sahneaciklamasi", "gorunum", "imageprompt", "prompt", "action", "aksiyon", "ne olur", "neolur"],
  setting: ["setting", "mekan", "location", "yer", "place", "background", "arkaplan", "ortam", "environment", "set"],
  time: ["time", "zaman", "timeofday", "gunzamani", "lighting", "isik", "saat"],
  camera: ["camera", "kamera", "shot", "cekim", "aci", "angle", "shottype", "cekimtipi"],
  transition: ["transition", "gecis"],
  duration: ["duration", "sure", "seconds", "saniye", "length", "durationsec", "uzunluk"],
  actors: ["actors", "karakterler", "characters", "oyuncular", "cast", "kisiler", "who", "kimler"],
  actions: ["actions", "action", "eylem", "eylemler", "hareket", "hareketler", "yapar", "does", "doing", "ne yapar", "neyapar", "aksiyon"],
  emotion: ["emotion", "duygu", "mood", "his", "ifade", "expression", "feeling", "ruhhali"],
  prop: ["prop", "nesne", "esya", "obje", "item", "object", "holds", "holding", "elinde", "tutar", "tuttugu"],
  from: ["fromx", "from", "position", "konum", "pozisyon", "baslangic", "start", "x"],
  to: ["tox", "to", "hedef", "bitis", "end"],
  facing: ["facing", "yon", "bakis", "bakar", "direction"],
  style: ["style", "stil", "gorselstil", "artstyle", "tarz"],
  aspect: ["aspect", "aspectratio", "enboy", "enboyorani", "oran", "format", "ratio", "orientation"],
  totalDuration: ["duration", "sure", "length", "totalduration", "toplamsure", "videosuresi", "durationsec"],
  language: ["language", "dil", "lang"],
  era: ["era", "donem", "cag", "period", "devir"],
  caption: ["caption", "caps", "meme", "memeyazisi", "capsyazisi", "ustyazi", "punchline"],
  stings: ["stings", "efekt", "efektler", "memesesi", "memesesleri", "sesefekti", "sesefektleri", "sting"],
  satire: ["satire", "mizah", "parodi", "parody", "hiciv"],
  headline: ["headline", "ekranyazisi", "ekranmetni", "yazi", "baslikyazisi", "onscreentext", "overlay", "manset", "kartyazisi", "titlecard", "buyukyazi"],
  voice: ["voice", "ses", "sestipi", "anlaticisesi", "anlatici", "narrator", "narratorvoice", "seslendiren", "konusan", "speaker"],
};

export interface CharacterSpec {
  name: string;
  outfit?: OutfitId;
  hair?: HairId;
  hat?: DraftPlan["characters"][number]["hat"];
  tall?: boolean;
}

export interface ActorSpec {
  name: string;
  actions?: ActionId[];
  emotion?: EmotionId;
  prop?: PropId;
  fromX?: number;
  toX?: number;
  facing?: "left" | "right";
}

export interface SceneSpec {
  title?: string;
  narration?: string;
  visual?: string;
  setting?: SettingId;
  time?: DraftScene["timeOfDay"];
  camera?: CameraId;
  transition?: DraftScene["transition"];
  durationSec?: number;
  actors?: ActorSpec[];
  voice?: VoiceId;
  headline?: string;
  caption?: string;
  stings?: MemeSfxId[];
}

export interface JsonPrompt {
  title?: string;
  /** Plain-text version of the brief, for planners that read prose and for the keyword fallback. */
  story: string;
  characters: CharacterSpec[];
  scenes: SceneSpec[] | null;
  setting?: SettingId;
  settings: Partial<VideoSettings>;
  /** The brief as the user wrote it (pretty-printed), shown to LLM planners. */
  pretty: string;
}

/** Parses the story box as JSON (a ```json fence is fine). Returns null for ordinary prose. */
export function parseJsonPrompt(input: string): JsonPrompt | null {
  const text = input.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (!/^[[{]/.test(text)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(raw)) raw = { scenes: raw };
  if (!isObj(raw)) return null;
  // Allow one wrapper level such as {"video": {...}} or {"storyboard": {...}}.
  const inner = Object.values(raw).length === 1 && isObj(Object.values(raw)[0]) ? (Object.values(raw)[0] as Raw) : raw;
  const o = get(inner, K.scenes) || get(inner, K.story) || get(inner, K.characters) ? inner : raw;

  const characters = readCharacters(get(o, K.characters));
  const scenesRaw = get(o, K.scenes);
  const scenes = Array.isArray(scenesRaw)
    ? scenesRaw.map((s) => (isObj(s) ? readScene(s, characters) : { narration: str(s) })).filter((s) => s.narration || s.visual)
    : isObj(scenesRaw)
      ? Object.values(scenesRaw).filter(isObj).map((s) => readScene(s, characters))
      : null;
  // Actors named only inside scenes are characters too.
  for (const sc of scenes ?? [])
    for (const a of sc.actors ?? [])
      if (!characters.some((c) => fold(c.name) === fold(a.name)) && characters.length < 6) characters.push({ name: a.name });

  const settings: Partial<VideoSettings> = {};
  const style = resolveStyle(str(get(o, K.style)));
  if (style) settings.style = style;
  const aspect = resolveAspect(str(get(o, K.aspect)));
  if (aspect) settings.aspect = aspect;
  const total = seconds(get(o, K.totalDuration));
  if (total) settings.durationSec = Math.round(clamp(total, 10, 300));
  const lang = exact(LANGUAGES, str(get(o, K.language))?.slice(0, 2));
  if (lang) settings.language = lang;
  const voice = resolveVoice(str(get(o, K.voice)));
  if (voice) settings.voice = voice;
  const satire = get(o, K.satire);
  if (satire === true || satire === "evet" || satire === "true") settings.satire = true;

  const storyField = str(get(o, K.story));
  const era = str(get(o, K.era));
  const story = [
    era,
    storyField,
    ...(scenes ?? []).map((s) => [s.narration, s.visual].filter(Boolean).join(" ")),
  ].filter(Boolean).join("\n");
  if (!story && !characters.length) return null;

  return {
    title: str(get(o, K.title)),
    story: story || characters.map((c) => c.name).join(", "),
    characters,
    scenes: scenes?.length ? scenes : null,
    setting: resolveSetting(str(get(o, K.setting)) ?? era) ?? undefined,
    settings,
    pretty: JSON.stringify(raw, null, 2),
  };
}

function seconds(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return undefined;
  const m = v.match(/(\d+(?:[.,]\d+)?)\s*(dk|dakika|min|m\b)?/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  return m[2] ? n * 60 : n;
}

function position(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v > 1 ? clamp(v / 100, 0, 1) : clamp(v, 0, 1);
  if (typeof v !== "string") return undefined;
  const t = fold(v);
  if (/^\d/.test(t)) return position(Number(t.replace("%", "").replace(",", ".")));
  if (/sol|left/.test(t)) return /orta|center/.test(t) ? 0.35 : 0.2;
  if (/sağ|right/.test(t)) return /orta|center/.test(t) ? 0.65 : 0.8;
  if (/orta|merkez|center|middle/.test(t)) return 0.5;
  return undefined;
}

/** Hair from a free description: only words next to "saç"/"hair", so "uzun boylu" is not long hair. */
function hairFromLook(look: string): HairId | null {
  const t = fold(look);
  const unambiguous = resolveHair(t.match(/(?:samuray topuz\S*|topknot|at kuyruğu\S*|ponytail|topuz\S*|bun\b|kel\b|bald|kıvırcık|curly|afro|küt|bob\b)/u)?.[0]);
  if (unambiguous) return unambiguous;
  const near = t.match(/((?:\S+\s+){0,2})(?:saç\S*|hair)/u);
  return near ? resolveHair(near[1]) : null;
}

function readCharacters(v: unknown): CharacterSpec[] {
  const list = Array.isArray(v) ? v : isObj(v) ? Object.entries(v).map(([k, x]) => (isObj(x) ? { name: k, ...x } : { name: k, description: x })) : [];
  const out: CharacterSpec[] = [];
  for (const c of list) {
    if (typeof c === "string") {
      const [name, ...rest] = c.split(/\s*[:(,–-]\s*/);
      if (name) out.push(withLook({ name: name.trim() }, rest.join(" ")));
      continue;
    }
    if (!isObj(c)) continue;
    const name = str(get(c, K.name));
    if (!name) continue;
    const look = [str(get(c, K.look)), str(get(c, K.outfit)), str(get(c, K.hair)), str(get(c, K.hat))].filter(Boolean).join(" ");
    const spec = withLook({ name: name.slice(0, 40) }, look);
    const outfit = resolveOutfit(str(get(c, K.outfit)));
    const hair = resolveHair(str(get(c, K.hair)));
    const hat = resolveHat(str(get(c, K.hat)));
    if (outfit) spec.outfit = outfit;
    if (hair) spec.hair = hair;
    if (hat) spec.hat = hat;
    const tall = get(c, K.tall);
    if (typeof tall === "boolean") spec.tall = tall;
    else if (typeof tall === "string") spec.tall = /uzun|tall|iri|büyük|yes|evet/i.test(tall);
    out.push(spec);
  }
  return out.slice(0, 6);
}

function withLook(spec: CharacterSpec, look: string): CharacterSpec {
  if (!look.trim()) return spec;
  const outfit = resolveOutfit(look);
  const hair = hairFromLook(look);
  const hat = /şapka|bere|taç|kasket|bandana|alın bandı|hasır|silindir|fiyonk|kurdele|hat\b|cap\b|crown|beanie|headband|straw/iu.test(look) ? resolveHat(look) : null;
  if (outfit) spec.outfit = outfit;
  if (hair) spec.hair = hair;
  if (hat) spec.hat = hat;
  if (/uzun boy|tall|iri yarı|dev gibi/iu.test(look)) spec.tall = true;
  return spec;
}

function readActor(v: unknown, characters: CharacterSpec[]): ActorSpec | null {
  if (typeof v === "string") {
    // "Hiro (kızgın, kılıç tutuyor)" or just "Hiro".
    const t = v.trim();
    const known = characters.find((c) => fold(t).startsWith(fold(c.name)));
    const name = known?.name ?? t.split(/\s*[:(,–-]\s*/)[0].trim();
    if (!name) return null;
    const rest = t.slice(name.length);
    const actor: ActorSpec = { name };
    if (rest.trim()) {
      const actions = resolveActions(rest);
      if (actions.length) actor.actions = actions;
      actor.emotion = resolveEmotion(rest) ?? undefined;
      actor.prop = resolveProp(rest) ?? undefined;
    }
    return actor;
  }
  if (!isObj(v)) return null;
  const name = str(get(v, K.name));
  if (!name) return null;
  const actor: ActorSpec = { name: name.slice(0, 40) };
  const actions = resolveActions(get(v, K.actions));
  if (actions.length) actor.actions = actions;
  actor.emotion = resolveEmotion(str(get(v, K.emotion))) ?? undefined;
  actor.prop = resolveProp(str(get(v, K.prop))) ?? undefined;
  actor.fromX = position(get(v, K.from));
  actor.toX = position(get(v, K.to));
  const facing = str(get(v, K.facing));
  if (facing) actor.facing = /sol|left/i.test(facing) ? "left" : /sağ|right/i.test(facing) ? "right" : undefined;
  return actor;
}

const STING_WORDS: [RegExp, MemeSfxId][] = [
  [/boom|vine|bum\b|dum\b|dramatik/u, "boom"],
  [/trombon|wah|sad|üzgün|hüzün|vah/u, "trombone"],
  [/airhorn|korna|klakson|mlg|horn/u, "airhorn"],
  [/scratch|cızırt|plak|record/u, "scratch"],
];

function resolveStings(v: unknown): MemeSfxId[] | undefined {
  const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;+]/) : [];
  const out = new Set<MemeSfxId>();
  for (const it of items) {
    if (typeof it !== "string") continue;
    const k = fold(it.trim());
    const hit = (MEME_SFX as readonly string[]).includes(k) ? (k as MemeSfxId) : STING_WORDS.find(([re]) => re.test(k))?.[1];
    if (hit) out.add(hit);
  }
  return out.size ? [...out].slice(0, 3) : undefined;
}

function readScene(s: Raw, characters: CharacterSpec[]): SceneSpec {
  const actorsRaw = get(s, K.actors);
  const actors = (Array.isArray(actorsRaw) ? actorsRaw : actorsRaw != null ? [actorsRaw] : [])
    .map((a) => readActor(a, characters))
    .filter((a): a is ActorSpec => a !== null);
  const narration = str(get(s, K.narration));
  const visualRaw = str(get(s, K.visual));
  const visual = visualRaw && visualRaw !== narration ? visualRaw : undefined;
  const d = seconds(get(s, K.duration));
  return {
    title: str(get(s, K.title)),
    narration,
    visual,
    setting: resolveSetting(str(get(s, K.setting))) ?? undefined,
    time: resolveTime(str(get(s, K.time))) ?? undefined,
    camera: resolveCamera(str(get(s, K.camera))) ?? undefined,
    transition: resolveTransition(str(get(s, K.transition))) ?? undefined,
    durationSec: d ? clamp(d, MIN_SCENE_SEC, MAX_SCENE_SEC) : undefined,
    actors: actors.length ? actors.slice(0, 4) : undefined,
    voice: resolveVoice(str(get(s, K.voice))) ?? undefined,
    headline: str(get(s, K.headline))?.slice(0, 48),
    caption: str(get(s, K.caption))?.slice(0, 60),
    stings: resolveStings(get(s, K.stings)),
  };
}

/** Everything the brief says explicitly, written over a draft (from an LLM or the keyword planner). */
export function applyJsonPrompt(draft: DraftPlan, jp: JsonPrompt, fallback: DraftPlan): DraftPlan {
  const characters = draft.characters.map((c) => ({ ...c }));
  for (const spec of jp.characters) {
    let c = characters.find((x) => fold(x.name) === fold(spec.name));
    if (!c) {
      const known = fallback.characters.find((x) => fold(x.name) === fold(spec.name));
      c = known ? { ...known } : { name: spec.name, hat: "none", hair: "short", outfit: "casual", tall: false };
      if (characters.length < 6) characters.push(c);
    }
    Object.assign(c, {
      ...(spec.outfit && { outfit: spec.outfit }),
      ...(spec.hair && { hair: spec.hair }),
      ...(spec.hat && { hat: spec.hat }),
      ...(spec.tall !== undefined && { tall: spec.tall }),
    });
  }

  let scenes = draft.scenes;
  if (jp.scenes) {
    scenes = jp.scenes.map((spec, i) => {
      const base = structuredClone(draft.scenes[i] ?? fallback.scenes[i]);
      if (spec.title) base.title = spec.title;
      if (spec.headline) base.headline = spec.headline;
      if (spec.caption) base.caption = spec.caption;
      if (spec.stings) base.stings = spec.stings;
      if (spec.narration) base.narration = spec.narration;
      else if (!base.narration && spec.visual) base.narration = spec.visual;
      if (spec.visual) base.visualNote = spec.visual;
      const setting = spec.setting ?? (jp.setting && !draft.scenes[i] ? jp.setting : undefined);
      if (setting) base.setting = setting;
      if (spec.time) base.timeOfDay = spec.time;
      if (spec.camera) base.camera = spec.camera;
      if (spec.transition) base.transition = spec.transition;
      if (spec.actors) {
        base.actors = spec.actors.map((a) => {
          const prev = base.actors.find((x) => fold(x.character) === fold(a.name)) ?? fallback.scenes[i]?.actors.find((x) => fold(x.character) === fold(a.name));
          const fromX = a.fromX ?? prev?.fromX ?? 0.5;
          return {
            character: characters.find((c) => fold(c.name) === fold(a.name))?.name ?? a.name,
            actions: a.actions ?? prev?.actions ?? ["idle"],
            fromX,
            toX: a.toX ?? (a.fromX !== undefined && !a.actions?.some((x) => x === "walk" || x === "run" || x === "push") ? fromX : (prev?.toX ?? fromX)),
            facing: a.facing ?? prev?.facing ?? (fromX > 0.5 ? "left" : "right"),
            emotion: a.emotion ?? prev?.emotion ?? "neutral",
            prop: a.prop ?? prev?.prop ?? "none",
          };
        });
      }
      return base;
    });
  }
  return { title: jp.title ?? draft.title, characters, scenes };
}

/** A complete storyboard built from the brief alone (no LLM): keywords fill whatever it leaves out. */
export function jsonPromptToDraft(jp: JsonPrompt, settings: VideoSettings): DraftPlan {
  const names = jp.characters.length ? jp.characters.map((c) => c.name) : findNames(jp.story);
  const cast = names.length ? names : [settings.language === "tr" ? "Kahraman" : "Hero"];
  const era = first<(typeof ERA_WORDS)[number][1] | null>(jp.story, ERA_WORDS, null);
  const characters: DraftPlan["characters"] = cast.map((name, i) => ({
    name,
    hat: (era?.hat && i === 0 ? era.hat : "none") as DraftPlan["characters"][number]["hat"],
    hair: era ? era.hair[i % era.hair.length] : (["short", "ponytail", "spiky", "bob", "curly", "long"] as HairId[])[i % 6],
    outfit: era?.outfit[i % era.outfit.length] ?? (["casual", "dress", "hoodie"] as OutfitId[])[i % 3],
    tall: false,
  }));

  let scenes: DraftScene[];
  if (jp.scenes) {
    let prev: SettingId = jp.setting ?? first<SettingId>(jp.story, SETTING_WORDS, "park");
    let prevCast: string[] = [];
    scenes = jp.scenes.map((spec, i) => {
      const text = [spec.narration, spec.visual].filter(Boolean).join(" ");
      const s = planScene(text, i, cast, spec.setting ?? prev, prevCast);
      if (spec.setting) s.setting = spec.setting;
      prev = s.setting;
      prevCast = (spec.actors?.map((a) => a.name) ?? s.actors.map((a) => a.character));
      s.narration = spec.narration ?? spec.visual ?? "";
      s.visualNote = spec.visual ?? "";
      return s;
    });
  } else {
    scenes = planOffline(jp.story, settings).scenes;
  }
  return applyJsonPrompt({ title: jp.title ?? scenes[0]?.title ?? "Yeni video", characters, scenes }, jp, { title: "", characters, scenes });
}

/** The brief as the LLM sees it: authoritative, with the scene count fixed when given. */
export function jsonBrief(jp: JsonPrompt): string {
  const rules = [
    "The user supplied a structured JSON brief instead of prose. Treat every value it states as a requirement.",
    jp.scenes ? `Produce exactly ${jp.scenes.length} scenes, in the brief's order, one per brief scene.` : "",
    "Use narration text from the brief verbatim when given; write narration only where the brief leaves it out.",
    "Free-text values (places, actions, clothes, camera) must be mapped to the closest allowed enum value.",
    "Fill every field the brief leaves out so the visuals match that scene's narration.",
  ].filter(Boolean);
  return `${rules.join("\n")}\n\nJSON brief:\n${jp.pretty}`;
}
