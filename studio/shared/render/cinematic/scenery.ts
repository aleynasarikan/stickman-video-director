import type { Scene } from "../../schema";
import { hashString, rng } from "../painter";
import type { Stage } from "../background";
import { INK, mix, rgba, shade } from "./color";

type C = CanvasRenderingContext2D;
type Tod = Scene["timeOfDay"];

// Painted backgrounds for the cinematic style. Everything is vector and deterministic:
// the same scene and time always produce the same pixels, in the browser and in the MP4.

const SKY: Record<Tod, [string, string, string]> = {
  day: ["#6fb3e8", "#a9d6f2", "#e8f4fa"],
  sunset: ["#5b5a9e", "#e9876a", "#ffd39a"],
  night: ["#0b1430", "#1c2c5a", "#33497a"],
};

export const INDOOR = new Set<Scene["setting"]>(["space", "room", "office", "classroom", "kitchen", "stage", "cave", "japanese-room", "egypt-temple", "castle", "dojo", "news-studio"]);

/** Where the back wall meets the floor (interiors) or the far horizon (outdoors). */
export function backLine(st: Stage): number {
  return st.groundY - st.H * 0.2;
}

function vgrad(ctx: C, y0: number, y1: number, stops: string[]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

function box(ctx: C, x: number, y: number, w: number, h: number, fill: string | CanvasGradient, ow = 2, r = 0) {
  ctx.beginPath();
  if (r) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fill();
  if (ow) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = ow;
    ctx.stroke();
  }
}

function ink(ctx: C, ow: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function speckle(ctx: C, seed: number, x: number, y: number, w: number, h: number, n: number, color: string, size: number) {
  const r = rng(seed);
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) ctx.fillRect(x + r() * w, y + r() * h, size * (0.5 + r()), size * (0.5 + r()));
}

// ---------- sky & outdoor building blocks ----------

function sky(ctx: C, st: Stage, tod: Tod, t: number, seed: number, horizon: number) {
  const [a, b, c] = SKY[tod];
  ctx.fillStyle = vgrad(ctx, -st.H * 0.3, horizon, [a, b, c]);
  ctx.fillRect(st.left, -st.H, st.right - st.left, horizon + st.H + 2);
  const r = rng(seed);
  if (tod === "night") {
    for (let i = 0; i < 70; i++) {
      const x = st.left + r() * (st.right - st.left);
      const y = r() * horizon * 0.75;
      ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + i));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
    const mx = st.W * 0.8;
    const my = st.H * 0.16;
    const glow = ctx.createRadialGradient(mx, my, 0, mx, my, st.H * 0.22);
    glow.addColorStop(0, "rgba(255,250,220,0.35)");
    glow.addColorStop(1, "rgba(255,250,220,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(mx - st.H * 0.3, my - st.H * 0.3, st.H * 0.6, st.H * 0.6);
    ctx.beginPath();
    ctx.arc(mx, my, st.H * 0.045, 0, Math.PI * 2);
    ctx.fillStyle = "#f8f3dc";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx + st.H * 0.012, my - st.H * 0.008, st.H * 0.012, 0, Math.PI * 2);
    ctx.fillStyle = "#e4dcc0";
    ctx.fill();
    return;
  }
  const sx = st.W * 0.8;
  const sy = tod === "sunset" ? horizon - st.H * 0.08 : st.H * 0.14;
  const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, st.H * 0.35);
  sun.addColorStop(0, tod === "sunset" ? "rgba(255,190,120,0.75)" : "rgba(255,250,215,0.75)");
  sun.addColorStop(1, "rgba(255,240,200,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(sx - st.H * 0.4, sy - st.H * 0.4, st.H * 0.8, st.H * 0.8);
  ctx.beginPath();
  ctx.arc(sx, sy, st.H * 0.05, 0, Math.PI * 2);
  ctx.fillStyle = tod === "sunset" ? "#ffb26b" : "#fff6cf";
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const span = st.right - st.left;
    const cx = st.left + ((r() * span + t * 8 * (1 + i * 0.4)) % span);
    cloud(ctx, cx, st.H * (0.08 + r() * 0.18), st.H * (0.035 + r() * 0.025), tod);
  }
}

