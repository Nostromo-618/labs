/** Each createEngine owns exactly one worker and its pending operations. */
export async function loadTransformers() {
  return {
    async createEngine(model, { signal, onProgress }) {
      const worker = new Worker(
        new URL('../workers/transformers-chat-worker.js', import.meta.url),
        { type: 'module' },
      );
      const pending = new Map();
      let sequence = 0,
        closed = false,
        cancelTimer;
      const abortError = () => new DOMException('Generation stopped.', 'AbortError');
      const terminate = (error = abortError()) => {
        closed = true;
        clearTimeout(cancelTimer);
        worker.terminate();
        for (const task of pending.values()) task.reject(error);
        pending.clear();
      };
      worker.onerror = (event) =>
        terminate(new Error(event.message || 'Model worker failed. Reload the model.'));
      worker.onmessage = ({ data }) => {
        const task = pending.get(data.id);
        if (!task) return;
        if (data.type === 'progress') task.onProgress?.(data.value);
        else if (data.type === 'update') task.onUpdate?.(data.value);
        else {
          pending.delete(data.id);
          clearTimeout(cancelTimer);
          if (data.type === 'error')
            task.reject(Object.assign(new Error(data.value.message), { name: data.value.name }));
          else task.resolve(data.value);
        }
      };
      const call = (method, args = {}, callbacks = {}) => {
        if (closed)
          return Promise.reject(new Error('Model worker was released. Reload the model.'));
        return new Promise((resolve, reject) => {
          const id = ++sequence;
          pending.set(id, { resolve, reject, ...callbacks });
          worker.postMessage({ id, method, args });
        });
      };
      const abortLoad = () => terminate();
      signal.addEventListener('abort', abortLoad, { once: true });
      try {
        if (signal.aborted) throw abortError();
        let source;
        // The explicit QA build may be served from an isolated local model host.
        // Keep these machine-local paths out of the normal production bundle.
        if (import.meta.env.DEV || import.meta.env.MODE === 'qa') {
          const response = await fetch(`/models/${model.id}/.labs-model.json`, { signal });
          if (response.ok && !response.headers.get('content-type')?.includes('text/html')) {
            const marker = await response.json();
            if (marker.revision !== model.revision)
              throw new Error(
                `Local ${model.label} files use a different pinned revision. Refresh the local model files before loading.`,
              );
            for (const artifact of model.artifacts || []) {
              const file = artifact.path.split('/').map(encodeURIComponent).join('/');
              const check = await fetch(`/models/${model.id}/${file}`, { method: 'HEAD', signal });
              const bytes = Number(check.headers.get('content-length'));
              if (!check.ok || bytes !== artifact.bytes)
                throw new Error(
                  `Local model file is missing or incomplete: ${artifact.path}. Re-run the validated model fetch.`,
                );
            }
            source = `/models/${model.id}/`;
          }
        }
        await call('load', { model, source }, { onProgress });
      } catch (error) {
        terminate(error);
        throw error;
      } finally {
        signal.removeEventListener('abort', abortLoad);
      }
      return {
        countTokens: (messages) => call('countTokens', { messages }),
        async generate(messages, { maxOutputTokens, signal, onUpdate }) {
          const stop = () => this.cancel();
          signal.addEventListener('abort', stop, { once: true });
          try {
            if (signal.aborted) throw abortError();
            const result = await call(
              'generate',
              { messages, maxOutputTokens },
              {
                onUpdate: (text) => {
                  if (!signal.aborted) onUpdate(text);
                },
              },
            );
            if (signal.aborted) throw abortError();
            return result;
          } finally {
            signal.removeEventListener('abort', stop);
          }
        },
        cancel() {
          if (closed || !pending.size) return;
          worker.postMessage({ method: 'cancel' });
          clearTimeout(cancelTimer);
          cancelTimer = setTimeout(() => terminate(), 2000);
        },
        reset: () => call('reset'),
        async dispose() {
          try {
            if (!closed) await call('dispose');
          } finally {
            terminate();
          }
        },
      };
    },
  };
}
