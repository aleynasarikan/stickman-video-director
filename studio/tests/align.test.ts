import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { alignClipWords, alignWords, detectSpeech, parseWav, spokenSyllables, turkishNumber, type SpeechMap } from "../server/align";
import { ffmpeg } from "../server/ffmpeg";
import { narrationWordTimes } from "../shared/timeline";

const SR = 16000;

/** A test signal: tone (speech) and silence runs, as 16-bit mono PCM. */
function signal(parts: [kind: "tone" | "gap", sec: number][]): Int16Array {
  const out = new Int16Array(Math.round(parts.reduce((n, [, s]) => n + s, 0) * SR));
  let i = 0;
  for (const [kind, sec] of parts) {
    const n = Math.round(sec * SR);
    if (kind === "tone") for (let k = 0; k < n; k++) out[i + k] = Math.round(Math.sin((2 * Math.PI * 220 * k) / SR) * 12000);
    i += n;
  }
  return out;
}

function wav(samples: Int16Array, rate = SR): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + samples.byteLength, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(samples.byteLength, 40);
  return Buffer.concat([h, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]);
}

const ordered = (ws: { start: number; end: number }[]) => ws.every((w, i) => w.start <= w.end && (i === 0 || ws[i - 1].end <= w.start + 1e-9));

describe("Turkish spoken syllables", () => {
  it("reads numbers as words", () => {
    expect(turkishNumber(1923)).toBe("bin dokuz yüz yirmi üç");
    expect(turkishNumber(2026)).toBe("iki bin yirmi altı");
    expect(turkishNumber(100)).toBe("yüz");
    expect(turkishNumber(1_500_000)).toBe("bir milyon beş yüz bin");
    expect(turkishNumber(0)).toBe("sıfır");
  });

  it.each([
    ["Merhaba,", 3],
    ["gol!", 1],
    ["1923'te", 8], // bin dokuz yüz yirmi üç + te
    ["%40", 3], // yüzde kırk
    ["89.", 5], // seksen dokuzuncu
    ["12.500", 6], // on iki bin beş yüz
    ["3,5", 4], // üç virgül beş
    ["2-0", 4], // iki sıfır
    ["14:45", 4], // on dört kırk beş
    ["TBMM'de", 5], // te-be-me-me + de
    ["AB'ye", 3], // a-be + ye
    ["NATO", 2], // read as a word
    ["Dr.", 2], // doktor (not a sentence end either: see the long-sentence test)
    ["vb.", 4], // ve benzeri
    ["“Hayır!”", 2],
  ])("%s → %i", (word, n) => {
    expect(spokenSyllables(word)).toBe(n);
  });
});

describe("speech detection", () => {
  it("finds speech edges and pauses, ignoring short dips", () => {
    const pcm = { samples: signal([["gap", 0.3], ["tone", 0.5], ["gap", 0.05], ["tone", 0.4], ["gap", 0.25], ["tone", 0.6], ["gap", 0.4]]), sampleRate: SR };
    const s = detectSpeech(pcm)!;
    expect(s.start).toBeCloseTo(0.3, 1);
    expect(s.end).toBeCloseTo(2.1, 1);
    // The 50 ms dip is inside a word; only the 250 ms gap is a pause.
    expect(s.pauses).toHaveLength(1);
    expect(s.pauses[0].start).toBeCloseTo(1.25, 1);
    expect(s.pauses[0].end).toBeCloseTo(1.5, 1);
  });

  it("returns null for silence", () => {
    expect(detectSpeech({ samples: new Int16Array(SR), sampleRate: SR })).toBeNull();
  });

  it("parses 16-bit mono WAV and rejects other formats", () => {
    const samples = signal([["tone", 0.1]]);
    expect(parseWav(wav(samples))?.samples.length).toBe(samples.length);
    const stereo = wav(samples);
    stereo.writeUInt16LE(2, 22);
    expect(parseWav(stereo)).toBeNull();
    expect(parseWav(Buffer.from("not a wav file at all"))).toBeNull();
  });
});

