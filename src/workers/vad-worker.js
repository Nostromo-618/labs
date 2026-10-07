// Silero v5.1 adapter derived from snakers4/silero-vad at
// 84768cefdf5a3852400e9d8237f7315d14b64a08 (MIT). See speech/PROVENANCE.md.
import * as ort from 'onnxruntime-web/wasm';
import { SPEECH_MODELS, assetURL, openSpeechCache } from '../lib/speech/assets.js';
import { publicUrl } from '../lib/public-url.js';

ort.env.wasm.wasmPaths = publicUrl('transformers-wasm/');
ort.env.wasm.numThreads = 1;
let session, state, context;
function reset() {
  state = new Float32Array(256);
  context = new Float32Array(64);
}
async function load(args, progress) {
  const spec = SPEECH_MODELS.vad;
  const cache = await openSpeechCache('vwl-speech-vad-v1');
  let url = assetURL(spec, spec.files[0]);
  if (!args.remote && (import.meta.env.DEV || import.meta.env.MODE === 'qa')) {
    const base = new URL('/models/vwl-speech-vad/', self.location.href).href;
    const marker = base + '.labs-model.json';
    let response = await cache.match(marker);
    if (!response) {
      try {
        response = await fetch(marker);
      } catch {
        /* remote model remains available */
      }
      if (response?.ok && !response.headers.get('content-type')?.includes('text/html'))
        await cache.put(marker, response.clone());
    }
    if (response?.ok && !response.headers.get('content-type')?.includes('text/html')) {
      if ((await response.json()).revision !== spec.revision)
        throw new Error('Local voice detector revision differs. Refresh its model files.');
      url = base + spec.files[0];
    }
  }
  progress({ text: 'Loading voice detector (2.33 MB)…', cacheAvailable: cache.available });
  let response = await cache.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw new Error('Voice detector could not be downloaded.');
  }
  const bytes = await response.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (bytes.byteLength !== spec.artifacts[0].bytes || digest !== spec.artifacts[0].sha256)
    throw new Error('Voice detector is incomplete or incompatible.');
  await cache.put(url, new globalThis.Response(bytes));
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  reset();
  return { cacheAvailable: cache.available };
}
async function frame(pcm) {
  if (!session || !(pcm instanceof Float32Array) || pcm.length !== 512)
    throw new Error('Invalid voice detector frame.');
  const input = new Float32Array(576);
  input.set(context);
  input.set(pcm, 64);
  const feeds = {
    input: new ort.Tensor('float32', input, [1, 576]),
    state: new ort.Tensor('float32', state, [2, 1, 128]),
    sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), []),
  };
  let output;
  try {
    output = await session.run(feeds);
    state = output.stateN.data.slice();
    context = pcm.slice(-64);
    return Number(output.output.data[0]);
  } finally {
    for (const tensor of [...Object.values(feeds), ...Object.values(output || {})])
      tensor.dispose?.();
  }
}
self.onmessage = async ({ data: { id, method, args } }) => {
  try {
    const value =
      method === 'load'
        ? await load(args, (value) => self.postMessage({ id, type: 'progress', value }))
        : method === 'reset'
          ? reset()
          : method === 'frame'
            ? await frame(args.frame)
            : (() => {
                throw new Error('Unknown voice detector operation.');
              })();
    self.postMessage({ id, type: 'result', value });
  } catch (error) {
    self.postMessage({ id, type: 'error', value: { name: error.name, message: error.message } });
  }
};
