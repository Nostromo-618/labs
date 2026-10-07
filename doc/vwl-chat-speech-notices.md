# Speech attribution

Kokoro phonemization and normalization are adapted from [hexgrad/Kokoro](https://github.com/hexgrad/kokoro/tree/dfb907a02bba8152ca444717ca5d78747ccb4bec/kokoro.js), copyright 2025 hexgrad/Kokoro contributors, Apache-2.0. The bounded splitter and Labs lifecycle adapters are host code; the upstream streaming splitter is not used. [License text](./speech-licenses/KOKORO-LICENSE.txt).

The pinned `phonemizer` 1.2.1 wrapper is Apache-2.0, copyright Xenova. Its npm source revision is [6835144b7ee9043129222549c1ed2f6a27216278](https://github.com/xenova/phonemizer.js/tree/6835144b7ee9043129222549c1ed2f6a27216278), including the embedded eSpeak engine and its data. [Wrapper license](./speech-licenses/PHONEMIZER-LICENSE.txt). Embedded [eSpeak NG](https://github.com/espeak-ng/espeak-ng) is GPL-3.0-or-later; [license text](./speech-licenses/ESPEAK-NG-LICENSE.txt). Package versions and integrity are recorded in `pnpm-lock.yaml`.

[Whisper Tiny English ONNX](https://huggingface.co/onnx-community/whisper-tiny.en/tree/2575352d61be1bf7225cf8f8b268a4678025fc58) uses the OpenAI Whisper MIT model. [Kokoro and its 28 named English presets](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/1939ad2a8e416c0acfeecc08a694d14ef25f2231) are Apache-2.0. Assets are requested at those immutable revisions. No voice cloning or user voice upload is included.

Inference reuses Transformers.js 4.3.0 and the existing locked ONNX Runtime Web `1.31.0-dev.20260914-8d85527a0`. Matching JavaScript/WASM and phonemizer code are bundled locally. Whisper disables graph optimization to avoid the decoder QDQ/MatMulNBits rewrite failure observed with that runtime.

Voice Conversation Mode uses [Silero VAD v5.1](https://github.com/snakers4/silero-vad/tree/84768cefdf5a3852400e9d8237f7315d14b64a08), copyright Silero Team, MIT. Its model and adapter protocol are pinned to that commit, and the 2.33 MB graph is checked against its exact length and SHA-256 before inference. [License text](./speech-licenses/SILERO-LICENSE.txt). The detector uses the same local ONNX Runtime WASM files as Transformers.js, with an exact direct package version and a dedicated clearable cache.

The [English voice catalog](./kokoro-english-voices.json) records each preset identity, accent, phonemization language, exact 522,240-byte style size and SHA-256. Heart is the initial default; American/British groups exclude unnamed presets and other languages. Styles use the same immutable model revision and Apache-2.0 attribution. [Full source provenance](./speech-source-provenance.md).
