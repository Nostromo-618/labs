# vwl-ai-chat

On-device browser chat with LiteRT 0.17.1, WebLLM 0.2.85 and Transformers.js 4.3.0 / ONNX Runtime WebGPU. Labs links the local sibling package and uses a WebLLM module worker with local runtime/WASM assets. Prompts are processed locally; explicit model downloads still need a network connection unless available in browser cache or a development mirror.

## Models and compatibility

General, Docs and Compare share six primary choices grouped by family. A separate precision control exposes two compatibility variants; selecting a model never starts a download. Labels include engine, download size, candidate status and tool capability.

| Primary choice  | Engine                        | Role                                      | Tools                                         |
| --------------- | ----------------------------- | ----------------------------------------- | --------------------------------------------- |
| Gemma 4 E2B     | LiteRT                        | Default, about 2.0 GB                     | Native execution available                    |
| Gemma 4 E4B     | LiteRT                        | Quality, about 3.0 GB                     | Native execution available                    |
| Qwen3 0.6B Tiny | WebLLM                        | Small assistant, about 352 MB             | Documented model support; integration pending |
| LFM2.5 230M     | Transformers.js → ONNX WebGPU | Extraction candidate, about 216 MB        | Documented model support; integration pending |
| LFM2.5 350M     | Transformers.js → ONNX WebGPU | Structured-output candidate, about 297 MB | Documented model support; integration pending |
| LFM2.5 2.6B     | Transformers.js → ONNX WebGPU | Reasoning candidate, about 1.55 GB        | Documented model support; integration pending |

Tiny Q4F32 and LFM 2.6B Q4 remain explicit precision variants. Missing WebGPU disables loading; shader-f16 compatibility is checked before load. Retired selections display an explanation and offer the default without silently downloading it. All three engines retain worker/runtime isolation; no working model is migrated. Retired spikes, Gemma MLC peers and optional model families are removed. Existing downloaded models, chats and historical reports remain intact.

Official model-level tool support is recorded with [Gemma](https://deepmind.google/models/gemma/gemma-4/), [Qwen](https://huggingface.co/Qwen/Qwen3-0.6B#agentic-use) and Liquid model-card sources in the catalog. It does not certify our quantized builds or enable adapters. Only Gemma's integration currently executes tools. Candidate labels remain until fresh validation supports promotion.

Device and storage details are expandable. Browser-reported memory is approximate and does not establish GPU capacity. See the local review report for measured browser/model limitations; phone layout emulation does not establish physical phone inference support.

## Conversation lifecycle

Stop cancels generation. Reset, model switching, and route exit invalidate late output and release runtime resources. Only one operation may generate at a time. Context budgeting reserves response space, preserves system instructions and recent complete turns, and discloses omitted older context while retaining the visible transcript.

AI Chat provides General conversation with one visible and model history. Standalone documentation search is available in its own demo.

Complete replies are buffered and checked before display, persistence or speech. `onUpdate` fires once with the complete checked reply; Compare labels this timing “Checked reply”. Canceled replies are discarded. Rejected output uses a fixed safe response and invalidates backend context. Markdown escapes HTML; rejected link destinations are inert. These checks reduce specific risks; they do not guarantee that a model follows every instruction.

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

Native LiteRT tools are allowlisted and validated before execution. Rounds, calls, execution time, and result size are bounded; native calls receive native tool-response messages. XML requires an explicit compatibility setting. Tool handlers receive an AbortSignal and should cooperate with cancellation. Qwen and LFM tool execution remain integration-pending. Arguments are checked before execution and results before model ingestion or callbacks; rejected results become fixed errors.

## Local development and storage

```sh
pnpm models:fetch
pnpm models:fetch -- --model gemma-4-E4B-it-web
pnpm dev
```

Development probes `/models/<id>/…` for mirrors in ignored `.models/`; an HTML SPA fallback is rejected. Mirrors and evaluation artifacts are excluded from the production build. LiteRT weights use the owned `vwl-litert-models` Cache Storage bucket; WebLLM owns its model caches. Clear storage targets chat-owned records only. Caching is best effort and may fail when the browser denies storage or exceeds its quota. Warm offline inference was verified with an already loaded page and model; a cold offline site visit is not provided by a service worker.

The production build serves bundled JavaScript, LiteRT WASM, ONNX WASM, and pinned Tiny compiled model libraries locally. Model weights remain explicit downloads. Its script policy permits WebAssembly compilation without general JavaScript `unsafe-eval`.

## Guardrail policy and attribution

The default is English-first, family-friendly output. User profanity alone does not refuse a request. Reviewed profanity/slur data and contextual rules preserve health, identity, abuse reporting and help-seeking discussions. Inputs, admitted reference material, imported history, tool arguments and tool results are scanned. Rejected references/history are reported; all supplied evidence being rejected stops generation.

Local TypeScript uses selected adapted [Microsoft PyRIT](https://github.com/microsoft/PyRIT) rules, pinned Unicode confusables and `obscenity@0.4.6`. The sibling [third-party notices](../../vwl-ai-chat/THIRD_PARTY_NOTICES.md) and provenance manifest record versions, licenses, checksums and adaptations. Earlier LlmGuard, ai-guardian and llm-prompt-guard links were research references, not installed dependencies or a maintenance guarantee.

Bounded normalization/decoding scan variants preserve original text. These rules provide limited semantic moderation and may miss new attacks or misunderstand context. No additional classifier or remote service is used. [OWASP boundary guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) informs source/tool boundaries. Keep tool permissions minimal.

The current local validation report is [model and guardrail validation](./vwl-model-guardrails-validation.md). Inference uses Google LiteRT, MLC WebLLM, Hugging Face Transformers.js and ONNX Runtime. Labs UI uses Vanduo VD3 and Phosphor icons.

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
