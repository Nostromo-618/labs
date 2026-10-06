<script setup>
import VwlModelDetails from './VwlModelDetails.vue';
import VwlChatSpeech from './VwlChatSpeech.vue';
import { useChatWorkspace } from '../lib/chat-workspace.js';
import { useId } from 'vue';
import { clearSpeechCaches } from '../lib/speech/assets.js';
import { SpeechSession } from '../lib/speech/session.js';
import { ConversationSession } from '../lib/speech/conversation.js';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { VdButton, VdCard, VdIcon, VdModal, VdProgress, VdSpinner } from '@vanduo-oss/vd3';
import {
  AiChat,
  MODEL_GROUPS,
  MODEL_OPTIONS,
  PRIMARY_MODEL_OPTIONS,
  getModelVariants,
  getModelChoiceLabel,
  assessLoadCapacity,
  collectDeviceSignals,
  describeLoadProgress,
  getLiteRTRuntimeBlockReason,
  getModelDisplayName,
  getModelOption,
  shouldFocusChatComposer,
} from '@vanduo-oss/vwl-ai-chat';
import { validateLlmInput } from '@vanduo-oss/vwl-ai-chat/guardrails/llm';
import { toGuardrailError } from '@vanduo-oss/vwl-ai-chat';
import { chatRuntimeOptions, clearChatCaches } from '../lib/chat-runtime.js';
import { labsMarkdownToHtml } from '@vanduo-oss/vwl-ai-chat/markdown';

const MODEL_CACHE_FLAG_PREFIX = 'vwl-ai-chat-model-cached:';

