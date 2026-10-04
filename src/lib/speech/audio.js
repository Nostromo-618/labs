import { requestMicrophoneAudio } from './microphone.js';
import recorderURL from '../../workers/speech-recorder-worklet.js?url&no-inline';

const aborted = () => new DOMException('Speech stopped.', 'AbortError');

export async function createRecorder({ signal, onLimit }) {
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw new Error('Dictation needs HTTPS and microphone support.');
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context || !globalThis.AudioWorkletNode)
    throw new Error('This browser does not support local microphone recording.');
  // Resume immediately inside the user's click before asynchronous permission UI.
  const context = new Context();
  const resumed = context.resume();
  let stream, source, node, sink, timer, stopAck;
  const chunks = [];
  let closed = false;
  const cancel = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    stream?.getTracks().forEach((track) => track.stop());
    source?.disconnect();
    node?.disconnect();
    sink?.disconnect();
    chunks.length = 0;
    void context.close().catch(() => {});
    stopAck?.();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw aborted();
    stream = await requestMicrophoneAudio();
    if (closed || signal.aborted) {
      stream.getTracks().forEach((track) => track.stop());
      throw aborted();
    }
    await resumed;
    await context.audioWorklet.addModule(recorderURL);
    if (closed || signal.aborted) throw aborted();
    source = context.createMediaStreamSource(stream);
    node = new globalThis.AudioWorkletNode(context, 'vwl-speech-recorder');
    sink = context.createGain();
    sink.gain.value = 0;
    node.port.onmessage = ({ data }) => {
      if (closed) return;
      if (data.type === 'pcm') chunks.push(data.pcm);
      else if (data.type === 'stopped') stopAck?.();
      else if (data.type === 'limit') onLimit();
    };
    source.connect(node).connect(sink).connect(context.destination);
    timer = setTimeout(onLimit, 60000);
    return {
      cancel,
      async stop() {
        if (closed || signal.aborted) throw aborted();
        clearTimeout(timer);
        stream.getTracks().forEach((track) => track.stop());
        // Flush the worklet port before releasing its context; bound the wait.
        let ackTimer;
        await new Promise((resolve) => {
          stopAck = resolve;
          ackTimer = setTimeout(resolve, 200);
          node.port.postMessage('stop');
        });
        clearTimeout(ackTimer);
        if (closed || signal.aborted) throw aborted();
        const length = Math.min(
          chunks.reduce((sum, part) => sum + part.length, 0),
          context.sampleRate * 60,
        );
        const pcm = new Float32Array(length);
        let offset = 0;
        for (const part of chunks) {
          const size = Math.min(part.length, length - offset);
          pcm.set(part.subarray(0, size), offset);
          offset += size;
        }
        const rate = context.sampleRate;
        cancel();
        if (!pcm.length) return pcm;
        const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
        if (!Offline) throw new Error('This browser cannot resample local audio.');
        const offline = new Offline(1, Math.ceil((length * 16000) / rate), 16000);
        const buffer = offline.createBuffer(1, length, rate);
        buffer.copyToChannel(pcm, 0);
        const audio = offline.createBufferSource();
        audio.buffer = buffer;
        audio.connect(offline.destination);
        audio.start();
        const rendered = await offline.startRendering();
        if (signal.aborted) throw aborted();
        return rendered.getChannelData(0).slice();
      },
    };
  } catch (error) {
    cancel();
    void resumed.catch(() => {});
    throw error;
  }
}

