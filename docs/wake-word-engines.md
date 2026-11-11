# Wake-word engines: which routes are clean

Three of the four routes judged here are CLEAN: (a) as narrowed below, (c) and (d). Route (b) is NOT CLEAN. The probe
runs route (d). It heard espeak-ng sayings of 'Hey Lampas' and did not hear the test clip. But it also woke about 50
times an hour on speech it never heard. The Recommendation at the end names what is the Governor's to decide.

This document answers one question for the wake-word spike: can 'Hey Lampas' be heard in a browser with files whose
every licence is permissive, read at its source? It was written for story mw-rdpwdp1.5, after mw-rdpwdp1.1 stopped
because Hey Buddy and openWakeWord both need two feature models (`melspectrogram.onnx`, `embedding_model.onnx`) that
openWakeWord, their maker, puts under a non-commercial licence.

The rules it follows:

- Every licence is read at its source: the repository's LICENSE, the model card, the dataset card or the release
  page. A third party's README is never enough.
- A file whose licence is non-commercial, unclear or missing is NOT CLEAN.
- Nothing is paid for, no account is made and no key is used.
- Nothing downloaded here is committed: no model, no dataset, no audio.

All reads were made on 2026-11-11. Where a page needed JavaScript (Kaggle), it was rendered in a headless Chromium and
its text read. Repositories were read at the commit named, or at their default branch that day.

## Contents