function cloud(ctx: C, x: number, y: number, r: number, tod: Tod) {
  const top = tod === "sunset" ? "#ffe3c4" : "#ffffff";
  const bottom = tod === "sunset" ? "#e9a58f" : "#d9e7f2";
  ctx.fillStyle = vgrad(ctx, y - r * 1.5, y + r, [top, bottom]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x + r * 1.1, y - r * 0.55, r * 1.2, 0, Math.PI * 2);
  ctx.arc(x + r * 2.3, y - r * 0.1, r * 0.95, 0, Math.PI * 2);
  ctx.arc(x + r * 1.2, y + r * 0.2, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Rolling silhouette layer; `haze` blends it towards the sky for depth. */
function hills(ctx: C, st: Stage, base: number, amp: number, color: string, seed: number, freq = 1) {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6];
  ctx.beginPath();
  ctx.moveTo(st.left, st.H * 1.2);
  for (let x = st.left; x <= st.right; x += 12) {
    const k = (x / st.W) * freq;
    const y = base - amp * (0.55 + 0.3 * Math.sin(k * 5 + ph[0]) + 0.15 * Math.sin(k * 13 + ph[1]) + 0.08 * Math.sin(k * 29 + ph[2]));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(st.right, st.H * 1.2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function leafyTree(ctx: C, x: number, gy: number, h: number, leaf: string, seed: number, ow: number) {
  const r = rng(seed);
  const trunkW = h * 0.09;
  ctx.beginPath();
  ctx.moveTo(x - trunkW, gy);
  ctx.quadraticCurveTo(x - trunkW * 0.5, gy - h * 0.3, x - trunkW * 0.55, gy - h * 0.55);
  ctx.lineTo(x + trunkW * 0.55, gy - h * 0.55);
  ctx.quadraticCurveTo(x + trunkW * 0.5, gy - h * 0.3, x + trunkW, gy);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, gy - h * 0.6, gy, ["#6f4a2c", "#4e331f"]);
  ctx.fill();
  ink(ctx, ow);
  const blobs: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    blobs.push([x + Math.cos(a) * h * 0.2 * (0.7 + r() * 0.5), gy - h * 0.7 + Math.sin(a) * h * 0.14, h * (0.16 + r() * 0.07)]);
  }
  blobs.push([x, gy - h * 0.78, h * 0.24]);
  // Dark base layer with outline, then lit highlights.
  ctx.beginPath();
  for (const [bx, by, br] of blobs) {
    ctx.moveTo(bx + br, by);
    ctx.arc(bx, by, br, 0, Math.PI * 2);
  }
  ctx.fillStyle = shade(leaf, -0.25);
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow * 2;
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = leaf;
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    ctx.arc(bx - br * 0.12, by - br * 0.15, br * 0.82, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = shade(leaf, 0.22);
  for (const [bx, by, br] of blobs.slice(0, 5)) {
    ctx.beginPath();
    ctx.arc(bx - br * 0.3, by - br * 0.35, br * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }
}

function pine(ctx: C, x: number, gy: number, h: number, color: string, ow: number) {
  ctx.fillStyle = "#4e331f";
  ctx.fillRect(x - h * 0.03, gy - h * 0.15, h * 0.06, h * 0.15);
  for (let i = 0; i < 3; i++) {
    const w = h * (0.32 - i * 0.07);
    const y0 = gy - h * (0.12 + i * 0.25);
    ctx.beginPath();
    ctx.moveTo(x - w, y0);
    ctx.lineTo(x, y0 - h * 0.42);
    ctx.lineTo(x + w, y0);
    ctx.closePath();
    ctx.fillStyle = vgrad(ctx, y0 - h * 0.42, y0, [shade(color, 0.12), shade(color, -0.2)]);
    ctx.fill();
    if (ow) ink(ctx, ow);
  }
}

function grassGround(ctx: C, st: Stage, y0: number, base: string, seed: number, t: number) {
  ctx.fillStyle = vgrad(ctx, y0, st.H * 1.1, [shade(base, -0.1), base, shade(base, 0.12)]);
  ctx.fillRect(st.left, y0, st.right - st.left, st.H * 1.5);
  const r = rng(seed);
  ctx.strokeStyle = shade(base, -0.28);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < 260; i++) {
    const x = st.left + r() * (st.right - st.left);
    const y = y0 + Math.pow(r(), 0.8) * (st.H * 1.05 - y0);
    const h = 4 + ((y - y0) / st.H) * 22;
    const sway = Math.sin(t * 2 + x * 0.02) * 1.5;
    ctx.moveTo(x, y);
    ctx.lineTo(x + sway - 2, y - h);
    ctx.moveTo(x + 3, y);
    ctx.lineTo(x + 4 + sway, y - h * 0.8);
  }
  ctx.stroke();
  for (let i = 0; i < 26; i++) {
    const x = st.left + r() * (st.right - st.left);
    const y = y0 + st.H * 0.02 + r() * (st.H - y0);
    ctx.fillStyle = ["#ffffff", "#ffd84d", "#f472b6", "#c4b5fd"][i % 4];
    ctx.beginPath();
    ctx.arc(x, y, 3 + r() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function bench(ctx: C, x: number, gy: number, s: number, ow: number) {
  const wood = "#a0703f";
  for (const dx of [-0.42, 0.42]) box(ctx, x + dx * s - s * 0.03, gy - s * 0.28, s * 0.06, s * 0.28, "#3b3b3f", ow);
  for (let i = 0; i < 3; i++) box(ctx, x - s * 0.5, gy - s * (0.62 - i * 0.1), s, s * 0.07, wood, ow, s * 0.02);
  box(ctx, x - s * 0.52, gy - s * 0.31, s * 1.04, s * 0.07, shade(wood, 0.08), ow, s * 0.02);
}

function lampPost(ctx: C, x: number, gy: number, h: number, tod: Tod, ow: number) {
  box(ctx, x - h * 0.018, gy - h, h * 0.036, h, "#2e3238", ow);
  box(ctx, x - h * 0.05, gy - h * 0.05, h * 0.1, h * 0.05, "#2e3238", ow);
  ctx.beginPath();
  ctx.moveTo(x - h * 0.06, gy - h * 1.0);
  ctx.lineTo(x + h * 0.06, gy - h * 1.0);
  ctx.lineTo(x + h * 0.04, gy - h * 1.12);
  ctx.lineTo(x - h * 0.04, gy - h * 1.12);
  ctx.closePath();
  ctx.fillStyle = tod === "night" ? "#ffe6a3" : "#e9eef2";
  ctx.fill();
  ink(ctx, ow);
  if (tod !== "day") glow(ctx, x, gy - h * 1.06, h * 0.6, "255,214,140", 0.45);
}

function glow(ctx: C, x: number, y: number, r: number, rgb: string, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// ---------- interior building blocks ----------

function wall(ctx: C, st: Stage, y1: number, top: string, bottom: string) {
  ctx.fillStyle = vgrad(ctx, -st.H * 0.2, y1, [top, bottom]);
  ctx.fillRect(st.left, -st.H, st.right - st.left, y1 + st.H);
}

/** Wooden/tiled floor in one-point perspective. */
function floor(ctx: C, st: Stage, y0: number, base: string, kind: "wood" | "tile" | "tatami" | "stone" | "carpet") {
  const yB = st.H * 1.6;
  ctx.fillStyle = vgrad(ctx, y0, yB, [shade(base, -0.18), base, shade(base, 0.1)]);
  ctx.fillRect(st.left, y0, st.right - st.left, yB - y0 + st.H);
  const vx = st.W / 2;
  const vy = y0 - st.H * 0.9;
  const proj = (xAtY0: number, y: number) => vx + (xAtY0 - vx) * ((y - vy) / (y0 - vy));
  ctx.lineWidth = 1.5;
  if (kind === "carpet") {
    speckle(ctx, 3, st.left, y0, st.right - st.left, yB - y0, 500, rgba(shade(base, -0.3), 0.25), 2);
  } else {
    const step = kind === "wood" ? st.W * 0.07 : kind === "tatami" ? st.W * 0.16 : st.W * 0.1;
    ctx.strokeStyle = kind === "tatami" ? "#3f4a2c" : rgba(shade(base, -0.45), 0.55);
    ctx.lineWidth = kind === "tatami" ? 4 : 1.6;
    ctx.beginPath();
    for (let i = -20; i <= 20; i++) {
      const x0 = vx + i * step;
      ctx.moveTo(x0, y0);
      ctx.lineTo(proj(x0, yB), yB);
    }
    // Cross seams, spaced wider towards the viewer.
    const rows = kind === "wood" ? 7 : kind === "tatami" ? 2 : 5;
    for (let k = 1; k <= rows; k++) {
      const y = y0 + (yB - y0) * Math.pow(k / rows, 1.5);
      if (kind === "wood") {
        for (let i = -20; i <= 20; i++) {
          if ((i + k) % 3) continue;
          const xa = proj(vx + i * step, y);
          const xb = proj(vx + (i + 1) * step, y);
          ctx.moveTo(xa, y);
          ctx.lineTo(xb, y);
        }
      } else {
        ctx.moveTo(st.left, y);
        ctx.lineTo(st.right, y);
      }
    }
    ctx.stroke();
    if (kind === "wood") {
      ctx.strokeStyle = rgba("#ffffff", 0.07);
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let i = -20; i <= 20; i += 2) {
        const x0 = vx + (i + 0.5) * step;
        ctx.moveTo(x0, y0);
        ctx.lineTo(proj(x0, yB), yB);
      }
      ctx.stroke();
    }
  }
  // Contact shadow where wall meets floor.
  ctx.fillStyle = vgrad(ctx, y0, y0 + st.H * 0.05, ["rgba(0,0,0,0.28)", "rgba(0,0,0,0)"]);
  ctx.fillRect(st.left, y0, st.right - st.left, st.H * 0.05);
}

function baseboard(ctx: C, st: Stage, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(st.left, y - st.H * 0.025, st.right - st.left, st.H * 0.025);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(st.left, y - st.H * 0.025, st.right - st.left, 2);
}

function windowView(ctx: C, st: Stage, x: number, y: number, w: number, h: number, tod: Tod, t: number, frame = "#f5f1ea", curtains?: string) {
  const ow = 2.5;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const [a, b, c] = SKY[tod];
  ctx.fillStyle = vgrad(ctx, y, y + h, [a, b, c]);
  ctx.fillRect(x, y, w, h);
  if (tod === "night") speckle(ctx, 9, x, y, w, h * 0.6, 14, "#ffffff", 1.5);
  else cloud(ctx, x + ((w * 0.3 + t * 6) % (w * 1.2)) - w * 0.1, y + h * 0.3, h * 0.08, tod);
  ctx.fillStyle = tod === "night" ? "#1d2a3f" : "#7fa98a";
  ctx.beginPath();
  ctx.ellipse(x + w * 0.3, y + h * 1.0, w * 0.5, h * 0.25, 0, 0, Math.PI * 2);
  ctx.ellipse(x + w * 0.85, y + h * 1.05, w * 0.4, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const fw = Math.max(6, w * 0.05);
  ctx.strokeStyle = frame;
  ctx.lineWidth = fw;
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineWidth = fw * 0.6;
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow;
  ctx.strokeRect(x - fw / 2, y - fw / 2, w + fw, h + fw);
  box(ctx, x - fw, y + h + fw / 2, w + fw * 2, fw * 0.9, shade(frame, -0.08), ow);
  if (curtains) {
    for (const side of [0, 1]) {
      const cx = side ? x + w + fw * 0.5 : x - w * 0.22 - fw * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, y - fw * 2);
      ctx.lineTo(cx + w * 0.22, y - fw * 2);
      ctx.quadraticCurveTo(cx + w * (side ? 0.1 : 0.12), y + h * 0.6, cx + w * 0.22 * (side ? 0.6 : 1), y + h + fw * 3);
      ctx.lineTo(cx + (side ? 0 : w * 0.05), y + h + fw * 3);
      ctx.closePath();
      ctx.fillStyle = vgrad(ctx, y, y + h, [curtains, shade(curtains, -0.2)]);
      ctx.fill();
      ink(ctx, ow);
    }
    box(ctx, x - w * 0.3, y - fw * 2.6, w * 1.6, fw * 0.8, "#6b4a2c", ow, 3);
  }
  // Light falling into the room.
  if (tod !== "night") {
    ctx.fillStyle = tod === "sunset" ? "rgba(255,170,100,0.12)" : "rgba(255,250,220,0.14)";
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w * 1.6, backLine(st) + st.H * 0.12);
    ctx.lineTo(x + w * 0.4, backLine(st) + st.H * 0.12);
    ctx.closePath();
    ctx.fill();
  }
}

function frame(ctx: C, x: number, y: number, w: number, h: number, art: string, seed: number) {
  box(ctx, x, y, w, h, "#8a6a42", 2.5, 2);
  box(ctx, x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.8, art, 1.5);
  const r = rng(seed);
  ctx.fillStyle = shade(art, -0.3);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.1, y + h * 0.9);
  ctx.lineTo(x + w * (0.3 + r() * 0.2), y + h * (0.45 + r() * 0.2));
  ctx.lineTo(x + w * 0.65, y + h * 0.7);
  ctx.lineTo(x + w * 0.9, y + h * 0.5);
  ctx.lineTo(x + w * 0.9, y + h * 0.9);
  ctx.closePath();
  ctx.fill();
}

function plant(ctx: C, x: number, gy: number, s: number, ow: number) {
  ctx.beginPath();
  ctx.moveTo(x - s * 0.22, gy - s * 0.35);
  ctx.lineTo(x + s * 0.22, gy - s * 0.35);
  ctx.lineTo(x + s * 0.16, gy);
  ctx.lineTo(x - s * 0.16, gy);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, gy - s * 0.35, gy, ["#c8643b", "#9a4527"]);
  ctx.fill();
  ink(ctx, ow);
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i - 3) * 0.32;
    const len = s * (0.55 + (i % 3) * 0.12);
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * len * 0.5, gy - s * 0.35 + Math.sin(a) * len * 0.5, len * 0.5, s * 0.08, a, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 ? "#3f8f4e" : "#57a862";
    ctx.fill();
    ink(ctx, ow * 0.7);
  }
}

// ---------- settings ----------

/** Runs `fn` on the landscape set; in portrait the set is painted at the figures' scale and framed on its centre. */
function onSet(ctx: C, st: Stage, fn: (st: Stage) => void) {
  if (st.H > st.W) {
    // Portrait: props keep the same size relative to the characters as in 16:9.
    const H = st.figureH / 0.6;
    const W = (H * 16) / 9;
    const gy = H * 0.88;
    const tx = (st.W - W) / 2;
    const ty = st.groundY - gy;
    ctx.save();
    ctx.translate(tx, ty);
    fn({ W, H, groundY: gy, figureH: st.figureH, left: st.left - tx, right: st.right - tx });
    ctx.restore();
    return;
  }
  fn(st);
}

export function drawCinematicBackground(ctx: C, scene: Scene, st: Stage, t: number) {
  onSet(ctx, st, (s) => paint(ctx, scene, s, t));
}

/** Set pieces that stand in front of the characters (the news desk). */
export function drawCinematicForeground(ctx: C, scene: Scene, st: Stage) {
  if (scene.setting === "news-studio") onSet(ctx, st, (s) => newsDesk(ctx, s));
}

function paint(ctx: C, scene: Scene, st: Stage, t: number) {
  const seed = hashString(scene.id + scene.setting);
  const tod = scene.timeOfDay;
  const { W, H } = st;
  const gy = st.groundY;
  const bl = backLine(st);
  const ow = Math.max(2, H * 0.0032);
  if (paintPeriod(ctx, scene, st, t, seed)) return;

  switch (scene.setting) {
    case "blank": {
      ctx.fillStyle = vgrad(ctx, -H * 0.2, gy, ["#e7ddcb", "#f6efe2"]);
      ctx.fillRect(st.left, -H, st.right - st.left, H * 3);
      glow(ctx, W / 2, gy - H * 0.25, H * 0.8, "255,255,255", 0.5);
      ctx.fillStyle = vgrad(ctx, gy - H * 0.1, H * 1.1, ["rgba(0,0,0,0)", "rgba(120,95,60,0.18)"]);
      ctx.fillRect(st.left, gy - H * 0.1, st.right - st.left, H * 1.3);
      break;
    }

    case "park": {
      sky(ctx, st, tod, t, seed, bl);
      hills(ctx, st, bl + H * 0.02, H * 0.16, mix("#7aa874", SKY[tod][2], 0.45), seed + 1, 0.8);
      hills(ctx, st, bl + H * 0.04, H * 0.08, mix("#4f8a52", SKY[tod][2], 0.2), seed + 2, 1.6);
      grassGround(ctx, st, bl, "#79b65a", seed + 3, t);
      // Gravel path.
      ctx.fillStyle = vgrad(ctx, bl + H * 0.06, gy + H * 0.06, ["#d9c7a0", "#c9b48a"]);
      ctx.beginPath();
      ctx.moveTo(st.left, gy - H * 0.06);
      ctx.bezierCurveTo(W * 0.3, gy - H * 0.1, W * 0.7, gy - H * 0.02, st.right, gy - H * 0.07);
      ctx.lineTo(st.right, gy + H * 0.05);
      ctx.bezierCurveTo(W * 0.7, gy + H * 0.08, W * 0.3, gy + H * 0.02, st.left, gy + H * 0.06);
      ctx.closePath();
      ctx.fill();
      speckle(ctx, seed, st.left, gy - H * 0.06, st.right - st.left, H * 0.12, 160, "rgba(110,85,50,0.3)", 2);
      const r = rng(seed + 4);
      for (let x = st.left + W * 0.05; x < st.right; x += W * (0.26 + r() * 0.12)) {
        if (Math.abs(x - W * 0.5) < W * 0.12) continue;
        leafyTree(ctx, x, bl + H * 0.04, H * (0.42 + r() * 0.12), "#4f9a45", seed + Math.round(x), ow);
      }
      bench(ctx, W * 0.5, bl + H * 0.11, H * 0.22, ow);
      lampPost(ctx, W * 0.84, bl + H * 0.1, H * 0.42, tod, ow);
      break;
    }

    case "forest": {
      sky(ctx, st, tod, t, seed, bl);
      const far = mix("#3e6b4a", SKY[tod][1], 0.55);
      const r = rng(seed);
      for (let x = st.left; x < st.right; x += W * 0.045) pine(ctx, x + r() * 20, bl + H * 0.02, H * (0.35 + r() * 0.15), far, 0);
      ctx.fillStyle = rgba(SKY[tod][2], 0.35);
      ctx.fillRect(st.left, bl - H * 0.3, st.right - st.left, H * 0.35);
      for (let x = st.left; x < st.right; x += W * 0.09) pine(ctx, x + r() * 30, bl + H * 0.06, H * (0.45 + r() * 0.2), "#2f5f3a", ow);
      grassGround(ctx, st, bl + H * 0.05, "#5d8f45", seed + 1, t);
      // Light shafts
      if (tod !== "night") {
        ctx.fillStyle = "rgba(255,248,210,0.12)";
        for (let i = 0; i < 4; i++) {
          const x = W * (0.15 + i * 0.25);
          ctx.beginPath();
          ctx.moveTo(x, -H * 0.1);
          ctx.lineTo(x + W * 0.06, -H * 0.1);
          ctx.lineTo(x + W * 0.2, gy);
          ctx.lineTo(x + W * 0.08, gy);
          ctx.closePath();
          ctx.fill();
        }
      }
      for (let x = st.left + W * 0.1; x < st.right; x += W * 0.55) leafyTree(ctx, x, gy - H * 0.04, H * 0.62, "#3f7f3a", seed + Math.round(x), ow);
      break;
    }

    case "beach": {
      const sea = bl - H * 0.04;
      sky(ctx, st, tod, t, seed, sea);
      ctx.fillStyle = vgrad(ctx, sea, bl + H * 0.06, tod === "night" ? ["#13254a", "#1d3a66"] : tod === "sunset" ? ["#6c6aa8", "#e59a7a"] : ["#2f8fcf", "#5fc2e6"]);
      ctx.fillRect(st.left, sea, st.right - st.left, H * 0.2);
      ctx.fillStyle = mix("#6e8f7a", SKY[tod][1], 0.5);
      ctx.beginPath();
      ctx.ellipse(W * 0.2, sea + 2, W * 0.12, H * 0.035, 0, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        const y = sea + H * 0.015 + i * H * 0.016;
        for (let x = st.left; x < st.right; x += 18) {
          const yy = y + Math.sin(x / 35 + t * 1.8 + i) * 2;
          if (x === st.left) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      const sand = bl + H * 0.06;
      ctx.fillStyle = vgrad(ctx, sand, H * 1.1, ["#e9cf98", "#f3dfb0"]);
      ctx.beginPath();
      ctx.moveTo(st.left, sand);
      for (let x = st.left; x <= st.right; x += 20) ctx.lineTo(x, sand + Math.sin(x / 60 + t * 1.2) * 4);
      ctx.lineTo(st.right, H * 2);
      ctx.lineTo(st.left, H * 2);
      ctx.closePath();
      ctx.fill();
      speckle(ctx, seed, st.left, sand, st.right - st.left, H - sand + H * 0.1, 260, "rgba(150,110,60,0.25)", 2);
      // Palm tree
      const px = W * 0.12;
      ctx.beginPath();
      ctx.moveTo(px - 10, gy);
      ctx.quadraticCurveTo(px + W * 0.02, gy - H * 0.35, px + W * 0.06, gy - H * 0.6);
      ctx.lineTo(px + W * 0.075, gy - H * 0.6);
      ctx.quadraticCurveTo(px + W * 0.04, gy - H * 0.35, px + 10, gy);
      ctx.closePath();
      ctx.fillStyle = "#8a6238";
      ctx.fill();
      ink(ctx, ow);
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI + i * 0.55 + Math.sin(t * 1.5 + i) * 0.04;
        ctx.beginPath();
        ctx.ellipse(px + W * 0.068 + Math.cos(a) * H * 0.1, gy - H * 0.6 + Math.sin(a) * H * 0.05 + H * 0.03, H * 0.12, H * 0.03, a, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 ? "#3f8f4e" : "#4fa85a";
        ctx.fill();
        ink(ctx, ow);
      }
      // Umbrella
      const ux = W * 0.86;
      box(ctx, ux - 3, gy - H * 0.42, 6, H * 0.42, "#e9e3d8", ow);
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(ux, gy - H * 0.46);
        ctx.arc(ux, gy - H * 0.36, H * 0.16, Math.PI + (i * Math.PI) / 6, Math.PI + ((i + 1) * Math.PI) / 6);
        ctx.closePath();
        ctx.fillStyle = i % 2 ? "#ffffff" : "#e2483d";
        ctx.fill();
        ink(ctx, ow);
      }
      break;
    }

    case "mountain": {
      sky(ctx, st, tod, t, seed, bl);
      const ranges = [
        { base: bl + H * 0.02, amp: H * 0.5, col: mix("#7f8fb0", SKY[tod][2], 0.45), seed: seed + 1 },
        { base: bl + H * 0.04, amp: H * 0.34, col: mix("#5f7393", SKY[tod][2], 0.2), seed: seed + 2 },
      ];
      for (const rg of ranges) {
        const r = rng(rg.seed);
        for (let x = st.left - W * 0.2; x < st.right + W * 0.2; x += W * (0.32 + r() * 0.15)) {
          const h = rg.amp * (0.7 + r() * 0.4);
          const w = W * (0.25 + r() * 0.12);
          ctx.beginPath();
          ctx.moveTo(x - w, rg.base);
          ctx.lineTo(x, rg.base - h);
          ctx.lineTo(x + w, rg.base);
          ctx.closePath();
          ctx.fillStyle = rg.col;
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(x, rg.base - h);
          ctx.lineTo(x + w, rg.base);
          ctx.lineTo(x + w * 0.1, rg.base);
          ctx.closePath();
          ctx.fillStyle = "rgba(20,25,50,0.18)";
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(x - w * 0.22, rg.base - h * 0.78);
          ctx.lineTo(x, rg.base - h);
          ctx.lineTo(x + w * 0.22, rg.base - h * 0.78);
          ctx.lineTo(x + w * 0.08, rg.base - h * 0.82);
          ctx.lineTo(x - w * 0.05, rg.base - h * 0.74);
          ctx.closePath();
          ctx.fillStyle = "#f4f7fb";
          ctx.fill();
        }
      }
      for (let x = st.left; x < st.right; x += W * 0.06) pine(ctx, x, bl + H * 0.07, H * 0.16, "#3d6b45", 0);
      grassGround(ctx, st, bl + H * 0.06, "#86b062", seed + 3, t);
      break;
    }

    case "desert": {
      sky(ctx, st, tod === "night" ? "night" : tod === "sunset" ? "sunset" : "day", t, seed, bl);
      const pyr = (x: number, w: number, h: number, haze: number) => {
        ctx.beginPath();
        ctx.moveTo(x - w, bl + H * 0.02);
        ctx.lineTo(x, bl + H * 0.02 - h);
        ctx.lineTo(x + w, bl + H * 0.02);
        ctx.closePath();
        ctx.fillStyle = mix("#e2bc78", SKY[tod][2], haze);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, bl + H * 0.02 - h);
        ctx.lineTo(x + w, bl + H * 0.02);
        ctx.lineTo(x, bl + H * 0.02);
        ctx.closePath();
        ctx.fillStyle = mix("#b58a4f", SKY[tod][2], haze);
        ctx.fill();
      };
      pyr(W * 0.25, W * 0.16, H * 0.26, 0.45);
      pyr(W * 0.48, W * 0.1, H * 0.16, 0.5);
      pyr(W * 0.72, W * 0.2, H * 0.32, 0.35);
      hills(ctx, st, bl + H * 0.06, H * 0.06, "#e4c28a", seed + 1, 0.7);
      hills(ctx, st, gy + H * 0.02, H * 0.08, "#ebcf98", seed + 2, 0.5);
      ctx.fillStyle = vgrad(ctx, gy, H * 1.1, ["#ebcf98", "#f2dcae"]);
      ctx.fillRect(st.left, gy, st.right - st.left, H * 2);
      ctx.strokeStyle = "rgba(160,110,50,0.25)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        const y = bl + H * 0.08 + i * H * 0.03;
        for (let x = st.left; x < st.right; x += 24) ctx.lineTo(x, y + Math.sin(x / 50 + i) * 3);
        ctx.stroke();
      }
      break;
    }

    case "street":
    case "city":
    case "village": {
      sky(ctx, st, tod, t, seed, bl);
      const r = rng(seed + 1);
      const night = tod === "night";
      if (scene.setting === "city") {
        for (let x = st.left; x < st.right; x += W * 0.05) {
          const h = H * (0.25 + r() * 0.35);
          ctx.fillStyle = mix("#6d7f9e", SKY[tod][2], 0.45);
          ctx.fillRect(x, bl - h, W * 0.048, h + 5);
        }
      } else {
        hills(ctx, st, bl, H * 0.12, mix("#6f9a6a", SKY[tod][2], 0.45), seed + 2, 0.9);
      }
      const sidewalk = gy - H * 0.06;
      for (let x = st.left; x < st.right; ) {
        const bw = W * (scene.setting === "village" ? 0.2 : 0.14) * (0.8 + r() * 0.5);
        const bh = H * (scene.setting === "city" ? 0.55 + r() * 0.3 : scene.setting === "village" ? 0.3 + r() * 0.1 : 0.38 + r() * 0.2);
        building(ctx, x + 4, sidewalk, bw - 8, bh, scene.setting, r, night, ow, t);
        x += bw;
      }
      if (scene.setting === "village") {
        grassGround(ctx, st, sidewalk, "#88b060", seed + 5, t);
        ctx.fillStyle = vgrad(ctx, sidewalk, H * 1.1, ["#b89a6a", "#cdb488"]);
        ctx.beginPath();
        ctx.moveTo(st.left, gy - H * 0.03);
        ctx.lineTo(st.right, gy - H * 0.03);
        ctx.lineTo(st.right, H * 1.2);
        ctx.lineTo(st.left, H * 1.2);
        ctx.fill();
        speckle(ctx, seed, st.left, gy - H * 0.03, st.right - st.left, H * 0.3, 200, "rgba(90,70,40,0.3)", 2.5);
        // Well
        const wx = W * 0.82;
        box(ctx, wx - H * 0.08, gy - H * 0.13, H * 0.16, H * 0.1, "#9a9285", ow, 4);
        speckle(ctx, 5, wx - H * 0.08, gy - H * 0.13, H * 0.16, H * 0.1, 30, "rgba(0,0,0,0.25)", 3);
        box(ctx, wx - H * 0.075, gy - H * 0.3, H * 0.015, H * 0.17, "#6b4a2c", ow);
        box(ctx, wx + H * 0.06, gy - H * 0.3, H * 0.015, H * 0.17, "#6b4a2c", ow);
        ctx.beginPath();
        ctx.moveTo(wx - H * 0.11, gy - H * 0.28);
        ctx.lineTo(wx, gy - H * 0.36);
        ctx.lineTo(wx + H * 0.11, gy - H * 0.28);
        ctx.closePath();
        ctx.fillStyle = "#a8432f";
        ctx.fill();
        ink(ctx, ow);
      } else {
        ctx.fillStyle = vgrad(ctx, sidewalk, gy + H * 0.03, ["#c9c6bf", "#b5b1a8"]);
        ctx.fillRect(st.left, sidewalk, st.right - st.left, gy + H * 0.03 - sidewalk);
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = st.left; x < st.right; x += W * 0.06) {
          ctx.moveTo(x, sidewalk);
          ctx.lineTo(x - W * 0.02, gy + H * 0.03);
        }
        ctx.stroke();
        box(ctx, st.left, gy + H * 0.03, st.right - st.left, H * 0.015, "#8f8b84", 0);
        ctx.fillStyle = vgrad(ctx, gy + H * 0.045, H * 1.1, ["#4a4d52", "#5d6066"]);
        ctx.fillRect(st.left, gy + H * 0.045, st.right - st.left, H);
        ctx.fillStyle = "#e9e3c8";
        for (let x = st.left; x < st.right; x += W * 0.12) ctx.fillRect(x, gy + H * 0.11, W * 0.06, H * 0.008);
        for (let x = st.left + W * 0.22; x < st.right; x += W * 0.5) lampPost(ctx, x, sidewalk + H * 0.02, H * 0.45, tod, ow);
      }
      break;
    }

    case "room":
    case "office":
    case "classroom":
    case "kitchen": {
      const wallCol = { room: ["#f1d9b5", "#e3c39a"], office: ["#e3e8ec", "#cfd6dc"], classroom: ["#f0e6c4", "#e2d3a6"], kitchen: ["#f6eedd", "#e9dcc2"] }[scene.setting];
      wall(ctx, st, bl, wallCol[0], wallCol[1]);
      if (scene.setting === "room") {
        ctx.fillStyle = "rgba(160,110,70,0.08)";
        for (let x = st.left; x < st.right; x += W * 0.04) ctx.fillRect(x, -H, W * 0.018, bl + H);
      }
      if (scene.setting === "classroom") box(ctx, st.left, bl - H * 0.18, st.right - st.left, H * 0.18, "#b98a58", ow);
      if (scene.setting === "kitchen") {
        ctx.fillStyle = "#dfeef0";
        ctx.fillRect(st.left, bl - H * 0.32, st.right - st.left, H * 0.14);
        ctx.strokeStyle = "rgba(80,110,120,0.35)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = st.left; x < st.right; x += H * 0.035) {
          ctx.moveTo(x, bl - H * 0.32);
          ctx.lineTo(x, bl - H * 0.18);
        }
        for (let y = bl - H * 0.32; y < bl - H * 0.18; y += H * 0.035) {
          ctx.moveTo(st.left, y);
          ctx.lineTo(st.right, y);
        }
        ctx.stroke();
      }
      baseboard(ctx, st, bl, scene.setting === "office" ? "#9aa3ab" : "#8a6440");
      const winX = W * 0.66;
      const winW = W * 0.2;
      if (scene.setting === "office") {
        // Floor-to-ceiling glass with a skyline.
        ctx.save();
        ctx.beginPath();
        ctx.rect(W * 0.04, H * 0.06, W * 0.36, bl - H * 0.1);
        ctx.clip();
        const [a, b, c] = SKY[tod];
        ctx.fillStyle = vgrad(ctx, H * 0.06, bl, [a, b, c]);
        ctx.fillRect(W * 0.04, H * 0.06, W * 0.36, bl);
        const r = rng(seed);
        for (let x = W * 0.04; x < W * 0.4; x += W * 0.035) {
          const h = H * (0.15 + r() * 0.3);
          ctx.fillStyle = mix("#5f6f8c", c, 0.35);
          ctx.fillRect(x, bl - H * 0.04 - h, W * 0.032, h);
          if (tod === "night") speckle(ctx, Math.round(x), x, bl - H * 0.04 - h, W * 0.03, h, 8, "#ffe08a", 3);
        }
        ctx.restore();
        ctx.strokeStyle = "#7b858f";
        ctx.lineWidth = 8;
        ctx.strokeRect(W * 0.04, H * 0.06, W * 0.36, bl - H * 0.1);
        ctx.beginPath();
        ctx.moveTo(W * 0.16, H * 0.06);
        ctx.lineTo(W * 0.16, bl - H * 0.04);
        ctx.moveTo(W * 0.28, H * 0.06);
        ctx.lineTo(W * 0.28, bl - H * 0.04);
        ctx.lineWidth = 5;
        ctx.stroke();
        // Desk with monitor
        const dx = W * 0.68;
        const dy = bl + H * 0.02;
        box(ctx, dx - W * 0.14, dy - H * 0.17, W * 0.28, H * 0.03, "#8a6a4a", ow, 3);
        box(ctx, dx - W * 0.13, dy - H * 0.14, W * 0.012, H * 0.14, "#5a4632", ow);
        box(ctx, dx + W * 0.118, dy - H * 0.14, W * 0.012, H * 0.14, "#5a4632", ow);
        box(ctx, dx - W * 0.06, dy - H * 0.34, W * 0.12, H * 0.15, "#2d3440", ow, 4);
        ctx.fillStyle = vgrad(ctx, dy - H * 0.33, dy - H * 0.2, ["#7fd3f0", "#4aa3d8"]);
        ctx.fillRect(dx - W * 0.052, dy - H * 0.325, W * 0.104, H * 0.125);
        box(ctx, dx - W * 0.01, dy - H * 0.19, W * 0.02, H * 0.02, "#2d3440", ow);
        plant(ctx, W * 0.93, bl + H * 0.02, H * 0.2, ow);
        // Shelf
        box(ctx, W * 0.46, H * 0.18, W * 0.14, H * 0.012, "#6b4a2c", ow);
        ["#c0392b", "#2f6fd6", "#16a34a", "#d97706", "#7c3aed"].forEach((c, i) => box(ctx, W * 0.47 + i * W * 0.025, H * 0.1, W * 0.02, H * 0.08, c, 1.5));
      } else {
        windowView(ctx, st, winX, H * 0.12, winW, H * 0.3, tod, t, "#f7f2ea", scene.setting === "room" ? "#b5584a" : undefined);
      }
      if (scene.setting === "room") {
        frame(ctx, W * 0.14, H * 0.14, W * 0.12, H * 0.16, "#8fb8c9", seed);
        frame(ctx, W * 0.3, H * 0.2, W * 0.07, H * 0.1, "#e9c46a", seed + 1);
        // Sofa against the wall
        const sx = W * 0.27;
        const sy = bl + H * 0.03;
        box(ctx, sx - W * 0.16, sy - H * 0.25, W * 0.32, H * 0.14, "#4f7c8f", ow, 14);
        box(ctx, sx - W * 0.18, sy - H * 0.14, W * 0.36, H * 0.12, "#5d8ea3", ow, 10);
        box(ctx, sx - W * 0.2, sy - H * 0.2, W * 0.045, H * 0.18, "#4f7c8f", ow, 10);
        box(ctx, sx + W * 0.155, sy - H * 0.2, W * 0.045, H * 0.18, "#4f7c8f", ow, 10);
        box(ctx, sx - W * 0.1, sy - H * 0.22, W * 0.07, H * 0.07, "#e9c46a", ow, 8);
        plant(ctx, W * 0.9, bl + H * 0.03, H * 0.22, ow);
        // Floor lamp
        box(ctx, W * 0.53, bl - H * 0.32, 5, H * 0.34, "#3a3a3a", ow);
        ctx.beginPath();
        ctx.moveTo(W * 0.505, bl - H * 0.32);
        ctx.lineTo(W * 0.56, bl - H * 0.32);
        ctx.lineTo(W * 0.548, bl - H * 0.4);
        ctx.lineTo(W * 0.517, bl - H * 0.4);
        ctx.closePath();
        ctx.fillStyle = "#f3e2b0";
        ctx.fill();
        ink(ctx, ow);
        if (tod !== "day") glow(ctx, W * 0.532, bl - H * 0.34, H * 0.35, "255,210,140", 0.4);
      }
      if (scene.setting === "classroom") {
        box(ctx, W * 0.12, H * 0.1, W * 0.44, H * 0.3, "#2f5d47", ow * 1.5, 4);
        ctx.strokeStyle = "#8a6440";
        ctx.lineWidth = 10;
        ctx.strokeRect(W * 0.12, H * 0.1, W * 0.44, H * 0.3);
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(W * 0.16, H * 0.17);
        ctx.lineTo(W * 0.3, H * 0.17);
        ctx.moveTo(W * 0.16, H * 0.23);
        ctx.lineTo(W * 0.38, H * 0.23);
        ctx.moveTo(W * 0.16, H * 0.29);
        ctx.lineTo(W * 0.26, H * 0.29);
        ctx.arc(W * 0.46, H * 0.25, H * 0.06, 0, Math.PI * 2);
        ctx.moveTo(W * 0.4, H * 0.25);
        ctx.lineTo(W * 0.52, H * 0.25);
        ctx.stroke();
        box(ctx, W * 0.12, H * 0.4, W * 0.44, H * 0.015, "#8a6440", ow);
        ctx.beginPath();
        ctx.arc(W * 0.9, H * 0.12, H * 0.05, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ink(ctx, ow);
        ctx.beginPath();
        ctx.moveTo(W * 0.9, H * 0.12);
        ctx.lineTo(W * 0.9, H * 0.09);
        ctx.moveTo(W * 0.9, H * 0.12);
        ctx.lineTo(W * 0.92, H * 0.13);
        ink(ctx, ow);
      }
      if (scene.setting === "kitchen") {
        for (let i = 0; i < 4; i++) {
          box(ctx, W * 0.04 + i * W * 0.11, H * 0.06, W * 0.1, H * 0.16, "#7aa7a6", ow, 4);
          box(ctx, W * 0.085 + i * W * 0.11, H * 0.18, W * 0.012, H * 0.03, "#d8d2c4", 1.5, 2);
        }
        box(ctx, W * 0.03, bl - H * 0.18, W * 0.46, H * 0.025, "#d9d2c3", ow, 3);
        for (let i = 0; i < 4; i++) box(ctx, W * 0.04 + i * W * 0.11, bl - H * 0.155, W * 0.1, H * 0.15, "#7aa7a6", ow, 3);
        box(ctx, W * 0.17, bl - H * 0.21, W * 0.06, H * 0.035, "#6b6f75", ow, 6);
        box(ctx, W * 0.32, bl - H * 0.2, W * 0.08, H * 0.02, "#c89b62", ow, 3);
        box(ctx, W * 0.83, bl - H * 0.52, W * 0.13, H * 0.54, "#eef1f3", ow, 10);
        box(ctx, W * 0.84, bl - H * 0.36, W * 0.11, 3, "#b8c0c8", 0);
        box(ctx, W * 0.845, bl - H * 0.47, W * 0.008, H * 0.07, "#9aa3ab", 1.5, 3);
      }
      floor(ctx, st, bl, { room: "#b07c4f", office: "#8e959c", classroom: "#b88c5c", kitchen: "#d9cdb8" }[scene.setting], scene.setting === "office" ? "carpet" : scene.setting === "kitchen" ? "tile" : "wood");
      if (scene.setting === "room") {
        ctx.beginPath();
        ctx.ellipse(W * 0.5, gy - H * 0.01, W * 0.32, H * 0.06, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#b5584a";
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(W * 0.5, gy - H * 0.01, W * 0.29, H * 0.045, 0, 0, Math.PI * 2);
        ctx.strokeStyle = "#e9c46a";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (tod === "night") {
        ctx.fillStyle = "rgba(15,20,45,0.32)";
        ctx.fillRect(st.left, -H, st.right - st.left, H * 3);
      }
      break;
    }

    case "japanese-room": {
      // Glowing shoji screens between dark timber posts, tatami floor.
      const paperLit = tod === "night" ? ["#c9a86a", "#a8834a"] : tod === "sunset" ? ["#fbe0b6", "#efc792"] : ["#f8f1e2", "#ebdfc6"];
      wall(ctx, st, bl, paperLit[0], paperLit[1]);
      const top = H * 0.06;
      const post = W * 0.022;
      const bay = W * 0.2;
      ctx.strokeStyle = "#5a3d26";
      ctx.lineWidth = Math.max(2, W * 0.004);
      ctx.beginPath();
      for (let x = st.left; x < st.right; x += bay / 4) {
        ctx.moveTo(x, top);
        ctx.lineTo(x, bl - H * 0.07);
      }
      for (let y = top; y < bl - H * 0.07; y += (bl - top) / 6) {
        ctx.moveTo(st.left, y);
        ctx.lineTo(st.right, y);
      }
      ctx.stroke();
      if (tod !== "night") {
        // Soft shadow of a branch on the paper.
        ctx.strokeStyle = "rgba(90,70,50,0.18)";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(W * 0.62, top);
        ctx.quadraticCurveTo(W * 0.7, H * 0.2, W * 0.9, H * 0.28);
        ctx.moveTo(W * 0.72, H * 0.17);
        ctx.lineTo(W * 0.76, H * 0.1);
        ctx.stroke();
        speckle(ctx, seed, W * 0.66, H * 0.12, W * 0.25, H * 0.2, 40, "rgba(90,70,50,0.14)", 9);
      }
      for (let x = st.left; x < st.right; x += bay) box(ctx, x - post / 2, -H, post, bl + H, vgrad(ctx, 0, bl, ["#6b4528", "#4e321d"]), ow);
      box(ctx, st.left, -H, st.right - st.left, top + H, "#4e321d", ow);
      box(ctx, st.left, top - H * 0.02, st.right - st.left, H * 0.03, "#6b4528", ow);
      box(ctx, st.left, bl - H * 0.07, st.right - st.left, H * 0.07, vgrad(ctx, bl - H * 0.07, bl, ["#7a5434", "#5a3d26"]), ow);
      // Tatami
      floor(ctx, st, bl, "#cbbf86", "tatami");
      speckle(ctx, seed + 1, st.left, bl, st.right - st.left, H * 0.4, 400, "rgba(120,110,60,0.18)", 2);
      // Low table, scroll, lantern
      const tx = W * 0.52;
      box(ctx, tx - W * 0.12, gy - H * 0.09, W * 0.24, H * 0.025, "#6b4528", ow, 3);
      box(ctx, tx - W * 0.1, gy - H * 0.065, W * 0.015, H * 0.06, "#4e321d", ow);
      box(ctx, tx + W * 0.085, gy - H * 0.065, W * 0.015, H * 0.06, "#4e321d", ow);
      box(ctx, tx - W * 0.03, gy - H * 0.105, W * 0.06, H * 0.016, "#3a2a1c", ow, 2);
      box(ctx, W * 0.07, H * 0.12, W * 0.07, H * 0.3, "#efe6cf", ow, 2);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(W * 0.105, H * 0.17);
      ctx.lineTo(W * 0.105, H * 0.32);
      ctx.moveTo(W * 0.095, H * 0.2);
      ctx.lineTo(W * 0.118, H * 0.22);
      ctx.stroke();
      box(ctx, W * 0.065, H * 0.11, W * 0.08, H * 0.015, "#4e321d", ow);
      const lx = W * 0.88;
      box(ctx, lx - H * 0.05, bl - H * 0.2, H * 0.1, H * 0.17, tod === "day" ? "#f5ead2" : "#ffd98a", ow, 3);
      ctx.strokeStyle = "#4e321d";
      ctx.lineWidth = 3;
      ctx.strokeRect(lx - H * 0.05, bl - H * 0.2, H * 0.1, H * 0.17);
      if (tod !== "day") glow(ctx, lx, bl - H * 0.12, H * 0.4, "255,200,120", 0.5);
      // Katana on the floor rack
      ctx.lineCap = "round";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(W * 0.22, gy - H * 0.035);
      ctx.lineTo(W * 0.38, gy - H * 0.055);
      ctx.stroke();
      ctx.strokeStyle = "#d9dde2";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(W * 0.25, gy - H * 0.039);
      ctx.lineTo(W * 0.38, gy - H * 0.055);
      ctx.stroke();
      if (tod === "night") {
        ctx.fillStyle = "rgba(15,20,45,0.3)";
        ctx.fillRect(st.left, -H, st.right - st.left, H * 3);
      }
      break;
    }

    case "egypt-temple": {
      // Sunlit sandstone court with painted columns and a view to palms.
      sky(ctx, st, tod, t, seed, bl);
      ctx.fillStyle = mix("#e8c98f", SKY[tod][2], 0.35);
      ctx.fillRect(st.left, bl - H * 0.08, st.right - st.left, H * 0.1);
      for (const px of [W * 0.42, W * 0.58]) {
        ctx.fillStyle = "#7a5a34";
        ctx.fillRect(px - 4, bl - H * 0.3, 8, H * 0.24);
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI + i * 0.6;
          ctx.beginPath();
          ctx.ellipse(px + Math.cos(a) * H * 0.06, bl - H * 0.3 + Math.sin(a) * H * 0.025 + H * 0.01, H * 0.07, H * 0.018, a, 0, Math.PI * 2);
          ctx.fillStyle = "#4f8f4e";
          ctx.fill();
        }
      }
      const stone = ["#e2c28c", "#d4ad72"];
      const wallSeg = (x0: number, x1: number, y1 = bl) => {
        ctx.fillStyle = vgrad(ctx, -H * 0.2, bl, stone);
        ctx.fillRect(x0, -H, x1 - x0, y1 + H);
        ctx.strokeStyle = "rgba(120,80,40,0.35)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let y = -H + ((H * 1000) % (H * 0.07)), row = 0; y < y1; y += H * 0.07, row++) {
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
          for (let x = x0 + (row % 2) * W * 0.04; x < x1; x += W * 0.08) {
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + H * 0.07);
          }
        }
        ctx.stroke();
        speckle(ctx, Math.round(x0), x0, -H, x1 - x0, y1 + H, 160, "rgba(130,90,40,0.2)", 3);
      };
      wallSeg(st.left, W * 0.3);
      wallSeg(W * 0.7, st.right);
      wallSeg(W * 0.3, W * 0.7, 0);
      // Lintel over the opening.
      box(ctx, W * 0.28, H * 0.0, W * 0.44, H * 0.1, vgrad(ctx, 0, H * 0.1, ["#d8b47c", "#c49c62"]), ow);
      ctx.fillStyle = "#2f8f8a";
      ctx.fillRect(W * 0.28, H * 0.075, W * 0.44, H * 0.012);
      // Hieroglyph panels
      const glyphs = (x: number, y: number, w: number, h: number) => {
        box(ctx, x, y, w, h, "rgba(200,160,100,0.45)", 1.5);
        ctx.strokeStyle = "#6b4a2c";
        ctx.fillStyle = "#6b4a2c";
        ctx.lineWidth = 2.5;
        const r = rng(Math.round(x));
        for (let j = 0; j < 4; j++) {
          const gx = x + w * 0.5;
          const gy2 = y + h * (0.14 + j * 0.23);
          const s = w * 0.22;
          ctx.beginPath();
          switch (Math.floor(r() * 4)) {
            case 0: // eye
              ctx.ellipse(gx, gy2, s, s * 0.45, 0, 0, Math.PI * 2);
              ctx.moveTo(gx + s * 0.25, gy2);
              ctx.arc(gx, gy2, s * 0.25, 0, Math.PI * 2);
              break;
            case 1: // ankh
              ctx.ellipse(gx, gy2 - s * 0.5, s * 0.3, s * 0.4, 0, 0, Math.PI * 2);
              ctx.moveTo(gx, gy2 - s * 0.1);
              ctx.lineTo(gx, gy2 + s);
              ctx.moveTo(gx - s * 0.6, gy2);
              ctx.lineTo(gx + s * 0.6, gy2);
              break;
            case 2: // water
              for (let k = -2; k <= 2; k++) ctx.lineTo(gx + k * s * 0.4, gy2 + (k % 2 ? -1 : 1) * s * 0.2);
              break;
            default: // bird
              ctx.ellipse(gx, gy2, s * 0.5, s * 0.3, -0.2, 0, Math.PI * 2);
              ctx.moveTo(gx + s * 0.4, gy2 - s * 0.2);
              ctx.lineTo(gx + s * 0.8, gy2 - s * 0.05);
          }
          ctx.stroke();
        }
      };
      glyphs(W * 0.04, H * 0.12, W * 0.07, H * 0.38);
      glyphs(W * 0.82, H * 0.12, W * 0.07, H * 0.38);
      // Columns
      const column = (x: number) => {
        const w = W * 0.075;
        box(ctx, x - w / 2, H * 0.08, w, bl - H * 0.06, vgrad(ctx, 0, bl, ["#e9cf9c", "#d1ad74"]), ow);
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.fillRect(x + w * 0.18, H * 0.08, w * 0.32, bl - H * 0.06);
        [[0.18, "#2f8f8a"], [0.22, "#c0392b"], [0.26, "#d4a537"], [0.7, "#2f8f8a"], [0.74, "#d4a537"]].forEach(([k, c]) => {
          ctx.fillStyle = c as string;
          ctx.fillRect(x - w / 2, H * 0.08 + (bl - H * 0.06) * (k as number), w, H * 0.018);
        });
        ctx.beginPath();
        ctx.moveTo(x - w * 0.5, H * 0.08);
        ctx.quadraticCurveTo(x - w * 1.0, H * 0.02, x - w * 0.9, -H * 0.02);
        ctx.lineTo(x + w * 0.9, -H * 0.02);
        ctx.quadraticCurveTo(x + w * 1.0, H * 0.02, x + w * 0.5, H * 0.08);
        ctx.closePath();
        ctx.fillStyle = "#4f9a8f";
        ctx.fill();
        ink(ctx, ow);
        box(ctx, x - w * 0.62, bl - H * 0.03, w * 1.24, H * 0.05, "#c9a46c", ow);
      };
      column(W * 0.25);
      column(W * 0.75);
      floor(ctx, st, bl, "#d8b77f", "stone");
      // Sun patch through the opening.
      ctx.fillStyle = tod === "night" ? "rgba(140,160,220,0.1)" : "rgba(255,240,190,0.25)";
      ctx.beginPath();
      ctx.moveTo(W * 0.3, bl);
      ctx.lineTo(W * 0.7, bl);
      ctx.lineTo(W * 0.85, H * 1.1);
      ctx.lineTo(W * 0.35, H * 1.1);
      ctx.closePath();
      ctx.fill();
      // Clay jar
      const jx = W * 0.1;
      ctx.beginPath();
      ctx.moveTo(jx - H * 0.03, gy - H * 0.2);
      ctx.quadraticCurveTo(jx - H * 0.09, gy - H * 0.1, jx - H * 0.04, gy);
      ctx.lineTo(jx + H * 0.04, gy);
      ctx.quadraticCurveTo(jx + H * 0.09, gy - H * 0.1, jx + H * 0.03, gy - H * 0.2);
      ctx.closePath();
      ctx.fillStyle = vgrad(ctx, gy - H * 0.2, gy, ["#c06a3e", "#8f4527"]);
      ctx.fill();
      ink(ctx, ow);
      if (tod === "night") {
        ctx.fillStyle = "rgba(15,20,50,0.35)";
        ctx.fillRect(st.left, -H, st.right - st.left, H * 3);
      }
      break;
    }

    case "castle": {
      wall(ctx, st, bl, "#8d8a85", "#6f6b66");
      const r = rng(seed);
      for (let y = -H * 0.1, row = 0; y < bl; y += H * 0.08, row++) {
        for (let x = st.left + (row % 2) * W * 0.05; x < st.right; x += W * 0.1) {
          ctx.fillStyle = mix("#8d8a85", "#6a655e", r());
          ctx.beginPath();
          ctx.roundRect(x + 2, y + 2, W * 0.1 - 4, H * 0.08 - 4, 6);
          ctx.fill();
        }
      }
      // Arched window
      const ax = W * 0.5;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ax - W * 0.06, bl - H * 0.25);
      ctx.lineTo(ax - W * 0.06, H * 0.2);
      ctx.arc(ax, H * 0.2, W * 0.06, Math.PI, 0);
      ctx.lineTo(ax + W * 0.06, bl - H * 0.25);
      ctx.closePath();
      ctx.fillStyle = vgrad(ctx, H * 0.1, bl, SKY[tod]);
      ctx.fill();
      ink(ctx, ow * 2);
      ctx.restore();
      // Banners and torches
      for (const bx of [W * 0.2, W * 0.8]) {
        ctx.beginPath();
        ctx.moveTo(bx - W * 0.05, H * 0.05);
        ctx.lineTo(bx + W * 0.05, H * 0.05);
        ctx.lineTo(bx + W * 0.05, H * 0.42);
        ctx.lineTo(bx, H * 0.37);
        ctx.lineTo(bx - W * 0.05, H * 0.42);
        ctx.closePath();
        ctx.fillStyle = vgrad(ctx, H * 0.05, H * 0.42, ["#a8202f", "#7d1622"]);
        ctx.fill();
        ink(ctx, ow);
        ctx.beginPath();
        ctx.arc(bx, H * 0.2, W * 0.025, 0, Math.PI * 2);
        ctx.fillStyle = "#e9b949";
        ctx.fill();
        box(ctx, bx - W * 0.06, H * 0.04, W * 0.12, H * 0.015, "#5a3d26", ow, 3);
      }
      for (const tx of [W * 0.34, W * 0.66]) torch(ctx, tx, H * 0.3, H, t, ow);
      floor(ctx, st, bl, "#857f76", "stone");
      ctx.fillStyle = "#8f1d2a";
      ctx.beginPath();
      ctx.moveTo(W * 0.42, bl);
      ctx.lineTo(W * 0.58, bl);
      ctx.lineTo(W * 0.74, H * 1.1);
      ctx.lineTo(W * 0.26, H * 1.1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(10,10,30,0.25)";
      ctx.fillRect(st.left, -H, st.right - st.left, H * 3);
      for (const tx of [W * 0.34, W * 0.66]) glow(ctx, tx, H * 0.27, H * 0.45, "255,170,80", 0.35 + Math.sin(t * 9 + tx) * 0.04);
      break;
    }

    case "cave": {
      ctx.fillStyle = vgrad(ctx, -H * 0.2, gy, ["#2a1d14", "#4a3424"]);
      ctx.fillRect(st.left, -H, st.right - st.left, H * 3);
      const r = rng(seed);
      for (let i = 0; i < 14; i++) {
        const x = st.left + r() * (st.right - st.left);
        const y = r() * bl;
        ctx.beginPath();
        ctx.ellipse(x, y, W * (0.08 + r() * 0.1), H * (0.06 + r() * 0.08), r() * 3, 0, Math.PI * 2);
        ctx.fillStyle = mix("#4a3424", "#6b4c33", r());
        ctx.fill();
      }
      // Ochre wall paintings
      ctx.strokeStyle = "rgba(190,90,40,0.75)";
      ctx.fillStyle = "rgba(190,90,40,0.75)";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      const animal = (x: number, y: number, s: number) => {
        ctx.beginPath();
        ctx.ellipse(x, y, s, s * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - s * 0.6, y + s * 0.3);
        ctx.lineTo(x - s * 0.7, y + s * 0.9);
        ctx.moveTo(x + s * 0.6, y + s * 0.3);
        ctx.lineTo(x + s * 0.7, y + s * 0.9);
        ctx.moveTo(x + s * 0.9, y - s * 0.2);
        ctx.lineTo(x + s * 1.3, y - s * 0.5);
        ctx.stroke();
      };
      animal(W * 0.22, H * 0.25, H * 0.05);
      animal(W * 0.36, H * 0.2, H * 0.035);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(W * (0.7 + i * 0.05), H * 0.22, H * 0.018, 0, Math.PI * 2);
        ctx.fill();
      }
      // Stalactites
      for (let x = st.left; x < st.right; x += W * 0.07) {
        const h = H * (0.05 + r() * 0.1);
        ctx.beginPath();
        ctx.moveTo(x, -2);
        ctx.lineTo(x + W * 0.025, h);
        ctx.lineTo(x + W * 0.05, -2);
        ctx.closePath();
        ctx.fillStyle = "#3a281b";
        ctx.fill();
      }
      ctx.fillStyle = vgrad(ctx, bl, H * 1.1, ["#5a412c", "#6e5238"]);
      ctx.fillRect(st.left, bl, st.right - st.left, H * 2);
      speckle(ctx, seed, st.left, bl, st.right - st.left, H * 0.4, 240, "rgba(30,20,10,0.35)", 3);
      campfire(ctx, W * 0.5, gy - H * 0.02, H * 0.09, t, ow);
      glow(ctx, W * 0.5, gy - H * 0.1, H * 0.9, "255,150,60", 0.3 + Math.sin(t * 11) * 0.03);
      break;
    }

    case "stage": {
      ctx.fillStyle = vgrad(ctx, -H * 0.2, bl, ["#1b0f17", "#2e1824"]);
      ctx.fillRect(st.left, -H, st.right - st.left, bl + H);
      const curtain = (x0: number, x1: number) => {
        const n = Math.max(3, Math.round((x1 - x0) / (W * 0.035)));
        const w = (x1 - x0) / n;
        for (let i = 0; i < n; i++) {
          const g = ctx.createLinearGradient(x0 + i * w, 0, x0 + (i + 1) * w, 0);
          g.addColorStop(0, "#6e1020");
          g.addColorStop(0.5, "#c22a3c");
          g.addColorStop(1, "#6e1020");
          ctx.fillStyle = g;
          ctx.fillRect(x0 + i * w, -H, w + 1, gy + H);
        }
      };
      curtain(st.left, st.right);
      // Re-open the middle: dark backdrop behind the performers.
      ctx.fillStyle = vgrad(ctx, H * 0.12, bl, ["#20121b", "#341b29"]);
      ctx.fillRect(W * 0.16, H * 0.12, W * 0.68, bl - H * 0.12);
      ctx.fillStyle = "#9e1d2f";
      ctx.beginPath();
      ctx.moveTo(st.left, -H);
      ctx.lineTo(st.right, -H);
      ctx.lineTo(st.right, H * 0.12);
      for (let x = st.right; x >= st.left; x -= W * 0.08) ctx.quadraticCurveTo(x - W * 0.04, H * 0.18, x - W * 0.08, H * 0.12);
      ctx.closePath();
      ctx.fill();
      ink(ctx, ow);
      floor(ctx, st, bl, "#8a5a32", "wood");
      // Spotlight
      const g = ctx.createRadialGradient(W / 2, gy, 0, W / 2, gy, H * 0.55);
      g.addColorStop(0, "rgba(255,240,190,0.45)");
      g.addColorStop(1, "rgba(255,240,190,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(W * 0.46, -H * 0.1);
      ctx.lineTo(W * 0.54, -H * 0.1);
      ctx.lineTo(W * 0.8, gy + H * 0.08);
      ctx.lineTo(W * 0.2, gy + H * 0.08);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}

function building(ctx: C, x: number, base: number, w: number, h: number, kind: Scene["setting"], r: () => number, night: boolean, ow: number, t: number) {
  const palette = kind === "village" ? ["#efe2c4", "#e6d3ae", "#f2e8d2"] : ["#d9a07b", "#9bb7d4", "#c9c2b8", "#e3c87a", "#b79fc9", "#a7c4a0"];
  const col = palette[Math.floor(r() * palette.length)];
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, shade(col, 0.06));
  g.addColorStop(1, shade(col, -0.12));
  box(ctx, x, base - h, w, h, g, ow);
  if (kind === "village") {
    // Timber frame and pitched roof with smoke.
    ctx.strokeStyle = "#6b4528";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x, base - h * 0.5);
    ctx.lineTo(x + w, base - h * 0.5);
    ctx.moveTo(x + w * 0.5, base - h);
    ctx.lineTo(x + w * 0.5, base);
    ctx.moveTo(x, base - h);
    ctx.lineTo(x + w * 0.5, base - h * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - w * 0.08, base - h);
    ctx.lineTo(x + w * 0.5, base - h - w * 0.4);
    ctx.lineTo(x + w * 1.08, base - h);
    ctx.closePath();
    ctx.fillStyle = vgrad(ctx, base - h - w * 0.4, base - h, ["#b5523a", "#8f3b28"]);
    ctx.fill();
    ink(ctx, ow);
    box(ctx, x + w * 0.7, base - h - w * 0.35, w * 0.1, w * 0.2, "#8a7f72", ow);
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.3 + i / 3) % 1;
      ctx.fillStyle = `rgba(235,235,235,${0.45 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(x + w * 0.75 + k * w * 0.12, base - h - w * 0.42 - k * w * 0.3, w * (0.03 + k * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }
    box(ctx, x + w * 0.15, base - h * 0.4, w * 0.2, h * 0.4, "#6b4528", ow, 2);
    box(ctx, x + w * 0.6, base - h * 0.4, w * 0.25, h * 0.2, night ? "#ffd98a" : "#9fc4d8", ow, 2);
    return;
  }
  box(ctx, x - 4, base - h - 10, w + 8, 12, shade(col, -0.25), ow);
  const cols = Math.max(2, Math.floor(w / 46));
  const rows = Math.max(2, Math.floor(h / 70));
  const cw = w / cols;
  const rh = (h - 30) / rows;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows - 1; j++) {
      const lit = night && (i * 7 + j * 3 + Math.round(x)) % 3 !== 0;
      const wx = x + i * cw + cw * 0.22;
      const wy = base - h + 16 + j * rh + rh * 0.15;
      box(ctx, wx, wy, cw * 0.56, rh * 0.6, lit ? "#ffe08a" : vgrad(ctx, wy, wy + rh * 0.6, ["#cfe6f5", "#8fb4cf"]), 1.5);
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(wx - 2, wy + rh * 0.6, cw * 0.56 + 4, 4);
    }
  // Shop front with striped awning
  const aw = ["#e2483d", "#2f6fd6", "#16a34a", "#d97706"][Math.floor(r() * 4)];
  box(ctx, x + w * 0.1, base - rh * 0.95, w * 0.8, rh * 0.95, night ? "#f6d58a" : "#cde3ef", ow);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? "#ffffff" : aw;
    ctx.fillRect(x + w * 0.06 + (i * w * 0.88) / 6, base - rh * 1.15, (w * 0.88) / 6 + 1, rh * 0.2);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow;
  ctx.strokeRect(x + w * 0.06, base - rh * 1.15, w * 0.88, rh * 0.2);
}

function torch(ctx: C, x: number, y: number, H: number, t: number, ow: number) {
  box(ctx, x - H * 0.008, y, H * 0.016, H * 0.08, "#4e321d", ow);
  const f = 1 + Math.sin(t * 13 + x) * 0.12;
  ctx.beginPath();
  ctx.moveTo(x - H * 0.022, y);
  ctx.quadraticCurveTo(x - H * 0.025, y - H * 0.04 * f, x, y - H * 0.07 * f);
  ctx.quadraticCurveTo(x + H * 0.025, y - H * 0.04 * f, x + H * 0.022, y);
  ctx.closePath();
  ctx.fillStyle = "#ff9a3c";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y - H * 0.02, H * 0.01, H * 0.025 * f, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#ffe08a";
  ctx.fill();
}

function campfire(ctx: C, x: number, gy: number, s: number, t: number, ow: number) {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * s * 0.9, gy, s * 0.22, s * 0.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#6f6a64";
    ctx.fill();
    ink(ctx, ow * 0.8);
  }
  ctx.lineCap = "round";
  for (const d of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x - s * 0.6 * d, gy);
    ctx.lineTo(x + s * 0.6 * d, gy - s * 0.25);
    ctx.strokeStyle = INK;
    ctx.lineWidth = s * 0.2;
    ctx.stroke();
    ctx.strokeStyle = "#6b4528";
    ctx.lineWidth = s * 0.14;
    ctx.stroke();
  }
  const fl = (k: number, w: number, h: number, c: string) => {
    const f = 1 + Math.sin(t * 12 + k) * 0.1;
    ctx.beginPath();
    ctx.moveTo(x - w, gy - s * 0.15);
    ctx.quadraticCurveTo(x - w * 1.1, gy - h * 0.6 * f, x + Math.sin(t * 7 + k) * w * 0.3, gy - h * f);
    ctx.quadraticCurveTo(x + w * 1.1, gy - h * 0.6 * f, x + w, gy - s * 0.15);
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
  };
  fl(0, s * 0.55, s * 1.5, "#ff7a2a");
  fl(1, s * 0.35, s * 1.05, "#ffb340");
  fl(2, s * 0.18, s * 0.6, "#fff0a0");
}

/** Screen-space finishing: time-of-day grade and a soft vignette. */
export function gradeFrame(ctx: C, scene: Scene, W: number, H: number) {
  if (scene.timeOfDay === "sunset") {
    ctx.fillStyle = "rgba(255,140,60,0.10)";
    ctx.fillRect(0, 0, W, H);
  } else if (scene.timeOfDay === "night" && !INDOOR.has(scene.setting)) {
    ctx.fillStyle = "rgba(20,30,80,0.22)";
    ctx.fillRect(0, 0, W, H);
  }
  const v = ctx.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, scene.setting === "stage" || scene.setting === "cave" ? "rgba(0,0,0,0.55)" : scene.setting === "news-studio" ? "rgba(0,0,20,0.25)" : "rgba(20,10,0,0.3)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// ---------- period sets: Edo Japan and Ancient Egypt ----------

/** Dirt road or packed sand from `y0` down, with grit. */
function dirt(ctx: C, st: Stage, y0: number, a: string, b: string, seed: number) {
  ctx.fillStyle = vgrad(ctx, y0, st.H * 1.1, [a, b]);
  ctx.fillRect(st.left, y0, st.right - st.left, st.H * 1.5);
  speckle(ctx, seed, st.left, y0, st.right - st.left, st.H * 1.1 - y0, 260, rgba(shade(a, -0.45), 0.3), 2.5);
}

/** A tiled roof: trapezoid with eaves that turn up at the ends, and tile ribs. */
function tiledRoof(ctx: C, x0: number, x1: number, yEave: number, h: number, ow: number, color = "#4a505a") {
  const over = (x1 - x0) * 0.08;
  ctx.beginPath();
  ctx.moveTo(x0 - over, yEave - h * 0.18);
  ctx.quadraticCurveTo(x0 - over * 0.2, yEave + h * 0.05, x0 + over, yEave);
  ctx.lineTo(x1 - over, yEave);
  ctx.quadraticCurveTo(x1 + over * 0.2, yEave + h * 0.05, x1 + over, yEave - h * 0.18);
  ctx.lineTo(x1 - over * 0.6, yEave - h);
  ctx.lineTo(x0 + over * 0.6, yEave - h);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, yEave - h, yEave, [shade(color, 0.12), shade(color, -0.15)]);
  ctx.fill();
  ink(ctx, ow);
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(shade(color, -0.5), 0.5);
  ctx.lineWidth = Math.max(1.2, ow * 0.6);
  ctx.beginPath();
  for (let x = x0 - over; x < x1 + over; x += Math.max(6, (x1 - x0) / 16)) {
    ctx.moveTo(x, yEave + 4);
    ctx.lineTo(x + ((x0 + x1) / 2 - x) * 0.12, yEave - h);
  }
  ctx.stroke();
  ctx.restore();
  box(ctx, x0 + over * 0.4, yEave - h - h * 0.12, x1 - x0 - over * 0.8, h * 0.14, shade(color, -0.25), ow, 2);
}

/** Red paper lantern (chōchin) hanging from (x, y). */
function chochin(ctx: C, x: number, y: number, s: number, tod: Tod, ow: number, t: number) {
  const sway = Math.sin(t * 1.6 + x * 0.01) * 0.05;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sway);
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow * 0.8;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, s * 0.3);
  ctx.stroke();
  const lit = tod !== "day";
  ctx.beginPath();
  ctx.ellipse(0, s * 0.95, s * 0.42, s * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = vgrad(ctx, s * 0.35, s * 1.55, lit ? ["#ff8a5c", "#e0442b"] : ["#e2543a", "#a92f20"]);
  ctx.fill();
  ink(ctx, ow);
  ctx.strokeStyle = rgba(INK, 0.35);
  ctx.lineWidth = 1.2;
  for (const k of [-0.3, 0, 0.3]) {
    ctx.beginPath();
    ctx.ellipse(0, s * 0.95 + k * s * 0.9, s * 0.42 * Math.sqrt(1 - k * k), s * 0.05, 0, 0, Math.PI);
    ctx.stroke();
  }
  box(ctx, -s * 0.22, s * 0.3, s * 0.44, s * 0.1, "#1f1a17", 0);
  box(ctx, -s * 0.22, s * 1.52, s * 0.44, s * 0.1, "#1f1a17", 0);
  ctx.restore();
  if (lit) glow(ctx, x, y + s * 0.95, s * 3.2, "255,140,80", 0.4);
}

/** Two-storey Edo townhouse: plastered upper floor with slatted window, timber lattice shopfront, noren curtain. */
function machiya(ctx: C, x: number, base: number, w: number, h: number, r: () => number, tod: Tod, ow: number, t: number) {
  const night = tod === "night";
  const mid = base - h * 0.55;
  // Upper storey plaster with mushiko slatted window.
  box(ctx, x, base - h, w, h * 0.45, vgrad(ctx, base - h, mid, ["#f1e9d8", "#e2d6bd"]), ow);
  box(ctx, x + w * 0.25, base - h * 0.88, w * 0.5, h * 0.2, night ? "#ffcf7a" : "#3a2a1e", ow);
  ctx.fillStyle = "#e9dfc9";
  for (let k = 1; k < 9; k++) ctx.fillRect(x + w * 0.25 + (w * 0.5 * k) / 9 - 2, base - h * 0.88, 4, h * 0.2);
  // Lower storey: dark timber with koshi lattice; warm light behind it at night.
  box(ctx, x, mid, w, h * 0.55, vgrad(ctx, mid, base, ["#5e3f27", "#45301f"]), ow);
  const latX = x + w * 0.05;
  const latW = w * 0.42;
  box(ctx, latX, mid + h * 0.12, latW, h * 0.38, night ? "#ffd98a" : "#2e2018", ow);
  ctx.fillStyle = "#7a5434";
  for (let lx = latX + 3; lx < latX + latW - 2; lx += Math.max(5, w * 0.03)) ctx.fillRect(lx, mid + h * 0.12, Math.max(2, w * 0.012), h * 0.38);
  // Doorway with a split indigo noren and a white crest.
  const dx = x + w * 0.55;
  const dw = w * 0.36;
  box(ctx, dx, mid + h * 0.08, dw, h * 0.47, night ? "#6b4a2a" : "#22180f", ow);
  const nc = ["#26355a", "#5a2a2a", "#2f4a3a"][Math.floor(r() * 3)];
  ctx.fillStyle = vgrad(ctx, mid + h * 0.08, mid + h * 0.3, [nc, shade(nc, -0.2)]);
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.rect(dx + (dw * k) / 3 + 1.5, mid + h * 0.08, dw / 3 - 3, h * 0.22);
    ctx.fill();
    ink(ctx, ow * 0.7);
  }
  ctx.beginPath();
  ctx.arc(dx + dw / 2, mid + h * 0.18, h * 0.045, 0, Math.PI * 2);
  ctx.strokeStyle = "#f4efe6";
  ctx.lineWidth = Math.max(2, h * 0.012);
  ctx.stroke();
  // Eave between the storeys, and the main roof.
  tiledRoof(ctx, x, x + w, mid + h * 0.02, h * 0.11, ow);
  tiledRoof(ctx, x, x + w, base - h + h * 0.02, h * 0.2, ow);
  if (r() > 0.35) chochin(ctx, dx - w * 0.06, mid + h * 0.06, h * 0.12, tod, ow, t);
}

/** Distant snow-capped volcano. */
function fuji(ctx: C, x: number, base: number, h: number, tod: Tod) {
  const body = mix("#5d7397", SKY[tod][2], 0.45);
  ctx.beginPath();
  ctx.moveTo(x - h * 1.6, base);
  ctx.quadraticCurveTo(x - h * 0.5, base - h * 0.55, x - h * 0.16, base - h);
  ctx.lineTo(x + h * 0.16, base - h);
  ctx.quadraticCurveTo(x + h * 0.5, base - h * 0.55, x + h * 1.6, base);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - h * 0.16, base - h);
  ctx.lineTo(x + h * 0.16, base - h);
  ctx.lineTo(x + h * 0.36, base - h * 0.72);
  ctx.lineTo(x + h * 0.18, base - h * 0.78);
  ctx.lineTo(x + h * 0.05, base - h * 0.7);
  ctx.lineTo(x - h * 0.12, base - h * 0.79);
  ctx.lineTo(x - h * 0.36, base - h * 0.72);
  ctx.closePath();
  ctx.fillStyle = mix("#ffffff", SKY[tod][2], 0.25);
  ctx.fill();
}

/** Timber gate with a small tiled roof (kabukimon), straddling the road at x. */
function edoGate(ctx: C, x: number, gy: number, H: number, ow: number) {
  const half = H * 0.2;
  const top = gy - H * 0.62;
  const wood = vgrad(ctx, top, gy, ["#5a3d26", "#3e2a1a"]);
  for (const s of [-1, 1]) {
    box(ctx, x + s * half - H * 0.025, top, H * 0.05, gy - top, wood, ow);
    box(ctx, x + s * half - H * 0.035, gy - H * 0.04, H * 0.07, H * 0.04, "#8a8378", ow);
  }
  box(ctx, x - half - H * 0.06, top + H * 0.06, half * 2 + H * 0.12, H * 0.045, "#4e321d", ow);
  box(ctx, x - half - H * 0.02, top + H * 0.16, half * 2 + H * 0.04, H * 0.03, "#4e321d", ow);
  ctx.fillStyle = "#b08d3a";
  for (const s of [-1, 1]) ctx.fillRect(x + s * half - H * 0.012, top + H * 0.075, H * 0.024, H * 0.02);
  tiledRoof(ctx, x - half - H * 0.05, x + half + H * 0.05, top + H * 0.02, H * 0.09, ow);
}

/** Japanese castle keep (tenshu) on a sloped stone base, centred at x. */
function tenshu(ctx: C, x: number, base: number, H: number, ow: number, tod: Tod) {
  // Ishigaki: battered stone walls.
  const bw = H * 0.62;
  const bh = H * 0.14;
  ctx.beginPath();
  ctx.moveTo(x - bw / 2 - H * 0.06, base);
  ctx.lineTo(x - bw / 2 + H * 0.02, base - bh);
  ctx.lineTo(x + bw / 2 - H * 0.02, base - bh);
  ctx.lineTo(x + bw / 2 + H * 0.06, base);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, base - bh, base, ["#9b968c", "#7a756c"]);
  ctx.fill();
  ink(ctx, ow);
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(INK, 0.3);
  ctx.lineWidth = 1.5;
  for (let y = base - bh, row = 0; y < base; y += bh / 4, row++)
    for (let sx = x - bw / 2 - H * 0.06 + (row % 2) * H * 0.025; sx < x + bw / 2 + H * 0.06; sx += H * 0.05) ctx.strokeRect(sx, y, H * 0.05, bh / 4);
  ctx.restore();
  // Three white tiers, each narrower, under dark curved roofs, gables on the lower two.
  let y = base - bh;
  const tiers = [
    [0.5, 0.13],
    [0.38, 0.11],
    [0.26, 0.1],
  ];
  tiers.forEach(([wk, hk], i) => {
    const w = H * wk;
    const h = H * hk;
    box(ctx, x - w / 2, y - h, w, h, vgrad(ctx, y - h, y, ["#f7f3ea", "#e3dccd"]), ow);
    const lit = tod === "night";
    for (let k = 0; k < 3 - (i === 2 ? 1 : 0); k++) {
      const n = 3 - (i === 2 ? 1 : 0);
      box(ctx, x - w / 2 + (w * (k + 0.5)) / n - H * 0.015, y - h * 0.62, H * 0.03, h * 0.3, lit ? "#ffd98a" : "#2c2620", ow * 0.8);
    }
    y -= h;
    tiledRoof(ctx, x - w / 2 - H * 0.02, x + w / 2 + H * 0.02, y + h * 0.15, H * 0.06, ow, "#3e4652");
    if (i < 2) {
      // Chidori gable.
      ctx.beginPath();
      ctx.moveTo(x - H * 0.06, y + h * 0.05);
      ctx.lineTo(x, y - H * 0.05);
      ctx.lineTo(x + H * 0.06, y + h * 0.05);
      ctx.closePath();
      ctx.fillStyle = "#f2ede2";
      ctx.fill();
      ink(ctx, ow);
    }
    y -= H * 0.05;
  });
  // Gilded shachihoko on the ridge ends.
  ctx.fillStyle = "#d4a537";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + s * H * 0.12, y + H * 0.005, H * 0.012, H * 0.022, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ink(ctx, ow * 0.7);
  }
}

/** Date palm. */
function palm(ctx: C, x: number, base: number, h: number, ow: number) {
  ctx.beginPath();
  ctx.moveTo(x - h * 0.03, base);
  ctx.quadraticCurveTo(x + h * 0.05, base - h * 0.5, x + h * 0.02, base - h);
  ctx.lineTo(x + h * 0.06, base - h);
  ctx.quadraticCurveTo(x + h * 0.09, base - h * 0.5, x + h * 0.03, base);
  ctx.closePath();
  ctx.fillStyle = "#8a6438";
  ctx.fill();
  ink(ctx, ow);
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI + 0.2 + i * 0.45;
    ctx.beginPath();
    ctx.ellipse(x + 0.04 * h + Math.cos(a) * h * 0.2, base - h + Math.sin(a) * h * 0.06 + h * 0.03, h * 0.22, h * 0.045, a, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 ? "#4f8f4e" : "#3f7a40";
    ctx.fill();
    ink(ctx, ow * 0.7);
  }
}

/** Market stall: striped awning on poles, a table of pots, baskets of fruit. */
function stall(ctx: C, x: number, gy: number, w: number, H: number, r: () => number, ow: number) {
  const top = gy - H * 0.36;
  for (const sx of [x, x + w]) box(ctx, sx - 3, top, 6, gy - top, "#6b4a2c", ow);
  const cols = [["#2f8f8a", "#efe2c4"], ["#b8432f", "#efe2c4"], ["#d4a537", "#7a3b26"]][Math.floor(r() * 3)];
  const stripes = 7;
  for (let i = 0; i < stripes; i++) {
    ctx.beginPath();
    const a = x - w * 0.06 + ((w * 1.12) / stripes) * i;
    const b = a + (w * 1.12) / stripes;
    ctx.moveTo(a, top - H * 0.04);
    ctx.lineTo(b, top - H * 0.04);
    ctx.lineTo(b + w * 0.02, top + H * 0.05);
    ctx.lineTo(a + w * 0.02, top + H * 0.05);
    ctx.closePath();
    ctx.fillStyle = cols[i % 2];
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow;
  ctx.strokeRect(x - w * 0.06, top - H * 0.04, w * 1.14, H * 0.09);
  // Table with goods.
  box(ctx, x + w * 0.02, gy - H * 0.12, w * 0.96, H * 0.025, "#9a6a3c", ow, 2);
  box(ctx, x + w * 0.06, gy - H * 0.095, w * 0.04, H * 0.095, "#6b4a2c", ow);
  box(ctx, x + w * 0.9, gy - H * 0.095, w * 0.04, H * 0.095, "#6b4a2c", ow);
  for (let k = 0; k < 4; k++) {
    const px = x + w * (0.14 + k * 0.22);
    const py = gy - H * 0.12;
    if (k % 2 === 0) {
      // Clay jar.
      ctx.beginPath();
      ctx.moveTo(px - H * 0.015, py - H * 0.09);
      ctx.quadraticCurveTo(px - H * 0.05, py - H * 0.045, px - H * 0.025, py);
      ctx.lineTo(px + H * 0.025, py);
      ctx.quadraticCurveTo(px + H * 0.05, py - H * 0.045, px + H * 0.015, py - H * 0.09);
      ctx.closePath();
      ctx.fillStyle = vgrad(ctx, py - H * 0.09, py, ["#c87a46", "#8f4527"]);
      ctx.fill();
      ink(ctx, ow);
    } else {
      // Basket of fruit.
      box(ctx, px - H * 0.04, py - H * 0.035, H * 0.08, H * 0.035, "#c9a46c", ow, 4);
      const fruit = ["#e8862c", "#7fae3c", "#c0392b"][k % 3];
      for (let j = 0; j < 4; j++) {
        ctx.beginPath();
        ctx.arc(px - H * 0.027 + j * H * 0.018, py - H * 0.042 - (j % 2) * H * 0.008, H * 0.013, 0, Math.PI * 2);
        ctx.fillStyle = fruit;
        ctx.fill();
        ink(ctx, ow * 0.6);
      }
    }
  }
}

/** Flat-roofed mudbrick/sandstone house with beam ends, an arched door and small windows. */
function egyptHouse(ctx: C, x: number, base: number, w: number, h: number, r: () => number, night: boolean, ow: number) {
  const col = ["#e2c28c", "#d9b47a", "#ead1a0"][Math.floor(r() * 3)];
  box(ctx, x, base - h, w, h, vgrad(ctx, base - h, base, [shade(col, 0.06), shade(col, -0.1)]), ow);
  speckle(ctx, Math.round(x), x, base - h, w, h, 40, rgba(shade(col, -0.4), 0.25), 2.5);
  box(ctx, x - w * 0.03, base - h - h * 0.04, w * 1.06, h * 0.05, shade(col, -0.15), ow);
  ctx.fillStyle = "#5a3d26";
  for (let k = 0; k < 5; k++) ctx.fillRect(x + w * (0.1 + k * 0.2), base - h + h * 0.04, w * 0.05, h * 0.04);
  const dw = w * 0.28;
  const dx = x + w * (0.15 + r() * 0.4);
  ctx.beginPath();
  ctx.moveTo(dx, base);
  ctx.lineTo(dx, base - h * 0.42);
  ctx.arc(dx + dw / 2, base - h * 0.42, dw / 2, Math.PI, 0);
  ctx.lineTo(dx + dw, base);
  ctx.closePath();
  ctx.fillStyle = night ? "#6b4a2a" : "#3a2a1c";
  ctx.fill();
  ink(ctx, ow);
  for (const wx of [x + w * 0.1, x + w * 0.75]) box(ctx, wx, base - h * 0.75, w * 0.12, h * 0.14, night ? "#ffd98a" : "#3a2a1c", ow, 2);
}

// ---------- TV news studio ----------

/** Studio monitor with a slowly turning wireframe globe. */
function globePanel(ctx: C, x: number, y: number, w: number, h: number, t: number, ow: number) {
  box(ctx, x, y, w, h, vgrad(ctx, y, y + h, ["#123a7a", "#0b2150"]), ow, 6);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) * 0.38;
  glow(ctx, cx, cy, r * 1.6, "90,170,255", 0.35);
  ctx.strokeStyle = "rgba(160,215,255,0.75)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  for (const k of [-0.6, -0.3, 0, 0.3, 0.6]) {
    ctx.moveTo(cx + r * Math.sqrt(1 - k * k), cy + k * r);
    ctx.ellipse(cx, cy + k * r, r * Math.sqrt(1 - k * k), r * 0.08 * Math.sqrt(1 - k * k), 0, 0, Math.PI * 2);
  }
  for (let i = 0; i < 6; i++) {
    const a = ((t * 0.25 + i / 6) % 1) * Math.PI;
    const rx = Math.abs(Math.cos(a)) * r;
    ctx.moveTo(cx + rx, cy);
    ctx.ellipse(cx, cy, rx, r, 0, 0, Math.PI * 2);
  }
  ctx.stroke();
}

/** Studio monitor with animated bar chart and trend line. */
function chartPanel(ctx: C, x: number, y: number, w: number, h: number, t: number, ow: number, seed: number) {
  box(ctx, x, y, w, h, vgrad(ctx, y, y + h, ["#1b2f63", "#0e1c44"]), ow, 6);
  const r = rng(seed);
  const n = 6;
  const bw = (w * 0.7) / n;
  for (let i = 0; i < n; i++) {
    const v = 0.25 + r() * 0.6 + Math.sin(t * 1.2 + i) * 0.05;
    const bh = h * 0.65 * v;
    ctx.fillStyle = i % 2 ? "rgba(90,170,255,0.85)" : "rgba(230,57,70,0.85)";
    ctx.fillRect(x + w * 0.15 + i * bw + bw * 0.15, y + h * 0.85 - bh, bw * 0.7, bh);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const px = x + w * 0.1 + (w * 0.8 * i) / 12;
    const py = y + h * (0.5 - 0.25 * Math.sin(i * 0.7 + t * 0.6) * (i / 12));
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.stroke();
}

function newsStudio(ctx: C, scene: Scene, st: Stage, t: number, seed: number) {
  const { W, H } = st;
  const bl = backLine(st);
  const ow = Math.max(2, H * 0.0032);
  wall(ctx, st, bl, "#0a1633", "#14295c");
  // Vertical light strips and a glowing ceiling rig.
  for (let x = st.left + W * 0.02; x < st.right; x += W * 0.16) {
    ctx.fillStyle = "rgba(80,170,255,0.18)";
    ctx.fillRect(x, -H, W * 0.012, bl + H);
    ctx.fillStyle = "rgba(160,215,255,0.55)";
    ctx.fillRect(x + W * 0.004, -H, W * 0.004, bl + H);
  }
  for (const lx of [W * 0.2, W * 0.5, W * 0.8]) glow(ctx, lx, 0, H * 0.35, "150,200,255", 0.35);
  // Video wall: city skyline behind the anchor, data panels either side.
  const vy = H * 0.07;
  const vh = H * 0.5;
  box(ctx, W * 0.3, vy, W * 0.4, vh, vgrad(ctx, vy, vy + vh, scene.timeOfDay === "night" ? ["#0b1430", "#2b3a66"] : ["#3d7cc9", "#a7d0f0"]), ow, 6);
  ctx.save();
  ctx.beginPath();
  ctx.rect(W * 0.3, vy, W * 0.4, vh);
  ctx.clip();
  const r = rng(seed + 3);
  for (let x = W * 0.3; x < W * 0.7; x += W * 0.03) {
    const bh = vh * (0.25 + r() * 0.45);
    ctx.fillStyle = scene.timeOfDay === "night" ? "#16224a" : "#55708f";
    ctx.fillRect(x, vy + vh - bh, W * 0.028, bh);
    ctx.fillStyle = scene.timeOfDay === "night" ? "rgba(255,220,130,0.8)" : "rgba(220,235,250,0.55)";
    for (let wy = vy + vh - bh + 6; wy < vy + vh - 6; wy += 12) if (r() > 0.4) ctx.fillRect(x + 4, wy, 4, 5);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const k of [1, 2]) {
    ctx.moveTo(W * 0.3 + (W * 0.4 * k) / 3, vy);
    ctx.lineTo(W * 0.3 + (W * 0.4 * k) / 3, vy + vh);
  }
  ctx.moveTo(W * 0.3, vy + vh / 2);
  ctx.lineTo(W * 0.7, vy + vh / 2);
  ctx.stroke();
  chartPanel(ctx, W * 0.04, H * 0.12, W * 0.22, H * 0.32, t, ow, seed);
  globePanel(ctx, W * 0.74, H * 0.12, W * 0.22, H * 0.32, t, ow);
  // Glossy floor with a soft reflection of the wall.
  floor(ctx, st, bl, "#1a2550", "tile");
  ctx.fillStyle = vgrad(ctx, bl, bl + H * 0.15, ["rgba(120,180,255,0.18)", "rgba(120,180,255,0)"]);
  ctx.fillRect(st.left, bl, st.right - st.left, H * 0.15);
}

/** Anchor desk in front of the presenter: curved top, branded front panel. */
function newsDesk(ctx: C, st: Stage) {
  const { W, H } = st;
  const gy = st.groundY;
  const ow = Math.max(2, H * 0.0032);
  const cx = W / 2;
  const w = W * 0.5;
  const top = gy - st.figureH * 0.37;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, top + H * 0.02);
  ctx.quadraticCurveTo(cx, top + H * 0.07, cx + w / 2, top + H * 0.02);
  ctx.lineTo(cx + w * 0.44, gy);
  ctx.quadraticCurveTo(cx, gy + H * 0.04, cx - w * 0.44, gy);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, top, gy, ["#eef2f8", "#aab5c9"]);
  ctx.fill();
  ink(ctx, ow);
  // Brand stripes and a glowing logo plate.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#c8102e";
  ctx.fillRect(cx - w / 2, top + (gy - top) * 0.42, w, (gy - top) * 0.1);
  ctx.fillStyle = "#13306b";
  ctx.fillRect(cx - w / 2, top + (gy - top) * 0.55, w, (gy - top) * 0.06);
  ctx.restore();
  const pw = w * 0.22;
  const ph = (gy - top) * 0.3;
  box(ctx, cx - pw / 2, top + (gy - top) * 0.32, pw, ph, "#13306b", ow, 6);
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${Math.round(ph * 0.5)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("HABER", cx, top + (gy - top) * 0.32 + ph / 2);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
  // Desk top surface.
  ctx.beginPath();
  ctx.ellipse(cx, top + H * 0.02, w / 2, H * 0.03, 0, Math.PI, 0);
  ctx.quadraticCurveTo(cx, top + H * 0.07, cx - w / 2, top + H * 0.02);
  ctx.fillStyle = "#f8fafc";
  ctx.fill();
  ink(ctx, ow);
  // Papers on the desk.
  box(ctx, cx - w * 0.3, top + H * 0.005, w * 0.09, H * 0.012, "#ffffff", ow * 0.7, 2);
}

// ---------- football stadium ----------

function stadium(ctx: C, scene: Scene, st: Stage, t: number, seed: number) {
  const { W, H } = st;
  const gy = st.groundY;
  const bl = backLine(st);
  const ow = Math.max(2, H * 0.0032);
  const night = scene.timeOfDay !== "day";
  sky(ctx, st, scene.timeOfDay, t, seed, H * 0.2);
  // Floodlight towers behind the stand.
  for (const fx of [W * 0.06, W * 0.94]) {
    box(ctx, fx - W * 0.006, -H * 0.1, W * 0.012, H * 0.4, "#6b7280", ow);
    box(ctx, fx - W * 0.04, -H * 0.12, W * 0.08, H * 0.06, night ? "#fff7cc" : "#d1d5db", ow, 3);
    if (night) glow(ctx, fx, -H * 0.09, H * 0.5, "255,250,210", 0.55);
  }
  // Stand: a dark concrete bowl packed with a crowd in two club colours.
  const standTop = H * 0.1;
  const standBot = bl - H * 0.06;
  ctx.fillStyle = vgrad(ctx, standTop, standBot, ["#2c3442", "#3d4757"]);
  ctx.fillRect(st.left, standTop, st.right - st.left, standBot - standTop);
  box(ctx, st.left, standTop - H * 0.03, st.right - st.left, H * 0.03, "#9aa3b2", ow);
  const r = rng(seed + 7);
  const rows = 9;
  const kits = ["#e63946", "#ffd166", "#1d4ed8", "#f8fafc"];
  for (let row = 0; row < rows; row++) {
    const y = standTop + ((row + 0.6) / rows) * (standBot - standTop);
    const size = H * (0.011 + (row / rows) * 0.007);
    for (let x = st.left + (row % 2) * size; x < st.right; x += size * 2.3) {
      const bob = Math.max(0, Math.sin(t * 6 + x * 0.05 + row)) * size * 0.6;
      ctx.fillStyle = kits[(Math.floor(x / (W * 0.35)) % 2) * 2 + (r() > 0.75 ? 1 : 0)];
      ctx.fillRect(x - size * 0.6, y - bob, size * 1.2, size * 1.1);
      ctx.fillStyle = r() > 0.5 ? "#f1d3b3" : "#c99a6e";
      ctx.beginPath();
      ctx.arc(x, y - bob - size * 0.5, size * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Waving flags in the crowd.
  for (let i = 0; i < 5; i++) {
    const fx = st.left + ((i + 0.5) / 5) * (st.right - st.left) + r() * W * 0.05;
    const fy = standTop + (standBot - standTop) * (0.3 + r() * 0.3);
    const wv = Math.sin(t * 5 + i) * H * 0.01;
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx, fy - H * 0.08);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fx, fy - H * 0.08);
    ctx.quadraticCurveTo(fx + W * 0.02, fy - H * 0.08 + wv, fx + W * 0.04, fy - H * 0.07);
    ctx.lineTo(fx + W * 0.04, fy - H * 0.04);
    ctx.quadraticCurveTo(fx + W * 0.02, fy - H * 0.05 + wv, fx, fy - H * 0.05);
    ctx.closePath();
    ctx.fillStyle = kits[(i % 2) * 2];
    ctx.fill();
  }
  // Advertising boards along the touchline.
  const ads = ["#c8102e", "#1d4ed8", "#16a34a", "#f59e0b", "#7c3aed"];
  const adH = H * 0.06;
  for (let x = st.left, i = 0; x < st.right; x += W * 0.2, i++) {
    box(ctx, x, standBot, W * 0.2, adH, ads[i % ads.length], ow);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(x + W * 0.03, standBot + adH * 0.35, W * 0.14, adH * 0.3);
  }
  // Striped pitch with touchline and penalty box, a goal on the right.
  const pitchTop = standBot + adH;
  for (let i = 0; i < 12; i++) {
    const y0 = pitchTop + (H * 1.2 - pitchTop) * Math.pow(i / 12, 1.4);
    const y1 = pitchTop + (H * 1.2 - pitchTop) * Math.pow((i + 1) / 12, 1.4);
    ctx.fillStyle = i % 2 ? "#4c9a46" : "#58a851";
    ctx.fillRect(st.left, y0, st.right - st.left, y1 - y0 + 1);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = Math.max(2, H * 0.004);
  ctx.beginPath();
  ctx.moveTo(st.left, pitchTop + H * 0.02);
  ctx.lineTo(st.right, pitchTop + H * 0.02);
  ctx.moveTo(W * 0.68, pitchTop + H * 0.02);
  ctx.lineTo(W * 0.62, H * 1.2);
  ctx.stroke();
  const gx = W * 0.8;
  const gw = W * 0.16;
  const gh = H * 0.17;
  const gb = pitchTop + H * 0.05;
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = gx; x <= gx + gw; x += gw / 12) {
    ctx.moveTo(x, gb - gh);
    ctx.lineTo(x + W * 0.01, gb);
  }
  for (let y = gb - gh; y <= gb; y += gh / 6) {
    ctx.moveTo(gx, y);
    ctx.lineTo(gx + gw, y);
  }
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow * 3;
  ctx.beginPath();
  ctx.moveTo(gx, gb);
  ctx.lineTo(gx, gb - gh);
  ctx.lineTo(gx + gw, gb - gh);
  ctx.lineTo(gx + gw, gb);
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = ow * 1.8;
  ctx.stroke();
  if (night) {
    ctx.fillStyle = "rgba(10,20,50,0.18)";
    ctx.fillRect(st.left, -H, st.right - st.left, H * 3);
  }
}

// ---------- outer space (for "sent the ball into orbit" gags) ----------

function football(ctx: C, x: number, y: number, r: number, spin: number, ow: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ink(ctx, ow);
  ctx.fillStyle = "#1f1a17";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function space(ctx: C, st: Stage, t: number, seed: number) {
  const { W, H } = st;
  const ow = Math.max(2, H * 0.0032);
  ctx.fillStyle = vgrad(ctx, -H * 0.5, H * 1.2, ["#05060f", "#0d1238", "#1d1446"]);
  ctx.fillRect(st.left, -H, st.right - st.left, H * 3);
  const r = rng(seed);
  for (let i = 0; i < 220; i++) {
    const x = st.left + r() * (st.right - st.left);
    const y = -H * 0.2 + r() * H * 1.4;
    ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * 2 + i * 1.7));
    ctx.fillStyle = "#ffffff";
    const z = r() > 0.9 ? 3 : 1.6;
    ctx.fillRect(x, y, z, z);
  }
  ctx.globalAlpha = 1;
  glow(ctx, W * 0.55, H * 0.5, H * 0.9, "120,80,220", 0.18);
  // Earth, bottom left, with drifting cloud bands.
  const ex = W * 0.16;
  const ey = H * 0.95;
  const er = H * 0.42;
  glow(ctx, ex, ey, er * 1.25, "90,170,255", 0.45);
  ctx.save();
  ctx.beginPath();
  ctx.arc(ex, ey, er, 0, Math.PI * 2);
  ctx.fillStyle = vgrad(ctx, ey - er, ey + er, ["#3b82f6", "#1e40af"]);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = "#3f9b4f";
  for (const [dx, dy, rx, ry] of [[-0.3, -0.5, 0.35, 0.18], [0.25, -0.2, 0.28, 0.22], [-0.1, 0.1, 0.22, 0.12]]) {
    ctx.beginPath();
    ctx.ellipse(ex + (dx + ((t * 0.01) % 0.2)) * er, ey + dy * er, rx * er, ry * er, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (let i = 0; i < 3; i++) ctx.fillRect(ex - er + ((t * 15 + i * 140) % (er * 2)), ey - er * (0.7 - i * 0.25), er * 0.6, er * 0.05);
  ctx.restore();
  // Moon and a ringed planet.
  ctx.beginPath();
  ctx.arc(W * 0.86, H * 0.2, H * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = "#d9d6cf";
  ctx.fill();
  ink(ctx, ow);
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  for (const [dx, dy, rr] of [[-0.02, -0.02, 0.015], [0.025, 0.01, 0.01], [0, 0.03, 0.008]]) {
    ctx.beginPath();
    ctx.arc(W * 0.86 + dx * H, H * 0.2 + dy * H, rr * H, 0, Math.PI * 2);
    ctx.fill();
  }
  const px = W * 0.66;
  const py = H * 0.72;
  ctx.beginPath();
  ctx.arc(px, py, H * 0.05, 0, Math.PI * 2);
  ctx.fillStyle = "#e4a95c";
  ctx.fill();
  ink(ctx, ow);
  ctx.beginPath();
  ctx.ellipse(px, py, H * 0.1, H * 0.022, -0.35, 0, Math.PI * 2);
  ctx.strokeStyle = "#f2d59b";
  ctx.lineWidth = ow * 2;
  ctx.stroke();
  // The ball streaks across, spinning, with a fiery trail.
  const k = (t % 4) / 4;
  const bx = st.left + (st.right - st.left) * (0.2 + k * 0.6);
  const by = H * (0.85 - k * 0.7);
  for (let i = 8; i > 0; i--) {
    const q = i / 8;
    ctx.beginPath();
    ctx.arc(bx - q * W * 0.12, by + q * H * 0.14, H * 0.03 * (1 - q * 0.7), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,${Math.round(120 + 100 * q)},60,${0.55 * (1 - q)})`;
    ctx.fill();
  }
  football(ctx, bx, by, H * 0.04, t * 8, ow);
}

