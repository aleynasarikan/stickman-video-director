import type { Character, Project, Scene } from "../schema";
import { sequencePose } from "../rig";
import { buildTimeline, punchAt, spanAt, cueAt, type SceneSpan, type SubtitleCue } from "../timeline";
import { Painter, PALETTES, SKETCH_SET, type Ctx } from "./painter";
import { drawBackground, type Stage } from "./background";
import { drawFigure } from "./figure";
import { drawCinematicBackground, drawCinematicForeground, gradeFrame } from "./cinematic/scenery";
import { TICKER_H, drawNewsGraphics } from "./news";
import { drawCinematicFigure } from "./cinematic/figure";
import { isCinematic, type StyleId } from "../schema";
import { hashString } from "./painter";

export interface FrameOptions {
  width: number;
  height: number;
  cues?: SubtitleCue[];
  subtitles?: boolean;
}

const FADE_SEC = 0.45;

export function makeStage(width: number, height: number, style?: StyleId): Stage {
  const portrait = height > width;
  const cine = style !== undefined && isCinematic(style);
  return {
    W: width,
    H: height,
    groundY: height * (portrait ? (cine ? 0.76 : 0.74) : cine ? 0.88 : 0.82),
    // Cinematic figures are drawn larger, like a medium shot.
    figureH: portrait ? height * (cine ? 0.34 : 0.27) : height * (cine ? 0.6 : 0.36),
    left: -width * 0.6,
    right: width * 1.6,
  };
}

function cameraTransform(scene: Scene, stage: Stage, k: number, focusX: number, focusY: number) {
  const ease = k * k * (3 - 2 * k);
  let s = 1;
  let dx = 0;
  let dy = 0;
  switch (scene.camera) {
    case "medium":
      s = 1.3;
      break;
    case "close":
      s = 1.85;
      break;
    case "pan-left":
      s = 1.15;
      dx = (0.5 - ease) * stage.W * 0.22;
      break;
    case "pan-right":
      s = 1.15;
      dx = (ease - 0.5) * stage.W * 0.22;
      break;
    case "zoom-in":
      s = 1 + 0.45 * ease;
      break;
    case "zoom-out":
      s = 1.45 - 0.45 * ease;
      break;
    case "punch-in": {
      // Hold wide, then snap onto the face in 0.08 s and shake for a moment.
      const t = k * scene.durationSec - punchAt(scene);
      const snap = Math.min(1, Math.max(0, t / 0.08));
      s = 1.05 + 1.25 * snap;
      if (t > 0 && t < 0.45) {
        const a = (1 - t / 0.45) * stage.H * 0.012;
        dx = Math.sin(t * 90) * a;
        dy = Math.cos(t * 70) * a;
      }
      break;
    }
  }
  // Keep the focus point centred as we scale, but never reveal the sky above the
  // drawn area or the region below the ground plane.
  const cx = s === 1 ? stage.W / 2 : focusX;
  const cy = s === 1 ? stage.H / 2 : focusY;
  const tx = stage.W / 2 - cx * s + dx;
  const ty = Math.min(0, Math.max(stage.H - stage.H * s, stage.H / 2 - cy * s)) + dy;
  return { s, tx, ty };
}

function actorX(fromX: number, toX: number, travel: number, stage: Stage) {
  const x = fromX + (toX - fromX) * travel;
  return stage.W * (0.12 + x * 0.76);
}

