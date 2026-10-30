import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { EmaTts, FallbackTts, KIZAGAN_PRESETS, KizaganTts, type TtsEngine } from "../server/tts";

// A stand-in for scripts/ema_tts_worker.py that speaks the same protocol without the model:
// writes `pitch` seconds of silence per request (so tests can see the voice preset arrive),
// fails on "HATA", and exits on "ÇÖK".
const fake = `
import json, sys, wave
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    req = json.loads(line)
    if req["text"] == "HATA":
        print(json.dumps({"id": req["id"], "error": "bozuk metin"}), flush=True); continue
    if req["text"] == "ÇÖK":
        sys.exit(3)
    with wave.open(req["out"], "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000); w.writeframes(b"\\0\\0" * int(48000 * req.get("pitch", 1)))
    words = [[w, i * 0.3, i * 0.3 + 0.25] for i, w in enumerate(req["text"].split())]
    print(json.dumps({"id": req["id"], "duration": 1.0, "words": words}), flush=True)
`;

const dir = mkdtempSync(path.join(tmpdir(), "ema-test-"));
const script = path.join(dir, "worker.py");
writeFileSync(script, fake);
const engines: EmaTts[] = [];
const make = (python = "python3") => {
  const e = new EmaTts(python, script, 20_000);
  engines.push(e);
  return e;
};
afterAll(() => engines.forEach((e) => e.close()));

describe("EMA Lightning engine", () => {
  it("synthesizes through the worker and converts to the common wav format", async () => {
    const tts = make();
    const { duration: d, words } = await tts.synthesize("Merhaba dünya.", "tr", path.join(dir, "a.wav"));
    expect(d).toBeGreaterThan(0.9);
    expect(d).toBeLessThan(1.1);
    // Word timings come back from the worker for karaoke subtitles.
    expect(words).toEqual([{ text: "Merhaba", start: 0, end: 0.25 }, { text: "dünya.", start: 0.3, end: 0.55 }]);
    // Several scenes in parallel share the one worker.
    const ds = await Promise.all([1, 2, 3].map((i) => tts.synthesize(`Sahne ${i}`, "tr", path.join(dir, `p${i}.wav`))));
    expect(ds).toHaveLength(3);
  });

  it("reports a failed clip without killing the worker, and restarts after a crash", async () => {
    const tts = make();
    await expect(tts.synthesize("HATA", "tr", path.join(dir, "b.wav"))).rejects.toThrow(/seslendiremedi: bozuk metin/);
    expect((await tts.synthesize("Devam.", "tr", path.join(dir, "c.wav"))).duration).toBeGreaterThan(0);
    await expect(tts.synthesize("ÇÖK", "tr", path.join(dir, "d.wav"))).rejects.toThrow(/kapandı/);
    expect((await tts.synthesize("Yeniden.", "tr", path.join(dir, "e.wav"))).duration).toBeGreaterThan(0);
  });

  it("sends the chosen voice's preset to the worker", async () => {
    const tts = make();
    expect((await tts.synthesize("Merhaba.", "tr", path.join(dir, "v1.wav"), "erkek")).duration).toBeCloseTo(0.56, 1);
    expect((await tts.synthesize("Merhaba.", "tr", path.join(dir, "v2.wav"), "cocuk")).duration).toBeCloseTo(1.3, 1);
    expect((await tts.synthesize("Merhaba.", "tr", path.join(dir, "v3.wav"))).duration).toBeCloseTo(1, 1);
  });

  it("explains a missing Python instead of hanging", async () => {
    await expect(make(path.join(dir, "yok-python")).synthesize("x", "tr", path.join(dir, "f.wav"))).rejects.toThrow(/başlatılamadı|kapandı/);
  });

  it("falls back to the next engine for a failed clip", async () => {
    const backup: TtsEngine = { name: "yedek", synthesize: async () => ({ duration: 2 }) };
    const tts = new FallbackTts([make(path.join(dir, "yok-python")), backup]);
    expect(tts.name).toBe("ema-lightning");
    expect((await tts.synthesize("x", "tr", path.join(dir, "g.wav"))).duration).toBe(2);
  });
});

describe("Kızağan engine", () => {
  it("speaks the same protocol and derives voices from its male speaker", async () => {
    const tts = new KizaganTts("python3", script, 20_000);
    engines.push(tts as unknown as EmaTts);
    expect(tts.name).toBe("kizagan");
    // The fake worker writes `pitch` seconds: "erkek" is the model's own voice, "kadin" is shifted up.
    expect((await tts.synthesize("Merhaba.", "tr", path.join(dir, "k1.wav"), "erkek")).duration).toBeCloseTo(1, 1);
    expect((await tts.synthesize("Merhaba.", "tr", path.join(dir, "k2.wav"), "kadin")).duration).toBeCloseTo(KIZAGAN_PRESETS.kadin.pitch, 1);
    await expect(tts.synthesize("HATA", "tr", path.join(dir, "k3.wav"))).rejects.toThrow(/Kızağan TTS seslendiremedi/);
  });

  it("spells out Turkish numbers before synthesis", () => {
    const py = `import sys; sys.path.insert(0, "scripts"); from voice_tools import normalize_tr, split_sentences
for s in ["Göztepe 2-0 kazandı.", "Topaç Ali 89. dakikada vurdu.", "1. Lig'de %15 artış.", "Lakers 3'te 3 yaptı.", "12.500 taraftar"]: print(normalize_tr(s))
print("|".join(split_sentences("Takım 3. sırada. Sonra gol geldi!")))`;
    const out = execFileSync("python3", ["-c", py], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" }).trim().split("\n");
    expect(out).toEqual([
      "Göztepe iki sıfır kazandı.",
      "Topaç Ali seksen dokuzuncu dakikada vurdu.",
      "birinci Lig'de yüzde on beş artış.",
      "Lakers üçte üç yaptı.",
      "on iki bin beş yüz taraftar",
      "Takım 3. sırada.|Sonra gol geldi!",
    ]);
  });
});
