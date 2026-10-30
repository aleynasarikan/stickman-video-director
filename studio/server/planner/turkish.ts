// LLMs sometimes write Turkish without its letters ("bakalim", "Yildiz", "basladi"), and the TTS
// then reads exactly that. This restores ç ğ ı İ ö ş ü:
//   1. words that appear correctly spelled in the source text (feed, story) are copied as is;
//   2. known native stems get their letters back, and the endings after them follow vowel harmony
//      ("basladi" → "başl" + "adı" → "başladı");
//   3. optionally, an LLM pass that may change nothing but those letters (checked line by line).
// Only words that can be matched are touched: names and loanwords the lists don't know are left alone,
// because guessing from vowel harmony alone breaks them ("Ali", "dakika", "rakip").

const TR_TO_ASCII: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u", I: "i" };

/** Lowercase ASCII skeleton: what a word looks like with the Turkish letters stripped. */
export function asciiFold(s: string): string {
  return s.replace(/[çğıİöşüÇĞÖŞÜI]/g, (c) => TR_TO_ASCII[c] ?? c).toLowerCase();
}

const SPECIAL = /[çğıöşüÇĞİÖŞÜ]/;

// Native stems (and a few common inflected bases) that contain Turkish letters. Verb stems are
// cut before the vowel that the endings change ("başl" covers başla-, başlı-).
const STEMS = `
açık ağla ağır ağız ağaç akşam alış anlaş araç arkadaş artık aşağı aşk ayrıl bağır bağla bakış başar başl bekç bıçak bırak bilgisayar bölüm böyle büyü büyük bütün
çabuk çalış çarp çay çek çevir çıkış çık çiçek çift çizgi çocuk çok çöz çünkü dağ değer değiş değil doğru doğ dönüş dönem dörd dört dost düğün düş düşün düz düzel
eğlen eğit eşit gök gör göst gözük göz güç güçlü gül gün güneş güzel geçir geçmiş gelişm görüş görün görüntü gülümse güven hâlâ hayır hazır hızl ılık ısın ışık için içer
işte iyileş kaç kadın karşı kavuş kaybol kaybet kazan kılıç kımıl kırmızı kırık kırıl kısa kış kız kızgın kızıl köpek kötü kurtar lütfen mutlu müdür mükemmel müzik nasıl neşe
oğul oğl olağan ölç önce önem öğren öğret ört öyle özel özle paşa rüzgâr sağl saç sarı satış seç sevgi sıcak sık sıkıl sınav sınıf sıra sıradan sırt soğuk sonuç söyl söz sözleş
şaka şaşır şampiyon şarkı şehir şey şimdi şöyle şut tanış taşı teşekkür türk tüm uçak uğra ulaş ünlü üzgün üzül yağmur yakış yanlış yalnız yıkıl yıl yıldız yönet yürü yüz yüksel yüzyıl yüzük
zayıf zıpla güldür takım sıfır düdük düşük tribün kalkış hoca dakikal kişi kişisel aşırı ağrı doğal görev yönetim yarış yarışma güney kuzey doğu batı ülke dünya şiir şiddet şikâyet
direktör kulüp süper mağlubiyet hücum penaltı sakatlık şampiyonluk başkan gençlik türkiye fenerbahçe beşiktaş başakşehir göztepe kasımpaşa eyüpspor çaykur gençlerbirliği karagümrük ümraniye bülten gündem
`.split(/\s+/).filter(Boolean);

// Native stems without Turkish letters whose endings still need them ("kalkti" → "kalktı"), plus
// "gol", whose endings are front ("golu" → "golü"). Only full-ending matches are rewritten.
const PLAIN_STEMS = `
kalk bak bas imzala hava sat yap yaz otur dur bul oyna topla atla anla ara sakla kapa yat yakala kazan arka ayak kafa para sabah akla
yan yaz yol kol kum kuyruk top tut sor soru yorum oyun oyuncu kart kadro hakem kaleci taraftar kupa takla kaza hata kanat orta saha forma
gol henüz başka gerçek değil hafta puan kapan onayla sezon lig tur karar avantaj daha
`.split(/\s+/).filter(Boolean);

// Whole words whose stem is too short to match safely ("maç" would turn "Macaristan" into "Maç...").
// Never words whose stripped form is another real word: "öldü"/"oldu", "ön"/"on", "işi"/"ısı".
const EXACT = "maç maçı maça maçta maçtan maçın maçında maçını maçlar maçları maçların maçlarda maçlarında üçüncü üçte".split(" ");

