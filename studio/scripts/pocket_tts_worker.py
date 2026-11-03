#!/usr/bin/env python3
"""
Pocket TTS Turkish worker: loads the model once and serves requests over stdin/stdout.

Same JSON-lines protocol as ema_tts_worker.py, so server/tts.ts drives both the same way:
  stdout: {"ready": true} once the model is loaded, then one reply per request
  stdin:  {"id": 1, "text": "...", "out": "/abs/path.wav", "voice": "kadin"}
  stdout: {"id": 1, "duration": 3.2}            (no "words": Pocket reports no word timings;
          {"id": 1, "error": "..."}              server/align.ts aligns them to the audio)
  stdout: {"fatal": "..."} if the model cannot load (then exit 1)
Anything else (library logs, warnings, tracebacks) goes to stderr.

Model: wite-tech/pocket-tts-turkish (weights CC-BY-4.0; derived from Kyutai's Pocket TTS,
CC-BY-4.0), package pocket-tts-turkish (Apache-2.0) on pocket-tts 3.3 (MIT). Runs fully
offline from the pinned snapshot in the Hugging Face cache, or from POCKET_MODEL_DIR.

Environment:
  POCKET_MODEL_DIR  model folder (default: the pinned snapshot in the Hugging Face cache)
  POCKET_THREADS    CPU threads for torch (default 1, the model's design point; see README)
  POCKET_SEED       fixed seed so the same text is always read the same way (default 7)
"""
import json
import os
import signal
import sys

REPO = "wite-tech/pocket-tts-turkish"
REVISION = "fcbd37c74dc127be846face0ff36062e9a939f7b"

# The project's narrator voices mapped to the model's built-in speakers by measured pitch
# (median F0: female_1 ~247 Hz, female_2 ~215, male_3 ~139, male_1 ~111). The model has no
# child speaker: "cocuk" uses the highest voice, it is not a real child voice.
VOICES = {
    "kadin": "female_1",
    "kadin-olgun": "female_2",
    "erkek": "male_3",
    "erkek-kalin": "male_1",
    "cocuk": "female_1",
}

# Protocol replies go to the real stdout; everything else printed by libraries goes to stderr.
reply = sys.stdout
sys.stdout = sys.stderr


def send(obj):
    reply.write(json.dumps(obj, ensure_ascii=False) + "\n")
    reply.flush()


def model_dir():
    explicit = os.environ.get("POCKET_MODEL_DIR")
    if explicit:
        return explicit
    from huggingface_hub import constants

    return os.path.join(constants.HF_HUB_CACHE, "models--" + REPO.replace("/", "--"), "snapshots", REVISION)


def main():
    # Never reach the network at run time: the model was downloaded once, at a pinned revision.
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))

    folder = model_dir()
    if not os.path.isfile(os.path.join(folder, "model.safetensors")):
        raise RuntimeError(f"model not found in {folder}; see README (Pocket TTS kurulumu)")

    import torch
    from pocket_tts_turkish import TurkishTTS, save_wav

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from voice_tools import pocket_prenormalize

    tts = TurkishTTS.from_pretrained(folder, device="cpu")
    torch.set_num_threads(max(1, int(os.environ.get("POCKET_THREADS", "1"))))
    seed = int(os.environ.get("POCKET_SEED", "7"))
    # No torch.inference_mode() here: pocket-tts decodes part of the audio on its own thread, which
    # does not inherit the mode, and it already runs without gradients.
    tts.generate("Hazır.", voice=VOICES["kadin"], seed=seed)  # warm-up: the first call is slower
    send({"ready": True})

    for line in sys.stdin:  # ends when the server closes stdin
        if not line.strip():
            continue
        req = {}
        try:
            req = json.loads(line)
            text = str(req["text"])
            voice = VOICES.get(req.get("voice") or "kadin", VOICES["kadin"])
            audio = tts.generate(pocket_prenormalize(text), voice=voice, seed=seed)
            save_wav(req["out"], audio, tts.sample_rate)
            send({"id": req.get("id"), "duration": len(audio) / tts.sample_rate})
        except Exception as e:  # one bad request must not kill the worker
            print(f"pocket worker: {type(e).__name__}: {e}", file=sys.stderr)
            send({"id": req.get("id"), "error": str(e) or type(e).__name__})


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except BaseException as e:
        send({"fatal": str(e) or type(e).__name__})
        sys.exit(1)
