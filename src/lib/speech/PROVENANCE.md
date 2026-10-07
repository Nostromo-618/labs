# Speech source and assets

Kokoro phonemization/normalization is copied from `hexgrad/kokoro`, commit
`dfb907a02bba8152ca444717ca5d78747ccb4bec`, `kokoro.js/src/phonemize.js`.
Copyright 2025 hexgrad/Kokoro contributors. Apache-2.0; see KOKORO-LICENSE.
The worker's style selection and inference are adapted from that commit's
`kokoro.js/src/kokoro.js`. The upstream streaming splitter is not used.

`phonemizer` is pinned to 1.2.1, npm gitHead
`6835144b7ee9043129222549c1ed2f6a27216278` (xenova/phonemizer.js,
Apache-2.0 wrapper). Its embedded eSpeak NG is GPL-3.0-or-later.
License texts are distributed under `doc/speech-licenses/`.
The package's corresponding wrapper and embedded engine source is available at
https://github.com/xenova/phonemizer.js/tree/6835144b7ee9043129222549c1ed2f6a27216278;
eSpeak NG upstream source is https://github.com/espeak-ng/espeak-ng.
Transformers.js 4.3.0 and matching ONNX Runtime Web are the host's existing
locked dependencies; no separate 3.x runtime or upstream splitter is bundled.
ONNX Runtime Web is locked to `1.31.0-dev.20260914-8d85527a0`.
Whisper graph optimization is disabled to avoid a decoder QDQ rewrite error.
Each speech worker fixes the remote path template to its model revision as well
as passing `revision`, because earlier 4.2.0 metadata discovery omitted that option in
some calls. Fresh-worker offline reload and immutable URLs are covered by real QA.

Whisper model: onnx-community/whisper-tiny.en at
2575352d61be1bf7225cf8f8b268a4678025fc58 (OpenAI Whisper, MIT).
Kokoro model and named English presets: onnx-community/Kokoro-82M-v1.0-ONNX at
1939ad2a8e416c0acfeecc08a694d14ef25f2231 (Apache-2.0).
Only preset voice data is used; no cloning encoder or user voice upload.

Silero VAD v5.1: snakers4/silero-vad at
84768cefdf5a3852400e9d8237f7315d14b64a08 (MIT; SILERO-LICENSE.txt).
The local WASM worker adapts the 16 kHz recurrent input/context protocol from
`src/silero_vad/utils_vad.py` at that commit. The ONNX graph has 2,327,524 bytes,
SHA-256 2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f.
The model is verified before inference. ONNX Runtime Web is a direct exact
version dependency shared with Transformers.js; the same local WASM assets
are used. Voice detection, recording and transcripts stay in memory; only the
pinned detector weights enter the clearable `vwl-speech-vad-v1` cache.

## Named English voice catalog

`voices.json` records all 28 named `af_`, `am_`, `bf_`, and `bm_` presets from
[the same immutable Kokoro revision](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices).
Each record supplies the upstream identity, display name, American/British accent,
phonemization language, exact 522,240-byte size and SHA-256 from upstream LFS
metadata, verified against downloaded bytes. Attribution and Apache-2.0 licensing
apply to the entire catalog, as described above. Names are derived from upstream
preset identifiers; unnamed legacy presets and other languages are excluded.
No voice weights are shipped with Labs. Load requests fetch one selected style;
successful style switches reuse the already loaded shared Kokoro model. American
presets use `a` phonemization and British presets use `b`. Default callers retain
`af_heart`. `node utils/fetch-speech-models.mjs kokoro --all-voices` explicitly
prepares all catalog styles for local QA; normal downloads retain just Heart.