/** Loanword stems that take front-vowel endings although their last vowel is back ("golü", "saati"). */
const FRONT = new Set(["gol", "saat", "rol", "kalp", "hal", "alkol", "kontrol", "petrol", "protokol", "sembol", "idol", "dikkat", "kabul", "hayal"]);

function lastVowel(s: string): string | null {
  for (let i = s.length - 1; i >= 0; i--) if ("aeıioöuüâî".includes(s[i])) return s[i];
  return null;
}

/** Endings take the stem's harmony: 4-way i/ı/u/ü; a soft g between vowels becomes ğ. */
function harmonize(stem: string, suffix: string): string {
  const own = lastVowel(stem.toLocaleLowerCase("tr")) ?? "e";
  // Front-taking loanwords keep their roundness: gol → golü, saat → saati.
  let last = FRONT.has(asciiFold(stem)) ? ({ a: "e", ı: "i", o: "ö", u: "ü" } as Record<string, string>)[own] ?? own : own;
  let out = "";
  for (let i = 0; i < suffix.length; i++) {
    const c = suffix[i];
    let r = c;
    if (c === "i" || c === "ı" || c === "u" || c === "ü") {
      const back = "aıouâ".includes(last);
      const round = "ouöü".includes(last);
      r = back ? (round ? "u" : "ı") : round ? "ü" : "i";
      last = r;
    } else if ("aeoö".includes(c)) last = c;
    else if (c === "s" && /[ıiuü]$/.test(out) && !/[aeıioöuü]/.test(suffix[i + 1] ?? "")) r = "ş"; // -ış, -mış
    else if (c === "g") {
      const prev = i === 0 ? stem.slice(-1) : suffix[i - 1];
      const next = suffix[i + 1] ?? "";
      if ("aeıioöuü".includes(prev) && "aeıioöuü".includes(next)) r = "ğ";
    }
    out += r;
  }
  return out;
}

export interface Vocab {
  /** ascii skeleton of a whole word → its correct spelling */
  words: Map<string, string>;
  /** ascii skeleton of a stem → its correct spelling, longest first */
  stems: [string, string][];
}

export function buildVocab(...sources: string[]): Vocab {
  const words = new Map<string, string>(EXACT.map((w) => [asciiFold(w), w]));
  for (const src of sources)
    for (const w of src.split(/[^\p{L}]+/u))
      if (w.length >= 2 && SPECIAL.test(w)) {
        const k = asciiFold(w);
        if (!words.has(k)) words.set(k, w);
      }
  const stems = new Map<string, string>();
  for (const s of [...STEMS, ...PLAIN_STEMS]) stems.set(asciiFold(s), s);
  // Correctly spelled source words also work as stems for their own inflections ("Takım" → "Takimin").
  for (const [k, w] of words) if (k.length >= 4 && !stems.has(k)) stems.set(k, w.toLocaleLowerCase("tr"));
  return { words, stems: [...stems.entries()].sort((a, b) => b[0].length - a[0].length) };
}

// What may follow a stem: a chain of common Turkish endings (in their ASCII skeleton), so a stem
// never rewrites an unrelated word that merely starts the same way ("mac" in "macera").
const MORPHEMES = (
  "iyor uyor ecek acak eceg acag erek arak meli mali dikce abil ebil " +
  "lar ler nin nun ndan nden dan den tan ten nda nde yla yle dik duk tik tuk mis mus yor mak mek maz mez niz nuz ken siz suz lik luk dir dur tir tur " +
  "in un ni nu na ne ya ye yi yu da de ta te la le ki si su sin sun di du ti tu ma me ar er ir ur im um iz uz ca ce ci cu li lu mi mu il ul is us ik uk sa se ip up " +
  "gi gu i u a e m n k z"
).split(" ");
const ENDINGS = new RegExp(`^(?:${MORPHEMES.sort((a, b) => b.length - a.length).join("|")})*$`);

function matchCase(original: string, fixed: string): string {
  if (original === original.toLocaleUpperCase("tr") && original.length > 1) return fixed.toLocaleUpperCase("tr");
  if (original[0] === original[0].toLocaleUpperCase("tr") && original[0] !== original[0].toLocaleLowerCase("tr"))
    return fixed[0].toLocaleUpperCase("tr") + fixed.slice(1);
  return fixed;
}

/** A repair may add Turkish letters, never change or remove ones the word already has ("Bülteni" stays). */
function keepsLetters(word: string, fixed: string): boolean {
  if (fixed.length !== word.length) return false;
  const a = word.toLocaleLowerCase("tr");
  const b = fixed.toLocaleLowerCase("tr");
  for (let i = 0; i < a.length; i++) if (SPECIAL.test(a[i]) && a[i] !== b[i]) return false;
  return true;
}

