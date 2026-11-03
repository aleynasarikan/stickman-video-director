/**
 * Silence-aware word timing for TTS engines that do not report word timestamps (macOS say,
 * Pocket TTS, FreyaTTS). EMA Lightning reports its own timings and never comes through here.
 *
 * How it works:
 * 1. Read the clip's 16-bit PCM and measure loudness in 10 ms frames.
 * 2. Find where speech starts and ends, and the pauses (≥ 120 ms of silence) in between.
 * 3. Estimate word boundaries from spoken syllables (Turkish-aware: numbers, abbreviations,
 *    acronyms and apostrophe suffixes are counted as they are read aloud).
 * 4. Match the pauses to word boundaries jointly (dynamic programming, order preserved),
 *    preferring boundaries after punctuation; drop any match that would make the words between
 *    two pauses faster than speech; then spread those words by their syllables.
 *
 * Accuracy limits (documented in README "Kelime zamanlaması"):
 * - Pause edges are exact to ~10 ms; words *between* two pauses are still estimates, typically
 *   within 100–250 ms on a 2–3 s phrase and worse on long phrases spoken without a breath.
 * - A breath pause that does not fall at a word boundary in the estimate can be snapped to the
 *   neighbouring boundary; with no pause near any boundary the result equals the syllable estimate.
 * - Built for clean TTS output. Music, noise or reverb under the voice defeats the silence test.
 * - Only RIFF/WAVE 16-bit mono PCM is read (what the TTS engines here write); anything else
 *   returns null and the caller keeps the plain syllable estimate.
 */
import { readFile } from "node:fs/promises";
import type { WordTime } from "../shared/timeline";

export interface Pcm {
  samples: Int16Array;
  sampleRate: number;
}

export interface SpeechMap {
  /** First and last moment of speech, in seconds from the clip start. */
  start: number;
  end: number;
  /** Silences inside the speech, in time order. */
  pauses: { start: number; end: number }[];
}

const FRAME_SEC = 0.01;
export const MIN_PAUSE_SEC = 0.12;
const MIN_BLIP_SEC = 0.03;

/** Reads RIFF/WAVE PCM 16-bit mono without copying the sample data (when it is aligned). */
export function parseWav(buf: Buffer): Pcm | null {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let off = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === "data") {
      // 1 = PCM, 0xFFFE = WAVE_FORMAT_EXTENSIBLE (ffmpeg writes it for some layouts).
      if (!fmt || (fmt.format !== 1 && fmt.format !== 0xfffe) || fmt.channels !== 1 || fmt.bits !== 16) return null;
      // Streams written by a pipe can carry a 0/0xFFFFFFFF size: the data runs to the end.
      if (size === 0 || body + size > buf.length) size = buf.length - body;
      const n = Math.floor(size / 2);
      const abs = buf.byteOffset + body;
      const samples = abs % 2 === 0 ? new Int16Array(buf.buffer, abs, n) : new Int16Array(buf.buffer.slice(abs, abs + n * 2));
      return { samples, sampleRate: fmt.rate };
    }
    off = body + size + (size % 2);
  }
  return null;
}

/** Where speech is in a clip; null for a silent or unreadable one. */
export function detectSpeech({ samples, sampleRate }: Pcm): SpeechMap | null {
  const hop = Math.max(1, Math.round(sampleRate * FRAME_SEC));
  const frames = Math.floor(samples.length / hop);
  if (frames < 3) return null;
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop, end = i + hop; i < end; i++) sum += samples[i] * samples[i];
    db[f] = 10 * Math.log10(sum / hop / (32768 * 32768) + 1e-12);
  }
  const sorted = Float32Array.from(db).sort();
  const peak = sorted[frames - 1];
  if (peak < -60) return null;
  const floor = sorted[Math.floor(frames * 0.1)];
  const threshold = Math.min(peak - 6, Math.max(peak - 35, floor + 8));

  const voiced = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) voiced[f] = db[f] > threshold ? 1 : 0;
  // Drop clicks shorter than MIN_BLIP_SEC, then treat gaps shorter than MIN_PAUSE_SEC as speech
  // (stop consonants and syllable dips are not pauses).
  fillRuns(voiced, 1, Math.round(MIN_BLIP_SEC / FRAME_SEC), 0);
  const first = voiced.indexOf(1);
  const last = voiced.lastIndexOf(1);
  if (first < 0) return null;
  const pauses: SpeechMap["pauses"] = [];
  const minPause = Math.round(MIN_PAUSE_SEC / FRAME_SEC);
  for (let f = first; f <= last; ) {
    if (voiced[f]) {
      f++;
      continue;
    }
    let g = f;
    while (g <= last && !voiced[g]) g++;
    if (g - f >= minPause) pauses.push({ start: f * FRAME_SEC, end: g * FRAME_SEC });
    f = g;
  }
  return { start: first * FRAME_SEC, end: (last + 1) * FRAME_SEC, pauses };
}

