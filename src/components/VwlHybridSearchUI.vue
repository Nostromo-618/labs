<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { VdIcon, VdSpinner } from '@vanduo-oss/vd3';
import { DEFAULT_DOCS_BASE_URL } from '@vanduo-oss/vwl-hybrid-search';
import {
  normalizeSearchQuery,
  safeDocHref,
  sanitizeIconClass,
  validateSearchQuery,
} from '@vanduo-oss/vwl-hybrid-search/guardrails/search';
import { createDocsSearch, SEARCH_PRESETS } from '../lib/docs-search.js';

const props = defineProps({
  search: { type: Object, default: null },
  indexUrl: { type: String, default: '' },
  vectorsUrl: { type: String, default: '' },
  baseUrl: { type: String, default: DEFAULT_DOCS_BASE_URL },
  placeholder: { type: String, default: 'Search vd3 docs…' },
  /** Debounce for auto hybrid/fuzzy search after typing pauses. */
  debounceMs: { type: Number, default: 350 },
  showSemanticHint: { type: Boolean, default: true },
  /** Autofocus the search input on mount when safe (skips modals / other fields). */
  autofocus: { type: Boolean, default: true },
  emptyMessage: {
    type: String,
    default: 'No docs found. Try another query or pick a category filter.',
  },
});

const emit = defineEmits(['result-click']);

const preset = ref('minilm');
const semanticStatus = ref('Fuzzy search is ready. Semantic search is optional.');
let alive = true;
const rootEl = ref(null);
const inputEl = ref(null);
const query = ref('');
const results = ref([]);
const selectedIndex = ref(-1);
const dropdownOpen = ref(false);
const loading = ref(false);
const loadingMessage = ref('');
const statusMessage = ref('');
/** Subtle, non-blocking model download status (separate from search loading). */
const modelLoading = ref(false);
const modelProgressMessage = ref('');
const modelProgressPct = ref(0);
const activeCategory = ref('all');
const categories = ref([]);
const shortQueryHint = ref(false);
const listboxId = `vwl-neptune-results-${Math.random().toString(36).slice(2, 9)}`;

let engine = null;
let enginePending = null;
let engineEpoch = 0;
let ownsEngine = false;
let debounceTimer = null;
let semanticSeq = 0;
let didEnrichOnReady = false;
let unsubscribeSemantic = null;
let keyboardHandler = null;
let clickOutsideHandler = null;

const filteredResults = computed(() => {
  if (activeCategory.value === 'all') return results.value;
  return results.value.filter((r) => r.doc?.category === activeCategory.value);
});

const activeDescendant = computed(() =>
  selectedIndex.value >= 0 ? `${listboxId}-opt-${selectedIndex.value}` : '',
);

function snippetFor(doc) {
  const body = String(doc?.bodyText || '').trim();
  if (body) return body.slice(0, 120);
  const chunk = (doc?.chunks || []).find((c) => c?.text)?.text;
  return chunk ? String(chunk).slice(0, 120) : '';
}

function iconName(doc) {
  return sanitizeIconClass(doc?.icon || 'file-text');
}

function hrefFor(doc) {
  return safeDocHref(props.baseUrl, doc?.route || '/');
}

