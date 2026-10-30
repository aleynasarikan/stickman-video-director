import type { StyleId } from "../schema";

export type Ctx = CanvasRenderingContext2D;

export interface Palette {
  line: boolean; // classic styles: everything is outline-only
  bg: string;
  ink: string;
  outline: string;
  outlineWidth: number;
  headFill: string;
  limb: string;
}

export const PALETTES: Record<StyleId, Palette> = {
  cinematic: { line: false, bg: "#f3ead8", ink: "#1f1a17", outline: "#1f1a17", outlineWidth: 2.5, headFill: "#fbf6ee", limb: "#1f1a17" },
  news: { line: false, bg: "#0a1633", ink: "#1f1a17", outline: "#1f1a17", outlineWidth: 2.5, headFill: "#fbf6ee", limb: "#1f1a17" },
  sketch: { line: false, bg: "#fdfdfc", ink: "#2a2a2e", outline: "#2a2a2e", outlineWidth: 2, headFill: "#fdfdfc", limb: "#2a2a2e" },
  "classic-light": { line: true, bg: "#ffffff", ink: "#111111", outline: "#111111", outlineWidth: 3, headFill: "#ffffff", limb: "#111111" },
  "classic-dark": { line: true, bg: "#09090b", ink: "#f4f4f5", outline: "#f4f4f5", outlineWidth: 3, headFill: "#09090b", limb: "#f4f4f5" },
  "modern-pop": { line: false, bg: "#ffffff", ink: "#111111", outline: "rgba(0,0,0,0.18)", outlineWidth: 2, headFill: "#ffffff", limb: "#111111" },
  cozy: { line: false, bg: "#fff8ee", ink: "#2b2118", outline: "rgba(43,33,24,0.28)", outlineWidth: 2, headFill: "#ffffff", limb: "#2b2118" },
  prehistoric: { line: false, bg: "#efe0c2", ink: "#3b2a1a", outline: "rgba(59,42,26,0.55)", outlineWidth: 3, headFill: "#fbf6ea", limb: "#3b2a1a" },
};

/** Sketch backgrounds are drawn as light ink outlines; only figures and props get crayon colour. */
export const SKETCH_SET: Palette = { line: true, bg: "#fdfdfc", ink: "#4a4a50", outline: "#4a4a50", outlineWidth: 2, headFill: "#fdfdfc", limb: "#4a4a50" };

/** Shape helpers that respect the style: filled color shapes or outline-only drawings. */
export class Painter {
  constructor(public ctx: Ctx, public pal: Palette) {}

  private finish(fill: string) {
    const { ctx, pal } = this;
    if (pal.line) {
      ctx.fillStyle = pal.bg;
      ctx.fill();
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = pal.outlineWidth;
      ctx.stroke();
    } else {
      ctx.fillStyle = fill;
      ctx.fill();
      if (pal.outlineWidth > 0) {
        ctx.strokeStyle = pal.outline;
        ctx.lineWidth = pal.outlineWidth;
        ctx.stroke();
      }
    }
  }

  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.ctx.beginPath();
    this.ctx.rect(x, y, w, h);
    this.finish(fill);
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, fill: string) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
    this.finish(fill);
  }

  circle(x: number, y: number, r: number, fill: string) {
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.finish(fill);
  }

  ellipse(x: number, y: number, rx: number, ry: number, fill: string) {
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    this.finish(fill);
  }

  poly(points: number[], fill: string) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
    c.closePath();
    this.finish(fill);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width: number) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.strokeStyle = this.pal.line ? this.pal.ink : color;
    c.lineWidth = width;
    c.lineCap = "round";
    c.stroke();
  }

  /** Decorative fills (sky, glow, texture) that classic styles skip entirely. */
  get color(): boolean {
    return !this.pal.line;
  }
}

/** Deterministic PRNG so the same project always renders the same frames. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
