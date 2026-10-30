import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts } from "@napi-rs/canvas";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let done = false;

/** Makes the fonts the browser loads via CSS available to the MP4 renderer too. Safe to call repeatedly. */
export function registerFonts() {
  if (done) return;
  done = true;
  const caveat = path.join(root, "web", "public", "fonts", "Caveat.ttf");
  // Without it the renderer falls back to a system font; the video still renders.
  if (existsSync(caveat)) GlobalFonts.registerFromPath(caveat, "Caveat");
}
