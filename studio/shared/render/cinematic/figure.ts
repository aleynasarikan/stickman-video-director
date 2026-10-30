import type { Character, HairId, OutfitId } from "../../schema";
import { BONES, type Pose } from "../../rig";
import type { Painter } from "../painter";
import { hashString } from "../painter";
import { drawEffectsAt, drawFloatingPropAt, drawHeldProp, drawKickBall, type FigureState } from "../figure";
import { INK, mix, rgba, shade } from "./color";

interface Pt {
  x: number;
  y: number;
}

// Chibi proportions in units of the figure size S: a big round head on a short body,
// like hand-drawn explainer cartoons. Limb angles still come from the shared rig.
export const PRO = {
  headR: 0.15,
  neck: 0.012,
  torso: 0.25,
  upperArm: 0.125,
  forearm: 0.115,
  thigh: 0.165,
  shin: 0.165,
};
/** Rig hip heights are in BONES units; scale them to the shorter cartoon legs. */
export const LEG_K = (PRO.thigh + PRO.shin) / BONES.hipHeight;

const SKIN = "#fbf6ee";
const SKIN_SHADE = "#e6dccd";
const HAIR_COLORS = ["#1d1816", "#1d1816", "#2e1f17", "#4a2e1d", "#262329", "#6b3f22"];

export function hairColor(c: Character): string {
  // Period styles read best in black, as in Edo prints and Egyptian wigs.
  if (c.hair === "topknot" || c.hair === "bob") return HAIR_COLORS[0];
  return HAIR_COLORS[hashString(c.id) % HAIR_COLORS.length];
}

interface OutfitLook {
  top: string;
  legs: "pants" | "bare";
  pants: string;
  sleeves: "none" | "short" | "long" | "wide";
  sleeve: string;
  /** Skirt/robe length below the hip in S units (0 = none). */
  skirt: number;
  skirtColor: string;
  shoes: string;
}

export function outfitLook(outfit: OutfitId, color: string): OutfitLook {
  const base: OutfitLook = {
    top: color, legs: "pants", pants: "#3b4660", sleeves: "short", sleeve: color,
    skirt: 0, skirtColor: color, shoes: "#2a2420",
  };
  switch (outfit) {
    case "casual":
      return base;
    case "suit":
      return { ...base, top: "#2c3340", pants: "#2c3340", sleeves: "long", sleeve: "#2c3340", shoes: "#141414" };
    case "dress":
      return { ...base, legs: "bare", sleeves: "short", skirt: 0.17, skirtColor: color, shoes: shade(color, -0.45) };
    case "hoodie":
      return { ...base, pants: "#34373d", sleeves: "long", sleeve: color };
    case "labcoat":
      return { ...base, top: "#f3f3f0", pants: "#363b46", sleeves: "long", sleeve: "#f3f3f0", skirt: 0.16, skirtColor: "#f3f3f0" };
    case "kimono": {
      // Muted towards indigo, like dyed period cloth, while keeping the character's hue.
      const k = mix(shade(color, -0.3), "#2b3550", 0.35);
      return { ...base, top: k, legs: "bare", sleeves: "wide", sleeve: k, skirt: 0.3, skirtColor: k, shoes: "#d9c7a5" };
    }
    case "hakama": {
      // Samurai: indigo kimono top over wide, pleated grey trousers.
      const k = mix(shade(color, -0.45), "#232c45", 0.6);
      return { ...base, top: k, legs: "bare", sleeves: "wide", sleeve: k, skirt: 0.31, skirtColor: "#6b6e78", shoes: "#d9c7a5" };
    }
    case "tunic":
      return { ...base, top: "#efe6d2", legs: "bare", sleeves: "none", sleeve: SKIN, skirt: 0.25, skirtColor: "#f2ebdb", shoes: "#8a5a33" };
    case "toga":
      return { ...base, top: "#f1ede4", legs: "bare", sleeves: "none", sleeve: SKIN, skirt: 0.3, skirtColor: "#f1ede4", shoes: "#8a5a33" };
    case "armor":
      return { ...base, top: "#9aa3ad", legs: "bare", sleeves: "short", sleeve: color, skirt: 0.14, skirtColor: color, shoes: "#5b4636" };
    case "jersey":
      // Football kit: shirt in the character's colour, white shorts, dark boots.
      return { ...base, top: color, legs: "bare", sleeves: "short", sleeve: color, skirt: 0.1, skirtColor: "#f4f4f2", shoes: "#1b1b1b" };
    case "referee":
      return { ...base, top: "#1d1d20", legs: "bare", sleeves: "short", sleeve: "#1d1d20", skirt: 0.1, skirtColor: "#1d1d20", shoes: "#1b1b1b" };
    case "pelt":
      return { ...base, top: "#8a5a33", legs: "bare", sleeves: "none", sleeve: SKIN, skirt: 0.15, skirtColor: "#8a5a33", shoes: "#5b3a22" };
  }
}

function limb(origin: Pt, angle: number, bend: number, l1: number, l2: number, f: number): [Pt, Pt] {
  const j = { x: origin.x + Math.sin(angle) * l1 * f, y: origin.y + Math.cos(angle) * l1 };
  const a2 = angle + bend;
  return [j, { x: j.x + Math.sin(a2) * l2 * f, y: j.y + Math.cos(a2) * l2 }];
}

function path(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
}

