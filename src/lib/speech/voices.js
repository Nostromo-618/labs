import voices from './voices.json' with { type: 'json' };
export const KOKORO_VOICES = Object.freeze(voices.map((voice) => Object.freeze(voice)));
export function getKokoroVoice(id = 'af_heart') {
  const voice = KOKORO_VOICES.find((v) => v.id === id);
  if (!voice) throw new Error('Choose an available English Kokoro voice.');
  return voice;
}
export async function verifyVoiceBytes(bytes, voice) {
  if (bytes.byteLength !== voice.bytes)
    throw new Error('Neural voice file is incomplete or incompatible.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  if (hash !== voice.sha256)
    throw new Error('Neural voice checksum failed. Clear speech caches and reload this voice.');
}