/** A playback owns only its sources/context and can be stopped between chunks. */
export function createPCMPlayer(signal) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error('Audio playback is unavailable in this browser.');
  const context = new Context();
  const ready = context.resume();
  // Observe rejection now; inference can take seconds before play awaits it.
  void ready.catch(() => {});
  // Start a silent source in the gesture too. Some browsers defer unlocking an
  // otherwise empty audio graph until a source has actually been started.
  const unlock = context.createBufferSource();
  unlock.buffer = context.createBuffer(1, 1, context.sampleRate);
  unlock.connect(context.destination);
  unlock.onended = () => unlock.disconnect();
  unlock.start();
  let source, settle;
  let closed = false;
  const stop = (error = aborted()) => {
    try {
      source?.stop();
    } catch {
      /* already ended */
    }
    settle?.(error);
  };
  const cancel = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', cancel);
    stop();
    try {
      unlock.stop();
    } catch {
      /* already ended */
    }
    unlock.disconnect();
    void context.close().catch(() => {});
    void ready.catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  async function running(turnSignal) {
    if (closed || signal.aborted || turnSignal.aborted) throw aborted();
    if (context.state === 'running') return;
    const resumed = context.resume();
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        turnSignal.removeEventListener('abort', stop);
        if (error) reject(error);
        else resolve();
      };
      const stop = () => finish(aborted());
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              'Neural audio could not start. Click Read aloud again and check the browser’s site Sound setting.',
            ),
          ),
        3000,
      );
      signal.addEventListener('abort', stop, { once: true });
      turnSignal.addEventListener('abort', stop, { once: true });
      Promise.all([ready, resumed]).then(() => finish(), finish);
    });
    if (closed || signal.aborted || turnSignal.aborted) throw aborted();
    if (context.state !== 'running')
      throw new Error('Neural audio is suspended. Click Read aloud again to resume playback.');
  }
  return {
    cancel,
    stop,
    context,
    async play(pcm, rate, { onStart = () => {}, signal: turnSignal = signal } = {}) {
      if (closed || signal.aborted || turnSignal.aborted) throw aborted();
      if (!(pcm instanceof Float32Array) || !pcm.length || !Number.isFinite(rate) || rate <= 0)
        throw new Error(
          'Neural voice produced invalid audio. Reload the page and load Neural voice again.',
        );
      let peak = 0;
      for (const sample of pcm) {
        if (!Number.isFinite(sample))
          throw new Error(
            'Neural voice produced invalid audio. Reload the page and load Neural voice again.',
          );
        peak = Math.max(peak, Math.abs(sample));
      }
      if (peak < 0.000001)
        throw new Error(
          'Neural voice produced silent audio. Reload the page and load Neural voice again.',
        );
      // The context can be suspended while a long sentence is synthesized.
      await running(turnSignal);
      if (closed || signal.aborted || turnSignal.aborted) throw aborted();
      const buffer = context.createBuffer(1, pcm.length, rate);
      buffer.copyToChannel(pcm, 0);
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const active = source;
      const stopTurn = () => stop();
      turnSignal.addEventListener('abort', stopTurn, { once: true });
      try {
        await new Promise((resolve, reject) => {
          const finish = (error) => {
            clearTimeout(timer);
            context.removeEventListener('statechange', checkState);
            active.onended = null;
            settle = null;
            if (error) reject(error);
            else resolve();
          };
          const checkState = () => {
            if (context.state !== 'running')
              finish(
                closed || signal.aborted
                  ? aborted()
                  : new Error('Neural audio was interrupted. Click Read aloud to try again.'),
              );
          };
          const timer = setTimeout(
            () =>
              finish(new Error('Neural audio playback stalled. Click Read aloud to try again.')),
            (pcm.length / rate) * 1000 + 5000,
          );
          settle = finish;
          context.addEventListener('statechange', checkState);
          active.onended = () => finish();
          try {
            active.start();
            onStart();
          } catch (error) {
            finish(error);
          }
        });
      } finally {
        turnSignal.removeEventListener('abort', stopTurn);
        try {
          active.stop();
        } catch {
          /* already ended */
        }
        active.disconnect();
        if (source === active) source = null;
      }
      if (closed || signal.aborted || turnSignal.aborted) throw aborted();
    },
  };
}

export function speakSystem(text, voiceURI, signal) {
  const synth = globalThis.speechSynthesis;
  const voice = synth
    ?.getVoices()
    .find(
      (v) =>
        v.localService === true &&
        /^en(?:[-_]|$)/i.test(v.lang) &&
        (!voiceURI || v.voiceURI === voiceURI),
    );
  if (!voice)
    return Promise.reject(
      new Error('No local English voice is installed. Choose and load Neural voice.'),
    );
  return new Promise((resolve, reject) => {
    const utterance = new globalThis.SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    const finish = (error) => {
      signal.removeEventListener('abort', cancel);
      utterance.onend = utterance.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => {
      synth.cancel();
      finish(aborted());
    };
    utterance.onend = () => finish();
    utterance.onerror = (event) => finish(new Error(`Local voice playback failed: ${event.error}`));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    else synth.speak(utterance);
  });
}
