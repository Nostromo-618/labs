import { AiChat, getModelOption } from '@vanduo-oss/vwl-ai-chat';
import { chatRuntimeOptions, getChatDeviceCapabilities } from '../lib/chat-runtime.js';
import { SpeechSession } from '../lib/speech/session.js';
import { ConversationSession } from '../lib/speech/conversation.js';

// QA-only synthetic microphone; actual resampling, VAD, STT, chat, TTS and playback.
const inputContext = new globalThis.AudioContext({ sampleRate: 48000 });
let inputDestination;
const tracks = [],
  sources = [],
  phases = [],
  turns = [],
  peaks = [];
const status = document.getElementById('status');
const modelId = new URLSearchParams(location.search).get('model') || 'gemma-4-E2B-it-web';
const voiceId = new URLSearchParams(location.search).get('voice') || 'af_heart';
const chat = new AiChat({ ...chatRuntimeOptions, modelId });
const speech = new SpeechSession();
const originalPlayer = speech.playerFactory;
speech.playerFactory = (signal) => {
  const player = originalPlayer(signal);
  const play = player.play.bind(player);
  player.play = (pcm, rate, options) => {
    peaks.push({
      peak: pcm.reduce((peak, v) => Math.max(peak, Math.abs(v)), 0),
      samples: pcm.length,
      microphoneOff: tracks.every((t) => t.readyState === 'ended'),
    });
    return play(pcm, rate, options);
  };
  return player;
};
const report = () => ({
  state: loop.state,
  phases,
  turns,
  peaks,
  captures: tracks.length,
  liveTracks: tracks.filter((t) => t.readyState !== 'ended').length,
  heap: performance.memory?.usedJSHeapSize ?? null,
  userAgent: navigator.userAgent,
});
const loop = new ConversationSession({
  speech,
  getSettings: () => ({
    provider: 'neural',
    voiceId,
    modelId,
    maxOutputTokens: getModelOption(modelId)?.reasoning === 'required' ? 1024 : 192,
  }),
  ensureChat: async () => {
    const capability = await getChatDeviceCapabilities();
    if (
      !capability.webgpuSupported ||
      ((getModelOption(modelId)?.requires || []).includes('shader-f16') && !capability.shaderF16)
    )
      throw new Error('The selected model needs compatible WebGPU features');
    chat.setSystemPromptOptions({
      extraRules: 'Answer in 1–3 short conversational sentences in natural English.',
    });
    if (!chat.isLoaded()) await chat.load();
  },
  cancelChat: () => chat.cancel(),
  restoreInstructions: () => chat.setSystemPromptOptions({}),
  submitTurn: async (text, options) => {
    let previews = 0;
    const answer = await chat.generate(text, { ...options, onPreview: () => previews++ });
    turns.push({
      text,
      answer,
      previews,
      delivery: options.delivery,
      maxOutputTokens: options.maxOutputTokens,
      heap: performance.memory?.usedJSHeapSize ?? null,
    });
    return answer;
  },
  requestMicrophone: async ({ signal }) => {
    await inputContext.resume();
    inputDestination = inputContext.createMediaStreamDestination();
    const stream = inputDestination.stream;
    tracks.push(...stream.getTracks());
    stream.getTracks().forEach((t) => {
      t.enabled = false;
    });
    if (signal.aborted) stream.getTracks().forEach((t) => t.stop());
    return stream;
  },
  // On subsequent turns, use the same synthetic microphone provider.
  captureFactory: async (options) => {
    const { createConversationCapture } = await import('../lib/speech/conversation-capture.js');
    const stream = options.stream || (await loop.requestMicrophone({ signal: options.signal }));
    return createConversationCapture({ ...options, stream });
  },
  onChange: (state) => {
    if (phases.at(-1)?.status !== state.status)
      phases.push({
        status: state.status,
        at: performance.now(),
        liveTracks: tracks.filter((t) => t.readyState !== 'ended').length,
      });
    if (phases.length > 500) phases.shift();
    status.textContent =
      state.status + (state.error ? ': ' + state.error : '') + ' ' + state.progress;
    document.getElementById('results').textContent = JSON.stringify(report(), null, 2);
  },
});
window.conversationEvaluation = {
  loop,
  speech,
  chat,
  report,
  async feedPCM(pcm, rate = 16000) {
    const source = inputContext.createBufferSource();
    source.buffer = inputContext.createBuffer(1, pcm.length, rate);
    source.buffer.copyToChannel(pcm, 0);
    source.connect(inputDestination);
    await new Promise((resolve) => {
      source.onended = resolve;
      source.start();
    });
    source.disconnect();
  },
  async feed(text) {
    if (loop.state.status !== 'listening') throw new Error('Not listening');
    const output = await speech.runtime.synthesize(text, { voiceId });
    for (const pcm of output.chunks) {
      const source = inputContext.createBufferSource();
      source.buffer = inputContext.createBuffer(1, pcm.length, output.sampleRate);
      source.buffer.copyToChannel(pcm, 0);
      source.connect(inputDestination);
      sources.push(source);
      await new Promise((resolve) => {
        source.onended = resolve;
        source.start();
      });
      source.disconnect();
      sources.splice(sources.indexOf(source), 1);
    }
  },
  async dispose() {
    await loop.end();
    speech.dispose();
    await chat.dispose();
    tracks.forEach((t) => t.stop());
    sources.forEach((s) => s.disconnect());
    if (inputContext.state !== 'closed') await inputContext.close();
  },
};
document.getElementById('start').onclick = () => {
  void loop.start();
};
document.getElementById('pause').onclick = () => loop.pause();
document.getElementById('resume').onclick = () => {
  void loop.start();
};
document.getElementById('end').onclick = () => {
  void loop.end();
};
window.addEventListener('pagehide', () => {
  loop.pause();
  speech.dispose();
  if (inputContext.state !== 'closed') void inputContext.close().catch(() => {});
});
