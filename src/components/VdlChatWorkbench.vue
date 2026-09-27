<script setup>
import { defineAsyncComponent, ref } from 'vue';
import VdlAiChatUI from './VdlAiChatUI.vue';
const Compare = defineAsyncComponent(() => import('./VdlCompareChat.vue'));
const localEvaluation = import.meta.env.DEV || import.meta.env.MODE === 'qa';
const Evaluate = localEvaluation
  ? defineAsyncComponent(() => import('./VdlLocalEvaluation.vue'))
  : null;
const view = ref('chat'),
  selected = ref('gemma-4-E2B-it-web'),
  child = ref(null),
  changing = ref(false);
async function change(next) {
  if (changing.value || next === view.value) return;
  changing.value = true;
  try {
    if (view.value === 'chat') selected.value = child.value?.getModelId?.() || selected.value;
    await child.value?.suspend?.();
    view.value = next;
  } finally {
    changing.value = false;
  }
}
</script>
<template>
  <div class="vdl-chat-workbench">
    <nav class="vdl-chat-views" aria-label="AI Chat mode">
      <button
        class="vd-btn"
        :class="view === 'chat' ? 'vd-btn-primary' : 'vd-btn-outline'"
        :aria-pressed="view === 'chat'"
        :disabled="changing"
        @click="change('chat')"
      >
        Chat</button
      ><button
        class="vd-btn"
        :class="view === 'compare' ? 'vd-btn-primary' : 'vd-btn-outline'"
        :aria-pressed="view === 'compare'"
        :disabled="changing"
        @click="change('compare')"
      >
        Compare</button
      ><button
        v-if="localEvaluation"
        class="vd-btn"
        :class="view === 'evaluate' ? 'vd-btn-primary' : 'vd-btn-outline'"
        :aria-pressed="view === 'evaluate'"
        :disabled="changing"
        @click="change('evaluate')"
      >
        Evaluate · local
      </button>
    </nav>
    <p v-if="changing" role="status">Releasing model resources…</p>
    <KeepAlive
      ><component
        :is="view === 'chat' ? VdlAiChatUI : view === 'compare' ? Compare : Evaluate"
        ref="child"
        :model-a="selected"
    /></KeepAlive>
  </div>
</template>
<style scoped>
.vdl-chat-views {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
</style>