const props = defineProps({
  chat: { type: Object, default: null },
  speechOptions: { type: Object, default: null },
  conversationOptions: { type: Object, default: null },
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
const speechControls = ref(null);
const speechStatus = ref('idle');
const readingMessage = ref(null);
const speechBusy = computed(() => speechStatus.value !== 'idle');
const inputOverLimit = computed(() => inputText.value.length > 2000);
const speechState = ref({ status: 'idle', whisperReady: false, kokoroReady: false });
const conversationState = ref({
  status: 'stopped',
  error: '',
  progress: '',
  reviewText: '',
  reviewReason: '',
  turns: 0,
});
const conversationOwned = computed(() => conversationState.value.status !== 'stopped');
const conversationRunning = computed(
  () => conversationOwned.value && conversationState.value.status !== 'paused',
);
const voiceReview = ref('');
let conversation = null,
  restoringConversation = false,
  conversationInstructionsActive = false;
const speech = new SpeechSession({
  ...(props.speechOptions || {}),
  onChange: (value) => {
    speechState.value = value;
    speechStatus.value = value.status;
  },
  onTranscript: appendTranscript,
});
function appendTranscript(text) {
  inputText.value += (inputText.value && !/\s$/.test(inputText.value) ? ' ' : '') + text;
  void focusComposer({ force: true });
}
async function readMessage(msg, idx) {
  if (conversationOwned.value || streaming.value || speechBusy.value || !msg.speechReady) return;
  readingMessage.value = idx;
  try {
    await speechControls.value?.speak(msg.content);
  } finally {
    if (readingMessage.value === idx) readingMessage.value = null;
  }
}
const tokenCount = ref(null);
const clearModalOpen = ref(false);
const {
  root: workspaceRoot,
  panel: settingsPanel,
  settingsButton,
  wide: workspaceWide,
  open: settingsOpen,
  modal: settingsModal,
  height: workspaceHeight,
} = useChatWorkspace(clearModalOpen);
const settingsId = `vwl-chat-settings-${useId()}`;
const voiceSettingsTarget = ref(null);
const conversationLabel = computed(
  () =>
    ({
      loading: 'Loading Conversation Mode…',
      listening: 'Listening… Pause for about 1.2 seconds to send.',
      transcribing: 'Microphone off · transcribing…',
      thinking: 'Microphone off · thinking…',
      'preparing-audio': 'Microphone off · preparing neural audio…',
      speaking: 'Microphone off · speaking…',
      paused: 'Conversation paused. Resume starts a new listening turn.',
    })[conversationState.value.status] || '',
);
const manualSpeechLabel = computed(
  () =>
    ({
      recording: `Microphone recording · ${speechState.value.recordingSeconds || 0} / 60 s`,
      transcribing: 'Transcribing on this device…',
      preparing: 'Waiting for microphone…',
      loading: 'Loading speech model…',
      speaking:
        speechState.value.playbackPhase === 'preparing'
          ? 'Preparing neural audio on this device…'
          : 'Reading aloud…',
    })[speechState.value.status] || '',
);
const storageUsage = ref('—');
const storageQuota = ref('—');
const storagePct = ref(0);
const errorBanner = ref('');
const messagesEl = ref(null);
const composerInput = ref(null);
const stickToBottom = ref(true);
const capacityNote = ref('');
const freezeHint = ref('');
const contextNotice = ref('');
let savedHistory = [];
let alive = true;
let uiOperation = 0;
let generationAbort = null;
const selectedPrimaryId = computed(
  () => getModelOption(selectedModelId.value)?.variantOf || selectedModelId.value,
);
const selectedVariants = computed(() => getModelVariants(selectedModelId.value));

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
    models: PRIMARY_MODEL_OPTIONS.filter((m) => m.group === group.id).map((model) => {
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
  if (resolved.loadBlocked) flags.push('Runtime unsupported');
  if (isModelLikelyCached(model.id)) flags.push('Cached');
  if (resolved.unavailable) flags.push('Unavailable');
  return `${getModelChoiceLabel(model)}${flags.length ? ` — ${flags.join(' — ')}` : ''}`;
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
  if (!getModelOption(modelId)) {
    errorBanner.value = 'This model is no longer supported. Choose a retained model and load it.';
    modelId = MODEL_OPTIONS[0].id;
    loaded.value = false;
  }
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

async function loadModel({ signal, strict = false } = {}) {
  if (!chat || loading.value) return;
  const catalogId = selectedModelId.value;
  const resolved = resolveModelForSystem(catalogId);
  if (resolved.unavailable || resolved.loadBlocked) {
    errorBanner.value = resolved.reason;
    progressText.value = '';
    if (strict) throw new Error(resolved.reason);
    return;
  }

  errorBanner.value = '';
  applySelection(catalogId);
  await chat.setModelId(resolved.modelId, { resetMessages: true });
  if (signal?.aborted) throw new DOMException('Model loading stopped.', 'AbortError');
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
  const stopLoad = () => chat?.cancel?.();
  signal?.addEventListener('abort', stopLoad, { once: true });
  try {
    await chat.load();
    if (signal?.aborted) throw new DOMException('Model loading stopped.', 'AbortError');
    await chat.setHistory(savedHistory);
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
    if (strict) throw err;
  } finally {
    signal?.removeEventListener('abort', stopLoad);
    loading.value = false;
  }
  if (loaded.value && !conversationOwned.value) await focusComposer();
}

async function ensureConversationChat({ signal, onProgress }) {
  onProgress('Loading Gemma E2B…');
  const history = chat.getHistory?.() || savedHistory;
  savedHistory = history;
  if (!conversationInstructionsActive) {
    chat.setSystemPromptOptions?.({
      extraRules:
        'For this spoken conversation, answer in 1–3 short conversational sentences. Use natural spoken English, avoid unnecessary lists and markdown, and keep the reply concise.',
    });
    conversationInstructionsActive = true;
  }
  if (!loaded.value || chat.modelId !== 'gemma-4-E2B-it-web') {
    selectedModelId.value = 'gemma-4-E2B-it-web';
    loaded.value = false;
    await loadModel({ signal, strict: true });
  }
  if (signal.aborted) throw new DOMException('Conversation stopped.', 'AbortError');
}
function startConversation(reviewedText = null) {
  if (!chat || restoringConversation) return;
  conversation ||= new ConversationSession({
    speech,
    preflight: () => {
      const resolved = resolveModelForSystem('gemma-4-E2B-it-web');
      if (resolved.unavailable || resolved.loadBlocked || resolved.changed)
        throw new Error(resolved.reason || 'Gemma E2B is unavailable on this device.');
    },
    ensureChat: ensureConversationChat,
    submitTurn: (text, options) => submitTurn(text, { ...options, voice: true }),
    cancelChat: () => {
      generationAbort?.abort();
      chat?.cancel?.();
    },
    restoreInstructions: () => {
      chat?.setSystemPromptOptions?.({});
      conversationInstructionsActive = false;
    },
    ...(props.conversationOptions || {}),
    onChange: (state) => {
      conversationState.value = state;
      voiceReview.value = state.reviewText;
    },
  });
  void conversation.start({ reviewedText });
}
async function endConversation() {
  if (!conversation) return;
  restoringConversation = true;
  try {
    await conversation.end();
  } finally {
    restoringConversation = false;
  }
}
function foregroundChanged() {
  if (document.hidden && conversationOwned.value) conversation?.pause();
}
function pauseForPage() {
  if (conversationOwned.value) conversation?.pause();
}

async function switchModel() {
  if (!chat || loading.value || streaming.value) return;
  await endConversation();
  speech.dispose();
  const resolved = resolveModelForSystem(selectedModelId.value);
  if (resolved.unavailable || resolved.loadBlocked) {
    errorBanner.value = resolved.reason;
    progressText.value = '';
    return;
  }
  if (resolved.modelId === chat.modelId && loaded.value) return;
  loaded.value = false;
  savedHistory = [];
  messages.value = [];
  tokenCount.value = null;
  stickToBottom.value = true;
  chat.reset();
  await loadModel();
}

function stopGeneration() {
  if (conversationOwned.value) conversation?.pause();
  generationAbort?.abort();
  chat?.cancel?.();
}
async function resetConversation() {
  await endConversation();
  speech.dispose();
  generationAbort?.abort();
  const operation = ++uiOperation;
  chat?.reset();
  messages.value = [];
  savedHistory = [];
  contextNotice.value = '';
  errorBanner.value = '';
  await chat?.setHistory?.([]);
  if (alive && operation === uiOperation) streaming.value = false;
}
async function sendMessage() {
  if (
    !chat ||
    conversationOwned.value ||
    !loaded.value ||
    streaming.value ||
    inputOverLimit.value ||
    (speechBusy.value && speechStatus.value !== 'speaking')
  )
    return;
  speech.cancel();
  const text = inputText.value.trim();
  if (!text) return;
  inputText.value = '';
  await submitTurn(text);
}
async function submitTurn(
  text,
  { signal: outerSignal, maxOutputTokens = 768, voice = false } = {},
) {
  if (!chat || !loaded.value || streaming.value)
    throw new Error('Chat is not ready for another turn.');
  const guard = validateLlmInput(text);
  if (!guard.allowed) {
    errorBanner.value = guard.message;
    if (voice) throw toGuardrailError(guard);
    return;
  }
  const operation = ++uiOperation;
  const current = () => alive && operation === uiOperation;
  const controller = new AbortController();
  const stop = () => controller.abort();
  outerSignal?.addEventListener('abort', stop, { once: true });
  if (outerSignal?.aborted) {
    stop();
    outerSignal.removeEventListener('abort', stop);
    throw new DOMException('Stopped', 'AbortError');
  }
  generationAbort = controller;
  errorBanner.value = '';
  messages.value.push({ role: 'user', content: text });
  messages.value.push({ role: 'assistant', content: '' });
  const assistantIdx = messages.value.length - 1;
  streaming.value = true;
  stickToBottom.value = true;
  await scrollToLatest(true);
  if (!voice) await focusComposer({ force: true });
  try {
    const reply = await chat.generate(text, {
      signal: controller.signal,
      maxOutputTokens,
      onContext: ({
        omittedTurns,
        omittedSources = 0,
        rejectedSources = 0,
        rejectedHistoryTurns = 0,
      }) => {
        if (current())
          contextNotice.value = [
            omittedSources ? `${omittedSources} reference(s) omitted by the source limit.` : '',
            omittedTurns ? `${omittedTurns} older turn(s) omitted from model context.` : '',
            rejectedSources ? `${rejectedSources} reference(s) rejected by guardrails.` : '',
            rejectedHistoryTurns
              ? `${rejectedHistoryTurns} history turn(s) rejected by guardrails.`
              : '',
          ]
            .filter(Boolean)
            .join(' ');
      },
      onUpdate: (partial) => {
        if (!current()) return;
        messages.value[assistantIdx] = { role: 'assistant', content: partial };
        void scrollToLatest();
      },
      onFinish: (usage) => {
        if (current()) tokenCount.value = usage?.total_tokens ?? null;
      },
    });
    if (!current() || controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const answer = reply;
    messages.value[assistantIdx] = { role: 'assistant', content: answer, speechReady: true };
    return answer;
  } catch (err) {
    if (!current()) {
      if (voice) throw err;
      return;
    }
    const stopped = err?.name === 'AbortError';
    const msg = stopped ? 'Generation stopped.' : err?.message || 'Generation failed.';
    if (!stopped) errorBanner.value = msg;
    messages.value[assistantIdx] = { role: 'assistant', content: msg };
    if (voice) throw err;
  } finally {
    outerSignal?.removeEventListener('abort', stop);
    if (current()) {
      generationAbort = null;
      streaming.value = false;
      await scrollToLatest(true);
      if (!voice) await focusComposer();
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
    await clearSpeechCaches();
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
    if (loading.value && conversationState.value.status === 'loading')
      conversation?.update({ progress: `Gemma E2B: ${described.progressText}` });
    progressText.value = described.progressText;
    freezeHint.value = described.freezeHint;
    statusText.value = described.statusText;
    statusTone.value = described.statusTone;
  });
  await refreshStoragePanel();
  refreshCapacityNote(selectedModelId.value);
  document.addEventListener('visibilitychange', refreshStoragePanel);
  document.addEventListener('visibilitychange', foregroundChanged);
  document.addEventListener('freeze', pauseForPage);
  window.addEventListener('pagehide', pauseForPage);
});

onBeforeUnmount(() => {
  conversation?.pause();
  speech.dispose();
  generationAbort?.abort();
  alive = false;
  uiOperation += 1;
  chat?.cancel?.();
  if (!props.chat) void chat?.dispose?.();
  if (unsubProgress) {
    unsubProgress();
    unsubProgress = null;
  }
  document.removeEventListener('visibilitychange', refreshStoragePanel);
  document.removeEventListener('visibilitychange', foregroundChanged);
  document.removeEventListener('freeze', pauseForPage);
  window.removeEventListener('pagehide', pauseForPage);
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
watch(selectedModelId, () => {
  if (!conversationOwned.value) speech.dispose();
});
async function suspend() {
  if (!workspaceWide.value) settingsOpen.value = false;
  await endConversation();
  speech.dispose();
  uiOperation++;
  generationAbort?.abort();
  chat?.cancel();
  if (chat) {
    savedHistory = chat.getHistory();
    await chat.dispose();
  }
  loaded.value = false;
  loading.value = false;
  streaming.value = false;
  statusText.value = 'Not loaded';
}
defineExpose({ suspend, getModelId: () => selectedModelId.value });
</script>

<template>
  <div ref="workspaceRoot" class="vwl-ai-workspace-host">
    <VdCard
      class="vwl-ai-chat-wrap vwl-card-glow vd-glass"
      :style="{ '--vwl-chat-height': workspaceHeight }"
      :aria-busy="loading ? 'true' : 'false'"
    >
      <div class="vwl-ai-chat-primary" :inert="settingsModal ? true : undefined">
        <div class="vwl-ai-header">
          <div class="vwl-ai-header-left">
            <VdIcon name="robot" />
            <h3 class="vwl-ai-title">{{ displayTitle }}</h3>
          </div>
          <div class="vwl-ai-header-status">
            <span class="vwl-ai-status-dot" :data-tone="statusTone"></span>
            <span>{{ statusText }}</span>
          </div>
          <div class="vwl-ai-header-actions">
            <VdButton
              v-if="loaded"
              size="sm"
              variant="ghost"
              :disabled="loading"
              @click="resetConversation"
              >New conversation</VdButton
            >
            <VdButton
              v-if="!conversationOwned"
              variant="primary"
              :disabled="!systemInfo || loading || streaming || speechBusy"
              @click="startConversation()"
              >Conversation Mode</VdButton
            >
            <template v-else>
              <VdButton
                v-if="conversationRunning"
                variant="secondary"
                @click="conversation?.pause()"
                >Pause conversation</VdButton
              >
              <VdButton
                v-else
                variant="primary"
                :disabled="conversationState.ending"
                @click="startConversation()"
                >Resume conversation</VdButton
              >
              <VdButton
                variant="ghost"
                :disabled="conversationState.ending"
                @click="endConversation"
                >End conversation</VdButton
              >
            </template>
            <VdButton
              ref="settingsButton"
              size="sm"
              variant="ghost"
              :aria-expanded="settingsOpen"
              :aria-controls="settingsId"
              @click="settingsOpen = !settingsOpen"
              ><VdIcon name="sliders-horizontal" aria-hidden="true" />Settings</VdButton
            >
          </div>
        </div>

        <div class="vwl-ai-chat-interface">
          <div
            v-if="conversationOwned || manualSpeechLabel || loading || streaming"
            class="vwl-ai-live-status"
            role="status"
            aria-live="polite"
          >
            <VdSpinner
              v-if="
                conversationRunning ||
                loading ||
                streaming ||
                (manualSpeechLabel && speechStatus !== 'recording')
              "
              size="sm"
              aria-hidden="true"
            />
            <span>{{
              conversationOwned
                ? conversationLabel
                : manualSpeechLabel ||
                  (loading ? 'Loading model…' : 'Generating and checking reply…')
            }}</span>
          </div>
          <p v-if="contextNotice" class="vwl-ai-context-note" role="status">{{ contextNotice }}</p>
          <div
            ref="messagesEl"
            class="vwl-ai-messages"
            aria-live="polite"
            @scroll.passive="onMessagesScroll"
          >
            <div
              v-for="(msg, idx) in messages"
              :key="idx"
              class="vwl-ai-message"
              :data-role="msg.role"
            >
              <div class="vwl-ai-message-role">{{ msg.role === 'user' ? 'You' : 'Assistant' }}</div>
              <div class="vwl-ai-message-body" v-html="renderMarkdown(msg.content)"></div>
              <p
                v-if="
                  msg.role === 'assistant' &&
                  ((idx === messages.length - 1 &&
                    ['preparing-audio', 'speaking'].includes(conversationState.status)) ||
                    (readingMessage === idx && speechStatus === 'speaking'))
                "
                class="vwl-ai-voice-progress"
                role="status"
                aria-live="polite"
              >
                <VdSpinner size="sm" aria-hidden="true" />
                {{
                  speechState.playbackPhase === 'preparing' ||
                  conversationState.status === 'preparing-audio'
                    ? 'Preparing voice… Kokoro is generating audio on this device.'
                    : 'Playing voice…'
                }}
              </p>
              <template v-if="msg.role === 'assistant' && msg.speechReady">
                <VdButton
                  v-if="readingMessage === idx && speechStatus === 'speaking'"
                  size="sm"
                  variant="ghost"
                  @click="speechControls?.cancel()"
                  >Stop reading</VdButton
                >
                <VdButton
                  v-else
                  size="sm"
                  variant="ghost"
                  :disabled="streaming || speechBusy || conversationOwned"
                  @click="readMessage(msg, idx)"
                  >Read aloud</VdButton
                >
              </template>
            </div>
            <div v-if="!messages.length" class="vwl-ai-empty">
              <VdIcon name="chat-circle-dots" aria-hidden="true" />
              <h4>
                {{
                  loaded
                    ? 'What would you like to talk about?'
                    : 'Your private conversation starts here'
                }}
              </h4>
              <p>
                {{
                  loaded
                    ? 'Ask anything. Answers stay on this device.'
                    : settingsOpen
                      ? 'Load a model in the Settings panel, or choose Conversation Mode above.'
                      : 'Open Settings to load a model, or choose Conversation Mode above.'
                }}
              </p>
              <VdButton
                v-if="!loaded && !settingsOpen"
                size="sm"
                variant="secondary"
                @click="settingsOpen = true"
                >Open Settings</VdButton
              >
            </div>
          </div>

          <div v-if="conversationState.reviewReason" class="vwl-conversation-review">
            <p role="alert">{{ conversationState.reviewReason }}</p>
            <label
              >Review voice message<textarea
                v-model="voiceReview"
                class="vwl-ai-input"
                rows="3"
                :readonly="conversationRunning"
              ></textarea>
            </label>
            <p>{{ voiceReview.length }} / 2000 · Your typed draft is separate.</p>
            <VdButton
              :disabled="
                conversationRunning ||
                conversationState.ending ||
                !voiceReview.trim() ||
                voiceReview.length > 2000
              "
              @click="startConversation(voiceReview)"
              >Send reviewed voice message</VdButton
            >
          </div>
          <form class="vwl-ai-form" @submit.prevent="sendMessage">
            <textarea
              ref="composerInput"
              v-model="inputText"
              class="vwl-ai-input"
              aria-label="Message"
              rows="2"
              placeholder="Message the local model… (Enter to send, Shift+Enter for newline)"
              :readonly="streaming || conversationOwned"
              :disabled="!loaded"
              @keydown="onComposerKeydown"
            ></textarea>
            <div class="vwl-ai-form-meta">
              <VwlChatSpeech
                ref="speechControls"
                :session="speech"
                :session-state="speechState"
                :conversation-owned="conversationOwned"
                :options="speechOptions"
                :disabled="!loaded || streaming || loading || conversationOwned"
                :settings-target="voiceSettingsTarget"
                compact
                @transcript="appendTranscript"
                @state="speechStatus = $event.status"
              />

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
                :disabled="
                  !loaded ||
                  streaming ||
                  conversationOwned ||
                  !inputText.trim() ||
                  inputOverLimit ||
                  (speechBusy && speechStatus !== 'speaking')
                "
              >
                <VdIcon v-if="!streaming" name="paper-plane-tilt" />
                <VdSpinner v-else size="sm" />
                Send
              </VdButton>
            </div>
          </form>
          <p v-if="inputOverLimit" class="vwl-ai-error" role="alert">
            Your draft is preserved. Edit it to 2000 characters or fewer before sending.
          </p>
          <p v-if="errorBanner" class="vwl-ai-error" role="alert">{{ errorBanner }}</p>

          <p v-if="conversationState.error" class="vwl-ai-error" role="alert">
            {{ conversationState.error }}
          </p>
          <p v-if="speechState.error" class="vwl-ai-error" role="alert">{{ speechState.error }}</p>
          <p
            v-if="
              !loaded &&
              (selectedResolved.unavailable || selectedResolved.loadBlocked) &&
              selectedResolved.reason
            "
            class="vwl-ai-error"
            role="alert"
          >
            {{ selectedResolved.reason }}
          </p>
          <p
            v-if="
              conversationState.cacheAvailable === false || speechState.cacheAvailable === false
            "
            class="vwl-ai-note"
            role="status"
          >
            Browser storage is unavailable. Future model loads may need a connection.
          </p>
        </div>
      </div>
      <div
        v-if="settingsModal"
        class="vwl-ai-settings-backdrop"
        data-testid="chat-settings-backdrop"
        aria-hidden="true"
        @click="settingsOpen = false"
      ></div>
      <aside
        v-show="settingsOpen"
        ref="settingsPanel"
        :id="settingsId"
        class="vwl-ai-settings-panel"
        :class="{ 'vwl-ai-settings-drawer': !workspaceWide }"
        :role="settingsModal ? 'dialog' : 'complementary'"
        :aria-modal="settingsModal ? 'true' : undefined"
        aria-label="Chat settings"
        tabindex="-1"
        :inert="!settingsOpen ? true : undefined"
      >
        <header class="vwl-ai-settings-header">
          <h3>Settings</h3>
          <VdButton
            size="sm"
            variant="ghost"
            aria-label="Close settings"
            @click="settingsOpen = false"
            ><VdIcon name="x" aria-hidden="true"
          /></VdButton>
        </header>
        <div class="vwl-ai-settings-content">
          <section aria-label="Model settings">
            <h4>Model</h4>
            <div class="vwl-ai-setup-grid">
              <div class="vwl-ai-setup-col">
                <label class="vwl-form-label" for="vwl-ai-model-select"
                  >Model · download size shown before loading</label
                >
                <select
                  id="vwl-ai-model-select"
                  class="vd-select vwl-ai-model-select"
                  :value="selectedPrimaryId"
                  :disabled="loading || streaming || conversationOwned"
                  @change="applySelection($event.target.value)"
                >
                  <optgroup v-for="group in groupedModels" :key="group.id" :label="group.label">
                    <option
                      v-for="model in group.models"
                      :key="model.id"
                      :value="model.id"
                      :disabled="systemInfo?.webgpuSupported === false"
                    >
                      {{ model.label }}
                    </option>
                  </optgroup>
                </select>
                <label
                  v-if="selectedVariants.length > 1"
                  class="vwl-ai-note"
                  for="vwl-ai-precision-select"
                  >Precision</label
                >
                <select
                  v-if="selectedVariants.length > 1"
                  id="vwl-ai-precision-select"
                  class="vd-select"
                  :value="selectedModelId"
                  :disabled="loading || streaming || conversationOwned"
                  @change="applySelection($event.target.value)"
                >
                  <option v-for="variant in selectedVariants" :key="variant.id" :value="variant.id">
                    {{ variant.precision.toUpperCase()
                    }}{{ variant.variantOf ? ' · Compatibility' : '' }} ·
                    {{ Math.round(variant.approxBytes / 1e6) }} MB
                  </option>
                </select>
                <p v-if="fallbackNote && !selectedResolved.loadBlocked" class="vwl-ai-note">
                  {{ fallbackNote }}
                </p>
                <details class="vwl-ai-diagnostics">
                  <summary>Model details</summary>
                  <VwlModelDetails :model-id="selectedModelId" />
                </details>
                <p v-if="cacheHint" class="vwl-ai-note">{{ cacheHint }}</p>
                <p v-if="capacityNote" class="vwl-ai-capacity-note" role="status">
                  {{ capacityNote }}
                </p>
              </div>
            </div>

            <p class="vd-text-muted vd-text-sm">
              Gemma 4 is the primary family. Optional small/fast models are available when you need
              a lighter download. Inference stays in your browser.
            </p>

            <div v-if="(loading || progressText) && !errorBanner" class="vwl-ai-progress">
              <VdProgress :value="progressPct" />
              <div class="vd-text-sm vd-text-muted">{{ progressText }}</div>
              <p v-if="freezeHint" class="vwl-ai-freeze-hint">{{ freezeHint }}</p>
            </div>

            <p
              v-if="fallbackNote && selectedResolved.loadBlocked"
              class="vwl-ai-error"
              role="status"
            >
              {{ fallbackNote }}
            </p>

            <div class="vwl-ai-setup-actions">
              <VdButton
                variant="primary"
                :loading="loading"
                :disabled="loadDisabled || streaming || conversationOwned"
                @click="loaded ? switchModel() : loadModel()"
              >
                <VdIcon name="download-simple" />
                {{
                  selectedResolved.loadBlocked
                    ? 'Runtime unsupported'
                    : loaded
                      ? 'Switch model'
                      : 'Load AI Model'
                }}
              </VdButton>
            </div>
          </section>
          <section aria-label="Voice settings">
            <h4>Voice</h4>
            <p class="vwl-ai-note">
              Conversation Mode uses Gemma E2B + Whisper + Kokoro Heart + voice detection · about
              2.15 GB of model downloads, plus runtime files. Loaded models are reused. English ·
              take turns.
            </p>
            <p v-if="conversationOwned && conversationState.progress" class="vwl-ai-note">
              {{ conversationState.progress }}
            </p>
            <div ref="voiceSettingsTarget"></div>
          </section>
          <section aria-label="Storage settings">
            <h4>Storage</h4>
            <details class="vwl-ai-diagnostics">
              <summary>Device and storage details</summary>
              <aside class="vwl-ai-storage-panel" aria-label="Local storage for this site">
                <div class="vwl-ai-storage-title">Storage &amp; memory</div>
                <div class="vd-text-sm vd-text-muted">
                  This origin: <strong>{{ storageUsage }}</strong>
                </div>
                <div class="vd-text-sm vd-text-muted">Quota: {{ storageQuota }}</div>
                <div class="vwl-ai-storage-meter" aria-hidden="true">
                  <div class="vwl-ai-storage-meter-fill" :style="{ width: storagePct + '%' }"></div>
                </div>
                <p class="vwl-ai-fineprint">
                  Includes Cache Storage / IndexedDB for this page. GPU memory is not available to
                  the page.
                </p>
              </aside>

              <div class="vwl-ai-system-info">
                <div class="vwl-ai-storage-title">System Info</div>
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
                  {{
                    systemInfo ? (systemInfo.shaderF16 ? 'Supported' : 'Unavailable') : 'Checking…'
                  }}
                </div>
                <div
                  class="vd-text-sm vd-text-muted"
                  :title="'deviceMemory is browser-capped/approximate; GPU VRAM is not exposed to web pages.'"
                >
                  Device: {{ deviceSummary }}
                </div>
              </div>
            </details>
            <VdButton
              size="sm"
              variant="ghost"
              :disabled="loading || streaming || conversationOwned"
              @click="clearModalOpen = true"
              ><VdIcon name="trash" />Clear storage</VdButton
            >
          </section>
        </div>
      </aside>
    </VdCard>
  </div>
  <VdModal v-model:open="clearModalOpen" title="Clear model storage?" size="md">
    <p>
      This removes Cache Storage / IndexedDB / local markers this chat stored for
      <strong>this site only</strong>. The next load may download again.
    </p>
    <ul>
      <li>Chat model files from the retained catalog</li>
      <li>The chat-owned LiteRT cache</li>
      <li>Dictation, neural voice, voice detector models and preset voice data</li>
      <li>Local “model cached” markers</li>
    </ul>
    <template #footer>
      <VdButton variant="secondary" @click="clearModalOpen = false">Cancel</VdButton>
      <VdButton variant="danger" @click="clearModelStorage">Clear storage</VdButton>
    </template>
  </VdModal>
</template>

<style scoped>
.vwl-conversation-panel {
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
}
.vwl-ai-voice-progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
}
.vwl-conversation-review {
  display: grid;
  gap: 0.5rem;
}
.vwl-ai-diagnostics summary {
  cursor: pointer;
  color: var(--text-secondary);
}
.vwl-ai-diagnostics[open] {
  display: grid;
  gap: 0.75rem;
}
.vwl-ai-context-note {
  padding: 0 1.25rem;
  font-size: 0.85rem;
}
.vwl-ai-chat-wrap {
  width: 100%;
  position: relative;
}

.vwl-ai-load-overlay {
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

.vwl-ai-load-overlay-card {
  max-width: 22rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
}

.vwl-ai-load-overlay-title {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.vwl-ai-capacity-note {
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

.vwl-ai-freeze-hint {
  margin: 0.55rem 0 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--text-muted);
}

.vwl-ai-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  padding: 0.65rem 0.85rem;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border-color);
}

.vwl-ai-header-left {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--color-primary);
}

.vwl-ai-title {
  margin: 0;
  font-size: 0.95rem;
  color: var(--text-primary);
}

.vwl-ai-header-status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.vwl-ai-status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--text-muted);
}

.vwl-ai-status-dot[data-tone='ok'] {
  background: var(--vd-color-success, #22c55e);
}
.vwl-ai-status-dot[data-tone='warn'] {
  background: var(--vd-color-warning, #f59e0b);
}
.vwl-ai-status-dot[data-tone='danger'] {
  background: var(--vd-color-danger, #ef4444);
}

.vwl-ai-setup {
  padding: 1.25rem 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: stretch;
}

.vwl-ai-setup-icon {
  font-size: 2.5rem;
  color: var(--color-primary);
  align-self: center;
}

.vwl-ai-setup-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.vwl-ai-setup-col,
.vwl-ai-storage-panel,
.vwl-ai-system-info {
  flex: 1 1 16rem;
  min-width: 0;
}

.vwl-ai-storage-panel,
.vwl-ai-system-info {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  padding: 0.85rem;
}

.vwl-ai-storage-title {
  font-weight: 650;
  margin-bottom: 0.45rem;
  color: var(--text-primary);
}

.vwl-form-label {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.vwl-ai-model-select {
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

.vwl-ai-note,
.vwl-ai-fineprint {
  margin: 0.45rem 0 0;
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

.vwl-ai-cache-badges,
.vwl-ai-compat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.55rem;
}

.vwl-ai-mini-badge {
  font-size: 0.7rem;
  border-radius: 999px;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--border-color);
  /* Filled chip so muted labels stay readable on dark glass cards. */
  background: var(--bg-secondary, var(--vd-bg-secondary));
  color: var(--text-primary, var(--vd-text-primary));
}

.vwl-ai-mini-badge[data-cached='1'],
.vwl-ai-mini-badge[data-state='native'] {
  border-color: rgba(var(--vd-color-success-rgb, 34, 197, 94), 0.55);
  background: rgba(var(--vd-color-success-rgb, 34, 197, 94), 0.14);
  color: var(--vd-color-success, #22c55e);
}

.vwl-ai-mini-badge[data-state='fallback'] {
  border-color: rgba(var(--vd-color-warning-rgb, 245, 158, 11), 0.55);
  background: rgba(var(--vd-color-warning-rgb, 245, 158, 11), 0.14);
  color: var(--vd-color-warning, #f59e0b);
}

.vwl-ai-mini-badge[data-state='unsupported'],
.vwl-ai-mini-badge[data-state='unavailable'] {
  border-color: rgba(var(--vd-color-danger-rgb, 239, 68, 68), 0.55);
  background: rgba(var(--vd-color-danger-rgb, 239, 68, 68), 0.14);
  color: var(--vd-color-danger, #ef4444);
}

.vwl-ai-mini-badge[data-state='experimental'] {
  border-color: rgba(var(--vd-color-info-rgb, 59, 130, 246), 0.55);
  background: rgba(var(--vd-color-info-rgb, 59, 130, 246), 0.14);
  color: var(--vd-color-info, #3b82f6);
}

.vwl-ai-storage-meter {
  margin-top: 0.45rem;
  height: 0.4rem;
  border-radius: 999px;
  background: var(--bg-tertiary, var(--bg-primary));
  overflow: hidden;
}

.vwl-ai-storage-meter-fill {
  height: 100%;
  background: var(--color-primary);
}

.vwl-ai-setup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.vwl-ai-progress {
  display: grid;
  gap: 0.4rem;
}

.vwl-ai-error {
  margin: 0;
  color: var(--vd-color-danger, #ef4444);
  font-size: 0.88rem;
}

.vwl-ai-chat-interface {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.vwl-ai-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
}

.vwl-ai-toolbar .vwl-ai-model-select {
  flex: 1 1 14rem;
}

.vwl-ai-messages {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.vwl-ai-message {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  padding: 0.75rem 0.9rem;
}

.vwl-ai-message[data-role='user'] {
  background: color-mix(in srgb, var(--vd-color-primary) 8%, var(--bg-secondary));
}

.vwl-ai-message-role {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
}

.vwl-ai-message-body {
  color: var(--text-primary);
  line-height: 1.55;
  font-size: 0.95rem;
}

.vwl-ai-empty {
  color: var(--text-muted);
  text-align: center;
  margin: auto;
}

.vwl-ai-form {
  border-top: 1px solid var(--border-color);
  padding: 0.85rem 1rem 1rem;
  display: grid;
  gap: 0.55rem;
}

.vwl-ai-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 3rem;
  max-height: min(10rem, 20dvh);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: 0.7rem 0.8rem;
  font: inherit;
}

.vwl-ai-form-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
  justify-content: flex-end;
}

.vwl-ai-workspace-host {
  width: 100%;
  min-width: 0;
}
.vwl-ai-chat-wrap {
  height: var(--vwl-chat-height, calc(100dvh - 12rem));
  min-height: 320px;
  display: flex;
  padding: 0;
  overflow: hidden;
}
.vwl-ai-chat-primary {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.vwl-ai-chat-wrap :deep(> .vd-card-body) {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 0;
}
.vwl-ai-header-left {
  flex: 1 1 12rem;
}
.vwl-ai-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.4rem;
}
.vwl-ai-header-actions {
  grid-column: 1 / -1;
}
.vwl-ai-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vwl-ai-header-left {
  min-width: 0;
}
.vwl-ai-header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}
.vwl-ai-header-actions :deep(.vd-btn) {
  font-size: 0.8rem;
  padding: 0.45rem 0.65rem;
  min-height: 2.25rem;
}
.vwl-ai-live-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
  padding: 0.45rem 0.85rem;
  font-size: 0.83rem;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
}
.vwl-ai-settings-panel {
  width: 320px;
  flex: 0 0 320px;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-color);
}
.vwl-ai-settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
}
.vwl-ai-settings-header h3 {
  margin: 0;
  font-size: 0.95rem;
}
.vwl-ai-settings-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 1rem;
}
.vwl-ai-settings-content section + section {
  margin-top: 1.25rem;
  border-top: 1px solid var(--border-color);
  padding-top: 1rem;
}
.vwl-ai-settings-content h4 {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
}
.vwl-ai-settings-content select {
  width: 100%;
  min-width: 0;
  text-overflow: ellipsis;
}
.vwl-ai-settings-content :deep(p),
.vwl-ai-settings-content :deep(label) {
  overflow-wrap: anywhere;
}
.vwl-ai-settings-content .vwl-ai-setup-grid {
  display: block;
}
.vwl-ai-settings-content .vwl-ai-setup-col {
  min-width: 0;
  display: grid;
  gap: 0.65rem;
}
.vwl-ai-settings-content .vwl-ai-setup-actions {
  padding: 0.65rem 0;
  display: flex;
  flex-wrap: wrap;
}
.vwl-ai-settings-content .vwl-ai-diagnostics {
  margin: 0.4rem 0;
}
.vwl-ai-settings-content .vwl-ai-storage-panel {
  margin-bottom: 0.75rem;
}
.vwl-ai-settings-drawer {
  position: fixed;
  z-index: 1040;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(320px, calc(100vw - 2rem));
  max-height: 100dvh;
  box-shadow: var(--vd-shadow-lg);
}
.vwl-ai-settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1030;
  background: rgb(0 0 0 / 45%);
}
.vwl-ai-form {
  flex: 0 0 auto;
  padding: 0.65rem 0.85rem;
}
.vwl-ai-form-meta :deep(.vwl-chat-speech) {
  margin-right: auto;
}
.vwl-ai-conversation-review {
  flex-shrink: 0;
}
.vwl-conversation-review {
  padding: 0.75rem 0.85rem;
  max-height: 35%;
  overflow: auto;
  flex-shrink: 0;
  border-top: 1px solid var(--border-color);
}
.vwl-ai-chat-interface > .vwl-ai-error,
.vwl-ai-chat-interface > .vwl-ai-note {
  padding: 0.3rem 0.85rem;
  max-height: 5rem;
  overflow: auto;
  flex-shrink: 0;
}
.vwl-ai-empty {
  display: grid;
  justify-items: center;
  gap: 0.75rem;
  max-width: 28rem;
  padding: 1rem;
}
.vwl-ai-empty h4,
.vwl-ai-empty p {
  margin: 0;
}
.vwl-ai-message {
  min-width: 0;
  overflow-wrap: anywhere;
}
.vwl-ai-message-body :deep(pre) {
  max-width: 100%;
  overflow: auto;
}
@media (max-width: 600px) {
  .vwl-ai-header {
    gap: 0.45rem;
  }
  .vwl-ai-header-status {
    font-size: 0.72rem;
  }
  .vwl-ai-header-actions {
    width: 100%;
  }
  .vwl-ai-header-actions :deep(.vd-btn) {
    font-size: 0.72rem;
    padding: 0.35rem 0.45rem;
  }
  .vwl-ai-title {
    font-size: 0.82rem;
  }
  .vwl-ai-input {
    font-size: 1rem;
  }
  .vwl-ai-messages {
    padding: 0.65rem;
  }
  .vwl-ai-form-meta {
    gap: 0.3rem;
  }
  .vwl-ai-form-meta :deep(.vd-btn) {
    font-size: 0.75rem;
  }
}
</style>