- [The table](#the-table)
- [Verdicts](#verdicts)
  - [Route (a)](#route-a-googles-own-speech_embedding-and-hey-buddys-trainer)
  - [Route (b)](#route-b-sherpa-onnx-keyword-spotting)
  - [Route (c)](#route-c-vosk-in-the-browser-with-a-small-grammar)
  - [Route (d)](#route-d-our-own-small-classifier-trained-from-scratch)
- [The probe](#the-probe)
- [Recommendation](#recommendation)

## The table

There is one row for each file a route needs to train or to run. "Verdict" is about that file only. The route verdicts
follow the table.

| Route | File | What it is | Source URL | Licence | The licence's own words | Read on | Verdict |
|---|---|---|---|---|---|---|---|
| (a) | speech_embedding, TensorFlow 1, variation speech-embedding, version 1 | Google's original audio-to-embedding model, with its own 32-band log-mel front end inside; we would convert it to our own ONNX | https://www.kaggle.com/models/google/speech-embedding (tfhub.dev/google/speech_embedding/1 redirects there) | Apache-2.0 | Kaggle's model page, publisher "Google · Published On 2020.10.06", shows "License Apache 2.0". The module's own doc (github.com/tensorflow/tfhub.dev, assets/docs/google/models/speech_embedding/1.md) states no licence. | 2026-11-11 | permissive. Its download needs a Kaggle login: an anonymous request to the download API returned 404 and the old storage.googleapis.com/tfhub-modules copy returned 403 |
| (a) | tf2onnx | converts the TensorFlow model to ONNX (training-time tool) | https://github.com/onnx/tensorflow-onnx (LICENSE) | Apache-2.0 | "Apache License Version 2.0, January 2004" | 2026-11-11 | permissive |
| (a) | Hey Buddy code and trainer | the Python trainer and the browser runtime | https://github.com/painebenjamin/hey-buddy @ 6e78d262 (LICENSE, README '# License') | Apache-2.0 | "HeyBuddy source code and pretrained models are released under the Apache License 2.0." | 2026-11-11 | permissive |
| (a) | Hey Buddy's pretrained/mel-spectrogram.onnx and speech-embedding.onnx | the feature models Hey Buddy loads by default; byte-identical to openWakeWord v0.5.1's melspectrogram.onnx and embedding_model.onnx (sha256, mw-rdpwdp1.1) | https://github.com/dscripka/openWakeWord (README) | CC-BY-NC-SA-4.0 by their maker | "All of the included pre-trained models are licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International license" | 2026-11-11 | NOT CLEAN: not used; row 1 replaces them |
| (a) | precalculated/common/training-large.npy, training-medium.npy, validation.npy | Hey Buddy's negative features: about 6,500 hours of speech already run through the embedding in the row above | https://huggingface.co/datasets/benjamin-paine/hey-buddy @ 33f887ff | CC-BY-4.0 in their own words | README: "Pre-calculated training and validation datasets are released under CC-BY 4.0"; card metadata "license: cc-by-4.0" | 2026-11-11 | UNVERIFIED: permissive in their own words, but made by running the NOT CLEAN embedding. Not used: we would make our own (see the verdict) |
| (a) | piper en_US-libritts_r-medium checkpoint | the TTS voice Hey Buddy uses to make positive and adversarial sayings (904 speakers) | https://huggingface.co/datasets/rhasspy/piper-checkpoints/raw/main/en/en_US/libritts_r/medium/MODEL_CARD | CC BY 4.0 (its data) | "Dataset * URL: http://www.openslr.org/141/ * License: CC BY 4.0" | 2026-11-11 | permissive (attribution) |
| (a) | LibriTTS-R | the voice's training data | https://www.openslr.org/141/ | CC BY 4.0 | "Category: Speech License: CC BY 4.0" | 2026-11-11 | permissive (attribution) |
| (a) | piper-sample-generator and Piper code | runs the voice | https://github.com/rhasspy/piper (LICENSE; archived) | MIT | "Permission is hereby granted, free of charge, to any person obtaining a copy of this software" | 2026-11-11 | permissive |
| (a) | deep-phonemizer.pt | makes Hey Buddy's adversarial phrases | https://github.com/as-ideas/DeepPhonemizer (LICENSE and README 'Pretrained Models') | MIT for the code; none stated for the checkpoints | Code: "Permission is hereby granted, free of charge". The README's 'Pretrained Models' table names each checkpoint and its dataset (cmudict, cmudict-ipa) but states no licence for them | 2026-11-11 | NOT CLEAN: not used; we pass our own adversarial phrases instead |
| (a) | bert-base-uncased tokenizer | filters the phrase out of the negatives' transcripts | https://huggingface.co/google-bert/bert-base-uncased @ 86b5e093 | Apache-2.0 | card metadata "license: apache-2.0" | 2026-11-11 | permissive |
| (a) | mit-impulse-response-survey-16khz | room echoes for augmentation | https://huggingface.co/datasets/benjamin-paine/mit-impulse-response-survey-16khz @ d771bf19 | CC BY 4.0 | "These files are licensed under an MIT Creative Commons license, CC-BY 4.0." | 2026-11-11 | permissive (attribution) |
| (a) | freesound-laion-640k-commercial-16khz-full | background sounds for augmentation | https://huggingface.co/datasets/benjamin-paine/freesound-laion-640k-commercial-16khz-full @ c43a9951 | CC0-1.0, CC-BY 4.0, CC-BY 3.0, CC-Sampling+ | "Audio is released under one of four licenses: CC0-1.0, CC-BY 4.0, CC-BY 3.0, CC-Sampling+" | 2026-11-11 | permissive for training (Sampling+ allows commercial sampling; we would ship none of it) |
| (a) | free-music-archive-commercial-16khz-full | background music for augmentation | https://huggingface.co/datasets/benjamin-paine/free-music-archive-commercial-16khz-full @ 4fad7a58 | mixed; card metadata says cc-by-4.0 | The card's licence table lists "FMA Sound Recording Common Law" (19.9 hours, 0.25 %) beside the Creative Commons ones | 2026-11-11 | NOT CLEAN: the Common Law class is unclear; not used (Hey Buddy can switch it off) |
| (a) | LibriSpeech (train-clean-100 or more) | speech to make our own negative features with our own embedding | https://www.openslr.org/12/ | CC BY 4.0 | "LibriSpeech ASR corpus is licensed under a Creative Commons Attribution 4.0 International License." (LICENSE.TXT in the archive) | 2026-11-11 | permissive (attribution) |
| (a) | onnxruntime-web 1.31.1 | runs the ONNX models in the browser (WebAssembly) | https://github.com/microsoft/onnxruntime (LICENSE) | MIT | "Permission is hereby granted, free of charge, to any person obtaining a copy of this software" | 2026-11-11 | permissive |
| (b) | sherpa-onnx code, its WebAssembly keyword spotter (wasm/kws) and npm package sherpa-onnx 2.0.1 | the runtime, native and in the browser | https://github.com/k2-fsa/sherpa-onnx @ bec3acea (LICENSE) | Apache-2.0 | "Apache License Version 2.0, January 2004" | 2026-11-11 | permissive |
| (b) | icefall KWS recipe | the training code for the keyword models | https://github.com/k2-fsa/icefall (LICENSE; recipe in pull request 1428) | Apache-2.0 | "Apache License Version 2.0, January 2004" | 2026-11-11 | permissive |
| (b) | sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01 (encoder, decoder and joiner .onnx, tokens.txt, bpe.model) | the English open-vocabulary keyword model, 17,626,723 bytes as a .tar.bz2 | https://github.com/k2-fsa/sherpa-onnx/releases/tag/kws-models and https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html | none stated by its maker | The maker's page: "The model is trained on GigaSpeech XL subset (10000 hours), it supports only English." | 2026-11-11 | NOT CLEAN: trained on GigaSpeech, whose terms are non-commercial (next row) |
| (b) | GigaSpeech XL | that model's training data | https://huggingface.co/datasets/speechcolab/gigaspeech @ 63c0836b | card metadata apache-2.0, with gated non-commercial terms of access | "SpeechColab does not own the copyright of the audio files. For researchers and educators who wish to use the audio files for non-commercial research and/or educational purposes ... Researcher shall use the Database only for non-commercial research and educational purposes." | 2026-11-11 | NOT CLEAN: non-commercial |
| (b) | sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20 | a Chinese-and-English keyword model, 32,885,699 bytes as a .tar.bz2 | https://github.com/k2-fsa/sherpa-onnx/releases/tag/kws-models and https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html | none stated by its maker; training data not named | The maker's section is headed "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20 (Chinese & English)" and names neither a licence nor a dataset. An open icefall issue (#2077) asks: "Request: Provide PyTorch pre-trained model and training code (if possible)". Re-hosts by others on Hugging Face say apache-2.0, but they did not make it | 2026-11-11 | UNVERIFIED: licence and training data not stated at the source |
| (c) | vosk-api | the speech engine (built on Kaldi) | https://github.com/alphacep/vosk-api @ 4ab98215 (COPYING) | Apache-2.0 | "Apache License Version 2.0, January 2004" | 2026-11-11 | permissive |
| (c) | Kaldi | the toolkit Vosk is built on, compiled into vosk-browser | https://github.com/kaldi-asr/kaldi (COPYING) | Apache-2.0 | "their respective author(s) under the terms of the Apache License v 2.0" | 2026-11-11 | permissive |
| (c) | vosk-browser 0.0.8 (dist/vosk.js, WebAssembly inside, 5,804,767 bytes) | Vosk compiled to WebAssembly, run in a Web Worker | https://github.com/ccoreilly/vosk-browser @ 4b8eb257 (LICENSE) and npm vosk-browser 0.0.8 | Apache-2.0 | "Apache License Version 2.0, January 2004"; npm "license": "Apache-2.0" | 2026-11-11 | permissive |
| (c) | vosk-model-small-en-us-0.15 (41,205,931 bytes as a .zip) | the small US English model: acoustic model, i-vector extractor and a runtime-grammar graph (Gr.fst, HCLr.fst) | https://alphacephei.com/vosk/models | Apache 2.0 | The maker's model table: "vosk-model-small-en-us-0.15 ... Lightweight wideband model for Android and RPi ... Apache 2.0". The README in the zip says only "Copyright 2020 Alpha Cephei Inc" | 2026-11-11 | permissive by its maker's word; its training data is not named (see the verdict) |
| (d) | scripts/wake-probe/probe.mjs | our log-mel front end, classifier, trainer and test, in plain JavaScript | https://github.com/Jonathan-A-White/voice-kit (LICENSE) | MIT | "Permission is hereby granted, free of charge, to any person obtaining a copy of this software" | 2026-11-11 | permissive (ours) |
| (d) | the trained weights (115,265 numbers) | the classifier the probe trains; ours, made from the two rows below | https://github.com/Jonathan-A-White/voice-kit/blob/main/scripts/wake-probe/probe.mjs (made by it, kept in its scratch folder) | MIT (ours) | "Permission is hereby granted, free of charge, to any person obtaining a copy of this software" | 2026-11-11 | permissive (ours; see the Governor's points on training data) |
| (d) | espeak-ng 1.51 and its voices | speaks 'Hey Lampas' and the negative sayings at training time; never shipped | https://github.com/espeak-ng/espeak-ng (README 'License Information', COPYING) | GPL-3.0-or-later | "eSpeak NG Text-to-Speech is released under the GPL version 3 or later license." | 2026-11-11 | permissive for this use: copyleft, but only run as a tool, and nothing of it ships (the Governor's to confirm) |
| (d) | ffmpeg | decodes and resamples audio at training time; never shipped | https://github.com/FFmpeg/FFmpeg (LICENSE.md) | LGPL-2.1-or-later | "Most files in FFmpeg are under the GNU Lesser General Public License version 2.1 or later (LGPL v2.1+)." | 2026-11-11 | permissive for this use: only run as a tool |
| (d) | LibriSpeech dev-clean (337,926,286 bytes) | the negative speech, plus a held-out part for counting false wakes | https://www.openslr.org/12/ (and LICENSE.TXT in the archive) | CC BY 4.0 | "LibriSpeech ASR corpus is licensed under a Creative Commons Attribution 4.0 International License." | 2026-11-11 | permissive (attribution) |
| (d) | piper en_US-libritts_r-medium and Piper (next story, not used by the probe) | more and more human-sounding voices for the sayings | https://huggingface.co/datasets/rhasspy/piper-checkpoints/raw/main/en/en_US/libritts_r/medium/MODEL_CARD and https://github.com/rhasspy/piper | CC BY 4.0 (data), MIT (code) | "Dataset * URL: http://www.openslr.org/141/ * License: CC BY 4.0"; "Permission is hereby granted, free of charge" | 2026-11-11 | permissive (attribution) |

## Verdicts

### Route (a): Google's own speech_embedding and Hey Buddy's trainer

**Verdict: CLEAN** only in this narrowed form. Google publishes speech_embedding under Apache 2.0 on Kaggle. Our own
ONNX of it, with its own mel front end, replaces the two NOT CLEAN feature files. Hey Buddy's code, the Piper
voice, the tokenizer, LibriSpeech and two of the augmentation sets are permissive. Some files are left out:
deep-phonemizer.pt (we give our own adversarial phrases), the FMA music set, and Hey Buddy's precalculated features.

**The precalculated features.** Their own words say CC-BY 4.0, but they were made by running openWakeWord's
embedding, which is NOT CLEAN. Whether a non-commercial model's outputs carry its licence is a licence judgement. This
document does not make it, and the route as judged here does not use them. If the Governor allowed them, our
embedding would have to match openWakeWord's numerically. A classifier trained on features from one embedding only
works with that embedding at run time. So the next story would first compare the two on the same audio, and only then
rely on those features. Without them, we make our own negative features from LibriSpeech (CC BY 4.0) with our own
embedding, and no match is needed.

- Training needed: yes, a classifier for each phrase over the shared embedding.
- Training time and disk on the laptop: (estimated, not run) a TensorFlow, tensorflow_hub and tf2onnx venv of about 3
  GB, to convert the model once (under an hour). LibriSpeech train-clean-100 is 6.3 GB, to make about 100 hours of our
  own negative features with our embedding: an hour or two on 4 threads (a guess, not timed). Hey Buddy's training on
  the CPU is 1 to 3 hours, and its own sayings with Piper take about 10 GB of disk. In all: about 20 GB, and half a
  day, to the first 'Hey Lampas' model.
- Browser download: (estimated from openWakeWord's files of the same two models: 1,087,958 and 1,326,578 bytes, and
  Hey Buddy's classifiers of 1,031,918 bytes each) about 3.5 MB of models. Add onnxruntime-web's WebAssembly,
  ort-wasm-simd-threaded.wasm, 14,848,852 bytes, and its loader of 53,725 bytes. About 18 MB the first time, then
  cached.
- In a browser: yes, today, with onnxruntime-web (WebAssembly).
- The first command set: yes for fixed phrases, as one more small classifier each over the same features ('play',
  'pause', 'stop', 'next chapter', 'previous chapter', 'back a verse'). Not 'open a passage', whose words are open-ended
  (a book, a chapter, a verse): that needs speech recognition after the wake.
- Its cost: a Kaggle login to download Google's model. Anonymous downloads return 404. An account is the Governor's to
  make.

### Route (b): sherpa-onnx keyword spotting

**Verdict: NOT CLEAN**. The file that fails is `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01`, the only English
keyword model. Its maker says it is trained on GigaSpeech XL, and GigaSpeech's terms limit the audio to "non-commercial
research and educational purposes". The newer `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20` is UNVERIFIED: its maker
states neither a licence nor its training data. The code (sherpa-onnx, icefall) is Apache-2.0, and a keyword model
trained by us on LibriSpeech with icefall's recipe would be clean. But that means training a speech transducer from
scratch on hundreds of hours of audio, the kind of run icefall makes on GPUs over days, and this laptop has no GPU. So
it is not a route for this spike.

### Route (c): Vosk in the browser with a small grammar

**Verdict: CLEAN** on every file's own licence: Vosk, Kaldi and vosk-browser are Apache-2.0, and the maker lists
vosk-model-small-en-us-0.15 as Apache 2.0. There is one caveat, named for the Governor and not decided here. The maker
does not say what the small model was trained on. The same table lists `vosk-model-en-us-0.42-gigaspeech`, trained on
GigaSpeech, as "Apache 2.0" too. So the maker's label is the only word we have on the small model's data.

- Training needed: no, for words in the model's vocabulary. 'Lampas' is not in it. Vosk 0.3.45 (Python, run on the
  laptop) given a grammar of the words below warned: "Ignoring word missing in vocabulary: 'lampas'". A grammar like
  `["hey lamp us", "hey lamb pass", "[unk]"]` is the only way without new files. Adding the true word
  means recompiling the graph with the maker's vosk-model-en-us-0.22-compile package (Kaldi, phonetisaurus, a large
  download). That package's licence was not read, and its graph is the large model's, not the small one's.
- Training time and disk on the laptop: (estimated) none for the sound-alike grammar, and 41 MB for the model. A
  compiled graph with the real word: several GB and an hour or more, not tried.
- Browser download: (measured) 41,205,931 bytes for the model and 5,804,767 bytes for vosk.js, about 47 MB the first
  time.
- In a browser: yes, today, with vosk-browser (WebAssembly in a Web Worker). Its repository was last pushed
  2025-12-07. It is a whole speech recogniser, running all the time, which costs far more compute per second than a
  wake-word classifier.
- The first command set: yes. The same run found every other word in its vocabulary: hey, lamp, us, lamb, pass,
  open, a, passage, play, pause, stop, next, previous, chapter, back, verse and john. A grammar can name the book
  names and numbers that 'open a passage' needs. This is its real strength: it could be the command recogniser after a
  wake word.

### Route (d): our own small classifier trained from scratch

**Verdict: CLEAN**. Every file is ours (MIT) or permissive at its source. The front end is a plain log-mel of 40
bands, written in probe.mjs: no one else's model. espeak-ng (GPL-3.0-or-later) and ffmpeg (LGPL-2.1-or-later) are only
run as tools at training time, and nothing of them ships. Whether that use of copyleft tools is fine is named for the
Governor below. The negatives are LibriSpeech (CC BY 4.0) and espeak-ng sayings of other words.

- Training needed: yes, for each phrase. It is short: see the probe's measured times below.
- Training time and disk on the laptop: (measured, one process under nice -n 10, one thread)
  - Making the sayings: 2 min 48 s.
  - Decoding LibriSpeech: 91 s.
  - Training: 658 s, 35 epochs, with one round of hard-negative mining after epoch 25. That includes 59 s making the
    fixed negatives.
  - The whole `all` run, with the sayings already made: 12 min 31 s, at most 2.4 GB of memory.
  - Disk: 1.1 GB for the whole scratch folder (du -sh). That also holds route (c)'s Vosk model and venv. Route (d)'s
    own part is LibriSpeech dev-clean (about 0.7 GB, the archive and its unpacked copy) and the decoded audio
    (302 MB).
- Browser download: (measured) 115,265 weights, 461,060 bytes as float32 (about 115 KB as int8). Add, estimated,
  about 10 KB of JavaScript for the front end and the network. No WebAssembly is needed.
- In a browser: not yet run in one. It is plain JavaScript with no dependency, so it runs as is in an AudioWorklet or a
  Web Worker fed by the microphone. It could also be exported to ONNX and run by onnxruntime-web.
- The first command set: partly. Fixed phrases ('play', 'pause', 'stop', 'next chapter', 'previous chapter', 'back a
  verse') can each be one more output of the same network, trained the same way. 'Open a passage' is open-ended, so it
  needs speech recognition after the wake: the browser's own, which voice-kit uses today, or route (c).

## The probe

`scripts/wake-probe/probe.mjs` runs route (d) headless on the laptop. Its README says how. One run of
`node scripts/wake-probe/probe.mjs all`:

1. Makes 1,152 sayings of 'Hey Lampas' with espeak-ng: 6 English voices, 16 variants, 4 speeds and 3 pitches.
2. Makes 840 sayings of 45 near words and sentences.
3. Decodes 107 minutes of LibriSpeech dev-clean from 30 speakers for negatives, and holds 22 minutes from 10 other
   speakers out.
4. Trains the classifier, a 1.8 s window of 40 log-mel bands to one hidden layer of 32. After 25 epochs, every window
   of the training speech the network takes for the phrase is added as a negative (1,277 windows), and 10 more epochs
   follow.
5. Tests:
   - 'Hey Lampas' in four espeak-ng voices it never trained on must be heard.
   - `packages/testing/clips/english.wav` ('Please read me the first chapter') must not be.
   - It also counts false wakes over the held-out LibriSpeech minutes, for information.

The result on the laptop, 2026-11-11:

```
PASS espeak-ng -v en-029 -s 160 -p 50 "Hey Lampas": HEARD (expected heard; best score 1.000, 1.11 s of audio scored in 18 ms)
PASS espeak-ng -v en-029+f4 -s 150 -p 60 "Hey Lampas": HEARD (expected heard; best score 1.000, 1.27 s of audio scored in 8 ms)
PASS espeak-ng -v en-us+m4 -s 175 -p 40 "Hey Lampas": HEARD (expected heard; best score 1.000, 1.11 s of audio scored in 9 ms)
PASS espeak-ng -v en-gb+klatt4 -s 140 -p 50 "Hey Lampas": HEARD (expected heard; best score 1.000, 1.31 s of audio scored in 10 ms)
PASS packages/testing/clips/english.wav ("Please read me the first chapter"): not heard (expected not heard; best score 0.005, 1.92 s of audio scored in 10 ms)
info: 18 false wake(s) in 21.8 min of held-out LibriSpeech speech (10 speakers never trained on); not part of the pass
probe: PASS
```

What this proves, and what it does not:

- It proves that a classifier we own, trained in minutes on the laptop from permissive files only, hears 'Hey Lampas'
  in synthetic voices it never trained on, and does not wake on the test clip. Each saying was tested alone, with a
  second of quiet either side, not inside other speech.
- Its false wakes are far too many. It woke 18 times in 21.8 minutes of speech it never heard, about 50 an hour, at
  the threshold it was built with (0.5, two windows in a row). The epic's provisional target is at most 1 an hour.
  Before the hard-negative round it woke 80 times in the same 21.8 minutes.
  - At a threshold of 0.99 it woke 0 times in the 21.8 minutes, and all four sayings above still scored 1.000.
  - But that threshold was found by looking at the same held-out speech, so it is not a fair measure. The next story
    sets its threshold on other audio.
- It says nothing yet about a human voice, a car or a phone microphone. Every positive was espeak-ng. The epic's story
  w3 measures that.

## Recommendation

**Route (d): our own small classifier, trained from scratch.** Of the CLEAN routes it is the only one where every byte
that ships is ours. It needs no account, no WebAssembly and no model from anyone else. It downloads about half a
megabyte, and it trains on this laptop in minutes, not hours. It is the one the probe proved. Its weakness is real,
and the next story must fix it first: about 50 false wakes an hour on speech it never heard, against a target of 1.
More and more varied negatives, sayings in human-sounding voices and a threshold set on separate audio are the usual
cures; whether they are enough is what story w3 measures. Route (a) is a fair second: Google's embedding was made for
keyword spotting from real speech (the paper on its card is "Training Keyword Spotters with Limited and Synthesized
Speech Data"), and may well hold up better with human voices. But it costs a Kaggle
account, a TensorFlow conversion and a half-day training run before the first test. Route (c) is not a wake-word
engine: it is a whole recogniser running all the time. It is the natural candidate for the command set after the wake.

**The next story** (mw-rdpwdp1.1 re-pathed: train and run in the browser), estimated at size M:

- Add the Piper en_US-libritts_r-medium voice (904 speakers, CC BY 4.0 data, MIT code) beside espeak-ng, so the
  sayings sound human. That is a Python venv of about 1 GB and about 30 minutes of synthesis on 4 threads
  (estimated).
- Add room echo and road-like noise to the mix, and more LibriSpeech (train-clean-100, 6.3 GB) as negatives.
- Set the threshold on audio kept apart from both training and measuring.
- Retrain: about 15 to 30 minutes (estimated from this probe's 11).
- Export the weights (about 0.5 MB, or 115 KB as int8) beside a plain-JavaScript detector in an AudioWorklet on the
  spike page.
- Credit LibriSpeech and LibriTTS-R in the README's Credits as data.

No money is needed.

**The Governor's to decide** (named here, not decided):

1. **Copyleft tools at training time.** espeak-ng (GPL-3.0-or-later) and ffmpeg (LGPL-2.1-or-later) make and decode
   the training audio. They are never shipped, and their output is our data. This document treats that as allowed,
   but it is a licence judgement.
2. **Attribution for training data.** Is a model trained on CC BY 4.0 audio (LibriSpeech, LibriTTS-R) owed an
   attribution where it ships? The safe answer, to credit both, costs nothing.
3. **Vosk's small model.** Its maker labels it Apache 2.0 but does not name its training data. Is the maker's label
   enough to use it, say for the command set?
4. **Hey Buddy's precalculated features.** They are CC-BY 4.0 in their own words, but were computed with
   openWakeWord's non-commercial embedding. May they be used? (Only route (a) would want them.)
5. **A Kaggle account.** Route (a) needs one to download Google's speech_embedding. It is free, but making an account
   is his to allow.