function fixWord(word: string, v: Vocab): string {
  const out = fixWordRaw(word, v);
  return keepsLetters(word, out) ? out : word;
}

function fixWordRaw(word: string, v: Vocab): string {
  const k = asciiFold(word);
  const exact = v.words.get(k);
  if (exact) return matchCase(word, exact.toLocaleLowerCase("tr"));
  for (const [ks, stem] of v.stems) {
    if (ks.length < 3 || !k.startsWith(ks)) continue;
    const rest = word.slice(ks.length).toLocaleLowerCase("tr");
    if (!ENDINGS.test(asciiFold(rest))) continue;
    return matchCase(word, stem + harmonize(stem, rest));
  }
  return word;
}

/** Restores Turkish letters in one line, word by word; apostrophe endings follow the restored name. */
export function restoreTurkish(text: string, v: Vocab): string {
  return text.replace(/[\p{L}]+(?:['’][\p{L}]+)?/gu, (token) => {
    const [base, ending] = token.split(/['’]/);
    const fixed = fixWord(base, v);
    if (ending === undefined) return fixed;
    const ap = token.includes("’") ? "’" : "'";
    // An ending after an apostrophe follows the name's last vowel: NASA'yı, Montella'nın, Ali'nin.
    const harmonized = ENDINGS.test(asciiFold(ending)) ? harmonize(fixed, asciiFold(ending)) : ending;
    return `${fixed}${ap}${matchCase(ending, harmonized)}`;
  });
}

/** Share of words that still look stripped after local repair: how much an LLM pass could help. */
export function strippedScore(lines: string[]): number {
  const words = lines.join(" ").split(/[^\p{L}]+/u).filter((w) => w.length >= 3);
  if (words.length < 8) return 0;
  const withLetters = words.filter((w) => SPECIAL.test(w)).length;
  // Ordinary Turkish has a Turkish letter in roughly every second or third word.
  return 1 - Math.min(1, withLetters / words.length / 0.3);
}

// Real words whose Turkish-letter twin means something else: an LLM "fixing" them changes the meaning
// ("oldu" → "öldü"), so a line where one of these changed is rejected.
const PROTECTED = new Set(
  ("oldu olur ol olan olarak olsun olacak olmaz on onu ona one onda ondan onlar gol golu gole golde sut sus dus yas yasa yasal isi kir kis sik su " +
    "sir siz bas basin kas kasim cay ac acik ic is us ut kus koy koyu sac seker").split(" "),
);

function touchesProtected(before: string, after: string): boolean {
  const a = before.split(/[^\p{L}]+/u);
  const b = after.split(/[^\p{L}]+/u);
  return a.some((w, i) => PROTECTED.has(w.toLocaleLowerCase("tr")) && b[i] !== w);
}

function diffWords(a: string, b: string): number {
  const wa = a.split(/\s+/);
  const wb = b.split(/\s+/);
  return wa.filter((w, i) => w !== wb[i]).length;
}

export type JsonWriter = (system: string, user: string, temperature?: number) => Promise<unknown>;

/**
 * Restores Turkish letters in generated lines. The local pass always runs; when lines still look
 * stripped and an LLM is available, it is asked to fix only the letters, and a line is accepted only
 * if nothing but those letters changed.
 */
export async function fixTurkishLines(lines: string[], source: string, writer?: JsonWriter): Promise<string[]> {
  const v = buildVocab(source);
  let out = lines.map((l) => restoreTurkish(l, v));
  // Judged on the LLM's original text: the local repair alone can make a stripped text look fine.
  // Two or more words needing repair means the model was dropping letters, so more may remain.
  const repaired = lines.reduce((n, l, i) => n + diffWords(l, out[i]), 0);
  if (writer && (strippedScore(lines) > 0.35 || repaired >= 2)) {
    try {
      const raw = (await writer(
        "You fix Turkish spelling. Restore the Turkish letters ç, ğ, ı, İ, ö, ş, ü wherever a word needs them. Change nothing else: same words, same order, same punctuation, same capitalisation. Reply as JSON: {\"lines\": [...]} with exactly one line per input line.",
        JSON.stringify({ lines: out }),
        0,
      )) as { lines?: unknown };
      const fixed: unknown[] | null = Array.isArray(raw?.lines) ? raw.lines : null;
      if (fixed && fixed.length === out.length)
        out = out.map((l, i) => {
          const f = fixed[i];
          return typeof f === "string" && asciiFold(f) === asciiFold(l) && !touchesProtected(l, f) ? f : l;
        });
    } catch {
      // The local repair stands.
    }
  }
  return out;
}
