import type { ActionId, Character, EmotionId, PropId, SettingId, StyleId } from "../schema";
import { BONES, type Pose } from "../rig";
import type { Painter } from "./painter";

interface Pt {
  x: number;
  y: number;
}

export interface FigureState {
  character: Character;
  x: number;
  groundY: number;
  size: number; // px figure height
  facing: 1 | -1;
  pose: Pose;
  action: ActionId;
  emotion: EmotionId;
  prop: PropId;
  t: number; // scene-local seconds (for effect animation)
  /** Seconds since the current action started (the rig's clock), for props that follow it. */
  actionT?: number;
  style: StyleId;
  /** Lets the cinematic renderer adapt props/poses to the place (e.g. kneeling in a Japanese room). */
  setting?: SettingId;
}

function limb(origin: Pt, angle: number, bend: number, l1: number, l2: number, f: number): [Pt, Pt] {
  const a1 = angle;
  const j = { x: origin.x + Math.sin(a1) * l1 * f, y: origin.y + Math.cos(a1) * l1 };
  const a2 = angle + bend;
  const e = { x: j.x + Math.sin(a2) * l2 * f, y: j.y + Math.cos(a2) * l2 };
  return [j, e];
}

function stroke(p: Painter, pts: Pt[], color: string, w: number) {
  const c = p.ctx;
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  for (const q of pts.slice(1)) c.lineTo(q.x, q.y);
  c.strokeStyle = color;
  c.lineWidth = w;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.stroke();
}