async function ensureEngine() {
  if (engine) return engine;
  if (enginePending) return enginePending;
  const epoch = engineEpoch;
  const external = props.search;
  const pending = (async () => {
    const eng =
      external ||
      (await createDocsSearch(preset.value, {
        indexUrl: props.indexUrl,
        vectorsUrl: props.vectorsUrl,
      }));
    await eng.initFuzzy();
    if (!alive || epoch !== engineEpoch) {
      if (!external) await eng.dispose?.();
      throw new DOMException('Search owner changed.', 'AbortError');
    }
    engine = eng;
    ownsEngine = !external;
    subscribeSemantic(eng);
    const counts = new Map();
    for (const doc of eng.getDocuments()) {
      const key = doc.category || 'Other';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    categories.value = [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
    return eng;
  })();
  enginePending = pending;
  try {
    return await pending;
  } finally {
    if (enginePending === pending) enginePending = null;
  }
}
function releaseEngine() {
  engineEpoch++;
  enginePending = null;
  unsubscribeSemantic?.();
  unsubscribeSemantic = null;
  if (ownsEngine) void engine?.dispose?.();
  engine = null;
  ownsEngine = false;
  didEnrichOnReady = false;
}
watch(preset, async () => {
  if (props.search) return;
  semanticSeq++;
  semanticStatus.value =
    'Fuzzy search is ready. Enable the selected semantic model to download it.';
  if (query.value.trim()) await runSearch(query.value);
});

async function enableSemantic() {
  modelLoading.value = true;
  try {
    let eng = await ensureEngine();
    if (!props.search && eng.embeddingPreset !== preset.value) {
      // Keep the already loaded fuzzy corpus usable if a download cannot begin.
      const next = await createDocsSearch(preset.value, {
        indexUrl: props.indexUrl,
        vectorsUrl: props.vectorsUrl,
      });
      if (!alive) {
        await next.dispose();
        return;
      }
      unsubscribeSemantic?.();
      await eng.dispose();
      engine = next;
      eng = next;
      ownsEngine = true;
      didEnrichOnReady = false;
      subscribeSemantic(next);
    }
    await eng.initSemantic();
    if (!alive) return;
    semanticStatus.value = 'Semantic search ready.';
    if (query.value.trim()) await runSearch(query.value);
  } catch (error) {
    semanticStatus.value = `Fuzzy search available. ${error.message}`;
  } finally {
    modelLoading.value = false;
  }
}

function openDropdown() {
  dropdownOpen.value = true;
}

function closeDropdown() {
  dropdownOpen.value = false;
  selectedIndex.value = -1;
}

function clearResultsUI({ keepShortHint = false } = {}) {
  semanticSeq += 1;
  results.value = [];
  selectedIndex.value = -1;
  loading.value = false;
  loadingMessage.value = '';
  if (!keepShortHint) shortQueryHint.value = false;
  statusMessage.value = '';
  dropdownOpen.value = false;
}

/**
 * Focus search when safe: skip open modals and other text fields, but allow
 * taking focus from buttons (e.g. demo card) after Neptune mounts.
 */
function tryAutofocusInput() {
  if (!props.autofocus) return;
  const ae = document.activeElement;
  if (ae?.closest?.('dialog, [role="dialog"], [aria-modal="true"]')) return;
  if (ae && ae !== inputEl.value) {
    const tag = ae.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable) {
      return;
    }
  }
  inputEl.value?.focus({ preventScroll: true });
}

/**
 * Run search for the current query.
 * - Auto path: hybrid when semantic is ready, otherwise fuzzy (live while model loads).
 * - Immediate/Enter path: always hybrid (awaits model if still warming).
 */
async function runSearch(rawQuery) {
  const eng = await ensureEngine();
  const normalized = normalizeSearchQuery(rawQuery, {
    maxLength: eng.queryMaxLength ?? 240,
  });
  const check = validateSearchQuery(normalized, {
    minLength: eng.queryMinLength ?? 2,
    maxLength: eng.queryMaxLength ?? 240,
  });
  if (!check.allowed) {
    shortQueryHint.value = Boolean(normalized);
    statusMessage.value = normalized
      ? `Type at least ${eng.queryMinLength ?? 2} characters to search.`
      : '';
    if (normalized) openDropdown();
    else clearResultsUI();
    return;
  }

  const useHybrid =
    Boolean(eng.isSemanticReady?.()) && (props.search || eng.embeddingPreset === preset.value);
  const seq = ++semanticSeq;
  selectedIndex.value = -1;
  shortQueryHint.value = false;
  loading.value = true;
  loadingMessage.value = useHybrid ? 'Searching with AI…' : 'Searching…';
  statusMessage.value = '';
  openDropdown();

  try {
    const result = await eng.search(normalized, {
      mode: useHybrid ? 'hybrid' : 'fuzzy',
    });
    if (seq !== semanticSeq) return;
    results.value = result.merged;
    if (!results.value.length) statusMessage.value = props.emptyMessage;
  } catch (err) {
    console.warn('[VwlHybridSearchUI] search failed', err);
    if (seq !== semanticSeq) return;
    const fallback = await eng.search(normalized, { mode: 'fuzzy' });
    if (seq !== semanticSeq) return;
    results.value = fallback.merged;
    if (!results.value.length) statusMessage.value = props.emptyMessage;
  } finally {
    if (seq === semanticSeq) {
      loading.value = false;
      loadingMessage.value = '';
    }
  }
}

function scheduleSearch(rawQuery, { immediate = false } = {}) {
  const engMin = engine?.queryMinLength ?? 2;
  const engMax = engine?.queryMaxLength ?? 240;
  const normalized = normalizeSearchQuery(rawQuery, { maxLength: engMax });
  clearTimeout(debounceTimer);
  // Invalidate in-flight responses while the user keeps typing.
  semanticSeq += 1;
  loading.value = false;
  loadingMessage.value = '';

  const check = validateSearchQuery(normalized, {
    minLength: engMin,
    maxLength: engMax,
  });
  if (!check.allowed) {
    results.value = [];
    selectedIndex.value = -1;
    if (normalized && normalized.length < engMin) {
      shortQueryHint.value = true;
      statusMessage.value = `Type at least ${engMin} characters to search.`;
      openDropdown();
    } else {
      clearResultsUI();
    }
    return;
  }

  shortQueryHint.value = false;
  if (immediate) {
    runSearch(normalized, { forceHybrid: true });
    return;
  }
  debounceTimer = setTimeout(() => {
    runSearch(normalized);
  }, props.debounceMs);
}

function onInput() {
  scheduleSearch(query.value);
}

function onKeyDown(e) {
  if (e.isComposing) return;
  const list = filteredResults.value;
  if (dropdownOpen.value && list.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex.value = Math.min(selectedIndex.value + 1, list.length - 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex.value = Math.max(selectedIndex.value - 1, -1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex.value >= 0) selectResult(list[selectedIndex.value]);
      else scheduleSearch(query.value, { immediate: true });
      return;
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    scheduleSearch(query.value, { immediate: true });
  }
}

function selectResult(result) {
  if (!result) return;
  emit('result-click', result);
  const href = hrefFor(result.doc);
  if (href && href !== '#') {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
  closeDropdown();
}

function setCategory(name) {
  activeCategory.value = name;
  selectedIndex.value = -1;
  if (query.value.trim()) openDropdown();
}

function subscribeSemantic(eng) {
  unsubscribeSemantic = eng.onSemanticProgress((data) => {
    // Keep model progress out of the results dropdown so typing/fuzzy stay free.
    if (data.stage === 'loading-model' || data.stage === 'downloading') {
      modelLoading.value = true;
      modelProgressMessage.value = data.message || 'Loading search model…';
      if (data.progress?.loaded && data.progress?.total) {
        modelProgressPct.value = Math.round((data.progress.loaded / data.progress.total) * 100);
      } else if (data.stage === 'loading-model') {
        modelProgressPct.value = 0;
      }
    } else if (data.stage === 'ready' || data.stage === 'error') {
      modelLoading.value = false;
      modelProgressMessage.value = '';
      modelProgressPct.value = 0;
      semanticStatus.value =
        data.stage === 'ready'
          ? 'Semantic search ready.'
          : `Fuzzy search available. ${data.message || 'Semantic search unavailable.'}`;
      // Enrich current query once when the model first becomes ready.
      if (data.stage === 'ready' && !didEnrichOnReady && query.value.trim()) {
        didEnrichOnReady = true;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          runSearch(query.value);
        }, 0);
      }
    }
  });
}

onMounted(async () => {
  let eng;
  try {
    eng = await ensureEngine();
  } catch (error) {
    semanticStatus.value = error.message;
    return;
  }
  if (!alive) {
    if (ownsEngine) void eng.dispose?.();
    return;
  }

  // Downloads require the explicit Enable semantic search action.
  tryAutofocusInput();

  keyboardHandler = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      inputEl.value?.focus();
      openDropdown();
    }
    if (e.key === 'Escape' && dropdownOpen.value) {
      e.preventDefault();
      closeDropdown();
      inputEl.value?.blur();
    }
  };
  document.addEventListener('keydown', keyboardHandler);

  clickOutsideHandler = (e) => {
    if (rootEl.value && !rootEl.value.contains(e.target)) closeDropdown();
  };
  document.addEventListener('click', clickOutsideHandler);
});

