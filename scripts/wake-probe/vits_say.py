"""Speaks a list of sayings with Coqui's VITS voice trained on VCTK (109 speakers), for scripts/wake-probe/probe.mjs.

Run by probe.mjs's prepare step with the scratch folder's venv (coqui-tts and PyTorch for the CPU; see README.md):

    python -I vits_say.py MODEL_DIR JOBS.json OUT
    python -I vits_say.py --speakers MODEL_DIR

MODEL_DIR holds the unpacked tts_models--en--vctk--vits (model_file.pth, config.json, speaker_ids.json). JOBS.json is
a list of {"text", "speaker" (a VCTK name such as "p225"), "length", "noise", "noisew"}. It writes OUT.i16 (the
sayings, 16-bit at the voice's rate, each followed by a quarter second of silence) and OUT.json ({"rate", "gap",
"lengths"}). One process, at most 4 threads.

The checkpoint is a downloaded file, so it is only ever read with PyTorch's weights_only loader, which reads tensors
and plain values and runs no code from the file: this script checks that first, and pins Coqui's loader to it.
"""

import contextlib
import io
import json
import os
import sys

import numpy as np
import torch

torch.set_num_threads(4)


def speakers(model_dir):
    with open(os.path.join(model_dir, "speaker_ids.json"), encoding="utf-8") as f:
        return sorted(json.load(f))


def main(model_dir, jobs_path, out):
    checkpoint = os.path.join(model_dir, "model_file.pth")
    torch.load(checkpoint, map_location="cpu", weights_only=True)  # raises if the file needs more than tensors
    import trainer.io

    trainer.io._WEIGHTS_ONLY = True
    from TTS.utils.synthesizer import Synthesizer

    # the published config names its maker's own path for the speakers file: point it at ours, in a copy
    with open(os.path.join(model_dir, "config.json"), encoding="utf-8") as f:
        config = json.load(f)
    speakers_file = os.path.join(model_dir, "speaker_ids.json")
    config["speakers_file"] = speakers_file
    config["model_args"]["speakers_file"] = speakers_file
    with open(out + ".config.json", "w", encoding="utf-8") as f:
        json.dump(config, f)
    with contextlib.redirect_stdout(io.StringIO()):
        synth = Synthesizer(
            tts_checkpoint=checkpoint,
            tts_config_path=out + ".config.json",
            tts_speakers_file=os.path.join(model_dir, "speaker_ids.json"),
            use_cuda=False,
        )
    model = synth.tts_model
    rate = synth.output_sample_rate
    with open(jobs_path, encoding="utf-8") as f:
        jobs = json.load(f)
    gap = np.zeros(rate // 4, dtype=np.int16)
    lengths = []
    with open(out + ".i16", "wb") as sink:
        for n, job in enumerate(jobs):
            model.length_scale = job["length"]
            model.inference_noise_scale = job["noise"]
            model.inference_noise_scale_dp = job["noisew"]
            with contextlib.redirect_stdout(io.StringIO()):
                audio = np.asarray(synth.tts(job["text"], speaker_name=job["speaker"]), dtype=np.float32)
            peak = max(1e-6, float(np.abs(audio).max()))
            pcm = (audio * (0.9 / peak) * 32767).astype(np.int16)
            sink.write(pcm.tobytes())
            sink.write(gap.tobytes())
            lengths.append(int(pcm.shape[0]))
            if (n + 1) % 500 == 0:
                print(f"vits: {n + 1}/{len(jobs)} sayings", flush=True)
    with open(out + ".json", "w", encoding="utf-8") as f:
        json.dump({"rate": rate, "gap": int(gap.shape[0]), "lengths": lengths}, f)


if __name__ == "__main__":
    if sys.argv[1] == "--speakers":
        print(json.dumps(speakers(sys.argv[2])))
    else:
        main(*sys.argv[1:4])
