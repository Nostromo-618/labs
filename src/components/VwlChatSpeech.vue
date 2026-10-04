<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { VdButton, VdIcon, VdSpinner } from '@vanduo-oss/vd3';
import { SpeechSession } from '../lib/speech/session.js';
import { localEnglishVoices } from '../lib/speech/text.js';
import { SPEECH_MODELS } from '../lib/speech/assets.js';

const props = defineProps({
  disabled: Boolean,
  compact: Boolean,
  settingsTarget: { type: Object, default: null },
  conversationOwned: Boolean,
  session: { type: Object, default: null },
  sessionState: { type: Object, default: null },
  options: { type: Object, default: null },
});
const emit = defineEmits(['transcript', 'state']);
const provider = ref('system'),
  voiceURI = ref(''),
  voices = ref([]);
const state = ref({
  status: 'idle',
  error: '',
  progress: '',
  whisperReady: false,
  kokoroReady: false,
});
const busy = computed(() => state.value.status !== 'idle');
const session =
  props.session ||
  new SpeechSession({
    ...(props.options || {}),
    onChange: (value) => {
      state.value = value;
      emit('state', value);
    },
    onTranscript: (text) => emit('transcript', text),
  });
watch(
  () => props.sessionState,
  (value) => {
    if (value) state.value = value;
  },
  { immediate: true },
);
function refreshVoices() {
  voices.value = localEnglishVoices();
  if (!voices.value.some((voice) => voice.voiceURI === voiceURI.value))
    voiceURI.value =
      voices.value.find((voice) => voice.default)?.voiceURI || voices.value[0]?.voiceURI || '';
}
function dispose() {
  session.dispose();
}
watch(provider, () => session.cancel());
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && !props.conversationOwned) session.cancel();
  },
);
onMounted(() => {
  refreshVoices();
  globalThis.speechSynthesis?.addEventListener('voiceschanged', refreshVoices);
  window.addEventListener('pagehide', dispose);
  document.addEventListener('freeze', dispose);
});
onBeforeUnmount(() => {
  if (!props.session) dispose();
  globalThis.speechSynthesis?.removeEventListener('voiceschanged', refreshVoices);
  window.removeEventListener('pagehide', dispose);
  document.removeEventListener('freeze', dispose);
});
defineExpose({
  cancel: () => session.cancel(),
  dispose,
  speak: (text) => session.speak(text, { provider: provider.value, voiceURI: voiceURI.value }),
});
</script>

<template>
  <section
    class="vwl-chat-speech"
    :class="{ 'vwl-chat-speech-compact': compact }"
    aria-label="Private speech controls"
  >
    <div class="vwl-chat-speech-actions">
      <VdButton
        v-if="!state.whisperReady"
        size="sm"
        variant="secondary"
        :disabled="disabled || busy"
        @click="session.load('whisper')"
      >
        <VdIcon name="microphone" aria-hidden="true" />
        Enable dictation ({{ SPEECH_MODELS.whisper.downloadMB }} MB)
      </VdButton>
      <VdButton
        v-else-if="state.status === 'recording'"
        size="sm"
        variant="secondary"
        @click="session.finishRecording()"
      >
        <VdIcon name="stop" aria-hidden="true" />
        Stop recording · {{ state.recordingSeconds }} / 60 s
      </VdButton>
      <VdButton
        v-else
        size="sm"
        variant="secondary"
        :disabled="disabled || (busy && state.status !== 'speaking')"
        @click="session.record()"
      >
        <VdIcon name="microphone" aria-hidden="true" />
        Record message
      </VdButton>
      <VdButton
        v-if="busy && !conversationOwned"
        size="sm"
        variant="ghost"
        @click="session.cancel()"
        >Cancel speech</VdButton
      >
      <Teleport :to="settingsTarget || 'body'" :disabled="!settingsTarget">
        <details>
          <summary>Voice settings</summary>
          <div class="vwl-chat-speech-settings">
            <label
              >Read-aloud voice
              <select v-model="provider" class="vd-select" :disabled="disabled || busy">
                <option value="system">System voice · local only</option>
                <option value="neural">Neural voice · Kokoro</option>
              </select>
            </label>
            <template v-if="provider === 'system'">
              <label v-if="voices.length"
                >Local English voice
                <select v-model="voiceURI" class="vd-select" :disabled="disabled || busy">
                  <option v-for="voice in voices" :key="voice.voiceURI" :value="voice.voiceURI">
                    {{ voice.name }} ({{ voice.lang }})
                  </option>
                </select>
              </label>
              <p v-else>
                No local English voice is installed. Select Neural voice and load Kokoro to read
                replies aloud.
              </p>
            </template>
            <template v-else>
              <p>
                Heart (af_heart) · about {{ SPEECH_MODELS.kokoro.downloadMB }} MB including voice
                data. Runs on this device. Audio can take several seconds to prepare.
              </p>
              <VdButton
                size="sm"
                variant="secondary"
                :disabled="disabled || busy || state.kokoroReady"
                @click="session.load('kokoro')"
                >{{ state.kokoroReady ? 'Neural voice ready' : 'Load Neural voice' }}</VdButton
              >
              <VdButton
                v-if="state.kokoroReady"
                size="sm"
                variant="secondary"
                :disabled="disabled || busy"
                @click="session.speak('This is the local neural voice.', { provider: 'neural' })"
                >Test Neural voice</VdButton
              >
              <p v-if="state.kokoroReady">
                If playback finishes silently, check that the browser tab and this site's Sound
                setting are not muted.
              </p>
            </template>
          </div>
        </details>
        <p class="vwl-chat-speech-note">
          English dictation stays on this device. Review the text before sending. Model downloads
          need a connection unless cached. Bundled speech runtime files may also load on first use.
        </p>
        <p v-if="compact && state.progress" role="status" aria-live="polite">
          {{ state.progress }}
        </p>
      </Teleport>
    </div>
    <p
      v-if="!compact && state.status !== 'idle' && !conversationOwned"
      class="vwl-speech-progress"
      role="status"
      aria-live="polite"
    >
      <VdSpinner v-if="state.status !== 'recording'" size="sm" aria-hidden="true" />
      {{
        state.status === 'transcribing'
          ? 'Transcribing on this device…'
          : state.status === 'recording'
            ? 'Microphone recording…'
            : state.status === 'preparing'
              ? 'Waiting for microphone…'
              : state.status === 'speaking'
                ? state.playbackPhase === 'preparing'
                  ? 'Preparing neural audio on this device…'
                  : 'Reading aloud…'
                : 'Loading speech model…'
      }}
      {{ state.progress }}
    </p>
    <p v-if="!compact && state.cacheAvailable === false" role="status">
      Browser storage is unavailable. Speech works now, but future loads may need a connection.
    </p>
    <p v-if="!compact && state.error" class="vwl-chat-speech-error" role="alert">
      {{ state.error }}
    </p>
  </section>
</template>

<style scoped>
.vwl-chat-speech {
  padding: 0.75rem 0;
}
.vwl-chat-speech-compact {
  padding: 0;
}
.vwl-chat-speech-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
}
.vwl-chat-speech-settings {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.vwl-chat-speech-settings label {
  display: grid;
  gap: 0.25rem;
}
.vwl-chat-speech-settings select {
  max-width: 100%;
}
.vwl-chat-speech summary {
  cursor: pointer;
}
.vwl-chat-speech p {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
}
.vwl-chat-speech-note {
  color: var(--text-secondary);
}
.vwl-chat-speech-error {
  color: var(--color-danger, #e45b65);
}
.vwl-speech-progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