onBeforeUnmount(() => {
  alive = false;
  semanticSeq += 1;
  clearTimeout(debounceTimer);
  releaseEngine();
  if (keyboardHandler) document.removeEventListener('keydown', keyboardHandler);
  if (clickOutsideHandler) document.removeEventListener('click', clickOutsideHandler);
  if (unsubscribeSemantic) {
    unsubscribeSemantic();
    unsubscribeSemantic = null;
  }
  // Release owned model resources on navigation.
  engine = null;
  didEnrichOnReady = false;
});

watch(
  () => props.search,
  async () => {
    releaseEngine();
    try {
      await ensureEngine();
      if (query.value.trim()) await runSearch(query.value);
    } catch (error) {
      if (alive) semanticStatus.value = error.message;
    }
  },
);

defineExpose({
  focus: () => inputEl.value?.focus(),
  getEngine: () => engine,
});
</script>

<template>
  <div ref="rootEl" class="vwl-neptune-search">
    <div class="vwl-neptune-semantic-controls">
      <label
        >Optional semantic model
        <select v-model="preset" class="vd-select" :disabled="modelLoading">
          <option v-for="choice in SEARCH_PRESETS" :key="choice.id" :value="choice.id">
            {{ choice.label }} · {{ choice.download }}
          </option>
        </select></label
      >
      <button
        type="button"
        class="vd-btn vd-btn-outline"
        :disabled="modelLoading"
        @click="enableSemantic"
      >
        {{ modelLoading ? 'Loading semantic model…' : 'Enable semantic search' }}
      </button>
      <p role="status">{{ semanticStatus }}</p>
    </div>
    <div
      v-if="categories.length"
      class="vwl-neptune-filters"
      role="list"
      aria-label="Filter by category"
    >
      <button
        type="button"
        class="vwl-neptune-filter-chip"
        :class="{ 'is-active': activeCategory === 'all' }"
        role="listitem"
        @click="setCategory('all')"
      >
        All
      </button>
      <button
        v-for="cat in categories"
        :key="cat.name"
        type="button"
        class="vwl-neptune-filter-chip"
        :class="{ 'is-active': activeCategory === cat.name }"
        role="listitem"
        @click="setCategory(cat.name)"
      >
        {{ cat.name }}
        <span class="vwl-neptune-filter-count">{{ cat.count }}</span>
      </button>
    </div>

    <div class="vwl-neptune-input-wrap">
      <VdIcon name="magnifying-glass" class="vwl-neptune-input-icon" aria-hidden="true" />
      <input
        ref="inputEl"
        v-model="query"
        type="search"
        class="vwl-neptune-input"
        :placeholder="placeholder"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        role="combobox"
        aria-label="Search documentation"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :aria-expanded="dropdownOpen ? 'true' : 'false'"
        :aria-controls="listboxId"
        :aria-activedescendant="activeDescendant"
        :aria-busy="loading ? 'true' : 'false'"
        @input="onInput"
        @keydown="onKeyDown"
        @focus="openDropdown"
      />
      <span v-if="showSemanticHint" class="vwl-neptune-hint" aria-hidden="true"> AI · fuzzy </span>
    </div>

    <div :id="listboxId" class="vwl-neptune-dropdown" role="listbox" :hidden="!dropdownOpen">
      <div v-if="loading" class="vwl-neptune-loader" role="status">
        <VdSpinner size="sm" />
        <span>{{ loadingMessage || 'Searching…' }}</span>
      </div>

      <p v-else-if="shortQueryHint || statusMessage" class="vwl-neptune-empty" role="status">
        {{ statusMessage || emptyMessage }}
      </p>

      <div
        v-for="(result, index) in filteredResults"
        :id="`${listboxId}-opt-${index}`"
        :key="result.doc.id"
        class="vwl-neptune-result"
        :class="{ 'is-selected': index === selectedIndex }"
        role="option"
        :aria-selected="index === selectedIndex ? 'true' : 'false'"
        tabindex="-1"
        @click="selectResult(result)"
        @mouseenter="selectedIndex = index"
      >
        <div class="vwl-neptune-result-header">
          <span class="vwl-neptune-result-icon">
            <VdIcon :name="iconName(result.doc)" />
          </span>
          <span class="vwl-neptune-result-title">{{ result.doc.title }}</span>
          <span class="vwl-neptune-result-trail">
            <span class="vwl-neptune-result-category">{{ result.doc.category }}</span>
            <span
              class="vwl-neptune-badge"
              :class="
                result.source === 'semantic'
                  ? 'vwl-neptune-badge-semantic'
                  : 'vwl-neptune-badge-fuzzy'
              "
            >
              {{ result.source === 'semantic' ? 'AI' : 'Fuzzy' }}
            </span>
          </span>
        </div>
        <div v-if="snippetFor(result.doc)" class="vwl-neptune-result-body">
          {{ snippetFor(result.doc) }}
        </div>
        <div class="vwl-neptune-result-footer">
          <div class="vwl-neptune-result-keywords">
            <span
              v-for="kw in (result.doc.keywords || []).slice(0, 3)"
              :key="kw"
              class="vwl-neptune-keyword"
              >{{ kw }}</span
            >
          </div>
          <a
            class="vwl-neptune-result-link"
            :href="hrefFor(result.doc)"
            target="_blank"
            rel="noopener noreferrer"
            @click.stop
            >Open docs →</a
          >
        </div>
      </div>
    </div>

    <div v-if="modelLoading" class="vwl-neptune-progress" role="status" aria-live="polite">
      <div class="vwl-neptune-progress-bar" :style="{ width: `${modelProgressPct}%` }" />
      <span class="vwl-neptune-progress-text">{{ modelProgressMessage }}</span>
    </div>
  </div>
