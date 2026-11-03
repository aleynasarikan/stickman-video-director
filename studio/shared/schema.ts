import { z } from "zod";

// Every value here maps to something the local renderer can actually draw.
// The LLM and the offline planner may only choose from these vocabularies.

export const ASPECTS = ["16:9", "9:16"] as const;
// "cinematic" is the detailed cartoon look; "sketch" is the minimalist hand-drawn look (paper grid,
// slender ink figures, crayon props, handwritten text); "news" is the cinematic look dressed as a TV
// news bulletin (studio, lower thirds, ticker); the others are the original flat styles.
export const STYLES = ["cinematic", "news", "sketch", "classic-light", "classic-dark", "modern-pop", "cozy", "prehistoric"] as const;
export const LANGUAGES = ["tr", "en"] as const;

export const SETTINGS = [
  "blank", "park", "street", "city", "room", "office", "classroom",
  "kitchen", "forest", "beach", "mountain", "cave", "stage",
  "japanese-room", "egypt-temple", "desert", "village", "castle",
  "japanese-street", "japanese-castle", "dojo", "egypt-market", "news-studio", "stadium", "space",
] as const;
export const TIMES_OF_DAY = ["day", "sunset", "night"] as const;
// "punch-in": meme-style snap zoom onto the lead's face just past mid-scene, with a shake and a boom.
export const CAMERAS = ["wide", "medium", "close", "pan-left", "pan-right", "zoom-in", "zoom-out", "punch-in"] as const;
/** Meme sound stings a scene can ask for (played just after it starts). */
export const MEME_SFX = ["boom", "trombone", "airhorn", "scratch"] as const;
export type MemeSfxId = (typeof MEME_SFX)[number];
export const TRANSITIONS = ["cut", "fade"] as const;

export const ACTIONS = [
  "idle", "walk", "run", "jump", "wave", "talk", "point", "think",
  "sit", "sleep", "dance", "cheer", "cry", "fall", "push", "fight", "kick", "miss",
] as const;
export const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "scared", "thinking"] as const;
export const PROPS = [
  "none", "phone", "book", "cup", "ball", "bag", "flower", "laptop",
  "umbrella", "gift", "sword", "lightbulb", "heart", "spear", "microphone", "trophy", "card",
] as const;
export const HATS = ["none", "beanie", "cap", "crown", "bow", "tophat", "headband", "straw"] as const;
export const HAIRS = ["none", "short", "spiky", "curly", "bob", "long", "ponytail", "bun", "topknot"] as const;
export const OUTFITS = ["casual", "suit", "dress", "hoodie", "labcoat", "kimono", "hakama", "tunic", "toga", "armor", "pelt", "jersey", "referee"] as const;

// Narrator voices. EMA Lightning has a single (female) voice; the others are made from it by
// the WORLD vocoder: pitch scales the fundamental frequency, formant warps the spectral envelope
// (below 1 = a longer, male vocal tract), speed is the speaking rate.
export const VOICES = ["kadin", "kadin-olgun", "erkek", "erkek-kalin", "cocuk"] as const;
export type VoiceId = (typeof VOICES)[number];
export const VOICE_PRESETS: Record<VoiceId, { pitch: number; formant: number; speed: number }> = {
  kadin: { pitch: 1, formant: 1, speed: 1 },
  "kadin-olgun": { pitch: 0.85, formant: 0.94, speed: 0.95 },
  erkek: { pitch: 0.56, formant: 0.84, speed: 1 },
  "erkek-kalin": { pitch: 0.48, formant: 0.8, speed: 0.93 },
  cocuk: { pitch: 1.3, formant: 1.12, speed: 1.05 },
};

export const FPS = 30;
export const MIN_SCENE_SEC = 3;
export const MAX_SCENE_SEC = 15;

export const VideoSettings = z.object({
  durationSec: z.number().int().min(10).max(300),
  aspect: z.enum(ASPECTS),
  style: z.enum(STYLES),
  language: z.enum(LANGUAGES),
  voiceover: z.boolean(),
  subtitles: z.boolean(),
  // Added later; missing means "kadin".
  voice: z.enum(VOICES).optional(),
  // Sound effects under the narration (jumps, falls, ideas...); missing means on.
  sfx: z.boolean().optional(),
  // Satire/meme content: shown with a MİZAH label and a closing disclaimer.
  satire: z.boolean().optional(),
});
export type VideoSettings = z.infer<typeof VideoSettings>;

