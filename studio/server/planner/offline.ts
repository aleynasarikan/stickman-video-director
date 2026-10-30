import type { ActionId, EmotionId, HairId, OutfitId, PropId, SettingId, VideoSettings } from "../../shared/schema";
import type { DraftPlan, DraftScene } from "../../shared/draft";
import type { Planner, PlanInput, SceneRegenInput } from "./types";
import { ACTION_WORDS, EMOTION_WORDS, ERA_WORDS, PROP_WORDS, SETTING_WORDS, TIME_WORDS, all, first, fold } from "./lexicon";

// Keyword-based planner: no network, no cost, deterministic. It produces a
// usable first storyboard the user can then edit; it does not "understand" the story.

const EVERYDAY_HAIR: HairId[] = ["short", "ponytail", "spiky", "bob", "curly", "long"];
const EVERYDAY_OUTFIT: OutfitId[] = ["casual", "dress", "hoodie", "casual", "dress", "hoodie"];

const CAMERAS: DraftScene["camera"][] = ["wide", "medium", "pan-right", "zoom-in", "medium", "close", "pan-left", "zoom-out"];

const STOP_NAMES = new Set([
  "Bir", "Bu", "Şu", "O", "Ve", "Ama", "Sonra", "Ertesi", "Gün", "Bugün", "Yarın", "Her", "Hiç", "Ben", "Sen", "Biz",
  "Onlar", "The", "A", "An", "Then", "And", "But", "One", "When", "He", "She", "They", "It", "Ne", "Neden", "Nasıl",
  "Çünkü", "Belki", "Artık", "Hemen", "Birden", "Sabah", "Akşam", "Gece", "İşte", "Oysa", "Fakat", "Ancak", "Da", "De",
  // Eras and places that open historical stories ("Edo döneminde…", "Antik Mısır'da…").
  "Edo", "Antik", "Mısır", "Roma", "Japonya", "Osmanlı", "Orta", "Çağ", "Köylüler", "Köyde",
]);

/** Also catches suffixed forms of longer stop words ("Mısırda", "Japonya'da" without an apostrophe). */
function isStopName(w: string): boolean {
  if (STOP_NAMES.has(w)) return true;
  for (const s of STOP_NAMES) if (s.length >= 4 && w.startsWith(s) && w.length - s.length <= 3) return true;
  return false;
}

