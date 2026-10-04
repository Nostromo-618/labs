import { createSpeechRuntime } from '../lib/speech/runtime.js';
import { createRecorder, createPCMPlayer, speakSystem } from '../lib/speech/audio.js';
import { localEnglishVoices } from '../lib/speech/text.js';
import { SpeechSession } from '../lib/speech/session.js';
import { SpeechEndpoint } from '../lib/speech/endpoint.js';
import { SpeechResampler } from '../lib/speech/resampler.js';

const runtime = createSpeechRuntime();
let controller, chat, microphoneAbort, playbackAbort;
const status = document.getElementById('status');
const results = document.getElementById('results');
const progress = (p) => {
  status.textContent = p.text;
};
window.speechEvaluation = {
  runtime,
  createSession: (options) => new SpeechSession(options),
  createEndpoint: () => new SpeechEndpoint(),
  createResampler: (rate) => new SpeechResampler(rate),
  async run() {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const remote = document.getElementById('remote').checked;
    const start = performance.now();
    const report = {
      userAgent: navigator.userAgent,
      modelSource: remote ? 'pinned Hugging Face assets' : 'local mirror if present',
      localVoices: localEnglishVoices().map((v) => v.name),
      timings: {},
      memoryBefore: performance.memory?.usedJSHeapSize ?? null,
      memoryScope: 'Main-thread JS heap only; excludes speech workers and GPU allocations.',
    };
    try {
      if (document.getElementById('with-chat').checked && !chat) {
        const [{ AiChat }, { chatRuntimeOptions }] = await Promise.all([
          import('@vanduo-oss/vwl-ai-chat'),
          import('../lib/chat-runtime.js'),
        ]);
        chat = new AiChat(chatRuntimeOptions);
        status.textContent = 'Loading Gemma alongside speech…';
        await chat.load();
      }
      report.chatLoaded = !!chat?.isLoaded();
      let at = performance.now();
      report.kokoroCache = await runtime.load('kokoro', { signal, onProgress: progress, remote });
      report.timings.kokoroLoadMs = performance.now() - at;
      status.textContent = 'Synthesizing test phrase…';
      at = performance.now();
      const output = await runtime.synthesize('Hello world. This is a private speech test.', {
        signal,
      });
      report.timings.synthesisMs = performance.now() - at;
      report.audioSeconds = output.chunks.reduce((n, pcm) => n + pcm.length, 0) / output.sampleRate;
      const pcm = new Float32Array(Math.round(report.audioSeconds * output.sampleRate));
      let offset = 0;
      for (const chunk of output.chunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }
      const offline = new globalThis.OfflineAudioContext(
        1,
        Math.ceil((pcm.length * 16000) / output.sampleRate),
        16000,
      );
      const buffer = offline.createBuffer(1, pcm.length, output.sampleRate);
      buffer.copyToChannel(pcm, 0);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      const audio = (await offline.startRendering()).getChannelData(0).slice();
      at = performance.now();
      report.whisperCache = await runtime.load('whisper', { signal, onProgress: progress, remote });
      report.timings.whisperLoadMs = performance.now() - at;
      status.textContent = 'Transcribing synthesized speech…';
      at = performance.now();
      report.transcript = await runtime.transcribe(audio, { signal });
      report.timings.transcriptionMs = performance.now() - at;
      report.silence = await runtime.transcribe(new Float32Array(16000), { signal });
      report.timings.totalMs = performance.now() - start;
      report.memoryAfter = performance.memory?.usedJSHeapSize ?? null;
      window.speechEvaluation.output = output;
      window.speechEvaluation.report = report;
      results.textContent = JSON.stringify(report, null, 2);
      const summary = document.getElementById('summary');
      summary.replaceChildren();
      for (const [key, value] of Object.entries({
        transcript: report.transcript,
        ...report.timings,
      })) {
        const row = document.createElement('p');
        row.textContent = `${key}: ${value}`;
        summary.append(row);
      }
      status.textContent = 'Passed';
      return report;
    } catch (error) {
      status.textContent = 'Failed: ' + error.message;
      throw error;
    }
  },
  stop() {
    controller?.abort();
    microphoneAbort?.abort();
    playbackAbort?.abort();
    runtime.dispose();
    void chat?.dispose();
    chat = null;
    status.textContent = 'Released';
  },
};
document.getElementById('run').onclick = () => {
  void window.speechEvaluation.run().catch(console.error);
};
document.getElementById('stop').onclick = () => window.speechEvaluation.stop();
document.getElementById('microphone').onclick = async () => {
  microphoneAbort?.abort();
  microphoneAbort = new AbortController();
  let recorder;
  try {
    recorder = await createRecorder({ signal: microphoneAbort.signal, onLimit: () => {} });
    status.textContent = 'Recording for three seconds…';
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const audio = await recorder.stop();
    results.textContent = JSON.stringify({
      framesAt16kHz: audio.length,
      seconds: audio.length / 16000,
    });
    status.textContent = 'Microphone released';
  } catch (error) {
    recorder?.cancel();
    status.textContent = error.message;
  }
};
// Testing PCM playback is a separate explicit gesture, preserving browser autoplay rules.
window.speechEvaluation.play = async () => {
  playbackAbort?.abort();
  const playback = (playbackAbort = new AbortController());
  const player = createPCMPlayer(playback.signal);
  const started = performance.now();
  const chunks = [];
  try {
    for (const chunk of window.speechEvaluation.output.chunks) {
      const at = performance.now();
      await player.play(chunk, 24000);
      chunks.push({
        startedMs: at - started,
        finishedMs: performance.now() - started,
        audioSeconds: chunk.length / 24000,
      });
    }
    window.speechEvaluation.playback = { totalMs: performance.now() - started, chunks };
    status.textContent = 'Playback completed';
  } finally {
    player.cancel();
  }
};
document.getElementById('play').onclick = () => {
  void window.speechEvaluation.play().catch((error) => {
    status.textContent = error.message;
  });
};
document.getElementById('system').onclick = async () => {
  playbackAbort?.abort();
  playbackAbort = new AbortController();
  const voice = localEnglishVoices()[0];
  try {
    await speakSystem('This installed voice runs locally.', voice?.voiceURI, playbackAbort.signal);
    status.textContent = 'Local system voice completed';
  } catch (error) {
    status.textContent = error.message;
  }
};
window.addEventListener('pagehide', () => window.speechEvaluation.stop());
