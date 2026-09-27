<script setup>
import VdlModelDetails from './VdlModelDetails.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { VdButton, VdCard, VdIcon, VdModal, VdProgress, VdSpinner } from '@vanduo-oss/vd3';
import {
  AiChat,
  MODEL_GROUPS,
  MODEL_OPTIONS,
  assessLoadCapacity,
  collectDeviceSignals,
  describeLoadProgress,
  getLiteRTRuntimeBlockReason,
  getModelDisplayName,
  getModelOption,
  shouldFocusChatComposer,
} from '@vanduo-oss/vdl-ai-chat';
import { chatRuntimeOptions, clearChatCaches } from '../lib/chat-runtime.js';
import {
  createDocsSearch,
  retrieveDocs,
  citedSources,
  INSUFFICIENT_EVIDENCE,
} from '../lib/docs-search.js';
import { labsMarkdownToHtml } from '@vanduo-oss/vdl-ai-chat/markdown';

const MODEL_CACHE_FLAG_PREFIX = 'vdl-ai-chat-model-cached:';

const props = defineProps({
  chat: { type: Object, default: null },
});

/**
 * Inference engines (LiteRT / WebLLM WASM) must not live inside Vue reactivity
 * (Proxy breaks bindings) and only one runtime should exist per tab.
 * Keep the owned runtime outside Vue proxies and dispose it on exit.
 * @type {AiChat | null}
 */
let chat = null;

const selectedModelId = ref(MODEL_OPTIONS[0].id);
const systemInfo = ref(null);
const loaded = ref(false);
const loading = ref(false);
const progressPct = ref(0);
const progressText = ref('');
const statusText = ref('Offline');
const statusTone = ref('muted');
const fallbackNote = ref('');
const cacheHint = ref('');
const inputText = ref('');
const messages = ref([]);
const streaming = ref(false);
const tokenCount = ref(null);
const clearModalOpen = ref(false);
const storageUsage = ref('—');
const storageQuota = ref('—');
const storagePct = ref(0);
const errorBanner = ref('');
const messagesEl = ref(null);
const composerInput = ref(null);
const stickToBottom = ref(true);
const capacityNote = ref('');
const freezeHint = ref('');
const advanced = ref(false);
const mode = ref('general');
const contextNotice = ref('');
const docsSemanticLoading = ref(false);
const docsStatus = ref(
  'Docs mode uses the local vd3 index. Optional semantic search downloads about 23 MB.',
);
const sessions = { general: { messages: [], history: [] }, docs: { messages: [], history: [] } };
let docsSearch = null;
let alive = true;
let uiOperation = 0;
let generationAbort = null;
let modeChanging = ref(false);
let docsSearchPending = null;
const curatedIds = new Set(['gemma-4-E2B-it-web', 'gemma-4-E4B-it-web', 'Qwen3-0.6B-q4f16_1-MLC']);

let unsubProgress = null;

const displayTitle = computed(() => `AI Chat (${getModelDisplayName(selectedModelId.value)})`);

const deviceSummary = computed(() => {
  const info = systemInfo.value;
  if (!info) return 'Checking…';
  const mem = info.deviceMemory != null ? `~${info.deviceMemory} GB RAM*` : 'RAM n/a';
  const cores =
    info.hardwareConcurrency != null ? `${info.hardwareConcurrency} cores` : 'cores n/a';
  const buf =
    info.maxStorageBufferBindingSize != null
      ? `buf ${(info.maxStorageBufferBindingSize / (1024 * 1024)).toFixed(0)} MB`
      : '';
  return [mem, cores, buf].filter(Boolean).join(' · ');
});

const groupedModels = computed(() =>
  MODEL_GROUPS.map((group) => ({
    ...group,
    models: MODEL_OPTIONS.filter(
      (m) => (advanced.value || curatedIds.has(m.id)) && (m.group || 'optional') === group.id,
    ).map((model) => {
      const resolved = resolveModelForSystem(model.id);
      return {
        ...model,
        resolved,
        cached: isModelLikelyCached(model.id),
        label: buildOptionLabel(model, resolved),
      };
    }),
  })).filter((group) => group.models.length),
);

function cacheFlagKey(modelId) {
  return `${MODEL_CACHE_FLAG_PREFIX}${modelId}`;
}

function isModelLikelyCached(modelId) {
  try {
    return localStorage.getItem(cacheFlagKey(modelId)) === '1';
  } catch {
    return false;
  }
}

function markModelCached(modelId) {
  try {
    localStorage.setItem(cacheFlagKey(modelId), '1');
  } catch {
    /* ignore */
  }
}

