import type { Scene, StyleId } from "../schema";
import { Painter, rng, hashString } from "./painter";

export interface Stage {
  W: number; // canvas width
  H: number; // canvas height
  groundY: number;
  figureH: number; // px height of a scale-1 figure
  left: number; // world-space extent drawn for pans/zooms
  right: number;
}

const SKY: Record<Scene["timeOfDay"], [string, string]> = {
  day: ["#8ecdf4", "#dff1fb"],
  sunset: ["#f7a26b", "#fde2b8"],
  night: ["#0f1a3a", "#2b3a66"],
};

const PREHISTORIC_SKY: Record<Scene["timeOfDay"], [string, string]> = {
  day: ["#e9d3a6", "#f5e8cc"],
  sunset: ["#e59a5c", "#f2cf9a"],
  night: ["#2e2a3a", "#4a4050"],
};

const GROUND: Record<Scene["setting"], string> = {
  blank: "#e8e2d6", park: "#7cc06b", street: "#b9bcc4", city: "#a8adb8", room: "#c79a6b",
  office: "#b8b2a6", classroom: "#c9a476", kitchen: "#e7dccb", forest: "#5f9e52", beach: "#f2d79b",
  mountain: "#8fae74", cave: "#6b5038", stage: "#7a4a2a",
  "japanese-room": "#cbbf86", "egypt-temple": "#d8b77f", desert: "#ebcf98", village: "#a9b77a", castle: "#857f76",
  "japanese-street": "#c2a878", "japanese-castle": "#b9ad92", dojo: "#c49a62", "egypt-market": "#dcc08a", "news-studio": "#1a2550", stadium: "#4c9a46", space: "#0b0f24",
};

// The flat styles have no art for the newer settings; borrow the closest classic one.
const LEGACY: Partial<Record<Scene["setting"], Scene["setting"]>> = {
  "japanese-room": "room", "egypt-temple": "mountain", desert: "mountain", village: "street", castle: "cave",
  "japanese-street": "street", "japanese-castle": "mountain", dojo: "room", "egypt-market": "street", "news-studio": "office", stadium: "park", space: "blank",
};

const INDOOR = new Set(["room", "office", "classroom", "kitchen", "stage", "cave"]);

