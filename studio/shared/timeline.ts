import type { Scene } from "./schema";

export interface SceneSpan {
  scene: Scene;
  index: number;
  start: number;
  end: number;
}

/** One spoken word, in seconds from the start of its clip (or of the video, inside a cue). */
export interface WordTime {
  text: string;
  start: number;
  end: number;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  /** Word timings for karaoke-style highlighting; absent for hand-made cues. */
  words?: WordTime[];
}

export function buildTimeline(scenes: Scene[]): { spans: SceneSpan[]; total: number } {
  let t = 0;
  const spans = scenes.map((scene, index) => {
    const span = { scene, index, start: t, end: t + scene.durationSec };
    t = span.end;
    return span;
  });
  return { spans, total: t };
}

/** When a punch-in camera snaps (seconds into the scene); its boom sound effect lands there too. */
export function punchAt(scene: Pick<Scene, "durationSec">): number {
  return Math.min(scene.durationSec * 0.55, Math.max(1.2, scene.durationSec - 1.5));
}

export function spanAt(spans: SceneSpan[], t: number): SceneSpan {
  for (const s of spans) if (t < s.end) return s;
  return spans[spans.length - 1];
}

/** Silence before each scene's narration starts (the exporter pads the voice clip by this much). */
export const SPEECH_LEAD = 0.15;

// Short phrases read faster than full sentences and keep the picture visible.
const MAX_CUE_CHARS = 34;

const VOWELS = /[aeıioöuüâîûAEIİOÖUÜÂÎÛ]/g;

/** Ends a sentence: "gol." does, a Turkish ordinal like "1." ("1. Lig", "9. hafta") does not. */
const sentenceEnd = (w: string) => /[.!?…]["'”’)]*$/.test(w) && !/^\d+\.$/.test(w);

/** Rough spoken weight of a word: its syllables (vowels), plus a pause after punctuation. */
function wordWeight(w: string): number {
  const syl = Math.max(1, (w.match(VOWELS) ?? []).length || Math.ceil(w.length / 3));
  return syl + (sentenceEnd(w) ? 1.6 : /[,;:]$/.test(w) ? 0.8 : 0);
}

/** Word timings spread over `speechSec` by syllable count, for engines that don't report them. */
export function estimateWordTimes(text: string, speechSec: number): WordTime[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const weights = words.map(wordWeight);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  return words.map((w, i) => {
    const d = (weights[i] / total) * speechSec;
    const out = { text: w, start: t, end: t + d * (/[.!?…,;:]$/.test(w) ? 0.75 : 1) };
    t += d;
    return out;
  });
}

/**
 * Times for the narration's own words. TTS engines report words after normalisation ("5" is
 * read as "beş"), so their list is used one-to-one only when the counts match; otherwise the
 * estimate is fitted into the span the engine actually spoke.
 */
export function narrationWordTimes(text: string, speechSec: number, spoken?: WordTime[]): WordTime[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (spoken?.length && spoken.length === words.length) return words.map((w, i) => ({ text: w, start: spoken[i].start, end: spoken[i].end }));
  if (spoken?.length) {
    const s0 = spoken[0].start;
    const span = spoken[spoken.length - 1].end - s0;
    return estimateWordTimes(text, span).map((w) => ({ ...w, start: w.start + s0, end: w.end + s0 }));
  }
  return estimateWordTimes(text, speechSec);
}

/**
 * Splits narration into short cues timed to the words. `words` are clip-relative timings of
 * the narration's words (see narrationWordTimes); without them the timing is estimated.
 */
export function sceneCues(text: string, start: number, speechSec: number, words?: WordTime[]): SubtitleCue[] {
  const times = words ?? estimateWordTimes(text, speechSec);
  if (times.length === 0) return [];
  const groups: WordTime[][] = [];
  let cur: WordTime[] = [];
  let len = 0;
  for (const w of times) {
    if (cur.length && len + 1 + w.text.length > MAX_CUE_CHARS) {
      groups.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(w);
    len += (len ? 1 : 0) + w.text.length;
    if (sentenceEnd(w.text) || (/[,;:]$/.test(w.text) && len > MAX_CUE_CHARS / 2)) {
      groups.push(cur);
      cur = [];
      len = 0;
    }
  }
  if (cur.length) groups.push(cur);
  const end = start + Math.max(speechSec, times[times.length - 1].end);
  return groups.map((g, i) => {
    const next = groups[i + 1];
    return {
      start: start + (i === 0 ? 0 : g[0].start),
      // A cue stays up until the next one starts, so the text never flickers off between phrases.
      end: next ? start + next[0].start : end,
      text: g.map((w) => w.text).join(" "),
      words: g.map((w) => ({ text: w.text, start: start + w.start, end: start + w.end })),
    };
  });
}

/** Estimated speaking time used when no real TTS duration is known. */
export function estimateSpeechSec(text: string, language: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wps = language === "tr" ? 2.2 : 2.6;
  return words / wps;
}

export function buildCues(spans: SceneSpan[], speechSec: (span: SceneSpan) => number, words?: (span: SceneSpan) => WordTime[] | undefined): SubtitleCue[] {
  return spans.flatMap((s) => {
    const sec = Math.min(speechSec(s), s.end - s.start - SPEECH_LEAD);
    return sceneCues(s.scene.narration, s.start + SPEECH_LEAD, sec, words?.(s));
  });
}

/** The spoken words inside one scene, in seconds from the scene's start. */
export function sceneWords(cues: SubtitleCue[] | undefined, span: { start: number; end: number }): WordTime[] {
  if (!cues) return [];
  return cues
    .filter((c) => c.start >= span.start - 1e-6 && c.start < span.end)
    .flatMap((c) => c.words ?? [])
    .map((w) => ({ text: w.text, start: w.start - span.start, end: w.end - span.start }));
}

// The picture leads the sound by about a frame, which reads as in sync.
const LIP_LEAD = 0.04;

/**
 * How open the speaker's mouth is at `t` (0 = closed): one open-close per syllable of the word
 * being spoken, closed between words and when nobody is speaking.
 */
export function mouthAt(words: WordTime[], t: number): number {
  const at = t + LIP_LEAD;
  for (const w of words) {
    if (at < w.start) return 0;
    if (at < w.end) {
      const syl = Math.max(1, (w.text.match(VOWELS) ?? []).length);
      const phase = ((at - w.start) / Math.max(0.05, w.end - w.start)) * syl;
      return 0.2 + 0.8 * Math.abs(Math.sin(Math.PI * phase));
    }
  }
  return 0;
}

export function cueAt(cues: SubtitleCue[], t: number): SubtitleCue | undefined {
  return cues.find((c) => t >= c.start && t < c.end);
}