function resolveModelForSystem(modelId) {
  const option = getModelOption(modelId);
  if (!option) {
    return { modelId, changed: false, unavailable: false, loadBlocked: false, reason: '' };
  }

  const runtimeBlock = getLiteRTRuntimeBlockReason(option);
  if (runtimeBlock) {
    return {
      modelId,
      changed: false,
      unavailable: false,
      loadBlocked: true,
      reason: runtimeBlock,
    };
  }

  if (!systemInfo.value) {
    return { modelId, changed: false, unavailable: false, loadBlocked: false, reason: '' };
  }
  if (!systemInfo.value.webgpuSupported || systemInfo.value.error)
    return {
      modelId,
      changed: false,
      unavailable: true,
      loadBlocked: false,
      reason:
        'WebGPU is unavailable in this browser. Model loading requires a compatible browser and GPU.',
    };
  const missing = (option.requires || []).filter((feature) => {
    if (feature === 'shader-f16') return !systemInfo.value.shaderF16;
    return true;
  });
  if (missing.length && option.fallbackId && !option.experimental) {
    return {
      modelId: option.fallbackId,
      changed: true,
      unavailable: false,
      loadBlocked: false,
      reason: `Using compatibility fallback (${option.fallbackId}) because shader-f16 is not available.`,
    };
  }
  if (missing.length) {
    return {
      modelId,
      changed: false,
      unavailable: true,
      loadBlocked: false,
      reason: `This model requires ${missing.join(', ')}. Choose another model on this device.`,
    };
  }
  return { modelId, changed: false, unavailable: false, loadBlocked: false, reason: '' };
}

function buildOptionLabel(model, resolved) {
  const flags = [];
  if (model.litertKind === 'web-official') flags.push('LiteRT official web');
  else if (model.litertKind === 'portable') flags.push('LiteRT portable');
  else if (model.litertKind === 'spike') flags.push('LiteRT spike');
  if (model.experimental) flags.push('Experimental');
  if (resolved.loadBlocked) flags.push('Runtime unsupported');
  if (isModelLikelyCached(model.id)) flags.push('Cached');
  if (resolved.unavailable) flags.push('Unavailable');
  return `${model.label}${flags.length ? ` — ${flags.join(' — ')}` : ''}`;
}

const selectedResolved = computed(() => resolveModelForSystem(selectedModelId.value));
const loadDisabled = computed(
  () => loading.value || selectedResolved.value.unavailable || selectedResolved.value.loadBlocked,
);

async function detectSystemInfo() {
  const info = {
    webgpuSupported: !!navigator.gpu,
    adapterName: null,
    shaderF16: false,
    error: null,
    ...collectDeviceSignals(null),
  };
  if (!navigator.gpu) return info;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      info.error = 'No adapter found';
      return info;
    }
    info.adapterName = adapter.name || 'Unknown adapter';
    info.shaderF16 = !!(adapter.features && adapter.features.has('shader-f16'));
    Object.assign(info, collectDeviceSignals(adapter));
  } catch (err) {
    info.error = err?.message || 'Adapter detection failed';
  }
  return info;
}

function refreshCapacityNote(modelId = selectedModelId.value) {
  const resolved = resolveModelForSystem(modelId);
  if (resolved.loadBlocked || resolved.unavailable) {
    capacityNote.value = '';
    return;
  }
  const assessment = assessLoadCapacity({
    modelId: resolved.modelId,
    systemInfo: systemInfo.value || {},
  });
  if (assessment.level === 'ok') {
    capacityNote.value = '';
    return;
  }
  const prefer = assessment.recommendedLabel
    ? ` Prefer ${assessment.recommendedLabel} on weaker devices.`
    : '';
  capacityNote.value = `${assessment.level === 'high' ? 'Warning' : 'Caution'}: ${
    assessment.reasons[0] || 'This device may struggle with the selected model.'
  }${prefer}`;
}

function applySelection(modelId) {
  selectedModelId.value = modelId;
  const resolved = resolveModelForSystem(modelId);
  fallbackNote.value =
    resolved.changed || resolved.unavailable || resolved.loadBlocked ? resolved.reason : '';
  if (resolved.loadBlocked) {
    errorBanner.value = '';
  }
  cacheHint.value = resolved.loadBlocked
    ? ''
    : isModelLikelyCached(modelId) || isModelLikelyCached(resolved.modelId)
      ? 'This model looks cached in your browser — reload should skip a full download.'
      : 'First load downloads model weights into browser cache.';
  refreshCapacityNote(modelId);
  if (!loaded.value && chat && !resolved.loadBlocked && !resolved.unavailable) {
    void chat.setModelId(resolved.modelId).catch(() => {
      /* ignore while loading */
    });
  }
}

function isNearBottom(el, threshold = 80) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function onMessagesScroll() {
  stickToBottom.value = isNearBottom(messagesEl.value);
}

async function scrollToLatest(force = false) {
  await nextTick();
  const el = messagesEl.value;
  if (!el) return;
  if (force || stickToBottom.value) {
    el.scrollTop = el.scrollHeight;
    stickToBottom.value = true;
  }
}