export function drawBackground(p: Painter, original: Scene, stage: Stage, style: StyleId, t: number) {
  const scene = LEGACY[original.setting] ? { ...original, setting: LEGACY[original.setting]! } : original;
  const { ctx } = p;
  const { W, H, groundY: gy, left, right } = stage;
  const r = rng(hashString(scene.id + scene.setting));
  const span = right - left;

  // Sky / wall
  if (p.color && !INDOOR.has(scene.setting)) {
    const sky = style === "prehistoric" ? PREHISTORIC_SKY[scene.timeOfDay] : SKY[scene.timeOfDay];
    const g = ctx.createLinearGradient(0, 0, 0, gy);
    g.addColorStop(0, sky[0]);
    g.addColorStop(1, sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(left, -H, span, gy + H);
  } else {
    ctx.fillStyle = p.pal.bg;
    ctx.fillRect(left, -H, span, H * 3);
  }

  // Sun / moon / stars (outdoor only)
  if (!INDOOR.has(scene.setting) && scene.setting !== "blank") {
    if (scene.timeOfDay === "night") {
      if (p.color) {
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        for (let i = 0; i < 40; i++) {
          const tw = 0.6 + 0.4 * Math.sin(t * 2 + i);
          ctx.globalAlpha = tw;
          ctx.fillRect(left + r() * span, r() * gy * 0.6, 2, 2);
        }
        ctx.globalAlpha = 1;
      }
      p.circle(W * 0.82, H * 0.14, H * 0.05, "#f5f0d8");
    } else {
      p.circle(W * 0.84, H * (scene.timeOfDay === "sunset" ? 0.42 : 0.14), H * 0.06, scene.timeOfDay === "sunset" ? "#ff8a4c" : "#ffd84d");
      if (p.color) {
        for (let i = 0; i < 3; i++) {
          const cx = left + ((r() * span + t * 12 * (i + 1)) % span);
          cloud(p, cx, H * (0.08 + r() * 0.15), H * 0.04);
        }
      }
    }
  }

  // Setting scenery (drawn behind the ground line)
  switch (scene.setting) {
    case "park":
      for (let x = left + 40; x < right; x += W * 0.28 + r() * W * 0.1) tree(p, x, gy, H * (0.22 + r() * 0.08));
      p.rect(W * 0.5 - W * 0.09, gy - H * 0.06, W * 0.18, H * 0.02, "#a0703f");
      p.line(W * 0.5 - W * 0.08, gy - H * 0.04, W * 0.5 - W * 0.08, gy, "#6b4a2a", 4);
      p.line(W * 0.5 + W * 0.08, gy - H * 0.04, W * 0.5 + W * 0.08, gy, "#6b4a2a", 4);
      break;
    case "forest":
      for (let x = left; x < right; x += W * 0.1 + r() * W * 0.08) tree(p, x, gy - H * 0.03, H * (0.3 + r() * 0.15), "#3f7a3a");
      for (let x = left + 30; x < right; x += W * 0.16 + r() * W * 0.1) tree(p, x, gy, H * (0.25 + r() * 0.1));
      break;
    case "street":
    case "city": {
      const tall = scene.setting === "city" ? 0.55 : 0.35;
      for (let x = left; x < right; ) {
        const bw = W * (0.1 + r() * 0.08);
        const bh = H * (0.18 + r() * tall);
        const hue = ["#d9a07b", "#9bb7d4", "#c9c2b8", "#e3c87a", "#b79fc9"][Math.floor(r() * 5)];
        p.rect(x, gy - bh, bw - 6, bh, hue);
        windows(p, x, gy - bh, bw - 6, bh, scene.timeOfDay === "night");
        x += bw;
      }
      if (scene.setting === "street") {
        for (let x = left + W * 0.2; x < right; x += W * 0.45) {
          p.line(x, gy, x, gy - H * 0.32, "#444", 5);
          p.circle(x, gy - H * 0.33, H * 0.018, scene.timeOfDay === "night" ? "#ffe9a3" : "#ddd");
        }
      }
      break;
    }
    case "room":
      wall(p, stage, "#f3d9b8");
      windowFrame(p, W * 0.62, H * 0.15, W * 0.2, H * 0.3, scene.timeOfDay);
      p.rect(W * 0.18, H * 0.2, W * 0.12, H * 0.14, "#e8b04a");
      p.rect(W * 0.19, H * 0.215, W * 0.1, H * 0.11, "#7fb8d8");
      p.line(W * 0.9, gy, W * 0.9, gy - H * 0.3, "#555", 4);
      p.poly([W * 0.86, gy - H * 0.3, W * 0.94, gy - H * 0.3, W * 0.92, gy - H * 0.38, W * 0.88, gy - H * 0.38], "#f7e27a");
      break;
    case "office":
      wall(p, stage, "#dfe6ec");
      windowFrame(p, W * 0.08, H * 0.12, W * 0.24, H * 0.3, scene.timeOfDay);
      p.rect(W * 0.6, gy - H * 0.18, W * 0.3, H * 0.025, "#8a6a4a");
      p.line(W * 0.62, gy - H * 0.155, W * 0.62, gy, "#5a4632", 5);
      p.line(W * 0.88, gy - H * 0.155, W * 0.88, gy, "#5a4632", 5);
      p.rect(W * 0.7, gy - H * 0.3, W * 0.1, H * 0.11, "#2d3440");
      p.rect(W * 0.71, gy - H * 0.29, W * 0.08, H * 0.085, "#7fd3f0");
      p.rect(W * 0.94, gy - H * 0.12, W * 0.04, H * 0.12, "#c87b4a");
      tree(p, W * 0.96, gy - H * 0.11, H * 0.12, "#3f9a4a");
      break;
    case "classroom":
      wall(p, stage, "#f0e6c8");
      p.rect(W * 0.25, H * 0.12, W * 0.5, H * 0.3, "#2f5d47");
      if (p.color) {
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(W * 0.3, H * 0.2);
        ctx.lineTo(W * 0.45, H * 0.2);
        ctx.moveTo(W * 0.3, H * 0.26);
        ctx.lineTo(W * 0.6, H * 0.26);
        ctx.stroke();
      }
      p.rect(W * 0.25, H * 0.42, W * 0.5, H * 0.015, "#8a6a4a");
      break;
    case "kitchen":
      wall(p, stage, "#fbf1dc");
      if (p.color) {
        ctx.strokeStyle = "rgba(0,0,0,0.06)";
        ctx.lineWidth = 1;
        for (let y = H * 0.3; y < gy - H * 0.2; y += H * 0.04) {
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
        }
      }
      p.rect(W * 0.08, H * 0.1, W * 0.4, H * 0.14, "#c9e0e8");
      p.rect(W * 0.08, gy - H * 0.2, W * 0.4, H * 0.2, "#c9e0e8");
      p.rect(W * 0.06, gy - H * 0.22, W * 0.44, H * 0.025, "#9a8a7a");
      p.roundRect(W * 0.8, gy - H * 0.5, W * 0.12, H * 0.5, 10, "#f2f2f2");
      p.line(W * 0.815, gy - H * 0.42, W * 0.815, gy - H * 0.34, "#999", 4);
      break;
    case "beach": {
      if (p.color) {
        ctx.fillStyle = "#3aa0d8";
        ctx.fillRect(left, gy - H * 0.12, span, H * 0.12);
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          for (let x = left; x < right; x += 20) {
            const y = gy - H * (0.1 - i * 0.03) + Math.sin(x / 40 + t * 2 + i) * 3;
            if (x === left) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else {
        p.line(left, gy - H * 0.12, right, gy - H * 0.12, p.pal.ink, 2);
      }
      p.line(W * 0.15, gy, W * 0.13, gy - H * 0.3, "#8a6a4a", 5);
      p.poly([W * 0.03, gy - H * 0.3, W * 0.23, gy - H * 0.3, W * 0.13, gy - H * 0.38], "#ef5b5b");
      break;
    }
    case "mountain":
      for (let i = 0; i < 4; i++) {
        const mx = left + (i + 0.5) * (span / 4) + (r() - 0.5) * W * 0.1;
        const mh = H * (0.35 + r() * 0.2);
        const mw = W * (0.3 + r() * 0.15);
        p.poly([mx - mw / 2, gy, mx, gy - mh, mx + mw / 2, gy], style === "prehistoric" ? "#a08868" : "#7d8ea6");
        p.poly([mx - mw * 0.11, gy - mh * 0.78, mx, gy - mh, mx + mw * 0.11, gy - mh * 0.78], "#ffffff");
      }
      break;
    case "cave":
      if (p.color) {
        ctx.fillStyle = "#3a2a1c";
        ctx.fillRect(left, -H, span, H * 3);
      }
      p.poly([left, -H, right, -H, right, H * 0.25, W * 0.7, H * 0.12, W * 0.45, H * 0.18, W * 0.2, H * 0.1, left, H * 0.3], "#5a4330");
      fire(p, W * 0.5, gy, H * 0.08, t);
      break;
    case "stage":
      wall(p, stage, "#3a1d2e");
      p.rect(left, -H, W * 0.18 - left, gy + H, "#b0283a");
      p.rect(W * 0.82, -H, right - W * 0.82, gy + H, "#b0283a");
      if (p.color) {
        const g = ctx.createRadialGradient(W / 2, gy - H * 0.15, 10, W / 2, gy - H * 0.15, H * 0.45);
        g.addColorStop(0, "rgba(255,240,180,0.45)");
        g.addColorStop(1, "rgba(255,240,180,0)");
        ctx.fillStyle = g;
        ctx.fillRect(left, 0, span, gy);
      }
      break;
    case "blank":
      break;
  }

  // Ground
  if (p.color) {
    ctx.fillStyle = style === "prehistoric" && !INDOOR.has(scene.setting) ? "#b59464" : GROUND[scene.setting];
    if (style === "modern-pop" && scene.setting === "blank") ctx.fillStyle = "#f4f6f8";
    ctx.fillRect(left, gy, span, H * 2);
    if (scene.timeOfDay === "night" && !INDOOR.has(scene.setting)) {
      ctx.fillStyle = "rgba(10,15,40,0.35)";
      ctx.fillRect(left, gy, span, H * 2);
    }
  }
  p.line(left, gy, right, gy, p.pal.outline, p.pal.line ? 3 : 2);

  if (style === "modern-pop" && scene.setting === "blank" && p.color) {
    ctx.strokeStyle = "rgba(0,0,0,0.07)";
    ctx.lineWidth = 1;
    for (let i = -20; i <= 20; i++) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + i * W * 0.03, gy);
      ctx.lineTo(W / 2 + i * W * 0.12, H * 2);
      ctx.stroke();
    }
  }

  // Paper grain for the prehistoric look
  if (style === "prehistoric") {
    const g = rng(7);
    ctx.fillStyle = "rgba(80,50,20,0.06)";
    for (let i = 0; i < 500; i++) ctx.fillRect(left + g() * span, -H * 0.2 + g() * H * 1.4, 2, 2);
  }

  if (scene.timeOfDay === "night" && p.color && INDOOR.has(scene.setting) && scene.setting !== "cave") {
    ctx.fillStyle = "rgba(10,15,40,0.25)";
    ctx.fillRect(left, -H, span, H * 3);
  }
}

function wall(p: Painter, stage: Stage, color: string) {
  if (!p.color) return;
  p.ctx.fillStyle = color;
  p.ctx.fillRect(stage.left, -stage.H, stage.right - stage.left, stage.groundY + stage.H);
}

function cloud(p: Painter, x: number, y: number, r: number) {
  const c = p.ctx;
  c.fillStyle = "rgba(255,255,255,0.9)";
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.arc(x + r, y - r * 0.4, r * 1.1, 0, Math.PI * 2);
  c.arc(x + r * 2, y, r * 0.9, 0, Math.PI * 2);
  c.fill();
}

function tree(p: Painter, x: number, gy: number, h: number, leaf = "#4fa055") {
  p.rect(x - h * 0.05, gy - h * 0.55, h * 0.1, h * 0.55, "#8a5a32");
  p.circle(x, gy - h * 0.7, h * 0.3, leaf);
}

function windows(p: Painter, x: number, y: number, w: number, h: number, night: boolean) {
  const cols = Math.max(1, Math.floor(w / 26));
  const rows = Math.max(1, Math.floor(h / 34));
  const cw = w / cols;
  const rh = h / rows;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows - 1; j++) {
      const lit = night ? (i * 7 + j * 3) % 4 !== 0 : false;
      p.rect(x + i * cw + cw * 0.25, y + j * rh + rh * 0.3, cw * 0.5, rh * 0.45, lit ? "#ffe08a" : "#e9f3fb");
    }
}