export function splitSentences(story: string): string[] {
  return story
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export function findNames(story: string, max = 3): string[] {
  const counts = new Map<string, number>();
  splitSentences(story).forEach((sentence, si) => {
    const words = sentence.split(/\s+/);
    words.forEach((raw, i) => {
      const w = raw.replace(/[^\p{L}'’]/gu, "").split(/['’]/)[0];
      if (!/^\p{Lu}\p{Ll}+$/u.test(w) || isStopName(w)) return;
      // Sentence-initial words are ambiguous (any word is capitalised there), except the
      // story's very first word, which is usually the protagonist ("Mert ofiste…").
      const weight = i > 0 || si === 0 ? 1 : 0.5;
      counts.set(w, (counts.get(w) ?? 0) + weight);
    });
  });
  return [...counts.entries()]
    .filter(([, n]) => n >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

function groupSentences(sentences: string[], groups: number): string[] {
  if (sentences.length <= groups) return sentences;
  const out: string[] = [];
  const per = sentences.length / groups;
  for (let g = 0; g < groups; g++) {
    out.push(sentences.slice(Math.round(g * per), Math.round((g + 1) * per)).join(" "));
  }
  return out.filter(Boolean);
}

function sceneCount(settings: VideoSettings, sentenceCount: number): number {
  const ideal = Math.round(settings.durationSec / 7);
  return Math.max(1, Math.min(ideal, sentenceCount, 40));
}

export function planScene(text: string, index: number, names: string[], prevSetting: SettingId, prevCast: string[] = []): DraftScene {
  const present = names.filter((n) => text.includes(n));
  const together = /ikisi|hepsi|birlikte|beraber|together|both/i.test(fold(text));
  // Keep whoever was on screen before so unnamed subjects ("gördü", "he") stay visible.
  const cast = [...new Set(together ? names : [...prevCast.slice(0, 1), ...present])];
  if (cast.length === 0) cast.push(names[0]);
  cast.splice(3);
  const actions = all(text, ACTION_WORDS).slice(0, 2);
  const setting = first(text, SETTING_WORDS, prevSetting);
  const emotion = first(text, EMOTION_WORDS, "neutral" as EmotionId);
  const prop = first(text, PROP_WORDS, "none" as PropId);
  const time = first<"night" | "sunset" | null>(text, TIME_WORDS, null);

  const actors = cast.map((name, i) => {
    const lead = i === 0;
    const acts: ActionId[] = lead ? (actions.length ? actions : ["idle", "talk"]) : [actions.includes("talk") ? "talk" : "idle"];
    const slots = cast.length === 1 ? [0.5] : cast.length === 2 ? [0.3, 0.7] : [0.2, 0.5, 0.8];
    let fromX = slots[i];
    let toX = fromX;
    if (acts.some((a) => a === "walk" || a === "run" || a === "push")) {
      fromX = cast.length === 1 ? 0.15 : slots[i] - 0.2;
      toX = cast.length === 1 ? 0.6 : slots[i];
    }
    return {
      character: name,
      actions: acts,
      fromX: Math.max(0, fromX),
      toX,
      facing: (i === 0 ? "right" : "left") as "left" | "right",
      emotion: lead ? emotion : "neutral",
      prop: lead ? prop : ("none" as PropId),
    };
  });

  return {
    title: text.split(/\s+/).slice(0, 6).join(" ").replace(/[.,!?…]+$/, ""),
    narration: text,
    visualNote: "",
    setting,
    timeOfDay: time ?? "day",
    camera: CAMERAS[index % CAMERAS.length],
    transition: index > 0 && setting !== prevSetting ? "fade" : "cut",
    actors,
  };
}

export function planOffline(story: string, settings: VideoSettings): DraftPlan {
  const sentences = splitSentences(story);
  const chunks = groupSentences(sentences, sceneCount(settings, sentences.length));
  const names = findNames(story);
  const cast = names.length ? names : [settings.language === "tr" ? "Kahraman" : "Hero"];
  let prev: SettingId = first(story, SETTING_WORDS, "park" as SettingId);
  let prevCast: string[] = [];
  const scenes = chunks.map((text, i) => {
    const s = planScene(text, i, cast, prev, prevCast);
    prev = s.setting;
    prevCast = s.actors.map((a) => a.character);
    return s;
  });
  return {
    title: sentences[0]?.split(/\s+/).slice(0, 6).join(" ").replace(/[.,!?…]+$/, "") ?? "Yeni video",
    characters: cast.map((name, i) => {
      const era = first<(typeof ERA_WORDS)[number][1] | null>(story, ERA_WORDS, null);
      if (era) return { name, hat: (era.hat && i === 0 ? era.hat : "none") as "none" | "headband", hair: era.hair[i % era.hair.length], outfit: era.outfit[i % era.outfit.length], tall: false };
      return { name, hat: "none" as const, hair: EVERYDAY_HAIR[i % EVERYDAY_HAIR.length], outfit: EVERYDAY_OUTFIT[i % EVERYDAY_OUTFIT.length], tall: false };
    }),
    scenes,
  };
}

export class OfflinePlanner implements Planner {
  readonly kind = "offline" as const;

  async plan(input: PlanInput): Promise<DraftPlan> {
    return planOffline(input.story, input.settings);
  }

  async regenerateScene(input: SceneRegenInput): Promise<DraftScene> {
    const names = input.project.characters.map((c) => c.name);
    const scene = input.project.scenes[input.index];
    const prev = input.project.scenes[input.index - 1]?.setting ?? scene.setting;
    const byId = new Map(input.project.characters.map((c) => [c.id, c.name]));
    const onScreen = scene.actors.map((a) => byId.get(a.characterId) ?? "").filter(Boolean);
    const draft = planScene(scene.narration, input.index + 1, names, prev, onScreen);
    // Offer a visibly different take: rotate the camera and vary the lead's actions.
    draft.camera = CAMERAS[(CAMERAS.indexOf(scene.camera) + 3) % CAMERAS.length];
    if (draft.actors[0]) {
      const pool: ActionId[] = ["talk", "point", "think", "wave", "jump", "cheer", "walk"];
      const pick = pool[(input.index + Date.now()) % pool.length];
      draft.actors[0].actions = [...draft.actors[0].actions.slice(0, 1), pick];
    }
    return draft;
  }
}