describe("alignWords", () => {
  it("short sentence: words fill the detected speech, leading/trailing silence excluded", () => {
    const words = alignWords("Merhaba dünya.", { start: 0.4, end: 1.3, pauses: [] });
    expect(words.map((w) => w.text)).toEqual(["Merhaba", "dünya."]);
    expect(words[0].start).toBeCloseTo(0.4);
    expect(words[1].end).toBeCloseTo(1.3);
    // Three syllables vs two.
    expect(words[0].end - words[0].start).toBeGreaterThan(words[1].end - words[1].start);
  });

  it("punctuation-heavy: pauses snap to the boundaries after punctuation", () => {
    const text = "Gol! Ama, hakem… iptal etti.";
    const speech: SpeechMap = {
      start: 0.1,
      end: 2.6,
      pauses: [
        { start: 0.4, end: 0.75 }, // after "Gol!"
        { start: 1.05, end: 1.2 }, // after "Ama,"
        { start: 1.55, end: 1.9 }, // after "hakem…"
      ],
    };
    const w = alignWords(text, speech);
    expect(w).toHaveLength(5);
    expect(w[0].end).toBeCloseTo(0.4);
    expect(w[1].start).toBeCloseTo(0.75);
    expect(w[1].end).toBeCloseTo(1.05);
    expect(w[2].start).toBeCloseTo(1.2);
    expect(w[2].end).toBeCloseTo(1.55);
    expect(w[3].start).toBeCloseTo(1.9);
    expect(w[4].end).toBeCloseTo(2.6);
    expect(ordered(w)).toBe(true);
  });

  it("long sentence with numbers and abbreviations stays ordered and anchored", () => {
    const text =
      "TBMM'de bugün 2026 bütçesi görüşüldü, Dr. Ayşe Yılmaz %40 artış önerdi. " +
      "Muhalefet ise 12.500 liralık asgari ücretin yetersiz olduğunu, enflasyonun 3,5 kat arttığını söyledi.";
    const n = text.split(/\s+/).length;
    // Pauses where the punctuation is: after "görüşüldü,", "önerdi." and "olduğunu,".
    const speech: SpeechMap = { start: 0.2, end: 12.4, pauses: [{ start: 3.0, end: 3.25 }, { start: 6.1, end: 6.6 }, { start: 9.6, end: 9.85 }] };
    const w = alignWords(text, speech);
    expect(w).toHaveLength(n);
    expect(ordered(w)).toBe(true);
    expect(w[0].start).toBeCloseTo(0.2);
    expect(w[n - 1].end).toBeCloseTo(12.4);
    const after = (word: string) => w[w.findIndex((x) => x.text === word) + 1].start;
    expect(after("görüşüldü,")).toBeCloseTo(3.25);
    expect(after("önerdi.")).toBeCloseTo(6.6);
    expect(after("olduğunu,")).toBeCloseTo(9.85);
    // No word starts inside a pause.
    for (const x of w) for (const p of speech.pauses) expect(x.start >= p.end - 1e-9 || x.end <= p.start + 1e-9).toBe(true);
  });

  it("without pauses it is the syllable estimate over the speech", () => {
    const w = alignWords("bir iki üç dört", { start: 1, end: 3, pauses: [] });
    expect(w[0].start).toBeCloseTo(1);
    expect(w[3].end).toBeCloseTo(3);
    expect(ordered(w)).toBe(true);
  });

  it("dense engine pauses (measured on a real Pocket TTS clip) never squeeze words faster than speech", () => {
    // detectSpeech() output for Pocket reading the punctuation-heavy line (sample from the benchmark).
    const speech: SpeechMap = {
      start: 0.18,
      end: 6.73,
      pauses: [[0.47, 0.83], [0.96, 1.32], [1.59, 1.98], [2.07, 2.38], [3.16, 3.3], [3.4, 3.6], [4.79, 5.0], [5.41, 6.07]].map(([start, end]) => ({ start, end })),
    };
    const text = "Gol! Ama... hakem iptal etti; taraftarlar şaşkın: 'Neden?' diye sordu.";
    const w = alignWords(text, speech);
    expect(ordered(w)).toBe(true);
    expect(w[0].start).toBeCloseTo(0.18);
    expect(w[w.length - 1].end).toBeCloseTo(6.73);
    // No word starts or ends inside a silence (a word may still span one it was not matched to).
    for (const x of w)
      for (const p of speech.pauses) {
        expect(x.start <= p.start + 1e-9 || x.start >= p.end - 1e-9).toBe(true);
        expect(x.end <= p.start + 1e-9 || x.end >= p.end - 1e-9).toBe(true);
      }
    // Runs between matched pauses are never faster than speech.
    expect(w.every((x) => spokenSyllables(x.text) / (x.end - x.start) < 40)).toBe(true);
  });

  it("keeps the same word list as the subtitles (split on whitespace)", () => {
    const text = "  Son dakika:   TBMM'de  oylama!  ";
    expect(alignWords(text, { start: 0, end: 2, pauses: [] }).map((w) => w.text)).toEqual(["Son", "dakika:", "TBMM'de", "oylama!"]);
  });
});

describe("alignClipWords on a real WAV file", () => {
  it("reads ffmpeg's WAV output and aligns to its silences", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "align-"));
    try {
      const f = path.join(dir, "a.wav");
      // 0.3 s silence, 0.6 s tone, 0.3 s silence, 0.5 s tone, 0.4 s silence — at 44.1 kHz like the TTS output.
      await ffmpeg([
        "-f", "lavfi", "-i", "sine=frequency=200:duration=0.6",
        "-f", "lavfi", "-i", "sine=frequency=200:duration=0.5",
        "-filter_complex", "[0]adelay=300,apad=pad_dur=0.3[a];[1]apad=pad_dur=0.4[b];[a][b]concat=n=2:v=0:a=1",
        "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", f,
      ]);
      const w = (await alignClipWords(f, "Merhaba, dünya."))!;
      expect(w).toHaveLength(2);
      expect(w[0].start).toBeCloseTo(0.3, 1);
      expect(w[0].end).toBeCloseTo(0.9, 1);
      expect(w[1].start).toBeCloseTo(1.2, 1);
      expect(w[1].end).toBeCloseTo(1.7, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null for an unreadable file so the caller keeps the estimate", async () => {
    expect(await alignClipWords("/yok/boyle/bir/dosya.wav", "Merhaba")).toBeNull();
  });
});

describe("EMA's own timings are untouched", () => {
  it("narrationWordTimes uses reported word times one-to-one", () => {
    const spoken = [{ text: "Merhaba", start: 0.12, end: 0.6 }, { text: "dünya", start: 0.7, end: 1.1 }];
    expect(narrationWordTimes("Merhaba dünya.", 1.3, spoken)).toEqual([
      { text: "Merhaba", start: 0.12, end: 0.6 },
      { text: "dünya.", start: 0.7, end: 1.1 },
    ]);
  });
});
