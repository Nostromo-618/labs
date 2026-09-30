# vwl-ai-chat

On-device browser chat with LiteRT 0.17.1 and bundled WebLLM 0.2.85. Labs links the local sibling package and uses a WebLLM module worker with local runtime/WASM assets. Prompts are processed locally; explicit model downloads still need a network connection unless available in browser cache or a development mirror.

## Models and compatibility

The primary picker offers Gemma 4 E2B (default, about 2 GB), E4B (quality, about 3 GB), and Qwen3 0.6B MLC (Tiny, about 0.5 GB). Advanced contains experimental and optional models. Compatibility and download size appear before Load. Constrained devices receive a Tiny recommendation; selecting a model does not start a download. Missing WebGPU disables loading. Where supported, a disclosed f32 variant can accommodate missing shader-f16.

LiteRT portable Qwen3/Ministral experiments remain blocked by their unsupported runtime path. Community MLC Gemma builds retain the latest-turn template workaround and fold host instructions into that user turn. They are experimental and are outside the curated three-model QA matrix.

Device and storage details are expandable. Browser-reported memory is approximate and does not establish GPU capacity. See the local review report for measured browser/model limitations; phone layout emulation does not establish physical phone inference support.

## Conversation lifecycle

Stop cancels generation. Reset, model switching, and route exit invalidate late output and release runtime resources. Only one operation may generate at a time. Context budgeting reserves response space, preserves system instructions and recent complete turns, and discloses omitted older context while retaining the visible transcript.

General chat and Docs keep separate histories. Docs retrieves bounded excerpts from the same canonical local index as search. The host treats references as untrusted, accepts citations only to retrieved source IDs, and shows an insufficient-evidence response when evidence or valid citations are missing. A valid source link is not a guarantee that every generated claim is correct.

Streamed output passes deterministic guardrails before display, and markdown escapes HTML and unsafe links. These checks reduce specific risks; they do not guarantee that a model follows every instruction.

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
  onUpdate: text => console.log(text),
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
