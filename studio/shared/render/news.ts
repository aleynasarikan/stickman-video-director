import type { Project } from "../schema";
import type { SceneSpan } from "../timeline";
import type { Stage } from "./background";
import type { Ctx } from "./painter";

// Broadcast graphics for the "news" style: a channel bug, a lower third with the scene's
// kicker (its title, e.g. the source) and headline, and a ticker of every headline.

const SANS = `"Helvetica Neue", Helvetica, Arial, sans-serif`;
const RED = "#c8102e";
const NAVY = "#0f2557";

/** Height of the ticker band as a fraction of the frame; subtitles sit above it. */
export const TICKER_H = 0.065;

/** Ticker items: each distinct headline once (a story spans several scenes), minus the bulletin's own name. */
export function newsHeadlines(project: Project): string[] {
  const title = project.title.trim().toLocaleLowerCase("tr");
  const out = project.scenes
    .map((s) => s.headline?.trim())
    .filter((h): h is string => Boolean(h) && h!.toLocaleLowerCase("tr") !== title);
  return [...new Set(out)];
}

function fit(ctx: Ctx, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

export function drawNewsGraphics(ctx: Ctx, project: Project, span: SceneSpan, localT: number, stage: Stage) {
  const { W, H } = stage;
  const portrait = H > W;
  const u = portrait ? W / 720 : H / 720; // 1 at 720p
  const scene = span.scene;
  ctx.save();
  ctx.textBaseline = "middle";

  // Channel bug, top left.
  const by = 28 * u;
  const satire = project.settings.satire === true;
  const bug = satire ? "MİZAH" : "HABER";
  ctx.font = `800 ${Math.round(24 * u)}px ${SANS}`;
  const bw = ctx.measureText(bug).width + 28 * u;
  ctx.fillStyle = satire ? "#7c3aed" : RED;
  ctx.fillRect(28 * u, by, bw, 40 * u);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(bug, 42 * u, by + 21 * u);
  ctx.font = `600 ${Math.round(18 * u)}px ${SANS}`;
  const label = fit(ctx, project.title.toLocaleUpperCase("tr"), W * 0.5);
  const lw = ctx.measureText(label).width + 24 * u;
  ctx.fillStyle = "rgba(10,20,50,0.78)";
  ctx.fillRect(28 * u + bw, by, lw, 40 * u);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, 28 * u + bw + 12 * u, by + 21 * u);

  // Re-enactments (any scene outside the studio) are labelled so no one takes them for real footage.
  if (scene.setting !== "news-studio") {
    ctx.font = `800 ${Math.round(22 * u)}px ${SANS}`;
    const interview = scene.actors.some((a) => a.prop === "microphone");
    const label = interview ? "RÖPORTAJ · CANLANDIRMA" : "CANLANDIRMA";
    const w = ctx.measureText(label).width + 28 * u;
    const x = W - 28 * u - w;
    ctx.fillStyle = "#ffd400";
    ctx.fillRect(x, by, w, 40 * u);
    ctx.fillStyle = "#111111";
    ctx.fillText(label, x + 14 * u, by + 21 * u);
  }

  // Lower third: slides in from the left, leaves just before the cut.
  const headline = scene.headline?.trim();
  if (headline && localT > 0.3) {
    const k = Math.min(1, (localT - 0.3) / 0.4);
    const ease = 1 - Math.pow(1 - k, 3);
    const out = Math.min(1, Math.max(0, (scene.durationSec - localT) / 0.3));
    const x = 40 * u - (1 - ease) * W * 0.6;
    const y = H * (1 - TICKER_H) - (portrait ? 290 : 150) * u;
    const maxW = W - 80 * u;
    ctx.globalAlpha = out;
    ctx.font = `700 ${Math.round((portrait ? 34 : 32) * u)}px ${SANS}`;
    const text = fit(ctx, headline, maxW - 36 * u);
    const hw = Math.min(maxW, ctx.measureText(text).width + 36 * u);
    const kicker = scene.title.trim().toLocaleUpperCase("tr").slice(0, 32);
    if (kicker) {
      ctx.font = `800 ${Math.round(18 * u)}px ${SANS}`;
      const kw = ctx.measureText(kicker).width + 24 * u;
      ctx.fillStyle = RED;
      ctx.fillRect(x, y - 30 * u, kw, 30 * u);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(kicker, x + 12 * u, y - 14 * u);
    }
    ctx.fillStyle = NAVY;
    ctx.fillRect(x, y, hw, 58 * u);
    ctx.fillStyle = RED;
    ctx.fillRect(x, y + 58 * u, hw * ease, 5 * u);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.round((portrait ? 34 : 32) * u)}px ${SANS}`;
    ctx.fillText(text, x + 18 * u, y + 30 * u);
    ctx.globalAlpha = 1;
  }

  // Satire is said out loud at the start and the end: nobody should take a joke for a claim.
  if (satire && (span.index === 0 || span.index === project.scenes.length - 1)) {
    ctx.font = `600 ${Math.round(17 * u)}px ${SANS}`;
    const note = "Bu bir mizah içeriğidir; gerçek kişiler hakkında gerçek bir iddia içermez.";
    const nw = ctx.measureText(note).width + 24 * u;
    const ny = by + 48 * u; // under the bug, clear of the subtitles
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect((W - nw) / 2, ny, nw, 28 * u);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(note, (W - nw) / 2 + 12 * u, ny + 15 * u);
  }

  // Ticker: every headline of the bulletin scrolling right to left.
  const items = newsHeadlines(project);
  if (items.length) {
    const th = H * TICKER_H;
    const ty = H - th;
    ctx.fillStyle = "rgba(245,247,250,0.96)";
    ctx.fillRect(0, ty, W, th);
    ctx.font = `600 ${Math.round(th * 0.45)}px ${SANS}`;
    const line = items.join("   •   ") + "   •   ";
    const lineW = ctx.measureText(line).width;
    const t = span.start + localT;
    const label = "GÜNDEM";
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, ty, W, th);
    ctx.clip();
    ctx.fillStyle = NAVY;
    let x = W - ((t * 110 * u) % lineW);
    for (x -= lineW; x < W; x += lineW) ctx.fillText(line, x, ty + th / 2);
    ctx.restore();
    ctx.font = `800 ${Math.round(th * 0.45)}px ${SANS}`;
    const lw2 = ctx.measureText(label).width + 28 * u;
    ctx.fillStyle = RED;
    ctx.fillRect(0, ty, lw2, th);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, 14 * u, ty + th / 2);
  }
  ctx.restore();
}