/** Sets runs of `value` shorter than `minLen` to `to`. */
function fillRuns(a: Uint8Array, value: number, minLen: number, to: number) {
  for (let i = 0; i < a.length; ) {
    if (a[i] !== value) {
      i++;
      continue;
    }
    let j = i;
    while (j < a.length && a[j] === value) j++;
    if (j - i < minLen) a.fill(to, i, j);
    i = j;
  }
}

// ---- Turkish spoken syllables ---------------------------------------------------------------

const VOWEL = /[aeıioöuüâîûAEIİOÖUÜÂÎÛ]/g;
const vowels = (s: string) => (s.match(VOWEL) ?? []).length;

const ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];

/** A non-negative integer as Turkish words ("1923" → "bin dokuz yüz yirmi üç"). */
export function turkishNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "sıfır";
  const under1000 = (k: number) => {
    const h = Math.floor(k / 100);
    const rest = k % 100;
    return [h === 0 ? "" : h === 1 ? "yüz" : `${ONES[h]} yüz`, TENS[Math.floor(rest / 10)], ONES[rest % 10]].filter(Boolean).join(" ");
  };
  const parts: string[] = [];
  const scales: [number, string][] = [[1e9, "milyar"], [1e6, "milyon"], [1e3, "bin"]];
  let r = Math.floor(n);
  for (const [v, name] of scales) {
    const q = Math.floor(r / v);
    if (q) parts.push(v === 1e3 && q === 1 ? "bin" : `${under1000(q)} ${name}`);
    r %= v;
  }
  if (r) parts.push(under1000(r));
  return parts.join(" ");
}

/** Abbreviations read as full words (lower-cased, with their dot). */
const ABBREV: Record<string, string> = {
  "dr.": "doktor", "prof.": "profesör", "doç.": "doçent", "av.": "avukat", "sn.": "sayın", "vb.": "ve benzeri",
  "vs.": "vesaire", "örn.": "örneğin", "bkz.": "bakınız", "yy.": "yüzyıl", "no.": "numara", "tel.": "telefon",
  "cad.": "caddesi", "sok.": "sokağı", "mah.": "mahallesi", "km": "kilometre", "kg": "kilogram", "cm": "santimetre",
  "dk.": "dakika", "sa.": "saat", "tl": "lira",
};