export const Character = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  hat: z.enum(HATS),
  scale: z.number().min(0.6).max(1.3),
  // Added later: defaults keep older saved projects valid.
  hair: z.enum(HAIRS).default("short"),
  outfit: z.enum(OUTFITS).default("casual"),
});
export type Character = z.infer<typeof Character>;

export const Actor = z.object({
  characterId: z.string().min(1),
  actions: z.array(z.enum(ACTIONS)).min(1).max(4),
  fromX: z.number().min(0).max(1),
  toX: z.number().min(0).max(1),
  facing: z.enum(["left", "right"]),
  emotion: z.enum(EMOTIONS),
  prop: z.enum(PROPS),
});
export type Actor = z.infer<typeof Actor>;

/** File names allowed in a project's assets folder (no paths, image types only). */
export const ASSET_FILE_RE = /^[\w-]{1,80}\.(png|jpe?g)$/;

export const Scene = z.object({
  id: z.string().min(1),
  title: z.string().max(80),
  narration: z.string().max(600),
  visualNote: z.string().max(400),
  durationSec: z.number().min(MIN_SCENE_SEC).max(MAX_SCENE_SEC),
  setting: z.enum(SETTINGS),
  timeOfDay: z.enum(TIMES_OF_DAY),
  camera: z.enum(CAMERAS),
  transition: z.enum(TRANSITIONS),
  actors: z.array(Actor).max(4),
  approved: z.boolean(),
  /** Overrides the narrator voice for this scene (e.g. a line spoken by a male character). */
  voice: z.enum(VOICES).optional(),
  /** Big on-screen text for the scene (2-5 words), like a hand-written title card; empty = none. */
  headline: z.string().max(48).optional(),
  /** Meme caption: bold white uppercase text with a black outline at the top of the frame. */
  caption: z.string().max(60).optional(),
  /** Meme sound stings for this scene. */
  stings: z.array(z.enum(MEME_SFX)).max(3).optional(),
  /**
   * Optional generated background image in the project's assets folder. Absent (every existing
   * project) or missing on disk = the scene's drawn Canvas background, exactly as before.
   */
  background: z.object({ file: z.string().regex(ASSET_FILE_RE), prompt: z.string().max(600) }).optional(),
});
export type Scene = z.infer<typeof Scene>;

/** Who drafted the storyboard: an LLM API, or the free keyword-based "offline" planner. */
export const PLANNERS = ["claude", "qwen", "groq", "deepseek", "offline"] as const;
export type PlannerKind = (typeof PLANNERS)[number];
export type AiPlannerKind = Exclude<PlannerKind, "offline">;
export const AI_PLANNERS: readonly AiPlannerKind[] = ["qwen", "groq", "deepseek", "claude"];
export const PLANNER_LABEL: Record<PlannerKind, string> = { claude: "Claude", qwen: "Qwen", groq: "Groq", deepseek: "DeepSeek", offline: "Çevrimdışı" };

export const Project = z.object({
  id: z.string().min(1),
  title: z.string().max(120),
  story: z.string().max(20000),
  settings: VideoSettings,
  characters: z.array(Character).max(6),
  scenes: z.array(Scene).min(1).max(40),
  planner: z.enum(PLANNERS),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

export const CreateProjectRequest = z.object({
  story: z.string().trim().min(10).max(20000),
  settings: VideoSettings,
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export type StyleId = (typeof STYLES)[number];
export type SettingId = (typeof SETTINGS)[number];
export type ActionId = (typeof ACTIONS)[number];
export type EmotionId = (typeof EMOTIONS)[number];
export type PropId = (typeof PROPS)[number];
export type CameraId = (typeof CAMERAS)[number];
export type HairId = (typeof HAIRS)[number];
export type OutfitId = (typeof OUTFITS)[number];

export const CHARACTER_COLORS = ["#e63946", "#1d4ed8", "#16a34a", "#d97706", "#9333ea", "#0891b2"];

/** Styles drawn by the detailed cartoon renderer. */
export function isCinematic(style: StyleId): boolean {
  return style === "cinematic" || style === "news";
}

export function canvasSize(aspect: VideoSettings["aspect"]): { width: number; height: number } {
  return aspect === "16:9" ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