</template>

<style scoped>
.vwl-neptune-semantic-controls {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  align-items: end;
  margin-bottom: 1rem;
}
.vwl-neptune-semantic-controls label {
  flex: 1;
  min-width: 0;
}
.vwl-neptune-semantic-controls select {
  width: 100%;
}
.vwl-neptune-semantic-controls p {
  flex-basis: 100%;
  font-size: 0.85rem;
  margin: 0;
  color: var(--text-secondary);
}
.vwl-neptune-search {
  position: relative;
  width: 100%;
}

.vwl-neptune-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-bottom: 0.85rem;
}

.vwl-neptune-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 0.3rem 0.7rem;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

.vwl-neptune-filter-chip.is-active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-alpha-10, rgba(var(--vd-color-primary-rgb), 0.12));
}

.vwl-neptune-filter-count {
  opacity: 0.7;
  font-size: 0.72rem;
}

.vwl-neptune-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.vwl-neptune-input-icon {
  position: absolute;
  left: 0.85rem;
  color: var(--text-muted);
  pointer-events: none;
}

.vwl-neptune-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.85rem 4.5rem 0.85rem 2.6rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
  font-size: 1rem;
}

.vwl-neptune-input:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.vwl-neptune-hint {
  position: absolute;
  right: 0.75rem;
  color: var(--text-muted);
  font-size: 0.72rem;
  white-space: nowrap;
}

