// Renders one still per scene for each style, for eyeballing renderer changes.
// Usage: npm run snapshot -- <outDir> [16:9|9:16]
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { planOffline } from "../server/planner/offline";
import { normalizeDraft } from "../shared/draft";
import { renderFrame } from "../shared/render/frame";
import { buildTimeline } from "../shared/timeline";
import { STYLES, canvasSize, type Project, type VideoSettings } from "../shared/schema";

const out = process.argv[2] ?? "snapshots";
const aspect = (process.argv[3] ?? "16:9") as VideoSettings["aspect"];
const story =
  "Mert ofiste bilgisayarının başında düşünüyordu. Aklına harika bir fikir geldi! Hemen patronu Selin ile konuştu. " +
  "Selin çok şaşırdı ve sevindi. Akşam ikisi birlikte parkta dans ederek kutladı.";
mkdirSync(out, { recursive: true });
const { width, height } = canvasSize(aspect);

for (const style of STYLES) {
  const settings: VideoSettings = { durationSec: 30, aspect, style, language: "tr", voiceover: false, subtitles: true };
  const n = normalizeDraft(planOffline(story, settings), settings);
  const project: Project = { id: "snap", story, settings, planner: "offline", createdAt: "", updatedAt: "", ...n };
  for (const s of buildTimeline(project.scenes).spans) {
    const c = createCanvas(width, height);
    renderFrame(c.getContext("2d") as unknown as CanvasRenderingContext2D, project, s.start + s.scene.durationSec * 0.6, {
      width, height, subtitles: true, cues: [{ start: s.start, end: s.end, text: s.scene.narration }],
    });
    writeFileSync(`${out}/${style}-${aspect.replace(":", "x")}-${s.index}.png`, c.toBuffer("image/png"));
  }
}
console.log(`Kareler yazıldı: ${out}`);