/** Paints the period sets; returns false for any other setting. */
function paintPeriod(ctx: C, scene: Scene, st: Stage, t: number, seed: number): boolean {
  const tod = scene.timeOfDay;
  const { W, H } = st;
  const gy = st.groundY;
  const bl = backLine(st);
  const ow = Math.max(2, H * 0.0032);
  const night = tod === "night";
  switch (scene.setting) {
    case "news-studio":
      newsStudio(ctx, scene, st, t, seed);
      return true;
    case "stadium":
      stadium(ctx, scene, st, t, seed);
      return true;
    case "space":
      space(ctx, st, t, seed);
      return true;
    case "japanese-street": {
      sky(ctx, st, tod, t, seed, bl);
      fuji(ctx, W * 0.3, bl - H * 0.05, H * 0.3, tod);
      hills(ctx, st, bl, H * 0.1, mix("#6c8a6e", SKY[tod][2], 0.5), seed + 2, 0.8);
      const r = rng(seed + 1);
      const base = gy - H * 0.05;
      for (let x = st.left; x < st.right; ) {
        const bw = W * (0.17 + r() * 0.06);
        machiya(ctx, x + 3, base, bw - 6, H * (0.4 + r() * 0.08), r, tod, ow, t);
        x += bw;
      }
      dirt(ctx, st, base, "#c2a878", "#d6c09a", seed + 3);
      // Drainage edge along the houses.
      box(ctx, st.left, base, st.right - st.left, H * 0.012, "#8a8378", 0);
      edoGate(ctx, W * 0.86, gy + H * 0.01, H, ow);
      if (night) {
        ctx.fillStyle = "rgba(15,20,50,0.28)";
        ctx.fillRect(st.left, -H, st.right - st.left, H * 3);
      }
      return true;
    }

    case "japanese-castle": {
      sky(ctx, st, tod, t, seed, bl);
      hills(ctx, st, bl, H * 0.12, mix("#5f7f62", SKY[tod][2], 0.5), seed + 2, 0.7);
      tenshu(ctx, W * 0.6, bl + H * 0.02, H, ow, tod);
      // Low white wall (dobei) with a tiled cap across the courtyard.
      const wy = bl + H * 0.02;
      box(ctx, st.left, wy - H * 0.07, st.right - st.left, H * 0.07, vgrad(ctx, wy - H * 0.07, wy, ["#f4efe4", "#ddd4c2"]), ow);
      box(ctx, st.left, wy - H * 0.02, st.right - st.left, H * 0.02, "#7a756c", ow);
      tiledRoof(ctx, st.left - W * 0.1, st.right + W * 0.1, wy - H * 0.065, H * 0.035, ow, "#3e4652");
      pine(ctx, W * 0.12, wy + H * 0.02, H * 0.5, "#2f5a3a", ow);
      leafyTree(ctx, W * 0.93, gy - H * 0.02, H * 0.5, "#f2b8c6", seed + 4, ow);
      dirt(ctx, st, wy, "#d6cdb8", "#e4dccb", seed + 3);
      // Drifting cherry petals.
      const r = rng(seed + 9);
      ctx.fillStyle = "#f6c6d2";
      for (let i = 0; i < 26; i++) {
        const px = st.left + ((r() * (st.right - st.left) + t * 30 * (0.6 + r())) % (st.right - st.left));
        const py = ((r() * H + t * 40 * (0.5 + r())) % (H * 0.9)) + H * 0.05;
        ctx.beginPath();
        ctx.ellipse(px, py, 4, 2.4, t + i, 0, Math.PI * 2);
        ctx.fill();
      }
      if (night) {
        ctx.fillStyle = "rgba(15,20,50,0.3)";
        ctx.fillRect(st.left, -H, st.right - st.left, H * 3);
      }
      return true;
    }

    case "dojo": {
      wall(ctx, st, bl, "#f2ebdc", "#e2d6bd");
      // Timber frame: posts, top beam, nageshi rail; wood wainscot below.
      const post = W * 0.024;
      for (let x = st.left; x < st.right; x += W * 0.25) box(ctx, x - post / 2, -H, post, bl + H, vgrad(ctx, 0, bl, ["#6b4528", "#4e321d"]), ow);
      box(ctx, st.left, -H, st.right - st.left, H * 1.05, "#4e321d", ow);
      box(ctx, st.left, H * 0.3, st.right - st.left, H * 0.025, "#5e3f27", ow);
      box(ctx, st.left, bl - H * 0.17, st.right - st.left, H * 0.17, vgrad(ctx, bl - H * 0.17, bl, ["#8a5e38", "#6b4528"]), ow);
      ctx.strokeStyle = rgba(INK, 0.3);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = st.left; x < st.right; x += W * 0.06) {
        ctx.moveTo(x, bl - H * 0.17);
        ctx.lineTo(x, bl);
      }
      ctx.stroke();
      // Kamiza: hanging calligraphy scroll between two shelves.
      const sx = W * 0.5;
      box(ctx, sx - W * 0.05, H * 0.06, W * 0.1, H * 0.22, "#f7f1e2", ow, 2);
      box(ctx, sx - W * 0.055, H * 0.05, W * 0.11, H * 0.014, "#4e321d", ow);
      box(ctx, sx - W * 0.055, H * 0.275, W * 0.11, H * 0.014, "#4e321d", ow);
      ctx.strokeStyle = INK;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(3, W * 0.005);
      ctx.beginPath();
      ctx.moveTo(sx - W * 0.015, H * 0.09);
      ctx.lineTo(sx + W * 0.02, H * 0.1);
      ctx.moveTo(sx, H * 0.085);
      ctx.quadraticCurveTo(sx - W * 0.005, H * 0.17, sx - W * 0.02, H * 0.2);
      ctx.moveTo(sx + W * 0.005, H * 0.15);
      ctx.lineTo(sx + W * 0.022, H * 0.2);
      ctx.moveTo(sx - W * 0.018, H * 0.23);
      ctx.lineTo(sx + W * 0.02, H * 0.235);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx + W * 0.022, H * 0.255, W * 0.006, 0, Math.PI * 2);
      ctx.fillStyle = "#c0392b";
      ctx.fill();
      // Weapon rack with wooden swords.
      const rx = W * 0.1;
      box(ctx, rx - W * 0.06, H * 0.36, W * 0.012, bl - H * 0.38, "#5a3d26", ow);
      box(ctx, rx + W * 0.05, H * 0.36, W * 0.012, bl - H * 0.38, "#5a3d26", ow);
      for (let k = 0; k < 4; k++) {
        const y = H * 0.4 + k * H * 0.07;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(rx - W * 0.075, y + H * 0.01);
        ctx.quadraticCurveTo(rx, y - H * 0.008, rx + W * 0.08, y);
        ctx.stroke();
        ctx.strokeStyle = k % 2 ? "#c9a46c" : "#b48a54";
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      // Name plaques (nafudakake).
      const nx = W * 0.78;
      box(ctx, nx, H * 0.36, W * 0.16, H * 0.2, "#7a5434", ow, 2);
      for (let k = 0; k < 8; k++) box(ctx, nx + W * 0.008 + k * W * 0.019, H * 0.375, W * 0.014, H * 0.16, "#efe2c4", 1);
      floor(ctx, st, bl, "#c49a62", "wood");
      if (tod !== "night") {
        ctx.fillStyle = "rgba(255,240,200,0.12)";
        ctx.beginPath();
        ctx.moveTo(W * 0.3, bl);
        ctx.lineTo(W * 0.42, bl);
        ctx.lineTo(W * 0.6, H * 1.1);
        ctx.lineTo(W * 0.4, H * 1.1);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(15,20,45,0.28)";
        ctx.fillRect(st.left, -H, st.right - st.left, H * 3);
        for (const lx of [W * 0.3, W * 0.7]) glow(ctx, lx, H * 0.2, H * 0.5, "255,200,120", 0.3);
      }
      return true;
    }

    case "egypt-market": {
      sky(ctx, st, tod, t, seed, bl);
      // Pyramids on the horizon, hazed into the sky.
      for (const [px, ph] of [[0.18, 0.2], [0.3, 0.13]] as const) {
        ctx.beginPath();
        ctx.moveTo(W * px - H * ph, bl);
        ctx.lineTo(W * px, bl - H * ph);
        ctx.lineTo(W * px + H * ph, bl);
        ctx.closePath();
        ctx.fillStyle = mix("#d9b77a", SKY[tod][2], 0.45);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(W * px, bl - H * ph);
        ctx.lineTo(W * px + H * ph, bl);
        ctx.lineTo(W * px + H * ph * 0.2, bl);
        ctx.closePath();
        ctx.fillStyle = rgba("#7a5a34", 0.18);
        ctx.fill();
      }
      const r = rng(seed + 1);
      const base = gy - H * 0.08;
      for (let x = st.left; x < st.right; ) {
        const bw = W * (0.15 + r() * 0.08);
        egyptHouse(ctx, x + 2, base, bw - 4, H * (0.3 + r() * 0.18), r, night, ow);
        if (r() > 0.6) palm(ctx, x + bw * 0.95, base, H * 0.42, ow);
        x += bw;
      }
      dirt(ctx, st, base, "#dcc08a", "#e9d4a6", seed + 3);
      stall(ctx, W * 0.04, gy - H * 0.02, W * 0.2, H, r, ow);
      stall(ctx, W * 0.74, gy - H * 0.02, W * 0.22, H, r, ow);
      if (night) {
        ctx.fillStyle = "rgba(15,20,50,0.32)";
        ctx.fillRect(st.left, -H, st.right - st.left, H * 3);
        for (const tx of [W * 0.03, W * 0.97]) torch(ctx, tx, gy - H * 0.42, H, t, ow);
      }
      return true;
    }
  }
  return false;
}
