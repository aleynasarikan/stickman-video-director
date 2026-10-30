"""Kızağan TTS worker (https://huggingface.co/AlicanKiraz0/Kizagan-TTS-v1.0, Apache-2.0; a Turkish
fine-tune of OpenBMB's VoxCPM2). Started once by server/tts.ts and kept alive so the 2.3B-parameter
model loads a single time. Same JSON-lines protocol as ema_tts_worker.py:
  stdin:  {"id": 1, "text": "...", "out": "/abs/path.wav", "pitch": 1.0, "formant": 1.0, "voice": "erkek"}
  stdout: {"ready": true}, then {"id": 1, "duration": 3.2, "words": [[w, start, end], ...]} or {"id": 1, "error": "..."}

Following the model card's recipe, every sentence is generated separately with the same reference
recording (long paragraphs drift), numbers are spelled out first (the model does not normalise them),
and the sentences are joined with a short pause. Word times are spread over each sentence's own audio.

Voices: the model's speaker is male (~105 Hz). A voice can be cloned from a recording you have the
right to use (KIZAGAN_REF_<VOICE>, e.g. KIZAGAN_REF_KADIN=/path/kadin.wav); otherwise it is derived
from the default reference with the WORLD vocoder (pitch/formant sent by the server).
"""

import json
import os
import sys

from voice_tools import convert_voice, normalize_tr, split_sentences, write_wav

reply = sys.stdout
sys.stdout = sys.stderr

PAUSE_S = 0.14
SETTINGS = dict(cfg_value=2.0, inference_timesteps=int(os.environ.get("KIZAGAN_STEPS", "16")), seed=42,
                min_len=2, max_len=1024, normalize=False, denoise=False, retry_badcase=False)


def send(obj):
    reply.write(json.dumps(obj, ensure_ascii=False) + "\n")
    reply.flush()


def pick_device():
    import torch

    want = os.environ.get("KIZAGAN_DEVICE", "")
    if want:
        return want
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def word_times(sentence, start, length):
    """The sentence's own words spread over its audio by length (good enough for karaoke highlighting)."""
    words = sentence.split()
    total = sum(len(w) + 1 for w in words) or 1
    out, t = [], start
    for w in words:
        d = (len(w) + 1) / total * length
        out.append([w, round(t, 3), round(t + d * 0.92, 3)])
        t += d
    return out


def main():
    import numpy as np
    from voxcpm import VoxCPM

    model_dir = os.environ.get("KIZAGAN_MODEL") or os.path.join(os.path.dirname(__file__), "..", "models", "Kizagan-TTS-v1.0")
    model_dir = os.path.abspath(model_dir)
    default_ref = os.environ.get("KIZAGAN_REFERENCE") or os.path.join(model_dir, "examples", "quickstart.wav")
    if not os.path.isfile(default_ref):
        raise RuntimeError(f"referans ses bulunamadı: {default_ref}")
    model = VoxCPM.from_pretrained(model_dir, device=pick_device(), load_denoiser=False, optimize=False)
    sr = model.tts_model.sample_rate
    model.generate(text="Hazır.", reference_wav_path=default_ref, **SETTINGS)  # warm-up
    send({"ready": True})

    for line in sys.stdin:
        if not line.strip():
            continue
        req = {}
        try:
            req = json.loads(line)
            voice = str(req.get("voice", ""))
            own_ref = os.environ.get(f"KIZAGAN_REF_{voice.upper().replace('-', '_')}", "")
            ref = own_ref if own_ref and os.path.isfile(own_ref) else default_ref
            pitch = 1.0 if ref != default_ref else float(req.get("pitch", 1.0))
            formant = 1.0 if ref != default_ref else float(req.get("formant", 1.0))
            pieces, words, t = [], [], 0.0
            gap = np.zeros(int(sr * PAUSE_S), dtype=np.float32)
            for sentence in split_sentences(req["text"]):
                wav = np.asarray(model.generate(text=normalize_tr(sentence), reference_wav_path=ref, **SETTINGS), dtype=np.float32).reshape(-1)
                length = len(wav) / sr
                words += word_times(sentence, t, length)
                pieces += [wav, gap]
                t += length + PAUSE_S
            if not pieces:
                raise ValueError("boş metin")
            audio = np.concatenate(pieces[:-1])
            if pitch != 1.0 or formant != 1.0:
                audio = convert_voice(audio, sr, pitch, formant)
            write_wav(req["out"], audio, sr)
            send({"id": req.get("id"), "duration": len(audio) / sr, "words": words})
        except Exception as e:  # one bad request must not kill the worker
            send({"id": req.get("id"), "error": str(e) or type(e).__name__})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        send({"fatal": str(e) or type(e).__name__})
        sys.exit(1)
