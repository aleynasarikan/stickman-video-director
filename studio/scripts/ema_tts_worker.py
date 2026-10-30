"""EMA Lightning Turkish TTS worker (https://huggingface.co/canberkkkkkk/ema-lightning, Apache-2.0).

Started once by server/tts.ts and kept alive so the model loads a single time.
Protocol: one JSON object per line.
  stdin:  {"id": 1, "text": "...", "out": "/abs/path.wav", "speed": 1.0, "pitch": 1.0, "formant": 1.0}
  stdout: {"ready": true}            once the model is loaded
          {"id": 1, "duration": 3.2, "words": [["Merhaba", 0.0, 0.6], ...]} or {"id": 1, "error": "..."}
Everything else the library prints goes to stderr, so stdout stays machine-readable.

EMA Lightning has one (female) voice. Other voices are derived with the WORLD vocoder
(pyworld, MIT): "pitch" scales F0 and "formant" warps the spectral envelope, so pitch 0.56 with
formant 0.84 turns it into a male-sounding voice without the "slowed tape" sound of resampling.
"""

import json
import os
import sys

from voice_tools import convert_voice, write_wav

reply = sys.stdout
sys.stdout = sys.stderr


def send(obj):
    reply.write(json.dumps(obj, ensure_ascii=False) + "\n")
    reply.flush()


def main():
    from ema_lightning import EMA

    # On Apple Silicon the CPU path is several times faster than MPS for this small model.
    tts = EMA(device=os.environ.get("EMA_DEVICE", "cpu"))
    tts.say("Hazır.", seed=1)  # warm-up: the first call is much slower than the rest
    send({"ready": True})
    seed = int(os.environ.get("EMA_SEED", "7"))
    for line in sys.stdin:
        if not line.strip():
            continue
        req = {}
        try:
            req = json.loads(line)
            pitch = float(req.get("pitch", 1.0))
            formant = float(req.get("formant", 1.0))
            speed = float(req.get("speed", 1.0))
            if pitch == 1.0 and formant == 1.0:
                speech = tts.say(req["text"], path=req["out"], speed=speed, seed=seed)
            else:
                speech = tts.say(req["text"], speed=speed, seed=seed)
                write_wav(req["out"], convert_voice(speech.audio, speech.sample_rate, pitch, formant), speech.sample_rate)
            # Word times come from the model's own frame plan; the WORLD conversion keeps timing.
            words = [[w.text, w.start, w.end] for w in getattr(speech, "words", ())]
            send({"id": req.get("id"), "duration": speech.duration, "words": words})
        except Exception as e:  # one bad request must not kill the worker
            send({"id": req.get("id"), "error": str(e) or type(e).__name__})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        send({"fatal": str(e) or type(e).__name__})
        sys.exit(1)
