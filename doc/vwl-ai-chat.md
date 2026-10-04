# vwl-ai-chat

On-device browser chat with LiteRT 0.17.1 and bundled WebLLM 0.2.85. Labs links the local sibling package and uses a WebLLM module worker with local runtime/WASM assets. Prompts are processed locally; explicit model downloads still need a network connection unless available in browser cache or a development mirror.

## Models and compatibility

The primary picker offers Gemma 4 E2B (default, about 2 GB), E4B (quality, about 3 GB), and Qwen3 0.6B MLC (Tiny, about 0.5 GB). Advanced contains experimental and optional models. Compatibility and download size appear before Load. Constrained devices receive a Tiny recommendation; selecting a model does not start a download. Missing WebGPU disables loading. Where supported, a disclosed f32 variant can accommodate missing shader-f16.

LiteRT portable Qwen3/Ministral experiments remain blocked by their unsupported runtime path. Community MLC Gemma builds retain the latest-turn template workaround and fold host instructions into that user turn. They are experimental and are outside the curated three-model QA matrix.

Device and storage details are expandable. Browser-reported memory is approximate and does not establish GPU capacity. See the local review report for measured browser/model limitations; phone layout emulation does not establish physical phone inference support.

## Conversation lifecycle

Stop cancels generation. Reset, model switching, and route exit invalidate late output and release runtime resources. Only one operation may generate at a time. Context budgeting reserves response space, preserves system instructions and recent complete turns, and discloses omitted older context while retaining the visible transcript.

AI Chat provides General conversation with one visible and model history. Standalone documentation search is available in its own demo.

Streamed output passes deterministic guardrails before display, and markdown escapes HTML and unsafe links. These checks reduce specific risks; they do not guarantee that a model follows every instruction.

## Private dictation and read-aloud

### Chat workspace

Messages and the composer fill the available viewport below navigation. Settings opens a 320px right panel at workspace widths of at least 960px; it is initially open and collapses to give messages more width. Narrower workspaces use a right-hand drawer with Escape/backdrop dismissal and keyboard focus return. Model, Voice and Storage controls scroll separately from messages. Documentation remains below the workspace.

Conversation Mode, Pause/Resume, End, New conversation and Settings remain in the compact chat header. Dictation stays beside the composer; Read aloud/Stop stays on each completed answer. Main-chat status remains visible while listening, transcribing, thinking or preparing/playing audio, even with Settings closed. Paused voice review remains separate from the saved typed draft.

Closing Settings or resizing does not restart engines, cancel audio or reset voice selection. Settings visibility is temporary UI state; existing model and voice defaults are unchanged. The composer can use page scrolling in very short windows or when a keyboard leaves less than the workspace's minimum height.

See [workspace validation](./vwl-chat-workspace-validation.md) for browser checks and review screenshots.

Labs adds speech controls without changing AiChat's text API. Enable dictation explicitly downloads the pinned Whisper Tiny English model and tokenizer (about 44 MB); Record message requests the microphone, and Stop recording transcribes locally into the current editable draft. Recording stops after 60 seconds. Nothing is sent automatically, and drafts over 2,000 characters stay intact with Send disabled until edited.

Read aloud is available on completed General replies. It reads the final displayed prose after guardrails, omitting code blocks, citation markers and raw URLs. Voice settings default to installed English voices that the browser marks `localService: true`. When none exist, choose Neural voice and explicitly load Kokoro's Heart (`af_heart`, about 94 MB). Both neural speech engines use single-threaded CPU/WASM; they do not change chat's WebGPU requirements. Neural playback prepares at most one sentence ahead, but slower devices may still have gaps.

Neural read-aloud shows “Preparing neural audio” until a PCM source starts. After loading Kokoro, use **Test Neural voice** in Voice settings to check playback independently of chat. If that test finishes silently, check the browser tab's mute state and the site's Sound setting; the page cannot detect a browser-level mute. Suspended, interrupted or stalled Web Audio and invalid/silent model output now produce actionable errors. Stop also cancels an outstanding audio-resume wait.

