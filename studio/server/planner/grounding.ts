import type { DraftPlan, DraftScene } from "../../shared/draft";
import type { ActionId, EmotionId, OutfitId, SettingId, VideoSettings } from "../../shared/schema";
import { ACTION_WORDS, EMOTION_WORDS, PROP_WORDS, SETTING_WORDS, TIME_WORDS, all, first, fold } from "./lexicon";

// Checks every planner's storyboard (LLM or offline) against what each scene's narration
// actually says, and repairs the visuals where they contradict or ignore it: a character
// the narration talks about must be on screen, an object it mentions must be in someone's
// hand, a place it names must be the set, and so on. It only fills gaps and fixes clear
// contradictions; choices that agree with the text are left alone.

type DraftActor = DraftScene["actors"][number];

const SLOTS = [0.5, 0.25, 0.75, 0.1, 0.9, 0.38, 0.62];

function nameIndex(text: string, name: string): number {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${fold(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u");
  const m = re.exec(text);
  return m ? m.index : -1;
}

/** The free spot nearest the centre that keeps a readable gap to everyone already there. */
function freeSlot(actors: DraftActor[]): number {
  const gap = (x: number) => Math.min(1, ...actors.map((a) => Math.abs(a.toX - x)));
  const roomy = SLOTS.filter((x) => gap(x) >= 0.25).sort((a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5));
  return roomy[0] ?? [...SLOTS].sort((a, b) => gap(b) - gap(a))[0];
}

const TALK = new Set<ActionId>(["talk"]);

// Generic sets have period versions: a village in an Edo story is a Japanese street, not
// timber-framed European houses. The era is read from how the cast is dressed.
export type Era = "japan" | "egypt";
const ERA_VARIANT: Record<Era, Partial<Record<SettingId, SettingId>>> = {
  japan: { village: "japanese-street", street: "japanese-street", city: "japanese-street", castle: "japanese-castle", classroom: "dojo", room: "japanese-room", office: "japanese-room", kitchen: "japanese-room" },
  egypt: { village: "egypt-market", street: "egypt-market", city: "egypt-market", castle: "egypt-temple", room: "egypt-temple" },
};
const ERA_OUTFITS: Record<Era, OutfitId[]> = { japan: ["kimono", "hakama"], egypt: ["tunic"] };

/** The story's era when most of the cast wears its clothes. */
export function eraOf(outfits: OutfitId[]): Era | null {
  for (const era of Object.keys(ERA_OUTFITS) as Era[]) {
    const n = outfits.filter((o) => ERA_OUTFITS[era].includes(o)).length;
    if (n > 0 && n * 2 >= outfits.length) return era;
  }
  return null;
}

export function eraSetting(setting: SettingId, era: Era | null): SettingId {
  return (era && ERA_VARIANT[era][setting]) || setting;
}

export interface GroundResult {
  draft: DraftPlan;
  /** Human-readable list of what was changed, for logs and tests. */
  fixes: string[];
}

export function groundScene(
  scene: DraftScene, names: string[], settings: Pick<VideoSettings, "aspect">, prev?: DraftScene, era: Era | null = null,
): { scene: DraftScene; fixes: string[] } {
  const s: DraftScene = { ...scene, actors: scene.actors.map((a) => ({ ...a, actions: [...a.actions] })) };
  const fixes: string[] = [];
  const raw = fold(`${s.narration} ${s.visualNote}`);
  // Character names must not trigger keywords ("Deniz" is a name, not the sea).
  let text = raw;
  for (const nm of names) text = text.split(fold(nm)).join(" ");
  const maxActors = settings.aspect === "9:16" ? 2 : 4;

  // 1. Who: characters the narration mentions, in order of appearance.
  const mentioned = names
    .map((nm) => ({ nm, at: nameIndex(raw, nm) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.nm);
  const onScreen = (nm: string) => s.actors.find((a) => fold(a.character) === fold(nm));
  const talkScene = all(text, ACTION_WORDS).some((a) => TALK.has(a));
  for (const nm of mentioned) {
    if (onScreen(nm) || s.actors.length >= maxActors) continue;
    const x = freeSlot(s.actors);
    const others = s.actors.length ? s.actors.reduce((t, a) => t + a.toX, 0) / s.actors.length : 0.5;
    s.actors.push({
      character: nm, actions: [talkScene ? "talk" : "idle"], fromX: x, toX: x,
      facing: others < x ? "left" : "right", emotion: "neutral", prop: "none",
    });
    fixes.push(`${nm} sahneye eklendi`);
  }
  // An unnamed subject ("o", "he") is whoever led the previous scene.
  if (s.actors.length === 0 && prev?.actors[0]) {
    s.actors.push({ ...prev.actors[0], actions: ["idle"], fromX: prev.actors[0].toX, toX: prev.actors[0].toX, prop: "none" });
    fixes.push(`${prev.actors[0].character} önceki sahneden taşındı`);
  }
  if (s.actors.length === 0) {
    s.setting = eraSetting(s.setting, era);
    return { scene: s, fixes };
  }
  const subject = (mentioned.length && onScreen(mentioned[0])) || s.actors[0];

  // 2. Doing what: if the narration names actions and nobody performs any of them, the lead does.
  const acts = all(text, ACTION_WORDS).filter((a) => !TALK.has(a) || all(text, ACTION_WORDS).length === 1);
  if (acts.length && !s.actors.some((a) => a.actions.some((x) => acts.includes(x)))) {
    const keep = subject.actions.filter((x) => x !== "idle" && !acts.includes(x));
    subject.actions = [...acts.slice(0, 2), ...keep].slice(0, 3);
    fixes.push(`${subject.character}: ${acts.slice(0, 2).join(", ")}`);
  }

  // 3. Feeling.
  const emo = first<EmotionId | null>(text, EMOTION_WORDS, null);
  if (emo && s.actors.every((a) => a.emotion === "neutral")) {
    subject.emotion = emo;
    fixes.push(`${subject.character} duygusu: ${emo}`);
  }
  for (const a of s.actors) {
    if (a.actions.includes("cry") && (a.emotion === "happy" || a.emotion === "neutral")) a.emotion = "sad";
    if (a.actions.includes("cheer") && a.emotion === "neutral") a.emotion = "happy";
  }

  // 4. Holding what: a mentioned object should be visible.
  const props = all(text, PROP_WORDS);
  if (props.length && !s.actors.some((a) => props.includes(a.prop))) {
    const holder = subject.prop === "none" ? subject : (s.actors.find((a) => a.prop === "none") ?? subject);
    holder.prop = props[0];
    fixes.push(`${holder.character} eline: ${props[0]}`);
  }

  // 5. Where: the set must be one of the places the narration names (if it names any),
  // in the story's period version.
  const places = [...new Set(all(text, SETTING_WORDS).map((x) => eraSetting(x, era)))];
  if (places.length && !places.includes(s.setting)) {
    fixes.push(`mekân: ${s.setting} → ${places[0]}`);
    s.setting = places[0];
  } else if (!places.length && s.setting === "blank" && prev && prev.setting !== "blank") {
    s.setting = prev.setting;
  }
  const period = eraSetting(s.setting, era);
  if (period !== s.setting) {
    fixes.push(`dönem mekânı: ${s.setting} → ${period}`);
    s.setting = period;
  }

  // 6. When.
  const time = first<"night" | "sunset" | null>(text, TIME_WORDS, null);
  if (time && s.timeOfDay === "day") {
    s.timeOfDay = time;
    fixes.push(`zaman: ${time}`);
  }

  // Two characters standing in one place face each other (a conversation, a confrontation).
  const still = (a: DraftActor) => !a.actions.some((x) => x === "walk" || x === "run" || x === "push");
  if (s.actors.length === 2 && s.actors.every(still) && fixes.length) {
    const [a, b] = s.actors[0].toX <= s.actors[1].toX ? s.actors : [s.actors[1], s.actors[0]];
    a.facing = "right";
    b.facing = "left";
  }
  return { scene: s, fixes };
}

export function groundDraft(draft: DraftPlan, settings: Pick<VideoSettings, "aspect"> & Partial<Pick<VideoSettings, "style">>): GroundResult {
  // A news bulletin's narration reports events elsewhere: "the minister ran to..." must not move
  // the presenter out of the studio or make them run.
  if (settings.style === "news") return { draft, fixes: [] };
  const names = draft.characters.map((c) => c.name).filter(Boolean);
  const era = eraOf(draft.characters.map((c) => c.outfit));
  const fixes: string[] = [];
  const scenes: DraftScene[] = [];
  draft.scenes.forEach((scene, i) => {
    const r = groundScene(scene, names, settings, scenes[i - 1], era);
    scenes.push(r.scene);
    fixes.push(...r.fixes.map((f) => `Sahne ${i + 1}: ${f}`));
  });
  return { draft: { ...draft, scenes }, fixes };
}

/** Moves generic sets to the story's period version (for drafts that skipped grounding, e.g. explicit JSON values). */
export function periodSettings(draft: DraftPlan): DraftPlan {
  const era = eraOf(draft.characters.map((c) => c.outfit));
  if (!era) return draft;
  return { ...draft, scenes: draft.scenes.map((s) => ({ ...s, setting: eraSetting(s.setting, era) })) };
}