export function drawScene(ctx: Ctx, project: Project, span: SceneSpan, localT: number, stage: Stage) {
  const scene = span.scene;
  const style = project.settings.style;
  const pal = PALETTES[style];
  const p = new Painter(ctx, pal);
  const chars = new Map<string, Character>(project.characters.map((c) => [c.id, c]));
  const dur = scene.durationSec;
  const k = Math.min(1, Math.max(0, localT / dur));

  const figures = scene.actors.flatMap((a, i) => {
    const character = chars.get(a.characterId);
    if (!character) return [];
    const seq = sequencePose(a.actions, localT, dur);
    const { travel, action, actionT } = seq;
    let pose = seq.pose;
    // A reporter's microphone goes to their own mouth while they speak, to the guest otherwise.
    if (a.prop === "microphone" && !["walk", "run", "jump", "fall", "sleep", "push"].includes(action))
      pose = { ...pose, armFront: action === "talk" ? [0.55, 2.2] : [1.3 + Math.sin(localT * 1.3) * 0.04, 0.2] };
    const x = actorX(a.fromX, a.toX, travel, stage);
    const moving = Math.abs(a.toX - a.fromX) > 0.02 && ["walk", "run", "push"].includes(action);
    const facing: 1 | -1 = moving ? (a.toX >= a.fromX ? 1 : -1) : a.facing === "right" ? 1 : -1;
    return [{ i, a, character, pose, x, facing, action, actionT }];
  });

  // Keep a shoulder's width between figures so planners that stack actors on the same
  // spot still read clearly. Pure function of this frame's positions, so it never jitters.
  const cine = isCinematic(style);
  const gap = stage.figureH * (cine ? 0.36 : 0.22);
  const order = [...figures].sort((a, b) => a.x - b.x || a.i - b.i);
  for (let pass = 0; pass < 3; pass++)
    for (let k = 1; k < order.length; k++) {
      const overlap = gap - (order[k].x - order[k - 1].x);
      if (overlap > 0) {
        order[k - 1].x -= overlap / 2;
        order[k].x += overlap / 2;
      }
    }

  const focus = figures.length ? figures : [];
  const focusX = focus.length ? focus.reduce((n, f) => n + f.x, 0) / focus.length : stage.W / 2;
  const lead = figures[0];
  const focusY =
    (scene.camera === "close" || scene.camera === "punch-in") && lead
      ? stage.groundY - stage.figureH * lead.character.scale * 0.72
      : stage.groundY - stage.figureH * 0.5;
  const cam = cameraTransform(scene, stage, k, focusX, focusY);

  ctx.save();
  ctx.translate(cam.tx, cam.ty);
  ctx.scale(cam.s, cam.s);
  if (cine) drawCinematicBackground(ctx, scene, stage, localT);
  else if (style === "sketch") {
    drawBackground(new Painter(ctx, SKETCH_SET), scene, stage, style, localT);
    paperGrid(ctx, stage);
  } else drawBackground(p, scene, stage, style, localT);
  const draw = cine ? drawCinematicFigure : drawFigure;
  for (const f of figures) {
    draw(p, {
      character: f.character,
      x: f.x,
      groundY: stage.groundY,
      size: stage.figureH * f.character.scale,
      facing: f.facing,
      pose: f.pose,
      action: f.action,
      emotion: f.a.emotion,
      prop: f.a.prop,
      t: localT + f.i * 0.37,
      actionT: f.actionT,
      style,
      setting: scene.setting,
    });
  }
  if (cine) drawCinematicForeground(ctx, scene, stage);
  ctx.restore();
  if (cine) gradeFrame(ctx, scene, stage.W, stage.H);
  if (scene.caption?.trim()) drawCaption(ctx, scene.caption.trim(), localT, stage);
  if (style === "news") drawNewsGraphics(ctx, project, span, localT, stage);
  else if (scene.headline?.trim()) drawHeadline(ctx, scene.headline.trim(), localT, dur, stage, style, hashString(scene.id));
}

/** Faint squared paper under the sketch style (64 px at 720p), drawn in world space so it moves with the camera. */
function paperGrid(ctx: Ctx, stage: Stage) {
  const step = Math.min(stage.W, stage.H) / 11.25;
  ctx.strokeStyle = "rgba(70,110,160,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.floor(stage.left / step) * step; x < stage.right; x += step) {
    ctx.moveTo(x, -stage.H);
    ctx.lineTo(x, stage.H * 2);
  }
  for (let y = -stage.H; y < stage.H * 2; y += step) {
    ctx.moveTo(stage.left, y);
    ctx.lineTo(stage.right, y);
  }
  ctx.stroke();
}

const MEME_FONT = `Impact, "Anton", "Arial Black", "Helvetica Neue", sans-serif`;