/** How many syllables `word` has when read aloud. Never less than 1. */
export function spokenSyllables(word: string): number {
  // Strip quotes/brackets and trailing punctuation, keep the apostrophe that joins a suffix.
  const core = word.replace(/^[("'“‘«]+|[)"”’»,;:!?…]+$/g, "");
  const lower = core.toLocaleLowerCase("tr");
  if (ABBREV[lower]) return vowels(ABBREV[lower]);
  if (ABBREV[lower.replace(/\.$/, "")]) return vowels(ABBREV[lower.replace(/\.$/, "")]);

  const [base, ...suffixParts] = core.split(/['’]/);
  const suffix = vowels(suffixParts.join(""));
  return Math.max(1, baseSyllables(base.replace(/\.$/, (m) => (/^\d+\.$/.test(base) ? m : ""))) + suffix);
}

function baseSyllables(base: string): number {
  if (!base) return 0;
  // Percent: "%40" → "yüzde kırk".
  if (/^%\d/.test(base)) return 2 + baseSyllables(base.slice(1));
  // Ordinal: "89." → "seksen dokuzuncu" (the ordinal suffix adds one syllable).
  if (/^\d+\.$/.test(base)) return vowels(turkishNumber(Number(base.slice(0, -1)))) + 1;
  // Thousands with dots: "12.500" → 12500.
  if (/^\d{1,3}(\.\d{3})+$/.test(base)) return vowels(turkishNumber(Number(base.replace(/\./g, ""))));
  // Decimal comma: "3,5" → "üç virgül beş".
  if (/^\d+,\d+$/.test(base)) {
    const [a, b] = base.split(",");
    return vowels(turkishNumber(Number(a))) + 2 + vowels(turkishNumber(Number(b)));
  }
  // Scores, times and ranges: "2-0", "14:45", "1923-1938".
  if (/^\d+([-–:/]\d+)+$/.test(base)) return base.split(/[-–:/]/).reduce((n, d) => n + vowels(turkishNumber(Number(d))), 0);
  if (/^\d+$/.test(base)) return vowels(turkishNumber(Number(base)));
  // Mixed tokens ("U19", "5G"): letters and digits read separately.
  if (/\d/.test(base)) return (base.match(/\d+/g) ?? []).reduce((n, d) => n + vowels(turkishNumber(Number(d))), 0) + baseSyllables(base.replace(/\d+/g, ""));
  // Acronyms read letter by letter ("TBMM" → te-be-me-me, "AB" → a-be) when short or with too few
  // vowels to be pronounced as a word ("NATO", "ASELSAN" are read as words).
  const letters = base.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 2 && letters === letters.toLocaleUpperCase("tr") && (letters.length <= 3 || vowels(letters) / letters.length < 0.34)) return letters.length;
  return vowels(base);
}

/** Ends a sentence: "gol." does; an ordinal ("89.") or an abbreviation ("Dr.", "vb.") does not. */
const sentenceEnd = (w: string) => /[.!?…]["'”’)]*$/.test(w) && !/^\d+\.$/.test(w) && !ABBREV[w.toLocaleLowerCase("tr")];
const clauseEnd = (w: string) => /[,;:]["'”’)]*$/.test(w);
/** Extra estimated time (in syllables) for the pause a punctuation mark usually brings. */
const punctWeight = (w: string): number => (sentenceEnd(w) ? 1.6 : clauseEnd(w) ? 0.8 : 0);

/** Faster than this between two pauses is not speech: one of the two anchors is wrong. */
const MAX_SYL_PER_SEC = 14;

/**
 * Removes anchors that would squeeze a run of words faster than anyone speaks (one wrongly
 * matched pause does that to its neighbour run). The shorter of the run's two bounding pauses is
 * the less certain one and is dropped first; repeated until every run is plausible.
 */
function dropImplausible(anchors: Map<number, { start: number; end: number }>, syl: number[], speech: SpeechMap) {
  for (let guard = anchors.size; guard > 0; guard--) {
    const cuts = [...anchors.keys()].sort((a, b) => a - b);
    let bad: number | null = null;
    let first = 0;
    let from = speech.start;
    for (const [k, cut] of [...cuts, syl.length - 1].entries()) {
      const pause = anchors.get(cut);
      const to = pause ? pause.start : speech.end;
      const n = syl.slice(first, cut + 1).reduce((a, b) => a + b, 0);
      if (n / Math.max(0.01, to - from) > MAX_SYL_PER_SEC) {
        const before = k > 0 ? cuts[k - 1] : null;
        const after = pause ? cut : null;
        const len = (i: number | null) => (i === null ? Infinity : anchors.get(i)!.end - anchors.get(i)!.start);
        bad = len(before) <= len(after) ? before : after;
        break;
      }
      first = cut + 1;
      from = pause ? pause.end : speech.end;
    }
    if (bad === null) return;
    anchors.delete(bad);
  }
}

/** Cost of leaving a pause unmatched, relative to (distance / speech span). */
const SKIP = 0.1;

function matchPauses(pauses: SpeechMap["pauses"], est: number[], words: string[], span: number): Map<number, { start: number; end: number }> {
  const P = [...pauses].sort((a, b) => a.start - b.start);
  const n = P.length;
  const m = est.length;
  const tolerance = Math.max(0.6, span * 0.3);
  const cost = (j: number, i: number) => {
    const dist = Math.abs(est[i] - (P[j].start + P[j].end) / 2);
    if (dist > tolerance) return Infinity;
    const bonus = sentenceEnd(words[i]) ? 0.12 : clauseEnd(words[i]) ? 0.06 : 0;
    return dist / span - bonus;
  };
  // F[j][i]: best cost for the first j pauses using only the first i boundaries.
  const F = Array.from({ length: n + 1 }, (_, j) => new Float64Array(m + 1).fill(j * SKIP));
  const how = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 0 boundary unused, 1 pause skipped, 2 matched
  for (let j = 1; j <= n; j++) {
    how[j][0] = 1;
    for (let i = 1; i <= m; i++) {
      let best = F[j][i - 1];
      let move = 0;
      if (F[j - 1][i] + SKIP < best) {
        best = F[j - 1][i] + SKIP;
        move = 1;
      }
      const c = F[j - 1][i - 1] + cost(j - 1, i - 1);
      if (c < best) {
        best = c;
        move = 2;
      }
      F[j][i] = best;
      how[j][i] = move;
    }
  }
  const anchors = new Map<number, { start: number; end: number }>();
  for (let j = n, i = m; j > 0; ) {
    const move = how[j][i];
    if (move === 2) anchors.set(i - 1, P[j - 1]);
    if (move === 0) i--;
    else if (move === 1) j--;
    else {
      i--;
      j--;
    }
  }
  return anchors;
}

/**
 * Word times for `text` fitted to the speech found in the audio (clip-relative seconds).
 * Pure function of the text and the speech map, so it is easy to test.
 */
export function alignWords(text: string, speech: SpeechMap): WordTime[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const syl = words.map(spokenSyllables);
  const punct = words.map(punctWeight);
  const span = Math.max(0.01, speech.end - speech.start);

  // Estimated boundary after word i: the middle of its punctuation pause, or its end.
  const total = syl.reduce((a, b) => a + b, 0) + punct.reduce((a, b) => a + b, 0);
  const est: number[] = [];
  let cum = 0;
  for (let i = 0; i < words.length - 1; i++) {
    cum += syl[i] + punct[i];
    est.push(speech.start + ((cum - punct[i] / 2) / total) * span);
  }

  // Match pauses (in time order) to word boundaries (in text order) with the cheapest
  // order-preserving assignment: a pause near a boundary costs its distance (less a bonus after
  // punctuation, where speakers and engines pause), leaving a pause unmatched costs SKIP. Done
  // jointly by dynamic programming, so a run of dense pauses (Pocket pauses at every sentence
  // mark) cannot steal each other's boundaries the way a one-at-a-time choice can.
  const anchors = matchPauses(speech.pauses, est, words, span);
  dropImplausible(anchors, syl, speech);

  // Spread each run of words between two anchors over the speech between them.
  const out: WordTime[] = [];
  const cuts = [...anchors.keys()].sort((a, b) => a - b);
  let first = 0;
  let from = speech.start;
  for (const cut of [...cuts, words.length - 1]) {
    const pause = anchors.get(cut);
    const to = pause ? pause.start : speech.end;
    const idx = Array.from({ length: cut - first + 1 }, (_, k) => first + k);
    // The run's own last pause is real silence now, so it no longer needs estimated time.
    const w = idx.map((i) => syl[i] + (i === cut ? 0 : punct[i]));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    // Unmatched pauses inside the run are silence too: words are spread over the voiced time
    // only, then mapped back past those pauses, so no word starts or ends inside a silence.
    const gaps = speech.pauses.filter((p) => p.start > from && p.end < to);
    const voiced = Math.max(0.01, to - from - gaps.reduce((n, p) => n + p.end - p.start, 0));
    const at = (v: number, isEnd: boolean) => {
      let t = from + v;
      for (const p of gaps) if (isEnd ? t > p.start + 1e-9 : t >= p.start - 1e-9) t += p.end - p.start;
      return t;
    };
    let v = 0;
    for (const [k, i] of idx.entries()) {
      const d = (w[k] / sum) * voiced;
      const inner = i !== cut && punct[i] > 0;
      out.push({ text: words[i], start: at(v, false), end: at(v + d * (inner ? 0.8 : 1), true) });
      v += d;
    }
    first = cut + 1;
    from = pause ? pause.end : speech.end;
  }
  return out;
}

/** Word times for a WAV clip, or null if it cannot be read or holds no speech. */
export async function alignClipWords(wavFile: string, text: string): Promise<WordTime[] | null> {
  try {
    const pcm = parseWav(await readFile(wavFile));
    const speech = pcm && detectSpeech(pcm);
    if (!speech) return null;
    const words = alignWords(text, speech);
    return words.length ? words : null;
  } catch {
    return null;
  }
}
