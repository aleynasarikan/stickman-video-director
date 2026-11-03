"""Shared helpers for the TTS workers: WAV writing, WORLD voice conversion, Turkish text normalisation.

Only the standard library and numpy are imported at module level; pyworld is imported when a voice
conversion is actually requested.
"""

import re
import wave


def write_wav(path, audio, sr):
    import numpy as np

    peak = float(np.abs(audio).max()) or 1.0
    pcm = (np.clip(audio / peak * 0.9, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def convert_voice(audio, sr, pitch, formant):
    """WORLD vocoder (pyworld, MIT): scale F0 by `pitch`, warp the spectral envelope by `formant`."""
    import numpy as np
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # pyworld imports the deprecated pkg_resources
        import pyworld as pw

    x = np.ascontiguousarray(audio, dtype=np.float64)
    f0, t = pw.harvest(x, sr, frame_period=5.0, f0_floor=60, f0_ceil=700)
    sp = pw.cheaptrick(x, f0, t, sr)
    ap = pw.d4c(x, f0, t, sr)
    if formant != 1.0:
        # Read each output bin from frequency k / formant of the original envelope.
        n = sp.shape[1]
        src = np.clip(np.arange(n) / formant, 0, n - 1)
        i = np.floor(src).astype(int)
        j = np.minimum(i + 1, n - 1)
        f = src - i
        sp = sp[:, i] * (1 - f) + sp[:, j] * f
    return pw.synthesize(np.ascontiguousarray(f0 * pitch), np.ascontiguousarray(sp), ap, sr, frame_period=5.0)


# ---------- Turkish numbers → words (models that don't normalise read "89" badly) ----------

ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"]
TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"]
SCALES = [(10**12, "trilyon"), (10**9, "milyar"), (10**6, "milyon"), (1000, "bin")]


def number_words(n):
    if n == 0:
        return "sıfır"
    out = []
    for value, name in SCALES:
        if n >= value:
            q, n = divmod(n, value)
            # "bin", not "bir bin".
            out.append(name if (q == 1 and value == 1000) else f"{number_words(q)} {name}")
    if n >= 100:
        q, n = divmod(n, 100)
        out.append("yüz" if q == 1 else f"{ONES[q]} yüz")
    if n >= 10:
        out.append(TENS[n // 10])
        n %= 10
    if n:
        out.append(ONES[n])
    return " ".join(out)


def _harmony(word):
    for ch in reversed(word):
        if ch in "aı":
            return "ı"
        if ch in "ei":
            return "i"
        if ch in "ou":
            return "u"
        if ch in "öü":
            return "ü"
    return "i"


def ordinal_words(n):
    words = number_words(n)
    if words.endswith("dört"):
        words = words[:-1] + "d"  # dört → dördüncü
    v = _harmony(words)
    return words + (f"nc{v}" if words[-1] in "aeıioöuü" else f"{v}nc{v}")


ORDINAL_NOUNS = "lig|tur|hafta|dakika|sıra|kat|sınıf|kez|yarı|devre|etap|gün|yıl|madde|bölüm|sezon|maç"


def normalize_tr(text):
    t = text
    t = re.sub(r"%\s?(\d+(?:,\d+)?)", r"yüzde \1", t)
    # Thousands separators: 12.500 → 12500.
    t = re.sub(r"(?<![\d.,])(\d{1,3}(?:\.\d{3})+)(?![\d,])", lambda m: m.group(1).replace(".", ""), t)
    # Scores: 2-0 → iki sıfır.
    t = re.sub(r"(?<!\d)(\d{1,2})-(\d{1,2})(?!\d)", lambda m: f"{number_words(int(m.group(1)))} {number_words(int(m.group(2)))}", t)
    # Ordinals: "89. dakikada", "1. Lig".
    t = re.sub(
        rf"(?<!\d)(\d+)\.(?=\s+(?:[a-zçğıöşü]|(?:{ORDINAL_NOUNS})))",
        lambda m: ordinal_words(int(m.group(1))),
        t,
        flags=re.IGNORECASE,
    )
    # Decimals: 2,5 → iki virgül beş.
    t = re.sub(r"(\d+),(\d+)", lambda m: f"{number_words(int(m.group(1)))} virgül {number_words(int(m.group(2)))}", t)
    # Year ranges and the rest: plain numbers; a suffix after an apostrophe joins the word ("3'te" → "üçte").
    t = re.sub(r"(\d+)-(\d+)", r"\1 \2", t)
    t = re.sub(r"(\d+)['’](\w+)", lambda m: f"{number_words(int(m.group(1)))}{m.group(2)}", t)
    t = re.sub(r"\d+", lambda m: number_words(int(m.group(0))), t)
    return re.sub(r"\s+", " ", t).strip()


# Turkish letter names, for acronyms read letter by letter ("TBMM" → "te be me me").
LETTER_NAMES = {
    "A": "a", "B": "be", "C": "ce", "Ç": "çe", "D": "de", "E": "e", "F": "fe", "G": "ge", "Ğ": "yumuşak ge",
    "H": "he", "I": "ı", "İ": "i", "J": "je", "K": "ke", "L": "le", "M": "me", "N": "ne", "O": "o", "Ö": "ö",
    "P": "pe", "R": "re", "S": "se", "Ş": "şe", "T": "te", "U": "u", "Ü": "ü", "V": "ve", "Y": "ye", "Z": "ze",
}


def pocket_prenormalize(text):
    """
    Fixes, before Pocket TTS Turkish's own normalizer runs, the two cases it reads wrongly:
    an acronym with an apostrophe suffix ("TBMM'de" became "...Mecliside", "AB'ye" became "ABye")
    is spelled letter by letter with its suffix ("te be me me de"), and an ordinal before a word
    ("89. dakikada") is written out so no pause is inserted after it. Dates, times, prices and
    bare acronyms are left to Pocket, which reads them correctly.
    """
    t = re.sub(
        r"\b([A-ZÇĞİÖŞÜ]{2,6})['’]([a-zçğıöşü]+)",
        lambda m: " ".join(LETTER_NAMES.get(c, c.lower()) for c in m.group(1)) + " " + m.group(2),
        text,
    )
    t = re.sub(
        rf"(?<![\d.])(\d+)\.(?=\s+(?:[a-zçğıöşü]|(?:{ORDINAL_NOUNS})))",
        lambda m: ordinal_words(int(m.group(1))),
        t,
        flags=re.IGNORECASE,
    )
    return t


def split_sentences(text):
    """Sentence-sized pieces (the model is most natural one utterance at a time); an ordinal's dot doesn't split."""
    parts = re.split(r"(?<=[.!?…])\s+(?=[^\s])", text.strip())
    out = []
    for p in parts:
        if out and re.search(r"(?<!\d)\d+\.$", out[-1]) and p[:1].islower():
            out[-1] += " " + p
        elif p:
            out.append(p)
    return out
