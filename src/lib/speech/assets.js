export const SPEECH_MODELS = Object.freeze({
  whisper: {
    repo: 'onnx-community/whisper-tiny.en',
    revision: '2575352d61be1bf7225cf8f8b268a4678025fc58',
    downloadMB: 44,
    files: [
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx',
    ],
  },
  kokoro: {
    repo: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    revision: '1939ad2a8e416c0acfeecc08a694d14ef25f2231',
    downloadMB: 94,
    files: [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/model_quantized.onnx',
      'voices/af_heart.bin',
    ],
  },
  vad: {
    repo: 'snakers4/silero-vad',
    revision: '84768cefdf5a3852400e9d8237f7315d14b64a08',
    downloadMB: 2.33,
    baseURL:
      'https://raw.githubusercontent.com/snakers4/silero-vad/84768cefdf5a3852400e9d8237f7315d14b64a08/src/silero_vad/data/',
    files: ['silero_vad.onnx'],
    artifacts: [
      {
        path: 'silero_vad.onnx',
        bytes: 2327524,
        sha256: '2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f',
      },
    ],
  },
});
export const SPEECH_CACHE_NAMES = [
  'vwl-speech-whisper-v1',
  'vwl-speech-kokoro-v1',
  'vwl-speech-vad-v1',
];
export const RECORDING_LIMIT_SECONDS = 60;
export function assetURL(model, file) {
  if (model.baseURL) return model.baseURL + file;
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file}`;
}

/** Best-effort owned storage: denied/quota failures must not break inference. */
export async function openSpeechCache(name, storage = globalThis.caches) {
  let cache;
  try {
    cache = await storage?.open(name);
  } catch {
    /* unavailable */
  }
  let available = !!cache;
  return {
    get available() {
      return available;
    },
    async match(key) {
      try {
        return await cache?.match(key);
      } catch {
        available = false;
        return undefined;
      }
    },
    async put(key, response) {
      try {
        await cache?.put(key, response);
      } catch {
        available = false;
        /* quota or storage denied */
      }
    },
  };
}
export async function clearSpeechCaches(storage = globalThis.caches) {
  if (!storage) return;
  await Promise.all(SPEECH_CACHE_NAMES.map((name) => storage.delete(name)));
}
