import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { KOKORO_VOICES, getKokoroVoice } from '../src/lib/speech/voices.js';
import { SPEECH_MODELS, assetURL } from '../src/lib/speech/assets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const voiceArg = args.indexOf('--voices');
const selectedVoices = args.includes('--all-voices')
  ? KOKORO_VOICES
  : voiceArg >= 0
    ? (args[voiceArg + 1] || '').split(',').map(getKokoroVoice)
    : [getKokoroVoice()];
const requested = args.filter(
  (arg, i) => !arg.startsWith('--') && (voiceArg < 0 || i !== voiceArg + 1),
);
const kinds = requested.length ? requested : Object.keys(SPEECH_MODELS);
for (const kind of kinds) {
  const spec = SPEECH_MODELS[kind];
  if (!spec) throw new Error('Choose whisper, kokoro and/or vad.');
  const directory = path.join(root, '.models', `vwl-speech-${kind}`);
  const metadata = spec.artifacts
    ? null
    : await fetch(
        `https://huggingface.co/api/models/${spec.repo}/revision/${spec.revision}?blobs=true`,
      );
  if (metadata && !metadata.ok)
    throw new Error(`Speech manifest download failed: ${metadata.status}`);
  const files =
    spec.artifacts?.map((record) => ({
      rfilename: record.path,
      size: record.bytes,
      lfs: { sha256: record.sha256 },
    })) || (await metadata.json()).siblings;
  const paths =
    kind === 'kokoro'
      ? [
          ...spec.files.filter((file) => !file.startsWith('voices/')),
          ...selectedVoices.map((v) => v.path),
        ]
      : spec.files;
  for (const file of paths) {
    const artifact = files.find((record) => record.rfilename === file);
    if (!artifact) throw new Error(`Pinned model lacks ${file}`);
    const target = path.join(directory, file);
    const valid = (bytes) =>
      bytes.length === artifact.size &&
      (!artifact.lfs || createHash('sha256').update(bytes).digest('hex') === artifact.lfs.sha256);
    try {
      if (valid(await fs.readFile(target))) {
        console.log(`${kind}: cached ${file}`);
        continue;
      }
    } catch {
      /* download */
    }
    const response = await fetch(assetURL(spec, file));
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${file}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new Error(`Incomplete or invalid speech artifact: ${file}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target + '.part', bytes);
    await fs.rename(target + '.part', target);
    console.log(`${kind}: verified ${file} (${bytes.length} bytes)`);
  }
  await fs.writeFile(
    path.join(directory, '.labs-model.json'),
    JSON.stringify({ repo: spec.repo, revision: spec.revision }),
  );
}
