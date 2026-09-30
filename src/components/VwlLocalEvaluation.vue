<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { MODEL_OPTIONS, BASELINE_MODEL_IDS, NEW_MODEL_IDS } from '@vanduo-oss/vwl-ai-chat';
import { runEvaluation, runPairEvaluation, renderReportHtml } from '../lib/model-evaluation.js';
const selected = ref([...BASELINE_MODEL_IDS, ...NEW_MODEL_IDS]);
const scope = ref('all'),
  cold = ref(true),
  pair = ref(false),
  busy = ref(false),
  message = ref(''),
  report = ref(null),
  error = ref('');
const models = MODEL_OPTIONS.filter((m) => !m.litertRuntime);
const bytes = computed(() =>
  models.filter((m) => selected.value.includes(m.id)).reduce((n, m) => n + m.approxBytes, 0),
);
let controller,
  running = Promise.resolve();
async function run() {
  controller = new AbortController();
  busy.value = true;
  error.value = '';
  const options = {
    modelIds: [...selected.value],
    scope: scope.value,
    cold: cold.value,
    repetitions: 3,
    signal: controller.signal,
    onProgress: (value) => {
      message.value = value.message;
      if (value.report) report.value = value.report;
    },
  };
  running = pair.value ? runPairEvaluation(options) : runEvaluation(options);
  try {
    report.value = await running;
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function download(html) {
  const contents = html
    ? report.value?.kind === 'paired-chat'
      ? renderPairReportHtml(report.value)
      : renderReportHtml(report.value)
    : JSON.stringify(report.value, null, 2);
  const url = URL.createObjectURL(
    new Blob([contents], { type: html ? 'text/html' : 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `vanduo-evaluation.${html ? 'html' : 'json'}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (character) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character];
  });
function renderPairReportHtml(value) {
  const panes = value.modes?.[value.mode] || [[], []];
  const models = value.models || [];
  const renderPane = (index) => {
    const title = models[index]?.label || models[index]?.id || `Pane ${index ? 'B' : 'A'}`;
    const turns = (panes[index] || [])
      .map((turn) => {
        const citations = (turn.citations || [])
          .map((source) => {
            const url = String(source.url || '');
            const safeUrl = /^https:\/\/vd3\.vanduo\.dev\//.test(url)
              ? `<a rel="noreferrer" href="${escapeHtml(url)}">${escapeHtml(source.title || url)}</a>`
              : escapeHtml(source.title || source.id || 'Source');
            return `<li>${safeUrl}</li>`;
          })
          .join('');
        return `<article><h3>${escapeHtml(turn.prompt)}</h3><p>Status: ${escapeHtml(turn.status)}</p><p>${escapeHtml(turn.response)}</p>${citations ? `<ul>${citations}</ul>` : ''}</article>`;
      })
      .join('');
    return `<section><h2>Pane ${index ? 'B' : 'A'} · ${escapeHtml(title)}</h2>${turns || '<p>No turns.</p>'}</section>`;
  };
  const checks = (value.checks || [])
    .map((check) => `<li>${escapeHtml(check.id)}: ${check.pass ? 'passed' : 'failed'}</li>`)
    .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Vanduo paired model evaluation</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:1200px;margin:2rem auto;padding:0 1rem}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem}section,article{border:1px solid #8885;border-radius:12px;padding:1rem}article{margin:.75rem 0}p{overflow-wrap:anywhere}</style><h1>Paired model evaluation</h1><p>${escapeHtml(value.timingNote)}</p><p>Mode: ${escapeHtml(value.mode)} · execution: ${escapeHtml(value.execution)}${value.stopped ? ' · stopped with partial results' : ''}</p><main>${renderPane(0)}${renderPane(1)}</main><h2>Checks</h2><ul>${checks}</ul></html>`;
}
async function suspend() {
  controller?.abort();
  try {
    await running;
  } catch {
    /* retained */
  }
}
defineExpose({ suspend });
onBeforeUnmount(() => {
  void suspend();
});
</script>
<template>
  <section class="vwl-local-evaluation" aria-label="Local model evaluation">
    <h3>Evaluate on this device</h3>
    <p>
      Runs stay local. Standard evaluations use one model at a time: one initial load and three warm
      repetitions. Pair stress tests share GPU resources.
    </p>
    <fieldset :disabled="busy">
      <legend>Models</legend>
      <label v-for="model in models" :key="model.id"
        ><input type="checkbox" v-model="selected" :value="model.id" /> {{ model.label }}</label
      >
    </fieldset>
    <p>{{ (bytes / 1e9).toFixed(2) }} GB total model files before cache reuse.</p>
    <div class="vwl-eval-actions">
      <label
        >Checks
        <select v-model="scope" :disabled="busy || pair">
          <option value="all">All checks</option>
          <option value="general">General</option>
          <option value="docs">Docs</option>
        </select></label
      ><label
        ><input type="checkbox" v-model="cold" :disabled="busy || pair" /> Clear selected chat
        caches before running</label
      ><label
        ><input type="checkbox" v-model="pair" :disabled="busy" /> Pair stress test (select exactly
        two)</label
      ><button
        class="vd-btn vd-btn-primary"
        :disabled="busy || !selected.length || (pair && selected.length !== 2)"
        @click="run"
      >
        Run evaluation</button
      ><button class="vd-btn vd-btn-outline" :disabled="!busy" @click="controller?.abort()">
        Stop
      </button>
    </div>
    <p role="status">{{ message }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="report"
      ><div class="vwl-eval-actions">
        <button class="vd-btn vd-btn-outline" @click="download(false)">Export JSON</button
        ><button class="vd-btn vd-btn-outline" @click="download(true)">Export HTML</button>
      </div>
      <section v-if="report.kind === 'paired-chat'" class="vwl-eval-pair-results">
        <p>
          {{ report.timingNote }}
          <span v-if="report.stopped">Stopped; partial results retained.</span>
        </p>
        <article v-for="(model, paneIndex) in report.models" :key="paneIndex">
          <h4>Pane {{ paneIndex ? 'B' : 'A' }} · {{ model.label }}</h4>
          <article
            v-for="(turn, turnIndex) in report.modes?.[report.mode]?.[paneIndex] || []"
            :key="turnIndex"
            class="vwl-eval-pair-turn"
          >
            <h5>{{ turn.prompt }}</h5>
            <p>Status: {{ turn.status }}</p>
            <p>{{ turn.response }}</p>
            <ul v-if="turn.citations?.length">
              <li v-for="source in turn.citations" :key="source.id">
                <a :href="source.url" target="_blank" rel="noreferrer">{{ source.title }}</a>
              </li>
            </ul>
          </article>
        </article>
        <h4>Pair checks</h4>
        <ul>
          <li v-for="check in report.checks || []" :key="check.id">
            {{ check.id }} · {{ check.pass ? 'passed' : 'failed' }}
          </li>
        </ul>
      </section>
      <template v-else>
        <article v-for="model in report.models" :key="model.modelId">
          <h4>{{ model.label }}</h4>
          <p v-if="model.error">{{ model.error }}</p>
          <details v-for="(test, i) in model.cases" :key="i">
            <summary>
              {{ test.id }} · {{ test.status || (test.pass ? 'passed' : 'failed') }} · round
              {{ test.round }}
            </summary>
            <p>{{ test.reasons?.join('; ') }}</p>
            <pre>{{ test.excerpt }}</pre>
          </details>
        </article>
        <pre v-if="report.checks">{{ report.checks }}</pre>
      </template>
    </template>
  </section>
</template>
<style scoped>
.vwl-local-evaluation fieldset {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  padding: 1rem;
}
.vwl-eval-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  margin: 1rem 0;
}
.vwl-local-evaluation pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.vwl-local-evaluation details {
  margin: 0.5rem 0;
}
.vwl-eval-pair-turn {
  margin: 0.75rem 0;
  overflow-wrap: anywhere;
}
.vwl-local-evaluation summary {
  cursor: pointer;
}
</style>