function windowFrame(p: Painter, x: number, y: number, w: number, h: number, tod: Scene["timeOfDay"]) {
  p.rect(x, y, w, h, SKY[tod][0]);
  p.line(x + w / 2, y, x + w / 2, y + h, "#fff", 5);
  p.line(x, y + h / 2, x + w, y + h / 2, "#fff", 5);
}

function fire(p: Painter, x: number, gy: number, s: number, t: number) {
  p.line(x - s * 0.6, gy - 2, x + s * 0.6, gy - s * 0.2, "#6b4a2a", 6);
  p.line(x + s * 0.6, gy - 2, x - s * 0.6, gy - s * 0.2, "#6b4a2a", 6);
  const f = 1 + Math.sin(t * 12) * 0.08;
  if (p.color) {
    const g = p.ctx.createRadialGradient(x, gy - s * 0.4, 2, x, gy - s * 0.4, s * 3);
    g.addColorStop(0, "rgba(255,170,60,0.45)");
    g.addColorStop(1, "rgba(255,170,60,0)");
    p.ctx.fillStyle = g;
    p.ctx.fillRect(x - s * 3, gy - s * 3.4, s * 6, s * 6);
  }
  p.poly([x - s * 0.45, gy - s * 0.2, x, gy - s * 1.3 * f, x + s * 0.45, gy - s * 0.2], "#ff8a2a");
  p.poly([x - s * 0.22, gy - s * 0.2, x, gy - s * 0.8 * f, x + s * 0.22, gy - s * 0.2], "#ffd84d");
}