/** A thick stroke with an ink outline: sleeves, trouser legs. */
function tube(ctx: CanvasRenderingContext2D, pts: Pt[], color: string, w: number, ow: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  path(ctx, pts);
  ctx.strokeStyle = INK;
  ctx.lineWidth = w + ow * 2;
  ctx.stroke();
  path(ctx, pts);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function inkLine(ctx: CanvasRenderingContext2D, pts: Pt[], w: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  path(ctx, pts);
  ctx.strokeStyle = INK;
  ctx.lineWidth = w;
  ctx.stroke();
}

function fillInk(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, ow: number) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/** Convex hull (monotone chain) — used to wrap skirts and robes around the legs in any pose. */
function hull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Point at distance d along a two-segment leg. */
function along(a: Pt, b: Pt, c: Pt, d: number): Pt {
  const l1 = Math.hypot(b.x - a.x, b.y - a.y);
  if (d <= l1) return { x: a.x + ((b.x - a.x) * d) / l1, y: a.y + ((b.y - a.y) * d) / l1 };
  const l2 = Math.hypot(c.x - b.x, c.y - b.y) || 1;
  const k = Math.min(1, (d - l1) / l2);
  return { x: b.x + (c.x - b.x) * k, y: b.y + (c.y - b.y) * k };
}

export function drawCinematicFigure(p: Painter, s: FigureState) {
  const { ctx } = p;
  const S = s.size;
  const f = s.facing;
  const kneel = s.action === "sit" && (s.setting === "japanese-room" || s.setting === "dojo");
  // Seiza: thighs forward, shins folded back under the body.
  const pose: Pose = kneel ? { ...s.pose, legFront: [Math.PI / 2, -Math.PI + 0.12], legBack: [Math.PI / 2 - 0.05, -Math.PI + 0.12], lean: 0.02 } : s.pose;
  const look = outfitLook(s.character.outfit, s.character.color);
  const ow = Math.max(1.6, S * 0.011); // outline width
  const lying = Math.abs(pose.rot) > 1;
  const hipH = kneel ? S * 0.09 : pose.hipY * LEG_K * S + (lying ? S * 0.07 : 0);

  if (kneel) drawCushion(p, s.x + f * S * 0.05, s.groundY, S, ow);
  else if (s.action === "sit") drawStool(p, s.x - f * S * 0.06, s.groundY, S, ow);
  if (s.action === "sleep") drawMat(p, s.x, s.groundY, S, ow, f);

  // Soft contact shadow.
  const lift = Math.max(0, pose.hipY - BONES.hipHeight) * LEG_K * S;
  const shR = S * (lying ? 0.42 : 0.2) * Math.max(0.4, 1 - lift / S);
  const g = ctx.createRadialGradient(s.x, s.groundY, 0, s.x, s.groundY, shR);
  g.addColorStop(0, "rgba(0,0,0,0.28)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(s.x, s.groundY, shR, shR * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(s.x, s.groundY - hipH);
  ctx.rotate(pose.rot * f);

  const hip: Pt = { x: 0, y: 0 };
  const T = PRO.torso * S;
  const neck: Pt = { x: Math.sin(pose.lean) * T * f, y: -Math.cos(pose.lean) * T };
  const shoulder: Pt = { x: neck.x * 0.86, y: neck.y * 0.86 };
  const headDir = pose.lean + pose.headTilt;
  const R = PRO.headR * S;
  const hd = PRO.neck * S + R * 0.9;
  const head: Pt = { x: neck.x + Math.sin(headDir) * hd * f, y: neck.y - Math.cos(headDir) * hd };

  const [bE, bH] = limb(shoulder, pose.armBack[0], pose.armBack[1], PRO.upperArm * S, PRO.forearm * S, f);
  const [fE, fH] = limb(shoulder, pose.armFront[0], pose.armFront[1], PRO.upperArm * S, PRO.forearm * S, f);
  const legOrigin = (side: number): Pt => ({ x: side * S * 0.025, y: 0 });
  const [bK, bF] = limb(legOrigin(-f), pose.legBack[0], pose.legBack[1], PRO.thigh * S, PRO.shin * S, f);
  const [fK, fF] = limb(legOrigin(f), pose.legFront[0], pose.legFront[1], PRO.thigh * S, PRO.shin * S, f);

  const hc = hairColor(s.character);
  drawHairBack(ctx, s.character.hair, head, R, f, hc, ow, s.t);
  if (s.character.outfit === "hoodie") {
    ctx.beginPath();
    ctx.ellipse(neck.x - f * S * 0.03, neck.y + S * 0.01, S * 0.075, S * 0.05, 0, 0, Math.PI * 2);
    fillInk(ctx, shade(look.top, -0.2), ow);
  }

  // Back limbs
  drawArm(ctx, shoulder, bE, bH, look, S, ow, true);
  drawLeg(ctx, legOrigin(-f), bK, bF, look, S, ow, f, true);
  drawLeg(ctx, legOrigin(f), fK, fF, look, S, ow, f, false);

  if (look.skirt > 0) drawSkirt(ctx, s.character.outfit, look, hip, [legOrigin(-f), bK, bF], [legOrigin(f), fK, fF], S, ow, f);

  drawTorso(ctx, s.character.outfit, look, hip, neck, S, ow, f, s.character.color);
  if (s.character.outfit === "hakama" && s.prop !== "sword" && !lying) drawSheathedKatana(ctx, S, ow, f);

  // Neck
  inkLine(ctx, [{ x: neck.x, y: neck.y + S * 0.01 }, { x: head.x * 0.4 + neck.x * 0.6, y: head.y * 0.4 + neck.y * 0.6 }], Math.max(2, S * 0.022));

  // Head
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.rotate(pose.headTilt * f * 0.6);
  ctx.scale(f, 1);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  const hg = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R * 1.05);
  hg.addColorStop(0, "#fffdf8");
  hg.addColorStop(0.65, SKIN);
  hg.addColorStop(1, SKIN_SHADE);
  fillInk(ctx, hg, ow * 1.1);
  drawFace(ctx, s, R, ow);
  drawHairFront(ctx, s.character.hair, R, hc, ow);
  drawHat(ctx, s.character.hat, R, ow, s.character.color);
  ctx.restore();

  drawArm(ctx, shoulder, fE, fH, look, S, ow, false);
  drawHeldProp(p, s, fE, fH, ow * 1.6);

  ctx.restore();

  // World-space position of the head for floating props and effects.
  const c = Math.cos(pose.rot * f);
  const sn = Math.sin(pose.rot * f);
  const hx = s.x + head.x * c - head.y * sn;
  const hy = s.groundY - hipH + head.x * sn + head.y * c;
  drawFloatingPropAt(p, s, hx, hy - R * 0.4, R * 0.75);
  drawEffectsAt(p, s, hx, hy, R * 0.75);
  drawKickBall(p, s);
}

function drawArm(ctx: CanvasRenderingContext2D, sh: Pt, el: Pt, hand: Pt, look: OutfitLook, S: number, ow: number, back: boolean) {
  const thin = Math.max(2, S * 0.022);
  const sleeveW = S * (look.sleeves === "wide" ? 0.07 : 0.05);
  const col = back ? shade(look.sleeve, -0.12) : look.sleeve;
  if (look.sleeves === "long" || look.sleeves === "wide") {
    tube(ctx, [sh, el, hand], col, sleeveW, ow);
  } else {
    inkLine(ctx, [sh, el, hand], thin);
    if (look.sleeves === "short") {
      const mid = { x: sh.x + (el.x - sh.x) * 0.55, y: sh.y + (el.y - sh.y) * 0.55 };
      tube(ctx, [sh, mid], col, sleeveW, ow);
    }
  }
  if (look.sleeves === "wide") {
    // Hanging kimono sleeve under the forearm.
    ctx.beginPath();
    ctx.moveTo(el.x - S * 0.03, el.y);
    ctx.quadraticCurveTo(el.x, el.y + S * 0.1, el.x + (hand.x - el.x) * 0.6, el.y + S * 0.07 + (hand.y - el.y) * 0.4);
    ctx.lineTo(el.x + (hand.x - el.x) * 0.7, el.y + (hand.y - el.y) * 0.7);
    ctx.closePath();
    fillInk(ctx, col, ow);
  }
  // Round white cartoon hand.
  ctx.beginPath();
  ctx.arc(hand.x, hand.y, S * 0.028, 0, Math.PI * 2);
  fillInk(ctx, back ? "#ece6dc" : "#ffffff", ow);
}

/** A sword worn through the sash: scabbard sloping back, hilt forward. */
function drawSheathedKatana(ctx: CanvasRenderingContext2D, S: number, ow: number, f: number) {
  const a = { x: -f * S * 0.2, y: S * 0.07 };
  const b = { x: f * S * 0.03, y: -S * 0.035 };
  const c = { x: f * S * 0.12, y: -S * 0.075 };
  ctx.lineCap = "round";
  for (const [from, to, w, col] of [[a, b, S * 0.03, "#1d1a22"], [b, c, S * 0.026, "#e8e2d4"]] as const) {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = INK;
    ctx.lineWidth = w + ow * 2;
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.stroke();
  }
  // Wrapped hilt and the round guard.
  ctx.strokeStyle = "#1d1a22";
  ctx.lineWidth = ow;
  for (let k = 0.25; k < 1; k += 0.25) {
    ctx.beginPath();
    ctx.arc(b.x + (c.x - b.x) * k, b.y + (c.y - b.y) * k, S * 0.008, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(b.x, b.y, S * 0.012, S * 0.028, Math.atan2(c.y - b.y, c.x - b.x), 0, Math.PI * 2);
  fillInk(ctx, "#b08d3a", ow);
}

function drawLeg(ctx: CanvasRenderingContext2D, hip: Pt, knee: Pt, foot: Pt, look: OutfitLook, S: number, ow: number, f: number, back: boolean) {
  if (look.legs === "pants") tube(ctx, [hip, knee, foot], back ? shade(look.pants, -0.15) : look.pants, S * 0.058, ow);
  else inkLine(ctx, [hip, knee, foot], Math.max(2, S * 0.022));
  // Shoe, pointing the way the figure faces.
  const ang = Math.atan2(foot.y - knee.y, foot.x - knee.x) - (f * Math.PI) / 2;
  ctx.save();
  ctx.translate(foot.x, foot.y);
  ctx.rotate(ang * 0.5);
  ctx.beginPath();
  ctx.ellipse(f * S * 0.018, -S * 0.004, S * 0.036, S * 0.019, 0, 0, Math.PI * 2);
  fillInk(ctx, back ? shade(look.shoes, -0.15) : look.shoes, ow);
  ctx.restore();
}

function drawSkirt(
  ctx: CanvasRenderingContext2D, outfit: OutfitId, look: OutfitLook, hip: Pt,
  back: [Pt, Pt, Pt], front: [Pt, Pt, Pt], S: number, ow: number, f: number,
) {
  const d = look.skirt * S;
  const pad = S * (look.skirt > 0.22 ? 0.05 : 0.045);
  const hw = S * 0.07;
  const pts: Pt[] = [{ x: hip.x - hw, y: hip.y - S * 0.03 }, { x: hip.x + hw, y: hip.y - S * 0.03 }];
  for (const leg of [back, front]) {
    // Sample along the leg so bent poses (sitting, kneeling) stay covered too.
    for (const k of [0.45, 0.75, 1]) {
      const q = along(leg[0], leg[1], leg[2], d * k);
      pts.push({ x: q.x - pad, y: q.y }, { x: q.x + pad, y: q.y }, { x: q.x, y: q.y + S * 0.01 });
    }
  }
  // Long robes keep a minimum width so they read as a garment, not trousers.
  if (look.skirt > 0.2) {
    const low = Math.max(...pts.map((q) => q.y));
    pts.push({ x: hip.x - S * 0.1, y: low - S * 0.01 }, { x: hip.x + S * 0.1, y: low - S * 0.01 });
  }
  const h = hull(pts);
  ctx.beginPath();
  ctx.moveTo(h[0].x, h[0].y);
  for (const q of h.slice(1)) ctx.lineTo(q.x, q.y);
  ctx.closePath();
  const minX = Math.min(...h.map((q) => q.x));
  const maxX = Math.max(...h.map((q) => q.x));
  const grad = ctx.createLinearGradient(minX, 0, maxX, 0);
  grad.addColorStop(0, shade(look.skirtColor, 0.12));
  grad.addColorStop(1, shade(look.skirtColor, -0.14));
  fillInk(ctx, grad, ow);

  // Folds and trims.
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(INK, 0.22);
  ctx.lineWidth = ow * 0.8;
  const low = Math.max(...h.map((q) => q.y));
  for (const k of [-0.35, 0.05, 0.4]) {
    ctx.beginPath();
    ctx.moveTo(hip.x + k * S * 0.12, hip.y + S * 0.04);
    ctx.lineTo(hip.x + k * S * 0.2, low);
    ctx.stroke();
  }
  if (outfit === "hakama") {
    // Sharp pleats down the front.
    ctx.strokeStyle = rgba(INK, 0.4);
    ctx.lineWidth = ow * 0.9;
    for (let x = minX + (maxX - minX) / 6; x < maxX - 1; x += (maxX - minX) / 6) {
      ctx.beginPath();
      ctx.moveTo(x, hip.y + S * 0.02);
      ctx.lineTo(x + (x - hip.x) * 0.15, low);
      ctx.stroke();
    }
  }
  if (outfit === "kimono" || outfit === "toga" || outfit === "tunic") {
    ctx.fillStyle = outfit === "kimono" ? shade(look.skirtColor, 0.35) : rgba("#b88a3a", 0.85);
    ctx.fillRect(minX - 5, low - S * 0.022, maxX - minX + 10, S * 0.014);
  }
  if (outfit === "armor") {
    ctx.strokeStyle = rgba(INK, 0.6);
    ctx.lineWidth = ow;
    for (let x = minX + S * 0.035; x < maxX; x += S * 0.035) {
      ctx.beginPath();
      ctx.moveTo(x, hip.y);
      ctx.lineTo(x, low);
      ctx.stroke();
    }
  }
  if (outfit === "pelt") {
    ctx.fillStyle = "#5b3a22";
    for (const [dx, dy] of [[-0.05, 0.05], [0.04, 0.09], [-0.01, 0.12]]) {
      ctx.beginPath();
      ctx.ellipse(hip.x + dx * S, hip.y + dy * S, S * 0.012, S * 0.008, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (outfit === "labcoat") {
    ctx.strokeStyle = rgba(INK, 0.5);
    ctx.lineWidth = ow;
    ctx.beginPath();
    ctx.moveTo(hip.x + f * S * 0.01, hip.y - S * 0.02);
    ctx.lineTo(hip.x + f * S * 0.02, low);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTorso(ctx: CanvasRenderingContext2D, outfit: OutfitId, look: OutfitLook, hip: Pt, neck: Pt, S: number, ow: number, f: number, accent: string) {
  const ang = Math.atan2(neck.x - hip.x, -(neck.y - hip.y));
  const len = Math.hypot(neck.x - hip.x, neck.y - hip.y);
  ctx.save();
  ctx.translate(hip.x, hip.y);
  ctx.rotate(ang);
  ctx.scale(f, 1); // local +x is the front of the body
  const sw = S * 0.088;
  const hw = S * 0.074;
  const top = -len * 0.98;
  const bottom = S * 0.035;
  const r = S * 0.04;
  ctx.beginPath();
  ctx.moveTo(-sw + r, top);
  ctx.lineTo(sw - r, top);
  ctx.quadraticCurveTo(sw, top, sw, top + r);
  ctx.lineTo(hw, bottom);
  ctx.lineTo(-hw, bottom);
  ctx.lineTo(-sw, top + r);
  ctx.quadraticCurveTo(-sw, top, -sw + r, top);
  ctx.closePath();
  const g = ctx.createLinearGradient(-sw, 0, sw, 0);
  g.addColorStop(0, shade(look.top, -0.16));
  g.addColorStop(0.55, look.top);
  g.addColorStop(1, shade(look.top, 0.1));
  fillInk(ctx, g, ow);

  ctx.save();
  ctx.clip();
  const line = (x1: number, y1: number, x2: number, y2: number, c = rgba(INK, 0.55), w = ow) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.stroke();
  };
  switch (outfit) {
    case "casual":
      ctx.beginPath();
      ctx.arc(S * 0.01, top, S * 0.032, 0, Math.PI);
      ctx.strokeStyle = rgba(INK, 0.5);
      ctx.lineWidth = ow;
      ctx.stroke();
      break;
    case "suit":
      ctx.beginPath();
      ctx.moveTo(-S * 0.02, top);
      ctx.lineTo(S * 0.045, top);
      ctx.lineTo(S * 0.012, top + len * 0.45);
      ctx.closePath();
      ctx.fillStyle = "#f5f5f2";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(S * 0.005, top + S * 0.01);
      ctx.lineTo(S * 0.025, top + S * 0.01);
      ctx.lineTo(S * 0.022, top + len * 0.42);
      ctx.lineTo(S * 0.012, top + len * 0.48);
      ctx.lineTo(S * 0.004, top + len * 0.42);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      line(-S * 0.02, top, S * 0.012, top + len * 0.55);
      line(S * 0.045, top, S * 0.012, top + len * 0.55);
      ctx.fillStyle = rgba(INK, 0.7);
      for (const y of [0.62, 0.78]) {
        ctx.beginPath();
        ctx.arc(S * 0.02, top + len * y, S * 0.006, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "dress":
      line(-hw, top + len * 0.78, hw, top + len * 0.78, rgba(INK, 0.35));
      ctx.beginPath();
      ctx.arc(S * 0.012, top, S * 0.036, 0, Math.PI);
      ctx.fillStyle = SKIN;
      ctx.fill();
      break;
    case "hoodie":
      line(S * 0.0, top + S * 0.01, S * 0.0, top + len * 0.35, rgba("#ffffff", 0.8), ow * 0.9);
      line(S * 0.03, top + S * 0.01, S * 0.03, top + len * 0.3, rgba("#ffffff", 0.8), ow * 0.9);
      ctx.strokeStyle = rgba(INK, 0.45);
      ctx.lineWidth = ow;
      ctx.strokeRect(-S * 0.045, top + len * 0.62, S * 0.11, len * 0.22);
      break;
    case "labcoat":
      ctx.beginPath();
      ctx.moveTo(-S * 0.015, top);
      ctx.lineTo(S * 0.045, top);
      ctx.lineTo(S * 0.016, top + len * 0.5);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      line(-S * 0.015, top, S * 0.016, bottom);
      line(S * 0.045, top, S * 0.016, top + len * 0.5);
      ctx.strokeStyle = rgba(INK, 0.45);
      ctx.strokeRect(S * 0.03, top + len * 0.55, S * 0.035, len * 0.15);
      break;
    case "jersey": {
      // V collar trim and a big shirt number.
      line(-S * 0.03, top, 0, top + len * 0.14, "#ffffff", S * 0.014);
      line(S * 0.03, top, 0, top + len * 0.14, "#ffffff", S * 0.014);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = rgba(INK, 0.6);
      ctx.lineWidth = ow * 0.6;
      ctx.font = `800 ${Math.round(S * 0.075)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.save();
      ctx.scale(f, 1); // keep the number readable whichever way the figure faces
      const num = String(((accent.charCodeAt(1) + accent.charCodeAt(3)) % 11) + 1);
      ctx.strokeText(num, 0, top + len * 0.5);
      ctx.fillText(num, 0, top + len * 0.5);
      ctx.restore();
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      break;
    }
    case "referee": {
      // Whistle on a cord.
      line(-S * 0.03, top + S * 0.005, S * 0.02, top + len * 0.35, "#d9d9d9", ow);
      ctx.beginPath();
      ctx.ellipse(S * 0.025, top + len * 0.38, S * 0.016, S * 0.01, 0, 0, Math.PI * 2);
      fillInk(ctx, "#c9ccd1", ow * 0.7);
      break;
    }
    case "kimono":
    case "hakama": {
      // Crossed collar and an obi sash.
      ctx.lineWidth = S * 0.018;
      ctx.strokeStyle = "#f4efe6";
      ctx.beginPath();
      ctx.moveTo(-S * 0.03, top);
      ctx.lineTo(S * 0.04, top + len * 0.55);
      ctx.moveTo(S * 0.05, top);
      ctx.lineTo(S * 0.0, top + len * 0.32);
      ctx.stroke();
      line(-S * 0.03, top, S * 0.04, top + len * 0.55, rgba(INK, 0.4), ow * 0.7);
      ctx.fillStyle = shade(accent, 0.35);
      ctx.fillRect(-sw, top + len * 0.62, sw * 2, len * 0.2);
      line(-sw, top + len * 0.62, sw, top + len * 0.62);
      line(-sw, top + len * 0.82, sw, top + len * 0.82);
      break;
    }
    case "tunic": {
      // Egyptian broad collar.
      const bands = [accent, "#d4a537", "#2f8f8a", "#d4a537"];
      bands.forEach((c, i) => {
        ctx.beginPath();
        ctx.ellipse(S * 0.01, top - S * 0.005, sw * (1.05 - i * 0.12), len * (0.4 - i * 0.07), 0, 0, Math.PI);
        ctx.fillStyle = c;
        ctx.fill();
      });
      ctx.beginPath();
      ctx.ellipse(S * 0.01, top - S * 0.005, sw * 0.55, len * 0.12, 0, 0, Math.PI);
      ctx.fillStyle = SKIN;
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(-sw, bottom - S * 0.03, sw * 2, S * 0.022);
      break;
    }
    case "toga":
      ctx.lineWidth = S * 0.035;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.moveTo(-sw, top + S * 0.01);
      ctx.lineTo(sw, top + len * 0.85);
      ctx.stroke();
      line(-sw, top + S * 0.03, sw, top + len * 0.9, rgba(INK, 0.35));
      break;
    case "armor":
      ctx.fillStyle = rgba("#ffffff", 0.25);
      ctx.fillRect(-sw * 0.3, top, sw * 0.5, len);
      for (const y of [0.35, 0.55, 0.75]) line(-sw, top + len * y, sw, top + len * y, rgba(INK, 0.45));
      ctx.fillStyle = accent;
      ctx.fillRect(-sw, bottom - S * 0.03, sw * 2, S * 0.025);
      break;
    case "pelt": {
      ctx.fillStyle = SKIN;
      ctx.beginPath();
      ctx.moveTo(sw, top);
      ctx.lineTo(sw, top + len * 0.45);
      ctx.lineTo(S * 0.0, top);
      ctx.closePath();
      ctx.fill();
      line(S * 0.0, top, sw, top + len * 0.45, INK, ow);
      ctx.fillStyle = "#5b3a22";
      for (const [x, y] of [[-0.03, 0.35], [0.02, 0.6], [-0.05, 0.75], [0.04, 0.85]]) {
        ctx.beginPath();
        ctx.ellipse(x * S, top + y * len, S * 0.013, S * 0.009, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
  // Soft shadow under the chin.
  ctx.fillStyle = rgba(INK, 0.12);
  ctx.beginPath();
  ctx.ellipse(S * 0.01, top, sw * 0.7, S * 0.022, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

// ---- Head (local frame: origin at the head centre, +x is the face direction) ----

function drawFace(ctx: CanvasRenderingContext2D, s: FigureState, R: number, ow: number) {
  const e = s.emotion;
  const seed = hashString(s.character.id) % 1000;
  const blinkT = (s.t + seed * 0.0037) % 3.6;
  const closed = s.action === "sleep" || blinkT < 0.13;
  const happyEyes = (e === "happy" && (s.action === "cheer" || s.action === "dance")) || s.action === "cheer";
  const cx = R * 0.2;
  const ey = R * 0.06;
  const eyes = [cx + R * 0.27, cx - R * 0.17];
  const big = e === "surprised" || e === "scared";

  // Blush
  if (e === "happy" || e === "surprised") {
    ctx.fillStyle = "rgba(240,120,120,0.28)";
    for (const x of [eyes[0] + R * 0.07, eyes[1] - R * 0.12]) {
      ctx.beginPath();
      ctx.ellipse(x, ey + R * 0.3, R * 0.11, R * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.lineCap = "round";
  for (const [i, x] of eyes.entries()) {
    const sc = i === 1 ? 0.92 : 1;
    if (closed) {
      ctx.beginPath();
      ctx.arc(x, ey - R * 0.02, R * 0.08 * sc, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.strokeStyle = INK;
      ctx.lineWidth = ow * 1.1;
      ctx.stroke();
      continue;
    }
    if (happyEyes) {
      ctx.beginPath();
      ctx.arc(x, ey + R * 0.04, R * 0.08 * sc, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.strokeStyle = INK;
      ctx.lineWidth = ow * 1.2;
      ctx.stroke();
      continue;
    }
    if (big) {
      ctx.beginPath();
      ctx.ellipse(x, ey, R * 0.12 * sc, R * 0.15 * sc, 0, 0, Math.PI * 2);
      fillInk(ctx, "#ffffff", ow * 0.8);
      ctx.beginPath();
      ctx.arc(x + R * 0.02, ey + R * 0.01, R * (e === "scared" ? 0.035 : 0.055), 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
      continue;
    }
    const lookUp = e === "thinking" ? -R * 0.05 : 0;
    ctx.beginPath();
    ctx.ellipse(x + (e === "thinking" ? R * 0.02 : 0), ey + lookUp, R * 0.07 * sc, R * 0.1 * sc, 0, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + R * 0.025, ey + lookUp - R * 0.035, R * 0.022, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    // Heavy upper lids give the deadpan / tired / sad looks.
    const lid = e === "sad" ? 0.55 : e === "angry" ? 0.5 : e === "neutral" ? 0.3 : 0;
    if (lid > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - R * 0.12, ey - R * 0.14, R * 0.24, R * 0.24 * lid);
      ctx.fillStyle = SKIN;
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      const ly = ey - R * 0.14 + R * 0.24 * lid;
      const tilt = e === "angry" ? (i === 0 ? -1 : 1) * R * 0.035 : e === "sad" ? (i === 0 ? 1 : -1) * R * 0.03 : 0;
      ctx.moveTo(x - R * 0.1, ly - tilt);
      ctx.lineTo(x + R * 0.1, ly + tilt);
      ctx.strokeStyle = INK;
      ctx.lineWidth = ow * 0.9;
      ctx.stroke();
    }
  }

  // Eyebrows
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow * 1.15;
  for (const [i, x] of eyes.entries()) {
    const inner = i === 0 ? -1 : 1; // direction towards the nose
    let y = ey - R * 0.24;
    let tilt = 0;
    if (e === "angry") tilt = R * 0.06;
    if (e === "sad" || e === "scared") tilt = -R * 0.06;
    if (big) y -= R * 0.08;
    if (e === "thinking" && i === 0) y -= R * 0.08;
    if (s.action === "sleep") y += R * 0.03;
    ctx.beginPath();
    ctx.moveTo(x - inner * R * 0.1, y);
    ctx.quadraticCurveTo(x, y - R * 0.03, x + inner * R * 0.09, y + tilt);
    ctx.stroke();
  }

  // Mouth
  const mx = cx + R * 0.06;
  const my = ey + R * 0.42;
  ctx.lineWidth = ow * 1.1;
  if (s.pose.mouthOpen > 0.05 || e === "surprised") {
    const open = e === "surprised" && s.pose.mouthOpen <= 0.05 ? 0.7 : s.pose.mouthOpen;
    ctx.beginPath();
    ctx.ellipse(mx, my, R * 0.11, R * (0.03 + 0.11 * open), 0, 0, Math.PI * 2);
    fillInk(ctx, "#6b2424", ow * 0.9);
    if (open > 0.4) {
      ctx.beginPath();
      ctx.ellipse(mx, my + R * 0.06 * open, R * 0.06, R * 0.03 * open, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#d9706b";
      ctx.fill();
    }
    return;
  }
  ctx.beginPath();
  switch (e) {
    case "happy":
      ctx.arc(mx, my - R * 0.1, R * 0.15, 0.2 * Math.PI, 0.8 * Math.PI);
      break;
    case "sad":
      ctx.arc(mx, my + R * 0.1, R * 0.11, 1.2 * Math.PI, 1.8 * Math.PI);
      break;
    case "scared":
      ctx.moveTo(mx - R * 0.1, my);
      ctx.quadraticCurveTo(mx - R * 0.05, my - R * 0.04, mx, my);
      ctx.quadraticCurveTo(mx + R * 0.05, my + R * 0.04, mx + R * 0.1, my);
      break;
    case "angry":
      ctx.arc(mx, my + R * 0.08, R * 0.1, 1.25 * Math.PI, 1.75 * Math.PI);
      break;
    case "thinking":
      ctx.moveTo(mx - R * 0.06, my);
      ctx.lineTo(mx + R * 0.09, my - R * 0.03);
      break;
    default:
      ctx.moveTo(mx - R * 0.07, my);
      ctx.quadraticCurveTo(mx, my + R * 0.015, mx + R * 0.07, my - R * 0.005);
  }
  ctx.stroke();
}

function hairBlob(ctx: CanvasRenderingContext2D, color: string, ow: number) {
  fillInk(ctx, color, ow);
}

/** Hair parts that hang behind the head and shoulders. Local frame = figure frame. */
function drawHairBack(ctx: CanvasRenderingContext2D, hair: HairId, head: Pt, R: number, f: number, color: string, ow: number, t: number) {
  if (!["bob", "long", "ponytail", "bun", "topknot"].includes(hair)) return;
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.scale(f, 1);
  ctx.beginPath();
  switch (hair) {
    case "bob":
      ctx.moveTo(-R * 1.12, R * 0.0);
      ctx.arc(0, -R * 0.02, R * 1.12, Math.PI, 0);
      ctx.lineTo(R * 1.1, R * 0.82);
      ctx.lineTo(-R * 1.12, R * 0.82);
      ctx.closePath();
      break;
    case "long": {
      const sway = Math.sin(t * 2) * R * 0.04;
      ctx.moveTo(-R * 1.08, 0);
      ctx.arc(0, -R * 0.02, R * 1.1, Math.PI, 0);
      ctx.quadraticCurveTo(R * 1.15, R * 1.0, R * 0.7 + sway, R * 1.7);
      ctx.lineTo(-R * 1.05 + sway, R * 1.75);
      ctx.quadraticCurveTo(-R * 1.25, R * 0.8, -R * 1.08, 0);
      break;
    }
    case "ponytail": {
      const sw = Math.sin(t * 3) * 0.15;
      ctx.save();
      ctx.translate(-R * 0.85, -R * 0.45);
      ctx.rotate(-0.5 + sw);
      ctx.ellipse(-R * 0.15, R * 0.55, R * 0.28, R * 0.62, 0.25, 0, Math.PI * 2);
      ctx.restore();
      break;
    }
    case "bun":
      ctx.arc(-R * 0.35, -R * 0.95, R * 0.36, 0, Math.PI * 2);
      break;
    case "topknot":
      ctx.save();
      ctx.translate(R * 0.05, -R * 1.02);
      ctx.rotate(0.2);
      ctx.roundRect(-R * 0.16, -R * 0.42, R * 0.32, R * 0.48, R * 0.14);
      ctx.restore();
      break;
  }
  hairBlob(ctx, color, ow);
  if (hair === "topknot" || hair === "bun") {
    ctx.beginPath();
    ctx.ellipse(hair === "bun" ? -R * 0.25 : R * 0.07, hair === "bun" ? -R * 0.68 : -R * 1.0, R * 0.17, R * 0.06, 0.2, 0, Math.PI * 2);
    ctx.fillStyle = hair === "bun" ? "#c0392b" : "#f4efe6";
    ctx.fill();
  }
  ctx.restore();
}

/** Hair on top of the head (drawn after the face). Local frame = head frame. */
function drawHairFront(ctx: CanvasRenderingContext2D, hair: HairId, R: number, color: string, ow: number) {
  if (hair === "none") return;
  ctx.beginPath();
  switch (hair) {
    case "short":
    case "spiky":
    case "curly":
    case "ponytail":
    case "bun":
    case "long":
      // Cap from behind the ear, over the crown, to a fringe above the eyes.
      ctx.moveTo(-R * 0.8, R * 0.42);
      ctx.arc(0, 0, R * 1.05, Math.PI * 0.86, Math.PI * 1.9);
      ctx.quadraticCurveTo(R * 0.78, -R * 0.42, R * 0.45, -R * 0.4);
      ctx.quadraticCurveTo(R * 0.15, -R * 0.52, -R * 0.15, -R * 0.38);
      ctx.quadraticCurveTo(-R * 0.48, -R * 0.2, -R * 0.5, R * 0.1);
      ctx.quadraticCurveTo(-R * 0.55, R * 0.32, -R * 0.8, R * 0.42);
      ctx.closePath();
      break;
    case "bob":
      ctx.moveTo(-R * 1.12, R * 0.0);
      ctx.arc(0, -R * 0.02, R * 1.12, Math.PI, Math.PI * 1.97);
      ctx.lineTo(R * 1.02, -R * 0.28);
      ctx.lineTo(-R * 0.3, -R * 0.28);
      ctx.lineTo(-R * 0.4, R * 0.2);
      ctx.lineTo(-R * 1.12, R * 0.3);
      ctx.closePath();
      break;
    case "topknot":
      // Edo chonmage: hair slicked over the crown and back, a clean forehead.
      ctx.moveTo(-R * 0.92, R * 0.38);
      ctx.arc(0, 0, R * 1.04, Math.PI * 0.88, Math.PI * 1.78);
      ctx.quadraticCurveTo(R * 0.35, -R * 0.66, -R * 0.05, -R * 0.62);
      ctx.quadraticCurveTo(-R * 0.48, -R * 0.45, -R * 0.55, R * 0.05);
      ctx.quadraticCurveTo(-R * 0.62, R * 0.3, -R * 0.92, R * 0.38);
      ctx.closePath();
      break;
  }
  hairBlob(ctx, color, ow);
  if (hair === "spiky") {
    ctx.beginPath();
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * (1.05 + (0.8 * i) / n);
      const r1 = R * 1.02;
      const r2 = R * 1.32;
      const a2 = a + (0.8 * Math.PI) / n / 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      else ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      if (i < n) ctx.lineTo(Math.cos(a2) * r2, Math.sin(a2) * r2);
    }
    ctx.closePath();
    hairBlob(ctx, color, ow);
  }
  if (hair === "curly") {
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.95 + i * 0.13);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98, R * 0.24, 0, Math.PI * 2);
      hairBlob(ctx, color, ow);
    }
  }
  // Sheen
  ctx.beginPath();
  ctx.arc(-R * 0.1, -R * 0.1, R * 0.82, Math.PI * 1.3, Math.PI * 1.55);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = R * 0.08;
  ctx.stroke();
}

function drawHat(ctx: CanvasRenderingContext2D, hat: Character["hat"], R: number, ow: number, color: string) {
  if (hat === "none") return;
  ctx.beginPath();
  switch (hat) {
    case "beanie":
      ctx.arc(0, -R * 0.12, R * 1.06, Math.PI * 1.02, Math.PI * 1.98);
      ctx.closePath();
      fillInk(ctx, "#d62839", ow);
      ctx.beginPath();
      ctx.roundRect(-R * 1.08, -R * 0.42, R * 2.16, R * 0.3, R * 0.1);
      fillInk(ctx, "#b81f2f", ow);
      return;
    case "cap":
      ctx.arc(0, -R * 0.2, R * 1.02, Math.PI, 0);
      ctx.closePath();
      fillInk(ctx, color, ow);
      ctx.beginPath();
      ctx.ellipse(R * 0.95, -R * 0.24, R * 0.6, R * 0.12, 0.05, 0, Math.PI * 2);
      fillInk(ctx, shade(color, -0.2), ow);
      return;
    case "crown":
      ctx.moveTo(-R * 0.7, -R * 0.72);
      ctx.lineTo(-R * 0.75, -R * 1.45);
      ctx.lineTo(-R * 0.38, -R * 1.08);
      ctx.lineTo(0, -R * 1.6);
      ctx.lineTo(R * 0.38, -R * 1.08);
      ctx.lineTo(R * 0.75, -R * 1.45);
      ctx.lineTo(R * 0.7, -R * 0.72);
      ctx.closePath();
      fillInk(ctx, "#f2c230", ow);
      for (const x of [-0.4, 0, 0.4]) {
        ctx.beginPath();
        ctx.arc(R * x, -R * 0.9, R * 0.08, 0, Math.PI * 2);
        ctx.fillStyle = x === 0 ? "#d62839" : "#2f6fd6";
        ctx.fill();
      }
      return;
    case "bow":
      ctx.ellipse(-R * 0.55, -R * 0.88, R * 0.32, R * 0.2, -0.5, 0, Math.PI * 2);
      fillInk(ctx, "#ec4899", ow);
      ctx.beginPath();
      ctx.ellipse(-R * 0.05, -R * 1.02, R * 0.32, R * 0.2, 0.5, 0, Math.PI * 2);
      fillInk(ctx, "#ec4899", ow);
      return;
    case "tophat":
      ctx.roundRect(-R * 0.62, -R * 2.0, R * 1.24, R * 1.15, R * 0.06);
      fillInk(ctx, "#1f2430", ow);
      ctx.beginPath();
      ctx.roundRect(-R * 1.05, -R * 0.92, R * 2.1, R * 0.18, R * 0.08);
      fillInk(ctx, "#1f2430", ow);
      ctx.fillStyle = color;
      ctx.fillRect(-R * 0.6, -R * 1.1, R * 1.2, R * 0.16);
      return;
    case "headband":
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.03, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#2f8f8a";
      ctx.fillRect(-R * 1.2, -R * 0.52, R * 2.4, R * 0.18);
      ctx.fillStyle = "#d4a537";
      ctx.fillRect(-R * 1.2, -R * 0.52, R * 2.4, R * 0.04);
      ctx.fillRect(-R * 1.2, -R * 0.38, R * 2.4, R * 0.04);
      ctx.restore();
      return;
    case "straw":
      ctx.moveTo(-R * 1.7, -R * 0.45);
      ctx.quadraticCurveTo(0, -R * 1.9, R * 1.7, -R * 0.45);
      ctx.quadraticCurveTo(0, -R * 0.7, -R * 1.7, -R * 0.45);
      fillInk(ctx, "#d9b46a", ow);
      ctx.strokeStyle = rgba(INK, 0.3);
      ctx.lineWidth = ow * 0.7;
      for (const x of [-0.9, -0.3, 0.3, 0.9]) {
        ctx.beginPath();
        ctx.moveTo(0, -R * 1.15);
        ctx.lineTo(R * x * 1.7, -R * 0.55);
        ctx.stroke();
      }
      return;
  }
}

function drawStool(p: Painter, x: number, gy: number, S: number, ow: number) {
  const { ctx } = p;
  const top = gy - S * 0.2 * (LEG_K / 0.733);
  const w = S * 0.16;
  ctx.lineCap = "round";
  for (const dx of [-w * 0.75, w * 0.75]) inkLine(ctx, [{ x: x + dx, y: top }, { x: x + dx * 1.1, y: gy }], S * 0.024);
  ctx.beginPath();
  ctx.roundRect(x - w, top - S * 0.025, w * 2, S * 0.045, S * 0.015);
  fillInk(ctx, "#a0703f", ow);
}

function drawCushion(p: Painter, x: number, gy: number, S: number, ow: number) {
  const { ctx } = p;
  ctx.beginPath();
  ctx.ellipse(x, gy - S * 0.02, S * 0.2, S * 0.045, 0, 0, Math.PI * 2);
  fillInk(ctx, "#7a3b46", ow);
  ctx.beginPath();
  ctx.ellipse(x, gy - S * 0.035, S * 0.17, S * 0.025, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#94505b";
  ctx.fill();
}

/** Futon under a sleeping figure; the head lies on the side opposite to `f`. */
function drawMat(p: Painter, x: number, gy: number, S: number, ow: number, f: number) {
  const { ctx } = p;
  const x0 = f > 0 ? x - S * 0.85 : x - S * 0.4;
  ctx.beginPath();
  ctx.roundRect(x0, gy - S * 0.06, S * 1.25, S * 0.06, S * 0.02);
  fillInk(ctx, "#e9e1f0", ow);
  ctx.beginPath();
  ctx.roundRect(x0, gy - S * 0.06, S * 1.25, S * 0.025, S * 0.01);
  ctx.fillStyle = mix("#7c6aa8", "#e9e1f0", 0.3);
  ctx.fill();
  const px = f > 0 ? x0 + S * 0.05 : x0 + S * 1.0;
  ctx.beginPath();
  ctx.roundRect(px, gy - S * 0.1, S * 0.2, S * 0.06, S * 0.03);
  fillInk(ctx, "#ffffff", ow);
}