Recordings remain in memory and are discarded after transcription or cancellation. The application sends neither recordings nor transcripts to inference services and never falls back to browser SpeechRecognition. Sending or recording stops playback; reset, model/mode changes, suspension and navigation invalidate pending results and release workers and audio resources. Speech failure leaves text chat available. Cache denial/quota errors are best effort and may require another download. Clear storage includes the dedicated `vwl-speech-whisper-v1` and `vwl-speech-kokoro-v1` caches.

Pinned model revisions, adapted Kokoro source, package provenance and license attribution are in `src/lib/speech/PROVENANCE.md` and [speech notices](./vwl-chat-speech-notices.md). Models load only after explicit actions. Executable code and matching WASM stay bundled locally under the existing CSP.

For local evaluation:

```sh
pnpm speech:fetch
RUN_SPEECH_INFERENCE=1 pnpm exec playwright test -c tests/local/speech.playwright.config.ts
pnpm exec vite build --mode qa
SPEECH_QA_PRODUCTION=1 RUN_SPEECH_INFERENCE=1 pnpm exec playwright test -c tests/local/speech.playwright.config.ts
```

The QA-only `/demo/speech-eval-harness.html` measures synthesis, transcription, cache reuse, capture and optional coexistence with default Gemma. `RUN_SPEECH_CHAT=1` enables the coexistence test. Development and QA preview can serve ignored `.models/` mirrors; ordinary production builds exclude the harness and mirrors. Warm inference works with network disabled in an already loaded page; new workers still need local executable assets, and cold offline site visits remain outside this change. See [speech validation](./vwl-chat-speech-validation.md) for measurements and outstanding browser QA.

## Host API

```js
import { AiChat } from '@vanduo-oss/vwl-ai-chat';
import { chatRuntimeOptions } from './src/lib/chat-runtime.js';

const chat = new AiChat({ ...chatRuntimeOptions });
await chat.load();
const controller = new AbortController();
const reply = await chat.generate('Hello', {
  signal: controller.signal,
  maxOutputTokens: 512,
  onUpdate: (text) => console.log(text),
});
await chat.dispose();
```

Existing callback signatures remain supported. See the sibling README for typed generation options, source context, token accounting, and supported JSON Schema keywords.

Native LiteRT tools are allowlisted and validated before execution. Rounds, calls, execution time, and result size are bounded; native calls receive native tool-response messages. XML requires an explicit compatibility setting. Tool handlers receive an AbortSignal and should cooperate with cancellation. WebLLM tool execution remains unsupported.

## Local development and storage

```sh
pnpm models:fetch
pnpm models:fetch -- --model gemma-4-E4B-it-web
pnpm dev
```

Development probes `/models/<id>/…` for mirrors in ignored `.models/`; an HTML SPA fallback is rejected. Mirrors and evaluation artifacts are excluded from the production build. LiteRT weights use the owned `vwl-litert-models` Cache Storage bucket; WebLLM owns its model caches. Clear storage targets chat-owned records only. Caching is best effort and may fail when the browser denies storage or exceeds its quota. Warm offline inference was verified with an already loaded page and model; a cold offline site visit is not provided by a service worker.

The production build serves bundled JavaScript, LiteRT WASM, ONNX WASM, and pinned Tiny compiled model libraries locally. Model weights remain explicit downloads. Its script policy permits WebAssembly compilation without general JavaScript `unsafe-eval`.

### Acknowledgments, Technologies & Attribution

Building a fully private, in-browser AI chat with robust guardrails is only possible thanks to the incredible ecosystem of open-source tools and frameworks. We extend our deepest gratitude to the creators and maintainers of the following technologies:

#### Core AI & Inference