.vwl-neptune-dropdown {
  margin-top: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  max-height: min(60vh, 28rem);
  overflow: auto;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}

.vwl-neptune-dropdown[hidden] {
  display: none !important;
}

.vwl-neptune-loader,
.vwl-neptune-empty {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 1rem 1.1rem;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.vwl-neptune-result {
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
}

.vwl-neptune-result:last-child {
  border-bottom: 0;
}

.vwl-neptune-result.is-selected,
.vwl-neptune-result:hover {
  background: var(--bg-secondary);
}

.vwl-neptune-result-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.vwl-neptune-result-icon {
  color: var(--color-primary);
  display: inline-flex;
}

.vwl-neptune-result-title {
  font-weight: 650;
  color: var(--text-primary);
  flex: 1 1 auto;
  min-width: 0;
}

.vwl-neptune-result-trail {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: auto;
}

.vwl-neptune-result-category {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.vwl-neptune-badge {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-radius: 999px;
  padding: 0.15rem 0.45rem;
}

.vwl-neptune-badge-fuzzy {
  background: rgba(var(--vd-color-info-rgb), 0.18);
  color: var(--vd-color-info);
}

.vwl-neptune-badge-semantic {
  background: rgba(var(--vd-color-primary-rgb), 0.18);
  color: var(--color-primary);
}

.vwl-neptune-result-body {
  margin-top: 0.4rem;
  color: var(--text-secondary);
  font-size: 0.88rem;
  line-height: 1.45;
}

.vwl-neptune-result-footer {
  margin-top: 0.55rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.vwl-neptune-result-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.vwl-neptune-keyword {
  font-size: 0.72rem;
  color: var(--text-muted);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
}

.vwl-neptune-result-link {
  color: var(--color-primary);
  font-size: 0.8rem;
  text-decoration: none;
  white-space: nowrap;
}

.vwl-neptune-result-link:hover {
  text-decoration: underline;
}

.vwl-neptune-progress {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
}

.vwl-neptune-progress-bar {
  height: 4px;
  background: var(--color-primary);
  border-radius: 2px;
  width: 0%;
  transition: width 0.3s ease;
}

.vwl-neptune-progress-text {
  display: block;
  margin-top: 0.375rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

@media (max-width: 600px) {
  .vwl-neptune-input {
    padding-right: 3.5rem;
  }

  .vwl-neptune-hint {
    font-size: 0.65rem;
  }
}
</style>
