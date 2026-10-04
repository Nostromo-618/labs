const aborted = () => new DOMException('Speech stopped.', 'AbortError');

/** Lazy host-owned worker RPC; no models or runtime imports on page entry. */
export function createSpeechRuntime({
  createWorker = (kind) =>
    kind === 'vad'
      ? new Worker(new URL('../../workers/vad-worker.js', import.meta.url), { type: 'module' })
      : new Worker(new URL('../../workers/speech-worker.js', import.meta.url), { type: 'module' }),
} = {}) {
  const engines = new Map();
  let sequence = 0;
  function release(kind, reason = aborted()) {
    const engine = engines.get(kind);
    if (!engine) return;
    engines.delete(kind);
    engine.worker.terminate();
    engine.pending?.reject(reason);
  }
  function engineFor(kind) {
    if (engines.has(kind)) return engines.get(kind);
    const worker = createWorker(kind);
    const engine = { worker, loaded: false, pending: null };
    engines.set(kind, engine);
    worker.onerror = (event) => {
      if (engines.get(kind) === engine)
        release(kind, new Error(event.message || 'Speech worker failed.'));
    };
    worker.onmessage = ({ data }) => {
      const pending = engine.pending;
      if (!pending || data.id !== pending.id) return;
      if (data.type === 'progress') pending.onProgress?.(data.value);
      else {
        engine.pending = null;
        if (data.type === 'error')
          pending.reject(Object.assign(new Error(data.value.message), { name: data.value.name }));
        else pending.resolve(data.value);
      }
    };
    return engine;
  }
  async function call(kind, method, args, { signal, onProgress } = {}, transfer = []) {
    if (signal?.aborted) throw aborted();
    const engine = engineFor(kind);
    if (engine.pending) throw new Error('A speech operation is already running.');
    const cancel = () => release(kind);
    signal?.addEventListener('abort', cancel, { once: true });
    let timeout;
    try {
      return await new Promise((resolve, reject) => {
        const id = ++sequence;
        engine.pending = { id, resolve, reject, onProgress };
        timeout = setTimeout(
          () => release(kind, new Error('Speech operation timed out. Retry loading the model.')),
          method === 'load' ? 300000 : 120000,
        );
        engine.worker.postMessage({ id, method, args }, transfer);
      });
    } catch (error) {
      release(kind, error);
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  }
  return {
    isLoaded: (kind) => !!engines.get(kind)?.loaded,
    async load(kind, options) {
      if (engines.get(kind)?.loaded) return;
      const result = await call(kind, 'load', { kind, remote: options?.remote === true }, options);
      if (options?.signal?.aborted) throw aborted();
      engines.get(kind).loaded = true;
      return result;
    },
    transcribe(audio, options) {
      return call('whisper', 'transcribe', { audio }, options, [audio.buffer]);
    },
    synthesize(text, options) {
      return call('kokoro', 'synthesize', { text }, options);
    },
    resetVad(options) {
      return call('vad', 'reset', {}, options);
    },
    detectSpeech(frame, options) {
      return call('vad', 'frame', { frame }, options, [frame.buffer]);
    },
    cancel() {
      for (const [kind, engine] of engines) if (engine.pending) release(kind);
    },
    dispose() {
      for (const kind of [...engines.keys()]) release(kind);
    },
  };
}