function isOtherInteractiveControl(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  if (el === composerInput.value) return false;
  if (typeof el.closest === 'function' && el.closest('[role="dialog"], .vd-modal')) return true;
  const tag = el.tagName;
  return (
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'A' ||
    el.isContentEditable === true
  );
}

/**
 * Keep keyboard UX on the composer after send/stream/load, without stealing
 * focus from model select / modal / other controls.
 * @param {{ force?: boolean }} [opts]
 */
async function focusComposer(opts = {}) {
  const force = !!opts.force;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const chatReady = loaded.value && !loading.value;
  if (
    !shouldFocusChatComposer({
      force,
      modalOpen: clearModalOpen.value,
      chatReady,
      activeIsComposer: active === composerInput.value,
      activeIsOtherControl: isOtherInteractiveControl(active),
    })
  ) {
    return;
  }
  await nextTick();
  const el = composerInput.value;
  if (!el || clearModalOpen.value || !loaded.value || loading.value) return;
  if (el.disabled) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
}

async function refreshStoragePanel() {
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      const usage = est.usage || 0;
      const quota = est.quota || 0;
      storageUsage.value = formatBytes(usage);
      storageQuota.value = quota ? formatBytes(quota) : '—';
      storagePct.value = quota ? Math.min(100, Math.round((usage / quota) * 100)) : 0;
    }
  } catch {
    storageUsage.value = '—';
    storageQuota.value = '—';
    storagePct.value = 0;
  }
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function loadModel() {
  if (!chat || loading.value) return;
  const catalogId = selectedModelId.value;
  const resolved = resolveModelForSystem(catalogId);
  if (resolved.unavailable || resolved.loadBlocked) {
    errorBanner.value = resolved.reason;
    progressText.value = '';
    return;
  }

  errorBanner.value = '';
  applySelection(catalogId);
  await chat.setModelId(resolved.modelId, { resetMessages: true });
  // Keep the catalog option selected (fallback IDs are not in the <select>).
  selectedModelId.value = catalogId;
  loading.value = true;
  progressPct.value = 0;
  freezeHint.value = '';
  progressText.value =
    getModelOption(catalogId)?.backend === 'litert'
      ? 'Initializing LiteRT WebGPU engine…'
      : 'Initializing WebGPU engine…';
  statusTone.value = 'warn';
  statusText.value = 'Loading…';
  try {
    await chat.load();
    await chat.setHistory(sessions[mode.value].history);
    if (!alive) return;
    markModelCached(catalogId);
    markModelCached(resolved.modelId);
    loaded.value = true;
    statusTone.value = 'ok';
    statusText.value = `Online (${getModelDisplayName(catalogId)})`;
    progressText.value = '';
    freezeHint.value = '';
    stickToBottom.value = true;
    await refreshStoragePanel();
  } catch (err) {
    statusTone.value = 'danger';
    statusText.value = 'Error';
    // Keep the message only in the error banner (avoid muted + red duplicates).
    progressText.value = '';
    errorBanner.value = err?.message || 'Failed to load model.';
    freezeHint.value = '';
  } finally {
    loading.value = false;
  }
  if (loaded.value) await focusComposer();
}

async function switchModel() {
  if (!chat || loading.value || streaming.value) return;
  const resolved = resolveModelForSystem(selectedModelId.value);
  if (resolved.unavailable || resolved.loadBlocked) {
    errorBanner.value = resolved.reason;
    progressText.value = '';
    return;
  }
  if (resolved.modelId === chat.modelId && loaded.value) return;
  loaded.value = false;
  sessions.general = { messages: [], history: [] };
  sessions.docs = { messages: [], history: [] };
  messages.value = [];
  tokenCount.value = null;
  stickToBottom.value = true;
  chat.reset();
  await loadModel();
}