export function drawFigure(p: Painter, s: FigureState) {
  const { ctx, pal } = p;
  const S = s.size;
  const f = s.facing;
  const pose = s.pose;
  // Hand-drawn style: slender ink lines and a bigger head (about 4.5 heads tall) for expressions.
  const sketch = s.style === "sketch";
  const lw = sketch ? Math.max(2.2, S * 0.02) : Math.max(3, S * 0.032);
  const headK = sketch ? 1.3 : 1;
  const limbColor = pal.limb;

  if (s.action === "sit") drawSeat(p, s.x - f * S * 0.05, s.groundY, S);

  // Soft contact shadow (color styles only)
  if (p.color) {
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    const lift = Math.max(0, pose.hipY - BONES.hipHeight);
    ctx.ellipse(s.x, s.groundY, S * 0.14 * (1 - lift), S * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(s.x, s.groundY - pose.hipY * S);
  ctx.rotate(pose.rot * f);

  const hip: Pt = { x: 0, y: 0 };
  const neck: Pt = { x: Math.sin(pose.lean) * BONES.torso * S * f, y: -Math.cos(pose.lean) * BONES.torso * S };
  const shoulder: Pt = { x: neck.x * 0.93, y: neck.y * 0.93 };
  const headDir = pose.lean + pose.headTilt;
  const headDist = (BONES.neck + BONES.headR * headK) * S;
  const head: Pt = { x: neck.x + Math.sin(headDir) * headDist * f, y: neck.y - Math.cos(headDir) * headDist };
  const headR = BONES.headR * headK * S;

  const ua = BONES.upperArm * S;
  const fa = BONES.forearm * S;
  const th = BONES.thigh * S;
  const sh = BONES.shin * S;
  const [bE, bH] = limb(shoulder, pose.armBack[0], pose.armBack[1], ua, fa, f);
  const [fE, fH] = limb(shoulder, pose.armFront[0], pose.armFront[1], ua, fa, f);
  const [bK, bF] = limb(hip, pose.legBack[0], pose.legBack[1], th, sh, f);
  const [fK, fF] = limb(hip, pose.legFront[0], pose.legFront[1], th, sh, f);

  // back limbs
  stroke(p, [shoulder, bE, bH], limbColor, lw);
  stroke(p, [hip, bK, bF], limbColor, lw);

  drawTorso(p, s, hip, neck, lw);

  stroke(p, [hip, fK, fF], limbColor, lw);

  // head
  ctx.beginPath();
  ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
  ctx.fillStyle = pal.headFill;
  ctx.fill();
  ctx.strokeStyle = pal.line ? pal.ink : pal.limb;
  ctx.lineWidth = lw * (pal.line ? 1 : 0.8);
  ctx.stroke();

  drawFace(p, s, head, headR, lw);
  drawHat(p, s, head, headR, headDir);

  stroke(p, [shoulder, fE, fH], limbColor, lw);
  drawHeldProp(p, s, fE, fH, lw);

  ctx.restore();

  const hx = s.x + head.x;
  const hy = s.groundY - s.pose.hipY * s.size + head.y;
  drawFloatingPropAt(p, s, hx, hy, headR);
  drawEffectsAt(p, s, hx, hy, headR);
  drawKickBall(p, s);
}

function drawTorso(p: Painter, s: FigureState, hip: Pt, neck: Pt, lw: number) {
  const { ctx, pal } = p;
  const style = s.style;
  if (pal.line) {
    stroke(p, [hip, neck], pal.ink, lw);
    return;
  }
  if (style === "sketch") {
    stroke(p, [hip, neck], pal.limb, lw);
    // A crayon scarf in the character's colour tells the cast apart.
    const k = 0.82;
    const a: Pt = { x: hip.x + (neck.x - hip.x) * k, y: hip.y + (neck.y - hip.y) * k };
    ctx.globalAlpha = 0.85;
    stroke(p, [{ x: a.x - s.facing * lw * 1.6, y: a.y }, { x: a.x + s.facing * lw * 1.6, y: a.y }], s.character.color, lw * 2.4);
    stroke(p, [{ x: a.x - s.facing * lw * 1.2, y: a.y }, { x: a.x - s.facing * lw * 2.6, y: a.y + lw * 4 }], s.character.color, lw * 1.6);
    ctx.globalAlpha = 1;
    return;
  }
  const S = s.size;
  const ang = Math.atan2(neck.x - hip.x, -(neck.y - hip.y));
  const len = Math.hypot(neck.x - hip.x, neck.y - hip.y);
  ctx.save();
  ctx.translate(hip.x, hip.y);
  ctx.rotate(ang);
  let fill = s.character.color;
  let w = S * 0.075;
  if (style === "prehistoric") {
    fill = "#b07a45";
    w = S * 0.09;
  }
  if (style === "cozy") w = S * 0.065;
  ctx.beginPath();
  const top = -len * 0.92;
  ctx.moveTo(-w * 0.75, top);
  ctx.lineTo(w * 0.75, top);
  ctx.lineTo(w, S * 0.03);
  ctx.lineTo(-w, S * 0.03);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = pal.limb;
  ctx.lineWidth = lw * 0.55;
  ctx.stroke();
  if (style === "prehistoric") {
    ctx.fillStyle = "#6e4824";
    for (const [dx, dy] of [[-0.3, -0.5], [0.35, -0.25], [-0.1, -0.15], [0.2, -0.7]]) {
      ctx.beginPath();
      ctx.arc(dx * w, dy * len, S * 0.012, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (style === "modern-pop") {
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(-w, S * 0.0, w * 2, S * 0.05);
  }
  ctx.restore();
}

function drawFace(p: Painter, s: FigureState, head: Pt, r: number, lw: number) {
  const { ctx, pal } = p;
  const talking = s.pose.mouthOpen > 0.05;
  // Classic styles keep the hollow head unless an expression is needed.
  if (pal.line && s.emotion === "neutral" && !talking && s.action !== "sleep") return;
  const f = s.facing;
  const ink = pal.line ? pal.ink : "#111";
  const ex = head.x + f * r * 0.32;
  const ey = head.y - r * 0.12;
  const gap = r * 0.36;
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(2, lw * 0.5);
  ctx.lineCap = "round";

  const blink = Math.sin(s.t * 1.7) > 0.985;
  if (s.action === "sleep" || blink) {
    for (const dx of [-gap / 2, gap / 2]) {
      ctx.beginPath();
      ctx.moveTo(ex + dx - r * 0.1, ey);
      ctx.lineTo(ex + dx + r * 0.1, ey);
      ctx.stroke();
    }
  } else {
    const er = s.emotion === "surprised" || s.emotion === "scared" ? r * 0.13 : r * 0.1;
    for (const dx of [-gap / 2, gap / 2]) {
      ctx.beginPath();
      ctx.ellipse(ex + dx, ey, er * 0.8, er * 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (s.emotion === "angry") {
    ctx.beginPath();
    ctx.moveTo(ex - gap / 2 - r * 0.15, ey - r * 0.3);
    ctx.lineTo(ex - gap / 2 + r * 0.12, ey - r * 0.2);
    ctx.moveTo(ex + gap / 2 + r * 0.15, ey - r * 0.3);
    ctx.lineTo(ex + gap / 2 - r * 0.12, ey - r * 0.2);
    ctx.stroke();
  }

  const mx = head.x + f * r * 0.3;
  const my = head.y + r * 0.4;
  ctx.beginPath();
  if (talking || s.emotion === "surprised") {
    const open = talking ? s.pose.mouthOpen : 0.8;
    ctx.ellipse(mx, my, r * 0.14, r * (0.04 + 0.14 * open), 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  switch (s.emotion) {
    case "happy":
      ctx.arc(mx, my - r * 0.12, r * 0.22, 0.2 * Math.PI, 0.8 * Math.PI);
      break;
    case "sad":
    case "scared":
      ctx.arc(mx, my + r * 0.18, r * 0.2, 1.2 * Math.PI, 1.8 * Math.PI);
      break;
    case "angry":
      ctx.moveTo(mx - r * 0.18, my + r * 0.02);
      ctx.lineTo(mx + r * 0.18, my - r * 0.02);
      break;
    case "thinking":
      ctx.moveTo(mx - r * 0.12, my);
      ctx.lineTo(mx + r * 0.16, my - r * 0.06);
      break;
    default:
      ctx.moveTo(mx - r * 0.13, my);
      ctx.lineTo(mx + r * 0.13, my);
  }
  ctx.stroke();
}

function drawHat(p: Painter, s: FigureState, head: Pt, r: number, dir: number) {
  const hat = s.character.hat;
  if (hat === "none") return;
  const { ctx } = p;
  const f = s.facing;
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.rotate(dir * f);
  const color = p.pal.line ? p.pal.bg : s.character.color;
  const edge = p.pal.line ? p.pal.ink : "rgba(0,0,0,0.5)";
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.beginPath();
  switch (hat) {
    case "beanie":
      ctx.arc(0, -r * 0.15, r * 1.02, Math.PI * 1.02, Math.PI * 1.98);
      ctx.closePath();
      ctx.fillStyle = p.pal.line ? color : "#e11d2e";
      break;
    case "cap":
      ctx.arc(0, -r * 0.2, r * 0.98, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(f * r * 0.6, -r * 0.2);
      ctx.lineTo(f * r * 1.55, -r * 0.12);
      ctx.lineWidth = r * 0.18;
      ctx.strokeStyle = p.pal.line ? p.pal.ink : color;
      break;
    case "crown":
      ctx.moveTo(-r * 0.7, -r * 0.7);
      ctx.lineTo(-r * 0.7, -r * 1.45);
      ctx.lineTo(-r * 0.35, -r * 1.05);
      ctx.lineTo(0, -r * 1.6);
      ctx.lineTo(r * 0.35, -r * 1.05);
      ctx.lineTo(r * 0.7, -r * 1.45);
      ctx.lineTo(r * 0.7, -r * 0.7);
      ctx.closePath();
      ctx.fillStyle = p.pal.line ? color : "#f5c518";
      break;
    case "bow":
      ctx.ellipse(-f * r * 0.7, -r * 0.8, r * 0.35, r * 0.22, -0.5, 0, Math.PI * 2);
      ctx.ellipse(-f * r * 0.2, -r * 1.0, r * 0.35, r * 0.22, 0.5, 0, Math.PI * 2);
      ctx.fillStyle = p.pal.line ? color : "#ec4899";
      break;
    case "tophat":
      ctx.rect(-r * 0.6, -r * 2.0, r * 1.2, r * 1.15);
      ctx.rect(-r * 1.0, -r * 0.9, r * 2.0, r * 0.18);
      ctx.fillStyle = p.pal.line ? color : "#1f2937";
      break;
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawHeldProp(p: Painter, s: FigureState, elbow: Pt, hand: Pt, lw: number) {
  const { ctx } = p;
  const S = s.size;
  const f = s.facing;
  const u = S * 0.05;
  const ang = Math.atan2(hand.y - elbow.y, hand.x - elbow.x);
  switch (s.prop) {
    case "phone":
      p.roundRect(hand.x - u * 0.35, hand.y - u * 0.9, u * 0.7, u * 1.2, 3, "#1f2937");
      if (p.color) {
        ctx.fillStyle = "#7dd3fc";
        ctx.fillRect(hand.x - u * 0.25, hand.y - u * 0.8, u * 0.5, u * 0.9);
      }
      break;
    case "book":
      p.rect(hand.x - u * 0.2, hand.y - u * 0.8, u * 1.1 * f, u * 1.2, "#b45309");
      break;
    case "cup":
      p.rect(hand.x - u * 0.35, hand.y - u * 0.8, u * 0.7, u * 0.9, "#ffffff");
      if (p.color) {
        ctx.strokeStyle = "rgba(150,150,150,0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const w = Math.sin(s.t * 3) * 4;
        ctx.moveTo(hand.x, hand.y - u);
        ctx.quadraticCurveTo(hand.x + 6 + w, hand.y - u * 1.5, hand.x, hand.y - u * 2);
        ctx.stroke();
      }
      break;
    case "ball":
      // A kicker's ball is at the foot (drawKickBall), not in the hand.
      if (s.action !== "kick" && s.action !== "miss") p.circle(hand.x + f * u * 0.4, hand.y, u * 0.6, "#f97316");
      break;
    case "microphone": {
      // Held up towards the mouth, with a channel cube on the handle.
      const mx = hand.x + f * u * 0.2;
      const my = hand.y - u * 0.9;
      p.line(hand.x, hand.y + u * 0.2, mx, my, "#2b2b2b", lw * 0.9);
      p.roundRect(mx - u * 0.42, my + u * 0.15, u * 0.84, u * 0.5, 2, "#c8102e");
      p.circle(mx, my - u * 0.15, u * 0.38, "#6b7280");
      break;
    }
    case "trophy":
      p.poly([hand.x - u * 0.7, hand.y - u * 1.8, hand.x + u * 0.7, hand.y - u * 1.8, hand.x + u * 0.35, hand.y - u * 0.7, hand.x - u * 0.35, hand.y - u * 0.7], "#f2c230");
      p.rect(hand.x - u * 0.12, hand.y - u * 0.7, u * 0.24, u * 0.5, "#d4a020");
      p.rect(hand.x - u * 0.45, hand.y - u * 0.25, u * 0.9, u * 0.3, "#7a5a20");
      break;
    case "card": {
      // Shown high: yellow, or red for a sending-off (red when the actor is angry).
      const red = s.emotion === "angry";
      p.roundRect(hand.x - u * 0.3, hand.y - u * 1.2, u * 0.6, u * 0.85, 2, red ? "#e11d2e" : "#facc15");
      break;
    }
    case "bag":
      p.line(hand.x, hand.y, hand.x, hand.y + u * 0.6, "#5b3a1a", 3);
      p.roundRect(hand.x - u * 0.7, hand.y + u * 0.5, u * 1.4, u * 1.1, 5, "#8b5a2b");
      break;
    case "flower":
      p.line(hand.x, hand.y, hand.x + f * u * 0.3, hand.y - u * 1.6, "#15803d", 3);
      p.circle(hand.x + f * u * 0.3, hand.y - u * 1.7, u * 0.35, "#f43f5e");
      p.circle(hand.x + f * u * 0.3, hand.y - u * 1.7, u * 0.13, "#fde047");
      break;
    case "laptop":
      p.rect(hand.x - u, hand.y - u * 0.1, u * 2, u * 0.2, "#9ca3af");
      p.rect(hand.x - u * 0.9 * f, hand.y - u * 1.3, u * 0.2 * f, u * 1.2, "#374151");
      break;
    case "umbrella":
      p.line(hand.x, hand.y, hand.x, hand.y - u * 3, "#374151", 3);
      ctx.beginPath();
      ctx.arc(hand.x, hand.y - u * 2.8, u * 2, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = p.color ? "#2563eb" : p.pal.bg;
      ctx.fill();
      ctx.strokeStyle = p.color ? p.pal.outline : p.pal.ink;
      ctx.lineWidth = 3;
      ctx.stroke();
      break;
    case "gift":
      p.rect(hand.x - u * 0.6, hand.y - u * 0.6, u * 1.2, u * 1.1, "#a855f7");
      p.line(hand.x, hand.y - u * 0.6, hand.x, hand.y + u * 0.5, "#fde047", 3);
      break;
    case "sword":
    case "spear": {
      const len = s.prop === "spear" ? S * 0.55 : S * 0.32;
      const dx = Math.cos(ang - (f * Math.PI) / 2.4);
      const dy = Math.sin(ang - (f * Math.PI) / 2.4);
      p.line(hand.x - dx * len * 0.25, hand.y - dy * len * 0.25, hand.x + dx * len, hand.y + dy * len, s.prop === "spear" ? "#7c5a3a" : "#cbd5e1", lw * 0.8);
      if (s.prop === "sword" && (s.character.outfit === "kimono" || s.character.outfit === "hakama") && p.color) {
        // Katana: dark wrapped hilt behind the hand and a round guard.
        p.line(hand.x - dx * len * 0.28, hand.y - dy * len * 0.28, hand.x, hand.y, "#1d1a22", lw * 1.1);
        p.circle(hand.x + dx * u * 0.35, hand.y + dy * u * 0.35, u * 0.32, "#b08d3a");
      }
      if (s.prop === "spear") {
        const tx = hand.x + dx * len;
        const ty = hand.y + dy * len;
        p.poly([tx + dx * u, ty + dy * u, tx - dy * u * 0.35, ty + dx * u * 0.35, tx + dy * u * 0.35, ty - dx * u * 0.35], "#9ca3af");
      }
      break;
    }
    default:
      break;
  }
}

/** The ball in front of a kicking figure's foot: still while winding up, flying off after the strike. */
export function drawKickBall(p: Painter, s: FigureState) {
  if (s.action !== "kick" && s.action !== "miss") return;
  const S = s.size;
  const c = ((s.actionT ?? s.t) % 1.4) / 1.4;
  const fly = c < 0.42 ? 0 : (c - 0.42) / 0.58;
  const r = S * 0.045;
  // A "miss" is the meme shot: the ball rockets straight up out of the frame.
  const sky = s.action === "miss";
  const x = s.x + s.facing * (S * 0.2 + fly * S * (sky ? 0.5 : 1.6));
  const y = s.groundY - r - (sky ? fly * fly * S * 5 : Math.sin(fly * Math.PI) * S * 0.35);
  p.ctx.globalAlpha = sky ? 1 : 1 - fly * 0.9;
  p.circle(x, y, r, "#ffffff");
  p.circle(x + r * 0.15, y - r * 0.1, r * 0.35, "#1f1f1f");
  p.ctx.globalAlpha = 1;
}

/** Props that float above the head; (hx, hy) is the head centre in world space. */
export function drawFloatingPropAt(p: Painter, s: FigureState, hx: number, hy: number, r: number) {
  const x = hx;
  const y = hy - r * 2.4;
  const bob = Math.sin(s.t * 3) * r * 0.15;
  if (s.prop === "lightbulb") {
    if (p.color) {
      const g = p.ctx.createRadialGradient(x, y + bob, 2, x, y + bob, r * 1.6);
      g.addColorStop(0, "rgba(255,230,120,0.8)");
      g.addColorStop(1, "rgba(255,230,120,0)");
      p.ctx.fillStyle = g;
      p.ctx.fillRect(x - r * 2, y + bob - r * 2, r * 4, r * 4);
    }
    p.circle(x, y + bob, r * 0.55, "#fde047");
    p.rect(x - r * 0.25, y + bob + r * 0.5, r * 0.5, r * 0.3, "#9ca3af");
  } else if (s.prop === "heart") {
    const k = r * (0.5 + Math.sin(s.t * 6) * 0.06);
    p.ctx.beginPath();
    p.ctx.moveTo(x, y + bob + k * 0.9);
    p.ctx.bezierCurveTo(x - k * 1.6, y + bob - k * 0.2, x - k * 0.6, y + bob - k * 1.3, x, y + bob - k * 0.4);
    p.ctx.bezierCurveTo(x + k * 0.6, y + bob - k * 1.3, x + k * 1.6, y + bob - k * 0.2, x, y + bob + k * 0.9);
    p.ctx.fillStyle = p.color ? "#ef4444" : p.pal.bg;
    p.ctx.fill();
    p.ctx.strokeStyle = p.color ? "rgba(0,0,0,0.3)" : p.pal.ink;
    p.ctx.lineWidth = 2;
    p.ctx.stroke();
  }
}

export function drawEffectsAt(p: Painter, s: FigureState, hx: number, hy: number, r: number) {
  const { ctx } = p;
  const ink = p.pal.line ? p.pal.ink : "#1f2937";
  if (s.action === "sleep") {
    ctx.fillStyle = ink;
    for (let i = 0; i < 3; i++) {
      const k = (s.t * 0.5 + i / 3) % 1;
      ctx.globalAlpha = 1 - k;
      ctx.font = `bold ${Math.round(r * (0.6 + i * 0.25))}px sans-serif`;
      ctx.fillText("z", hx + r * (0.5 + k * 1.5), hy - r * (1 + k * 2.5));
    }
    ctx.globalAlpha = 1;
  }
  if (s.action === "cry") {
    ctx.fillStyle = "#38bdf8";
    for (let i = 0; i < 2; i++) {
      const k = (s.t * 1.4 + i * 0.5) % 1;
      ctx.beginPath();
      ctx.arc(hx + s.facing * r * 0.3 + (i ? r * 0.3 : -r * 0.1), hy + k * r * 2.2, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (s.emotion === "surprised" && s.action !== "sleep") {
    ctx.fillStyle = p.color ? "#ef4444" : ink;
    ctx.font = `bold ${Math.round(r * 1.2)}px sans-serif`;
    ctx.fillText("!", hx + s.facing * r * 1.1, hy - r * 1.2);
  }
  if (s.emotion === "scared") {
    ctx.fillStyle = "#7dd3fc";
    ctx.beginPath();
    ctx.ellipse(hx - s.facing * r * 0.9, hy - r * 0.4 + Math.sin(s.t * 5) * 2, r * 0.12, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (s.action === "think" && s.prop !== "lightbulb") {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const vis = (s.t * 1.5) % 4 > i;
      if (!vis) continue;
      ctx.beginPath();
      ctx.arc(hx + s.facing * r * (0.9 + i * 0.5), hy - r * (1.1 + i * 0.6), r * (0.08 + i * 0.06), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawSeat(p: Painter, x: number, gy: number, S: number) {
  const seatY = gy - S * 0.24;
  p.rect(x - S * 0.14, seatY, S * 0.28, S * 0.035, "#8a5a32");
  p.line(x - S * 0.11, seatY, x - S * 0.11, gy, "#6b4423", Math.max(3, S * 0.02));
  p.line(x + S * 0.11, seatY, x + S * 0.11, gy, "#6b4423", Math.max(3, S * 0.02));
}
