import { z } from "zod";
import {
  ACTIONS, CAMERAS, CHARACTER_COLORS, MEME_SFX, EMOTIONS, HAIRS, HATS, OUTFITS, PROPS, SETTINGS, TIMES_OF_DAY, TRANSITIONS,
  MAX_SCENE_SEC, MIN_SCENE_SEC, clamp,
  type Character, type Scene, type VideoSettings,
} from "./schema";
import { estimateSpeechSec } from "./timeline";
import { LOCOMOTION } from "./rig";

// The shape planners produce. Deliberately loose on numbers (structured-output
// JSON schemas can't express ranges); normalizeDraft() clamps everything.
export const DraftActor = z.object({
  character: z.string().describe("Name of a character from the characters list"),
  actions: z.array(z.enum(ACTIONS)).describe("1-3 actions played in order during the scene"),
  fromX: z.number().describe("Start position, 0 = left edge, 1 = right edge"),
  toX: z.number().describe("End position; differs from fromX only if an action is walk/run/push"),
  facing: z.enum(["left", "right"]),
  emotion: z.enum(EMOTIONS),
  prop: z.enum(PROPS),
});

export const DraftScene = z.object({
  title: z.string(),
  narration: z.string().describe("Exact voice-over text for this scene, in the output language"),
  visualNote: z.string().describe("One sentence describing what the viewer sees"),
  headline: z.string().optional().describe("Big on-screen text, 2-5 words, in the output language; empty for no text"),
  caption: z.string().optional().describe("Optional meme caption (uppercase impact text), only for comedy/meme videos"),
  stings: z.array(z.enum(MEME_SFX)).optional().describe("Optional meme sound stings, only for comedy/meme videos"),
  setting: z.enum(SETTINGS),
  timeOfDay: z.enum(TIMES_OF_DAY),
  camera: z.enum(CAMERAS),
  transition: z.enum(TRANSITIONS),
  actors: z.array(DraftActor),
});

export const DraftPlan = z.object({
  title: z.string(),
  characters: z.array(
    z.object({
      name: z.string(),
      hat: z.enum(HATS),
      hair: z.enum(HAIRS).describe("Hairstyle; 'none' is bald"),
      outfit: z.enum(OUTFITS).describe("Clothing that fits the story's era and place"),
      tall: z.boolean(),
    }),
  ),
  scenes: z.array(DraftScene),
});

export type DraftPlan = z.infer<typeof DraftPlan>;
export type DraftScene = z.infer<typeof DraftScene>;

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function slug(name: string, used: Set<string>): string {
  const base =
    name
      .toLocaleLowerCase("tr")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "karakter";
  let id = base.slice(0, 30);
  for (let i = 2; used.has(id); i++) id = `${base.slice(0, 26)}-${i}`;
  used.add(id);
  return id;
}

export function sceneDuration(narration: string, language: string, target: number): number {
  const speech = estimateSpeechSec(narration, language);
  return Math.round(clamp(Math.max(target, speech + 1.2), MIN_SCENE_SEC, MAX_SCENE_SEC) * 10) / 10;
}

/** On-screen text stays a short title card or lower third: at most 9 words and 48 characters, no closing period. */
function headline(v: string | undefined): string | undefined {
  const words = (v ?? "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean).slice(0, 9);
  const text = words.join(" ").replace(/[.]+$/, "").slice(0, 48).trim();
  return text || undefined;
}

export function normalizeScene(
  d: DraftScene,
  characters: Character[],
  settings: VideoSettings,
  targetSec: number,
  id = newId("scn"),
): Scene {
  const byName = new Map(characters.map((c) => [c.name.toLocaleLowerCase("tr"), c]));
  const seen = new Set<string>();
  const actors = d.actors
    .flatMap((a) => {
      const c = byName.get(a.character.toLocaleLowerCase("tr")) ?? characters.find((x) => x.id === a.character);
      if (!c || seen.has(c.id)) return [];
      seen.add(c.id);
      let actions = a.actions.length ? a.actions.slice(0, 3) : (["idle"] as typeof a.actions);
      const fromX = clamp(Number.isFinite(a.fromX) ? a.fromX : 0.5, 0, 1);
      let toX = clamp(Number.isFinite(a.toX) ? a.toX : fromX, 0, 1);
      const moves = actions.some((x) => LOCOMOTION.has(x));
      // A figure only changes position while walking/running/pushing.
      if (!moves && Math.abs(toX - fromX) > 0.05) actions = (["walk", ...actions] as typeof actions).slice(0, 3);
      if (moves && Math.abs(toX - fromX) < 0.05) toX = clamp(fromX + (fromX < 0.5 ? 0.35 : -0.35), 0, 1);
      return [{ characterId: c.id, actions, fromX, toX, facing: a.facing, emotion: a.emotion, prop: a.prop }];
    })
    .slice(0, 4);
  // The space set is a gag shot of the ball in orbit: nobody stands there.
  if (d.setting === "space") actors.length = 0;

  return {
    id,
    title: d.title.slice(0, 80),
    narration: d.narration.slice(0, 600),
    visualNote: d.visualNote.slice(0, 400),
    ...(headline(d.headline) && { headline: headline(d.headline) }),
    ...(d.caption?.trim() && { caption: d.caption.trim().slice(0, 60) }),
    ...(d.stings?.length && { stings: [...new Set(d.stings)].slice(0, 3) }),
    durationSec: sceneDuration(d.narration, settings.language, targetSec),
    setting: d.setting,
    timeOfDay: d.timeOfDay,
    camera: d.camera,
    transition: d.transition,
    actors,
    approved: false,
  };
}

export function normalizeDraft(draft: DraftPlan, settings: VideoSettings): { title: string; characters: Character[]; scenes: Scene[] } {
  const used = new Set<string>();
  const characters: Character[] = draft.characters.slice(0, 6).map((c, i) => ({
    id: slug(c.name, used),
    name: c.name.slice(0, 40),
    color: CHARACTER_COLORS[i % CHARACTER_COLORS.length],
    hat: settings.style === "modern-pop" && i === 0 ? "beanie" : c.hat,
    scale: c.tall ? 1.08 : 1,
    hair: c.hair,
    outfit: c.outfit,
  }));
  if (characters.length === 0) {
    characters.push({ id: "kahraman", name: "Kahraman", color: CHARACTER_COLORS[0], hat: "none", scale: 1, hair: "short", outfit: "casual" });
  }
  const sceneDrafts = draft.scenes.slice(0, 40);
  const target = settings.durationSec / Math.max(1, sceneDrafts.length);
  const scenes = sceneDrafts.map((d) => normalizeScene(d, characters, settings, target));
  // Every scene needs someone on screen; fall back to the lead character idling.
  for (const s of scenes) {
    if (s.actors.length === 0 && s.setting !== "space") {
      s.actors.push({ characterId: characters[0].id, actions: ["idle"], fromX: 0.5, toX: 0.5, facing: "right", emotion: "neutral", prop: "none" });
    }
  }
  return { title: draft.title.slice(0, 120) || "Yeni video", characters, scenes };
}
