import { KOKORO_VOICES } from './speech/voices.js';
const KEY = 'vwl-chat-settings-v1';
const defaults = {
  delivery: 'checked-stream',
  provider: 'neural',
  voiceId: 'af_heart',
  voiceURI: '',
};
export function readChatPreferences() {
  let value = {};
  try {
    value = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    /* storage denied */
  }
  return {
    delivery: value.delivery === 'complete' ? 'complete' : defaults.delivery,
    provider: value.provider === 'system' ? 'system' : defaults.provider,
    voiceId: KOKORO_VOICES.some((v) => v.id === value.voiceId) ? value.voiceId : defaults.voiceId,
    voiceURI: typeof value.voiceURI === 'string' ? value.voiceURI.slice(0, 1024) : '',
  };
}
export function saveChatPreferences(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readChatPreferences(), ...patch }));
  } catch {
    /* storage denied */
  }
}