async function getDocsEngine() {
  if (!docsSearch && !docsSearchPending)
    docsSearchPending = createDocsSearch()
      .then(async (engine) => {
        if (!alive) {
          await engine.dispose();
          throw new DOMException('Closed', 'AbortError');
        }
        docsSearch = engine;
        return engine;
      })
      .finally(() => {
        docsSearchPending = null;
      });
  if (docsSearchPending) await docsSearchPending;
  return docsSearch;
}
async function enableDocsSemantic() {
  docsSemanticLoading.value = true;
  try {
    await (await getDocsEngine()).initSemantic();
    docsStatus.value = 'Semantic docs search ready.';
  } catch (error) {
    docsStatus.value = `Fuzzy docs search remains available. ${error.message}`;
  } finally {
    docsSemanticLoading.value = false;
  }
}
function stopGeneration() {
  generationAbort?.abort();
  chat?.cancel?.();
}
async function resetConversation() {
  generationAbort?.abort();
  const operation = ++uiOperation;
  chat?.reset();
  messages.value = [];
  sessions[mode.value] = { messages: [], history: [] };
  contextNotice.value = '';
  errorBanner.value = '';
  await chat?.setHistory?.([]);
  if (alive && operation === uiOperation) streaming.value = false;
}
watch(mode, async (next, previous) => {
  modeChanging.value = true;
  uiOperation += 1;
  sessions[previous] = { messages: messages.value, history: chat?.getHistory?.() || [] };
  messages.value = sessions[next].messages;
  await chat?.setHistory?.(sessions[next].history);
  contextNotice.value = '';
  errorBanner.value = '';
  modeChanging.value = false;
});
async function sendMessage() {
  if (!chat || !loaded.value || streaming.value || modeChanging.value) return;
  const text = inputText.value.trim();
  if (!text) return;
  const operation = ++uiOperation;
  const current = () => alive && operation === uiOperation;
  const controller = new AbortController();
  generationAbort = controller;
  errorBanner.value = '';
  inputText.value = '';
  messages.value.push({ role: 'user', content: text });
  messages.value.push({ role: 'assistant', content: '' });
  const assistantIdx = messages.value.length - 1;
  streaming.value = true;
  stickToBottom.value = true;
  await scrollToLatest(true);
  await focusComposer({ force: true });
  try {
    const sources = mode.value === 'docs' ? await retrieveDocs(await getDocsEngine(), text) : [];
    if (!current()) return;
    if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    if (mode.value === 'docs' && !sources.length) {
      messages.value[assistantIdx] = { role: 'assistant', content: INSUFFICIENT_EVIDENCE };
      return;
    }
    const reply = await chat.generate(text, {
      signal: controller.signal,
      sources,
      maxOutputTokens: 768,
      onContext: ({ omittedTurns }) => {
        if (current())
          contextNotice.value = omittedTurns
            ? `${omittedTurns} older turn(s) omitted from model context. Your transcript is still visible.`
            : '';
      },
      onUpdate: (partial) => {
        if (!current() || mode.value === 'docs') return;
        messages.value[assistantIdx] = { role: 'assistant', content: partial };
        void scrollToLatest();
      },
      onFinish: (usage) => {
        if (current()) tokenCount.value = usage?.total_tokens ?? null;
      },
    });
    if (!current()) return;
    const citations = citedSources(reply, sources);
    const answer =
      mode.value === 'docs' && !citations.length
        ? INSUFFICIENT_EVIDENCE
        : reply.replace(/\[source:([^[\]]+)\]/g, (_match, id) =>
            citations.some((c) => c.id === id)
              ? `[${citations.findIndex((c) => c.id === id) + 1}]`
              : '',
          );
    messages.value[assistantIdx] = { role: 'assistant', content: answer, citations };
    if (mode.value === 'docs') {
      const history = chat.getHistory();
      if (history.length) history[history.length - 1].content = answer;
      await chat.setHistory(history);
    }
  } catch (err) {
    if (!current()) return;
    const stopped = err?.name === 'AbortError';
    const msg = stopped ? 'Generation stopped.' : err?.message || 'Generation failed.';
    if (!stopped) errorBanner.value = msg;
    messages.value[assistantIdx] = { role: 'assistant', content: msg };
  } finally {
    if (current()) {
      generationAbort = null;
      streaming.value = false;
      await scrollToLatest(true);
      await focusComposer();
    }
  }
}

function onComposerKeydown(event) {
  if (event.key !== 'Enter') return;
  if (event.shiftKey || event.isComposing) return;
  event.preventDefault();
  sendMessage();
}

async function clearModelStorage() {
  await resetConversation();
  try {
    await chat?.dispose?.();
    await clearChatCaches();
    try {
      const keys = Object.keys(localStorage).filter((key) =>
        key.startsWith(MODEL_CACHE_FLAG_PREFIX),
      );
      for (const key of keys) localStorage.removeItem(key);
    } catch {
      /* storage may be disabled */
    }
    errorBanner.value = '';
    statusText.value = 'Chat model storage cleared';
  } catch (error) {
    errorBanner.value = `Some chat assets could not be cleared: ${error.message}`;
  }
  clearModalOpen.value = false;
  loaded.value = false;
  statusTone.value = 'muted';
  await refreshStoragePanel();
}

