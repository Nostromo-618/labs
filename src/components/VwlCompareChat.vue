<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { MODEL_OPTIONS, MODEL_GROUPS } from '@vanduo-oss/vwl-ai-chat';
import { labsMarkdownToHtml } from '@vanduo-oss/vwl-ai-chat/markdown';
import { CompareSession } from '../lib/compare-session.js';
import VwlModelDetails from './VwlModelDetails.vue';
const props = defineProps({ modelA: { type: String, default: 'gemma-4-E2B-it-web' } });
const state = ref(null),
  input = ref(''),
  activePane = ref(0),
  uiError = ref('');
const session = new CompareSession({
  modelA: props.modelA,
  onChange: (value) => {
    state.value = value;
  },
});
session.emit();
const groups = MODEL_GROUPS.map((g) => ({
  ...g,
  models: MODEL_OPTIONS.filter((m) => m.group === g.id && !m.litertRuntime),
})).filter((g) => g.models.length);
const selected = computed(() =>
  state.value.models.map((id) => MODEL_OPTIONS.find((m) => m.id === id)),
);
const download = computed(() =>
  [...new Map(selected.value.filter(Boolean).map((m) => [m.id, m])).values()].reduce(
    (n, m) => n + m.approxBytes,
    0,
  ),
);
const working = computed(() =>
  selected.value.every((m) => m?.estimatedWorkingBytes)
    ? selected.value.reduce((n, m) => n + m.estimatedWorkingBytes, 0)
    : null,
);
const locked = computed(() => state.value.busy || state.value.loading);
const twoLiteRT = computed(() => selected.value.every((m) => m?.backend === 'litert'));
async function act(run) {
  uiError.value = '';
  try {
    await run();
  } catch (e) {
    uiError.value = e.message;
  }
}
async function send() {
  const prompt = input.value.trim();
  if (!prompt) return;
  input.value = '';
  await act(() => session.send(prompt));
}
function exportResults() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ current: session.export(), previous: session.archives }, null, 2)], {
      type: 'application/json',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vanduo-comparison.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
defineExpose({ suspend: () => session.suspend() });
onBeforeUnmount(() => {
  void session.dispose();
});
</script>
<template>
  <section class="vwl-compare" aria-label="Compare two local models">
    <p>
      One prompt, two ongoing chats. Each model remembers its own answers, so follow-up contexts may
      differ.
    </p>
    <div class="vwl-compare-pickers">
      <div v-for="i in [0, 1]" :key="i">
        <label :for="`vwl-compare-model-${i}`">Model {{ i === 0 ? 'A' : 'B' }}</label>
        <select
          :id="`vwl-compare-model-${i}`"
          class="vd-select"
          :value="state.models[i]"
          :disabled="locked"
          @change="act(() => session.select(i, $event.target.value))"
        >
          <option value="" disabled>Choose a model</option>
          <optgroup v-for="group in groups" :key="group.id" :label="group.label">
            <option v-for="model in group.models" :key="model.id" :value="model.id">
              {{ model.label }}
            </option>
          </optgroup>
        </select>
        <VwlModelDetails :model-id="state.models[i]" />
      </div>
    </div>
    <div class="vwl-compare-toolbar">
      <label
        >Execution
        <select
          class="vd-select"
          :value="state.execution"
          :disabled="locked"
          @change="act(() => session.setExecution($event.target.value))"
        >
          <option value="together">Together</option>
          <option value="one-at-a-time">One at a time — lower memory</option>
        </select></label
      >
      <label
        >Output limit
        <select
          class="vd-select"
          v-model.number="session.state.outputTokens"
          :disabled="locked"
          @change="session.emit()"
        >
          <option :value="512">512 tokens</option>
          <option :value="1024">1,024 tokens</option>
          <option :value="2048">2,048 tokens</option>
        </select></label
      >
      <button
        class="vd-btn vd-btn-primary"
        :disabled="locked || !state.models.every(Boolean)"
        @click="act(() => session.loadPair())"
      >
        Load pair
      </button>
    </div>
    <p class="vwl-compare-note">
      {{ (download / 1e6).toFixed(0) }} MB distinct downloads. Working memory:
      {{
        working ? (working / 1e9).toFixed(1) + ' GB estimated' : 'not reliably known for this pair'
      }}. Browser RAM readings are approximate.
    </p>
    <p class="vwl-compare-note">
      {{
        state.execution === 'one-at-a-time'
          ? 'Models load in turn; both conversations are preserved.'
          : twoLiteRT
            ? 'Both models stay loaded; LiteRT generations run in turn.'
            : 'Together timings share GPU resources and are not isolated speed rankings.'
      }}
    </p>
    <p v-if="uiError || state.error" role="alert">{{ uiError || state.error }}</p>
    <div class="vwl-compare-actions">
      <button class="vd-btn vd-btn-outline" :disabled="!locked" @click="session.stop()">
        Stop both</button
      ><button class="vd-btn vd-btn-outline" @click="act(() => session.newComparison())">
        New comparison</button
      ><button class="vd-btn vd-btn-outline" @click="exportResults">Export results</button>
    </div>
    <div class="vwl-compare-tabs" role="tablist" aria-label="Response pane">
      <button
        v-for="i in [0, 1]"
        :key="i"
        :id="`vwl-compare-tab-${i}`"
        role="tab"
        :aria-selected="activePane === i"
        :aria-controls="`vwl-response-${i}`"
        :tabindex="activePane === i ? 0 : -1"
        @click="activePane = i"
        @keydown.right.prevent="
          activePane = 1 - i;
          $event.currentTarget.parentElement.children[1 - i].focus();
        "
        @keydown.left.prevent="
          activePane = 1 - i;
          $event.currentTarget.parentElement.children[1 - i].focus();
        "
      >
        {{ i === 0 ? 'A' : 'B' }} · {{ state.panes[i].status }}
      </button>
    </div>
    <div class="vwl-compare-panes">
      <section
        v-for="(pane, i) in state.panes"
        :key="i"
        :id="`vwl-response-${i}`"
        role="tabpanel"
        :aria-labelledby="`vwl-compare-tab-${i}`"
        :class="['vwl-compare-pane', { 'vwl-compare-active': activePane === i }]"
        :aria-label="`Model ${i === 0 ? 'A' : 'B'} responses`"
      >
        <header>
          <strong>{{ i === 0 ? 'A' : 'B' }} · {{ selected[i]?.label || 'Choose a model' }}</strong
          ><span role="status">{{ pane.status }}</span>
        </header>
        <p v-if="state.loading">{{ pane.progress }}</p>
        <p v-if="pane.error" role="alert">{{ pane.error }}</p>
        <div class="vwl-compare-turns" tabindex="0">
          <p v-if="!pane.turns.length">Answers will appear here.</p>
          <article v-for="(turn, n) in pane.turns" :key="n">
            <p class="vwl-compare-prompt">{{ turn.prompt }}</p>
            <div class="labs-md-prose" v-html="labsMarkdownToHtml(turn.response)"></div>
            <p v-if="turn.context?.omittedTurns">
              {{ turn.context.omittedTurns }} older turns omitted from context.
            </p>
            <p v-if="turn.error">{{ turn.error }}</p>
            <small
              >{{ turn.status
              }}<template v-if="turn.firstAnswerMs != null">
                · First answer {{ (turn.firstAnswerMs / 1000).toFixed(2) }}s</template
              ><template v-if="turn.generationMs != null">
                · Completed {{ (turn.generationMs / 1000).toFixed(2) }}s</template
              ></small
            >
          </article>
        </div>
        <footer>
          <button class="vd-btn vd-btn-outline" :disabled="!locked" @click="session.stop(i)">
            Stop {{ i === 0 ? 'A' : 'B' }}</button
          ><button
            class="vd-btn vd-btn-outline"
            :disabled="locked || !['failed', 'stopped'].includes(pane.turns.at(-1)?.status)"
            @click="act(() => session.retry(i))"
          >
            Retry last answer
          </button>
        </footer>
      </section>
    </div>
    <form class="vwl-compare-compose" @submit.prevent="send">
      <label for="vwl-compare-prompt">Message both models</label
      ><textarea
        id="vwl-compare-prompt"
        v-model="input"
        rows="3"
        :disabled="locked"
        @keydown.enter.exact="
          if (!$event.isComposing && $event.keyCode !== 229) {
            $event.preventDefault();
            send();
          }
        "
      ></textarea
      ><button class="vd-btn vd-btn-primary" :disabled="locked || !input.trim()">
        Send to both
      </button>
    </form>
  </section>
</template>
<style scoped>
.vwl-compare {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
.vwl-compare-pickers,
.vwl-compare-panes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.vwl-compare select {
  width: 100%;
}
.vwl-compare label {
  display: block;
  font-weight: 600;
}
.vwl-compare-toolbar,
.vwl-compare-actions,
.vwl-compare-pane footer {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  align-items: end;
}
.vwl-compare-note {
  font-size: 0.85rem;
  margin: 0;
}
.vwl-compare-pane {
  border: 1px solid var(--vd-border-color, #8886);
  border-radius: 0.8rem;
  padding: 1rem;
  min-width: 0;
}
.vwl-compare-pane header {
  display: grid;
  gap: 0.5rem;
}
.vwl-compare-turns {
  min-height: 12rem;
  max-height: 60vh;
  overflow: auto;
  overflow-wrap: anywhere;
  padding: 0.5rem 0;
}
.vwl-compare-turns article {
  padding-bottom: 1rem;
  border-bottom: 1px solid #8884;
}
.vwl-compare-prompt {
  font-weight: 600;
  white-space: pre-wrap;
}
.vwl-compare-compose {
  display: grid;
  gap: 0.5rem;
}
.vwl-compare-compose textarea {
  width: 100%;
  resize: vertical;
  background: var(--vd-input-bg, transparent);
  color: inherit;
  padding: 0.8rem;
  border: 1px solid #8888;
  border-radius: 0.6rem;
}
.vwl-compare-tabs {
  display: none;
}
@media (max-width: 700px) {
  .vwl-compare-pickers,
  .vwl-compare-panes {
    grid-template-columns: 1fr;
  }
  .vwl-compare-tabs {
    display: flex;
    gap: 0.5rem;
  }
  .vwl-compare-tabs button {
    flex: 1;
    padding: 0.75rem;
    color: inherit;
    background: transparent;
    border: 1px solid #8888;
    border-radius: 0.5rem;
  }
  .vwl-compare-tabs [aria-selected='true'] {
    border-color: var(--vd-primary, #4f86ed);
    font-weight: 700;
  }
  .vwl-compare-pane:not(.vwl-compare-active) {
    display: none;
  }
  .vwl-compare-compose {
    padding-bottom: env(safe-area-inset-bottom);
  }
}
</style>