/** Classic meme caption: white uppercase with a heavy black outline, at the top; slams in. */
function drawCaption(ctx: Ctx, text: string, t: number, stage: Stage) {
  const t0 = 0.25;
  if (t < t0) return;
  const k = Math.min(1, (t - t0) / 0.12);
  const scale = 1.6 - 0.6 * k;
  const portrait = stage.H > stage.W;
  const upper = text.toLocaleUpperCase("tr");
  let size = portrait ? stage.W * 0.1 : stage.H * 0.1;
  ctx.font = `900 ${Math.round(size)}px ${MEME_FONT}`;
  const maxW = stage.W * 0.9;
  // Up to two lines, shrinking to fit.
  const words = upper.split(/\s+/);
  let lines = [upper];
  if (ctx.measureText(upper).width > maxW && words.length > 1) {
    const mid = Math.ceil(words.length / 2);
    lines = [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (widest > maxW) {
    size *= maxW / widest;
    ctx.font = `900 ${Math.round(size)}px ${MEME_FONT}`;
  }
  const y0 = stage.H * (portrait ? 0.17 : 0.2);
  ctx.save();
  ctx.globalAlpha = k;
  ctx.translate(stage.W / 2, y0);
  ctx.scale(scale, scale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#ffffff";
  lines.forEach((l, i) => {
    const y = (i - (lines.length - 1) / 2) * size * 1.05;
    ctx.strokeText(l, 0, y);
    ctx.fillText(l, 0, y);
  });
  ctx.restore();
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

/** Handwritten display font (Caveat, OFL) with fallbacks when it is not installed. */
export const HAND_FONT = `"Caveat", "Comic Sans MS", "Chalkboard SE", cursive`;

const HIGHLIGHTER = ["#ffd84d", "#8fd3ff", "#ffb3c7", "#b8f28c"];

/**
 * The scene's big title card: pops in, gets a highlighter stroke underneath, and fades out
 * just before the scene ends.
 */
function drawHeadline(ctx: Ctx, text: string, t: number, dur: number, stage: Stage, style: StyleId, seed: number) {
  const t0 = 0.2;
  if (t < t0) return;
  const portrait = stage.H > stage.W;
  const pop = Math.min(1, (t - t0) / 0.35);
  // Ease-out with a little overshoot.
  const c = 1.70158;
  const scale = 1 + (c + 1) * Math.pow(pop - 1, 3) + c * Math.pow(pop - 1, 2);
  const alpha = Math.min(1, (t - t0) / 0.15) * Math.min(1, Math.max(0, (dur - t) / 0.35));
  if (alpha <= 0) return;
  let size = portrait ? stage.W * 0.1 : stage.H * 0.115;
  const font = (px: number) => `700 ${Math.round(px)}px ${HAND_FONT}`;
  ctx.font = font(size);
  const maxW = stage.W * 0.86;
  const w0 = ctx.measureText(text).width;
  if (w0 > maxW) {
    size *= maxW / w0;
    ctx.font = font(size);
  }
  const w = Math.min(maxW, ctx.measureText(text).width);
  const x = stage.W / 2;
  const y = stage.H * (portrait ? 0.15 : 0.14);
  const dark = style === "classic-dark";

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(style === "sketch" || style === "cozy" ? -0.025 : 0);
  ctx.scale(scale, scale);
  // Highlighter stroke, drawn left to right after the pop.
  const sweep = Math.min(1, Math.max(0, (t - t0 - 0.3) / 0.45));
  if (sweep > 0) {
    ctx.strokeStyle = HIGHLIGHTER[seed % HIGHLIGHTER.length];
    ctx.globalAlpha = alpha * (dark ? 0.55 : 0.75);
    ctx.lineCap = "round";
    ctx.lineWidth = size * 0.32;
    ctx.beginPath();
    ctx.moveTo(-w / 2 - size * 0.1, size * 0.22);
    ctx.lineTo(-w / 2 - size * 0.1 + (w + size * 0.2) * sweep, size * 0.18);
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = dark ? "#09090b" : "#ffffff";
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = dark ? "#f4f4f5" : "#1f1a17";
  ctx.fillText(text, 0, 0);
  ctx.restore();
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

/** Subtitle with the word being spoken highlighted (karaoke style) when word timings are known. */
function drawSubtitle(ctx: Ctx, cue: SubtitleCue, t: number, stage: Stage, style: StyleId) {
  const portrait = stage.H > stage.W;
  const hand = style === "sketch";
  const size = Math.round((portrait ? stage.W * 0.045 : stage.W * 0.03) * (hand ? 1.45 : 1));
  ctx.font = hand ? `700 ${size}px ${HAND_FONT}` : `600 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.textBaseline = "middle";
  const words = cue.words?.length ? cue.words : cue.text.split(" ").map((text) => ({ text, start: cue.start, end: cue.end }));
  const current = cue.words?.length ? words.reduce((k, w, i) => (t >= w.start ? i : k), -1) : -1;
  const space = ctx.measureText(" ").width;
  const maxW = stage.W * 0.86;
  const lines: { i: number; w: number }[][] = [[]];
  let lineW = 0;
  words.forEach((wd, i) => {
    const w = ctx.measureText(wd.text).width;
    const line = lines[lines.length - 1];
    if (line.length && lineW + space + w > maxW) {
      lines.push([{ i, w }]);
      lineW = w;
    } else {
      line.push({ i, w });
      lineW += (line.length > 1 ? space : 0) + w;
    }
  });
  const widths = lines.map((l) => l.reduce((n, x) => n + x.w, 0) + space * (l.length - 1));
  const lh = size * (hand ? 1.1 : 1.3);
  const boxH = lines.length * lh + size * 0.7;
  // In the news style subtitles sit just above the ticker.
  const y0 = style === "news" ? stage.H * (1 - TICKER_H) - boxH - stage.H * 0.012 : stage.H * (portrait ? 0.86 : 0.9) - boxH / 2;
  const boxW = Math.min(maxW, Math.max(...widths)) + size * 1.2;
  if (!hand) {
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.beginPath();
    const x = (stage.W - boxW) / 2;
    const r = size * 0.4;
    ctx.moveTo(x + r, y0);
    ctx.arcTo(x + boxW, y0, x + boxW, y0 + boxH, r);
    ctx.arcTo(x + boxW, y0 + boxH, x, y0 + boxH, r);
    ctx.arcTo(x, y0 + boxH, x, y0, r);
    ctx.arcTo(x, y0, x + boxW, y0, r);
    ctx.fill();
  }
  lines.forEach((line, li) => {
    let x = (stage.W - widths[li]) / 2;
    const y = y0 + size * 0.35 + lh * (li + 0.5);
    for (const { i, w } of line) {
      const now = i === current;
      if (hand) {
        ctx.lineJoin = "round";
        ctx.lineWidth = size * 0.2;
        ctx.strokeStyle = "#fdfdfc";
        ctx.strokeText(words[i].text, x, y);
        ctx.fillStyle = now ? "#d6452f" : "#2a2a2e";
      } else ctx.fillStyle = now ? "#ffd84d" : "#ffffff";
      ctx.fillText(words[i].text, x, y);
      x += w + space;
    }
  });
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Draws the whole video at time `t` (seconds). Same code runs in the browser and in the exporter. */
export function renderFrame(ctx: Ctx, project: Project, t: number, opts: FrameOptions) {
  const stage = makeStage(opts.width, opts.height, project.settings.style);
  const { spans, total } = buildTimeline(project.scenes);
  const span = spanAt(spans, Math.min(t, total - 1e-6));
  const localT = t - span.start;
  const pal = PALETTES[project.settings.style];

  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, opts.width, opts.height);
  drawScene(ctx, project, span, localT, stage);

  // Fade in from the background colour (scene transitions) and fade out at the very end.
  let fade = 0;
  if (span.scene.transition === "fade" && localT < FADE_SEC) fade = 1 - localT / FADE_SEC;
  if (span.index === 0 && localT < FADE_SEC) fade = Math.max(fade, 1 - localT / FADE_SEC);
  if (total - t < FADE_SEC) fade = Math.max(fade, 1 - (total - t) / FADE_SEC);
  if (fade > 0) {
    ctx.globalAlpha = Math.min(1, fade);
    ctx.fillStyle = pal.line ? pal.bg : "#000000";
    ctx.fillRect(0, 0, opts.width, opts.height);
    ctx.globalAlpha = 1;
  }

  if (opts.subtitles && opts.cues) {
    const cue = cueAt(opts.cues, t);
    if (cue) drawSubtitle(ctx, cue, t, stage, project.settings.style);
  }
}