function renderMarkdown(text) {
  try {
    return labsMarkdownToHtml(String(text || ''));
  } catch {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

onMounted(async () => {
  // Reuse one AiChat/WebLLM runtime for the tab (HMR / v-if remount safe).
  if (props.chat) chat = props.chat;
  else if (!chat) {
    chat = new AiChat(chatRuntimeOptions);
  }

  selectedModelId.value = chat.modelId || MODEL_OPTIONS[0].id;
  systemInfo.value = await detectSystemInfo();
  if (!alive) return;
  applySelection(selectedModelId.value);
  loaded.value = !!chat.isLoaded?.();
  if (loaded.value) {
    statusTone.value = 'ok';
    statusText.value = `Online (${getModelDisplayName(chat.modelId)})`;
    await focusComposer();
  }
  if (unsubProgress) unsubProgress();
  unsubProgress = chat.onProgress((data) => {
    const described = describeLoadProgress(data, {
      likelyCached: isModelLikelyCached(chat.modelId),
    });
    if (described.stage === 'error') {
      // Surface via errorBanner from load/generate catch — don't duplicate in progress.
      progressText.value = '';
      freezeHint.value = '';
      statusTone.value = 'danger';
      statusText.value = 'Error';
      return;
    }
    progressPct.value = described.progressPct;
    progressText.value = described.progressText;
    freezeHint.value = described.freezeHint;
    statusText.value = described.statusText;
    statusTone.value = described.statusTone;
  });
  await refreshStoragePanel();
  refreshCapacityNote(selectedModelId.value);
  document.addEventListener('visibilitychange', refreshStoragePanel);
});

onBeforeUnmount(() => {
  generationAbort?.abort();
  alive = false;
  uiOperation += 1;
  chat?.cancel?.();
  if (!props.chat) void chat?.dispose?.();
  void docsSearch?.dispose?.();
  if (unsubProgress) {
    unsubProgress();
    unsubProgress = null;
  }
  document.removeEventListener('visibilitychange', refreshStoragePanel);
});

watch(
  () => props.chat,
  (next) => {
    if (next) chat = next;
  },
);

watch(clearModalOpen, async (open, wasOpen) => {
  if (wasOpen && !open && loaded.value && !loading.value) {
    await focusComposer();
  }
});

watch(loaded, async (isLoaded, wasLoaded) => {
  if (isLoaded && !wasLoaded && !loading.value && !clearModalOpen.value) {
    await focusComposer();
  }
});
async function suspend() {
  uiOperation++;
  generationAbort?.abort();
  chat?.cancel();
  if (chat) {
    sessions[mode.value] = { messages: [...messages.value], history: chat.getHistory() };
    await chat.dispose();
  }
  loaded.value = false;
  loading.value = false;
  streaming.value = false;
  statusText.value = 'Not loaded';
  await docsSearch?.dispose();
  docsSearch = null;
}
defineExpose({ suspend, getModelId: () => selectedModelId.value });
</script>

<template>
  <VdCard class="vdl-ai-chat-wrap vdl-card-glow vd-glass" :aria-busy="loading ? 'true' : 'false'">
    <div v-if="loading" class="vdl-ai-load-overlay" role="status" aria-live="polite">
      <div class="vdl-ai-load-overlay-card">
        <VdSpinner size="sm" />
        <div class="vdl-ai-load-overlay-title">Loading model…</div>
        <div class="vd-text-sm vd-text-muted">
          {{
            freezeHint ||
            progressText ||
            'Please wait — interaction is paused while WebGPU initializes.'
          }}
        </div>
      </div>
    </div>

    <div class="vdl-ai-header">
      <div class="vdl-ai-header-left">
        <VdIcon name="robot" />
        <h3 class="vdl-ai-title">{{ displayTitle }}</h3>
      </div>
      <div class="vdl-ai-header-status">
        <span class="vdl-ai-status-dot" :data-tone="statusTone"></span>
        <span>{{ statusText }}</span>
      </div>
    </div>

    <div v-if="!loaded" class="vdl-ai-setup">
      <VdIcon name="download-simple" class="vdl-ai-setup-icon" />
      <div class="vdl-ai-setup-grid">
        <div class="vdl-ai-setup-col">
          <label class="vdl-form-label" for="vdl-ai-model-select"
            >Model · download size shown before loading</label
          >
          <label class="vdl-ai-note"
            ><input v-model="advanced" type="checkbox" /> More models</label
          >
          <select
            id="vdl-ai-model-select"
            class="vd-select vdl-ai-model-select"
            :value="selectedModelId"
            :disabled="loading"
            @change="applySelection($event.target.value)"
          >
            <optgroup v-for="group in groupedModels" :key="group.id" :label="group.label">
              <option
                v-for="model in group.models"
                :key="model.id"
                :value="model.id"
                :disabled="model.resolved.unavailable"
              >
                {{ model.label }}
              </option>
            </optgroup>
          </select>
          <p v-if="fallbackNote && !selectedResolved.loadBlocked" class="vdl-ai-note">
            {{ fallbackNote }}
          </p>
          <VdlModelDetails :model-id="selectedModelId" />
          <p v-if="cacheHint" class="vdl-ai-note">{{ cacheHint }}</p>
          <p v-if="capacityNote" class="vdl-ai-capacity-note" role="status">{{ capacityNote }}</p>
        </div>
      </div>
      <details class="vdl-ai-diagnostics">
        <summary>Device and storage details</summary>
        <aside class="vdl-ai-storage-panel" aria-label="Local storage for this site">
          <div class="vdl-ai-storage-title">Storage &amp; memory</div>
          <div class="vd-text-sm vd-text-muted">
            This origin: <strong>{{ storageUsage }}</strong>
          </div>
          <div class="vd-text-sm vd-text-muted">Quota: {{ storageQuota }}</div>
          <div class="vdl-ai-storage-meter" aria-hidden="true">
            <div class="vdl-ai-storage-meter-fill" :style="{ width: storagePct + '%' }"></div>
          </div>
          <p class="vdl-ai-fineprint">
            Includes Cache Storage / IndexedDB for this page. GPU memory is not available to the
            page.
          </p>
        </aside>

        <div class="vdl-ai-system-info">
          <div class="vdl-ai-storage-title">System Info</div>
          <div class="vd-text-sm vd-text-muted">
            WebGPU:
            {{
              systemInfo
                ? systemInfo.webgpuSupported
                  ? 'Supported'
                  : 'Not supported'
                : 'Checking…'
            }}
          </div>
          <div class="vd-text-sm vd-text-muted">
            GPU: {{ systemInfo?.adapterName || systemInfo?.error || 'Detecting…' }}
          </div>
          <div class="vd-text-sm vd-text-muted">
            shader-f16:
            {{ systemInfo ? (systemInfo.shaderF16 ? 'Supported' : 'Unavailable') : 'Checking…' }}
          </div>
          <div
            class="vd-text-sm vd-text-muted"
            :title="'deviceMemory is browser-capped/approximate; GPU VRAM is not exposed to web pages.'"
          >
            Device: {{ deviceSummary }}
          </div>
        </div>
      </details>

      <p class="vd-text-muted vd-text-sm">
        Gemma 4 is the primary family. Optional small/fast models are available when you need a
        lighter download. Inference stays in your browser.
      </p>

      <div v-if="(loading || progressText) && !errorBanner" class="vdl-ai-progress">
        <VdProgress :value="progressPct" />
        <div class="vd-text-sm vd-text-muted">{{ progressText }}</div>
        <p v-if="freezeHint" class="vdl-ai-freeze-hint">{{ freezeHint }}</p>
      </div>

      <p v-if="fallbackNote && selectedResolved.loadBlocked" class="vdl-ai-error" role="status">
        {{ fallbackNote }}
      </p>
      <p v-else-if="errorBanner" class="vdl-ai-error" role="alert">{{ errorBanner }}</p>

      <div class="vdl-ai-setup-actions">
        <VdButton variant="primary" :loading="loading" :disabled="loadDisabled" @click="loadModel">
          <VdIcon name="download-simple" />
          {{ selectedResolved.loadBlocked ? 'Runtime unsupported' : 'Load AI Model' }}
        </VdButton>
        <VdButton variant="secondary" :disabled="loading" @click="clearModalOpen = true">
          <VdIcon name="trash" />
          Clear storage
        </VdButton>
      </div>
    </div>

    <div v-else class="vdl-ai-chat-interface">
      <div class="vdl-ai-toolbar">
        <label
          >Conversation
          <select v-model="mode" class="vd-select" :disabled="streaming || modeChanging">
            <option value="general">General chat</option>
            <option value="docs">Docs · cited vd3 answers</option>
          </select></label
        >
        <VdButton variant="ghost" :disabled="loading" @click="resetConversation"
          >New conversation</VdButton
        >
      </div>
      <div v-if="mode === 'docs'" class="vdl-ai-docs-note">
        <p role="status">{{ docsStatus }}</p>
        <VdButton
          size="sm"
          variant="secondary"
          :disabled="docsSemanticLoading || streaming"
          @click="enableDocsSemantic"
          >Enable semantic docs search · ~23 MB</VdButton
        >
      </div>
      <p v-if="contextNotice" class="vdl-ai-docs-note" role="status">{{ contextNotice }}</p>
      <div class="vdl-ai-toolbar">
        <select
          class="vd-select vdl-ai-model-select"
          aria-label="Model"
          :value="selectedModelId"
          :disabled="loading || streaming"
          @change="applySelection($event.target.value)"
        >
          <optgroup v-for="group in groupedModels" :key="'live-' + group.id" :label="group.label">
            <option
              v-for="model in group.models"
              :key="'live-' + model.id"
              :value="model.id"
              :disabled="model.resolved.unavailable"
            >
              {{ model.label }}
            </option>
          </optgroup>
        </select>
        <VdButton
          size="sm"
          variant="secondary"
          :disabled="loading || streaming"
          @click="switchModel"
        >
          Switch model
        </VdButton>
        <VdButton
          size="sm"
          variant="ghost"
          :disabled="loading || streaming"
          @click="clearModalOpen = true"
        >
          Clear storage
        </VdButton>
      </div>

      <div
        ref="messagesEl"
        class="vdl-ai-messages"
        aria-live="polite"
        @scroll.passive="onMessagesScroll"
      >
        <div v-for="(msg, idx) in messages" :key="idx" class="vdl-ai-message" :data-role="msg.role">
          <div class="vdl-ai-message-role">{{ msg.role === 'user' ? 'You' : 'Assistant' }}</div>
          <div class="vdl-ai-message-body" v-html="renderMarkdown(msg.content)"></div>
          <ol
            v-if="msg.citations?.length"
            class="vdl-ai-citations"
            aria-label="Documentation sources"
          >
            <li v-for="source in msg.citations" :key="source.id">
              <a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}</a>
            </li>
          </ol>
        </div>
        <div v-if="!messages.length" class="vdl-ai-empty">
          Ask anything. Answers stay on this device.
        </div>
      </div>

      <form class="vdl-ai-form" @submit.prevent="sendMessage">
        <textarea
          ref="composerInput"
          v-model="inputText"
          class="vdl-ai-input"
          aria-label="Message"
          rows="3"
          maxlength="2000"
          placeholder="Message the local model… (Enter to send, Shift+Enter for newline)"
          :readonly="streaming"
          @keydown="onComposerKeydown"
        ></textarea>
        <div class="vdl-ai-form-meta">
          <span class="vd-text-sm vd-text-muted">{{ inputText.length }} / 2000</span>
          <span v-if="tokenCount != null" class="vd-text-sm vd-text-muted"
            >Tokens: {{ tokenCount }}</span
          >
          <VdButton v-if="streaming" variant="secondary" @click="stopGeneration">Stop</VdButton>
          <VdButton
            v-else
            type="submit"
            variant="primary"
            :loading="streaming"
            :disabled="streaming || !inputText.trim()"
          >
            <VdIcon v-if="!streaming" name="paper-plane-tilt" />
            <VdSpinner v-else size="sm" />
            Send
          </VdButton>
        </div>
      </form>
      <p v-if="errorBanner" class="vdl-ai-error" role="alert">{{ errorBanner }}</p>
    </div>
  </VdCard>

  <VdModal v-model:open="clearModalOpen" title="Clear model storage?" size="md">
    <p>
      This removes Cache Storage / IndexedDB / local markers this chat stored for
      <strong>this site only</strong>. The next load may download again.
    </p>
    <ul>
      <li>Chat model files from the curated and advanced catalog</li>
      <li>The chat-owned LiteRT cache</li>
      <li>Local “model cached” markers</li>
    </ul>
    <template #footer>
      <VdButton variant="secondary" @click="clearModalOpen = false">Cancel</VdButton>
      <VdButton variant="danger" @click="clearModelStorage">Clear storage</VdButton>
    </template>
  </VdModal>
</template>

<style scoped>
.vdl-ai-diagnostics summary {
  cursor: pointer;
  color: var(--text-secondary);
}
.vdl-ai-diagnostics[open] {
  display: grid;
  gap: 0.75rem;
}
.vdl-ai-docs-note {
  padding: 0 1.25rem;
  font-size: 0.85rem;
}
.vdl-ai-citations {
  overflow-wrap: anywhere;
}
.vdl-ai-chat-wrap {
  width: 100%;
  position: relative;
}

.vdl-ai-load-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  text-align: center;
  background: color-mix(in srgb, var(--bg-primary, #fff) 72%, transparent);
  backdrop-filter: blur(2px);
  pointer-events: all;
}

.vdl-ai-load-overlay-card {
  max-width: 22rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
}

.vdl-ai-load-overlay-title {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.vdl-ai-capacity-note {
  margin: 0.55rem 0 0;
  padding: 0.65rem 0.75rem;
  text-align: left;
  border-radius: var(--radius-sm, 0.5rem);
  border: 1px solid var(--vd-color-warning, #f59e0b);
  background: color-mix(in srgb, var(--vd-color-warning, #f59e0b) 12%, transparent);
  color: var(--text-primary);
  font-size: 0.85rem;
  line-height: 1.4;
}

.vdl-ai-freeze-hint {
  margin: 0.55rem 0 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--text-muted);
}

.vdl-ai-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
}

.vdl-ai-header-left {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--color-primary);
}

.vdl-ai-title {
  margin: 0;
  font-size: 1.1rem;
  color: var(--text-primary);
}

.vdl-ai-header-status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.vdl-ai-status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--text-muted);
}

.vdl-ai-status-dot[data-tone='ok'] {
  background: var(--vd-color-success, #22c55e);
}
.vdl-ai-status-dot[data-tone='warn'] {
  background: var(--vd-color-warning, #f59e0b);
}
.vdl-ai-status-dot[data-tone='danger'] {
  background: var(--vd-color-danger, #ef4444);
}

.vdl-ai-setup {
  padding: 1.25rem 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: stretch;
}

.vdl-ai-setup-icon {
  font-size: 2.5rem;
  color: var(--color-primary);
  align-self: center;
}

.vdl-ai-setup-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.vdl-ai-setup-col,
.vdl-ai-storage-panel,
.vdl-ai-system-info {
  flex: 1 1 16rem;
  min-width: 0;
}

.vdl-ai-storage-panel,
.vdl-ai-system-info {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  padding: 0.85rem;
}

.vdl-ai-storage-title {
  font-weight: 650;
  margin-bottom: 0.45rem;
  color: var(--text-primary);
}

.vdl-form-label {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.vdl-ai-model-select {
  width: 100%;
  padding: 0.55rem 0.65rem;
  /* Keep padding-right room for the vd3 native-select chevron. */
  padding-right: calc(0.65rem + var(--vd-select-arrow-size, 16px) + 0.5rem);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  /* Use background-color only — `background` shorthand resets
     background-repeat/size/position and tiles the vd3 chevron SVG
     when dark-theme select:focus re-applies background-image alone. */
  background-color: var(--bg-primary);
  color: var(--text-primary);
}

.vdl-ai-note,
.vdl-ai-fineprint {
  margin: 0.45rem 0 0;
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

.vdl-ai-cache-badges,
.vdl-ai-compat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.55rem;
}

.vdl-ai-mini-badge {
  font-size: 0.7rem;
  border-radius: 999px;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--border-color);
  /* Filled chip so muted labels stay readable on dark glass cards. */
  background: var(--bg-secondary, var(--vd-bg-secondary));
  color: var(--text-primary, var(--vd-text-primary));
}

.vdl-ai-mini-badge[data-cached='1'],
.vdl-ai-mini-badge[data-state='native'] {
  border-color: rgba(var(--vd-color-success-rgb, 34, 197, 94), 0.55);
  background: rgba(var(--vd-color-success-rgb, 34, 197, 94), 0.14);
  color: var(--vd-color-success, #22c55e);
}

.vdl-ai-mini-badge[data-state='fallback'] {
  border-color: rgba(var(--vd-color-warning-rgb, 245, 158, 11), 0.55);
  background: rgba(var(--vd-color-warning-rgb, 245, 158, 11), 0.14);
  color: var(--vd-color-warning, #f59e0b);
}

.vdl-ai-mini-badge[data-state='unsupported'],
.vdl-ai-mini-badge[data-state='unavailable'] {
  border-color: rgba(var(--vd-color-danger-rgb, 239, 68, 68), 0.55);
  background: rgba(var(--vd-color-danger-rgb, 239, 68, 68), 0.14);
  color: var(--vd-color-danger, #ef4444);
}

.vdl-ai-mini-badge[data-state='experimental'] {
  border-color: rgba(var(--vd-color-info-rgb, 59, 130, 246), 0.55);
  background: rgba(var(--vd-color-info-rgb, 59, 130, 246), 0.14);
  color: var(--vd-color-info, #3b82f6);
}

.vdl-ai-storage-meter {
  margin-top: 0.45rem;
  height: 0.4rem;
  border-radius: 999px;
  background: var(--bg-tertiary, var(--bg-primary));
  overflow: hidden;
}

.vdl-ai-storage-meter-fill {
  height: 100%;
  background: var(--color-primary);
}

.vdl-ai-setup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.vdl-ai-progress {
  display: grid;
  gap: 0.4rem;
}

.vdl-ai-error {
  margin: 0;
  color: var(--vd-color-danger, #ef4444);
  font-size: 0.88rem;
}

.vdl-ai-chat-interface {
  display: flex;
  flex-direction: column;
  min-height: min(62vh, 44rem);
  max-height: 70vh;
}

.vdl-ai-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
}

.vdl-ai-toolbar .vdl-ai-model-select {
  flex: 1 1 14rem;
}

.vdl-ai-messages {
  flex: 1 1 auto;
  overflow: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.vdl-ai-message {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  padding: 0.75rem 0.9rem;
}

.vdl-ai-message[data-role='user'] {
  background: rgba(var(--vd-color-primary-rgb), 0.08);
}

.vdl-ai-message-role {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
}

.vdl-ai-message-body {
  color: var(--text-primary);
  line-height: 1.55;
  font-size: 0.95rem;
}

.vdl-ai-empty {
  color: var(--text-muted);
  text-align: center;
  margin: auto;
}

.vdl-ai-form {
  border-top: 1px solid var(--border-color);
  padding: 0.85rem 1rem 1rem;
  display: grid;
  gap: 0.55rem;
}

.vdl-ai-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 4.5rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: 0.7rem 0.8rem;
  font: inherit;
}

.vdl-ai-form-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
  justify-content: flex-end;
}
</style>