- **[WebLLM (@mlc-ai/web-llm)](https://webllm.mlc.ai/)**: The core inference engine powering this component. WebLLM brings large language model chat directly to web browsers using WebGPU acceleration and WebAssembly, enabling completely private, local execution.
- **[Gemma 4 (Google DeepMind)](https://ai.google.dev/gemma)**: Primary LiteRT web models (E2B / E4B) plus experimental MLC peers.
- **[Qwen3](https://qwenlm.github.io/)**, **[Phi-4 (Microsoft)](https://huggingface.co/microsoft)**, **[Ministral (Mistral)](https://mistral.ai/)**: Multi-architecture LiteRT / WebLLM peers for Labs experimentation.
- **[WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)**: The modern web standard that allows web applications to access the device's underlying graphics processing unit (GPU) for highly parallelized computation.

#### Security & Guardrails

The deterministic prompt injection scanner in `vwl-ai-chat` relies on open-source regex patterns compiled, tested, and refined by the cybersecurity community. These patterns form our crucial first line of defense against jailbreaks and prompt leaks. We credit the authors of the following FOSS projects for their foundational research:

- **[LlmGuard (North-Shore-AI)](https://github.com/North-Shore-AI/LlmGuard)**: Comprehensive security protection for LLM applications including prompt injection detection.
- **[ai-guardian (itdove)](https://github.com/itdove/ai-guardian)**: A robust security layer for detecting manipulation attempts before they reach AI models.
- **[llm-prompt-guard (npm package)](https://www.npmjs.com/package/llm-prompt-guard)**: A sub-millisecond prompt injection firewall designed for TypeScript and JavaScript ecosystems.

#### UI & Design

- **[@vanduo-oss/vd3](https://github.com/vanduo-oss/vd3)**: Vanduo UI for Vue 3 used by the Labs site shell (tokens, components, theme).
- **[Phosphor Icons](https://phosphoricons.com/)**: The clean, consistent iconography used throughout the chat interface.

## Conversation Mode (General)

**Conversation Mode** authorizes Gemma E2B, Whisper, Kokoro Heart and the small Silero detector in one click (about 2.15 GB of models plus runtime files). Existing GPU checks run first. The browser may request microphone permission. Missing models load sequentially with progress; loaded engines are reused. Your General history continues and the typed composer draft stays separate.

Speak, then pause for about 1.2 seconds. A valid turn is transcribed and automatically submitted. The guarded answer uses a 192-token budget and asks for 1–3 conversational sentences. Kokoro plays the displayed prose; a spinner beside the reply identifies audio preparation and playback. Neural synthesis now prepares one bounded sentence first and looks ahead by only one sentence while it plays. Listening reopens 400 ms after playback. The microphone tracks are stopped throughout transcription, generation and playback, so spoken interruption is unavailable.

**Pause conversation** cancels the current operation and releases the microphone/audio graph. **Resume conversation** starts a fresh listening turn without resending the previous message. Idle models stay loaded; an interrupted inference worker may need cached reinitialization. **End conversation** restores normal instructions and manual controls. Hiding/freezing the page pauses the loop and requires explicit Resume; reset, workbench changes and navigation end it. Errors pause with available text retained.

Silence, brief detector misfires and empty transcripts do not send. A 60-second recording cap, oversized input or validation rejection pauses with a separate editable voice message. **Send reviewed voice message** explicitly submits that edited message and restarts the loop. Your typed draft is never combined with it or silently truncated. Manual model/mode/speech controls and the composer are unavailable while the automatic mode owns the chat; End restores them.

The internal `ConversationSession` owns cancellation epochs and loop media; the parent owns a shared `SpeechSession`/runtime for manual and automatic speech. A persistent context is unlocked in the initial gesture. Its PCM adapter can stop one playback independently of context disposal. Continuous mono resampling produces ordered 512-sample 16 kHz frames, with 0.5/0.35 VAD thresholds, 300 ms pre-roll and at least 250 ms detected speech. Detector state resets each turn. Queue, recording and audio look-ahead are bounded; raw audio stays in memory only. Clear storage also removes `vwl-speech-vad-v1`.

Actual-model acceptance uses a QA-only synthetic microphone graph, the production CSP and installed Chrome:

```sh
pnpm speech:fetch vad
pnpm build:qa
SPEECH_HEADED=1 SPEECH_QA_PRODUCTION=1 RUN_CONVERSATION_INFERENCE=1 \
  pnpm exec playwright test -c tests/local/speech.playwright.config.ts conversation-inference.spec.ts
pnpm exec playwright test -c tests/local/speech-ui.playwright.config.ts --project=Chromium --project=WebKit
```

See [conversation validation](./vwl-chat-conversation-validation.md) for actual-model timings, offline/network results and limits. English foreground desktop operation is the scope; physical room acoustics, mobile, background listening, barge-in and voice commands are not certified.
