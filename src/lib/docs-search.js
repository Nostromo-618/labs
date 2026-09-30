import { HybridSearch, DEFAULT_DOCS_BASE_URL } from '@vanduo-oss/vwl-hybrid-search';
import { safeDocHref } from '@vanduo-oss/vwl-hybrid-search/guardrails/search';
import Fuse from 'fuse.js';

export const SEARCH_PRESETS = [
  { id: 'minilm', label: 'Lightweight · MiniLM', download: 'about 23 MB' },
  { id: 'embeddinggemma', label: 'Quality · EmbeddingGemma', download: 'about 300 MB' },
];
export async function createDocsSearch(preset = 'minilm', overrides = {}) {
  let indexUrl = overrides.indexUrl;
  let vectorsUrl = overrides.vectorsUrl;
  if (!indexUrl || !vectorsUrl) {
    const response = await fetch('/data/search-manifest.json');
    if (!response.ok) throw new Error(`Documentation index unavailable (${response.status}).`);
    const manifest = await response.json();
    const model = manifest.presets?.[preset];
    const safePath = (p) => /^search\/[a-f0-9]{24}\/[a-z0-9-]+\.json$/.test(p);
    if (
      manifest.schemaVersion !== 1 ||
      !model ||
      !safePath(manifest.index) ||
      !safePath(model.path)
    )
      throw new Error('Invalid documentation manifest.');
    indexUrl = `/data/${manifest.index}`;
    vectorsUrl = `/data/${model.path}`;
  }
  const engine = new HybridSearch({
    embeddingPreset: preset,
    indexUrl,
    vectorsUrl,
    loadFuse: async () => ({ default: Fuse }),
    loadTransformers: () => import('@huggingface/transformers'),
    onnxWasmPaths: '/transformers-wasm/',
  });
  await engine.initFuzzy();
  return engine;
}
const terms = (text) =>
  String(text)
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
const stop = new Set([
  'the',
  'and',
  'how',
  'can',
  'with',
  'does',
  'what',
  'for',
  'are',
  'use',
  'from',
  'this',
  'that',
  'have',
  'you',
  'about',
]);
/** Bounded evidence, not instructions. Only host-retrieved IDs may become links. */
export async function retrieveDocs(engine, question) {
  const tokens = terms(question).filter((t) => !stop.has(t));
  if (!tokens.length) return [];
  const hits = new Map();
  // A whole-question fuzzy match often misses exact API identifiers. Include
  // bounded token searches, then require lexical evidence in each excerpt.
  for (const query of [tokens.join(' ').slice(0, 240), ...tokens.slice(0, 5)]) {
    const result = await engine.search(query, {
      mode: engine.isSemanticReady() ? 'hybrid' : 'fuzzy',
    });
    for (const hit of result.merged.slice(0, 5)) {
      if (!hits.has(hit.doc.id) || hits.get(hit.doc.id).score < hit.score)
        hits.set(hit.doc.id, hit);
    }
  }
  const candidates = [];
  for (const { doc, score, source } of [...hits.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)) {
    if (score < 0.5) continue;
    const chunks = doc.chunks?.length ? doc.chunks : [{ text: doc.bodyText, heading: doc.title }];
    for (const [index, chunk] of chunks.entries()) {
      const text = String(chunk.text || '');
      const matchingRows =
        chunk.heading === 'API'
          ? text
              .split('\n')
              .filter((row) => tokens.some((t) => terms(row.split('|')[0]).includes(t)))
          : [];
      const overlap = tokens.filter((t) =>
        terms(`${doc.title} ${chunk.heading} ${text}`).some(
          (w) => w === t || (t.length > 4 && w.startsWith(t)),
        ),
      ).length;
      const minimumOverlap = tokens.length === 1 ? 1 : Math.max(2, Math.ceil(tokens.length * 0.3));
      if (overlap < minimumOverlap && (source !== 'semantic' || score < 0.78)) continue;
      const anchor = doc.anchors?.includes(chunk.anchor) ? chunk.anchor : '';
      candidates.push({
        id: `${doc.id}:${index}`,
        title: `${doc.title}${chunk.heading && chunk.heading !== doc.title ? ' · ' + chunk.heading : ''}`,
        text: (matchingRows.length ? matchingRows.join('\n') : text).slice(0, 900),
        url:
          safeDocHref(DEFAULT_DOCS_BASE_URL, doc.route) +
          (anchor ? '#' + encodeURIComponent(anchor) : ''),
        rank: score + overlap / Math.max(1, tokens.length) + (matchingRows.length ? 1 : 0),
      });
    }
  }
  return candidates
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3)
    .map(({ rank: _rank, ...source }) => source);
}
export const INSUFFICIENT_EVIDENCE =
  'I do not have enough evidence in the local vd3 documentation to answer that. Try a component name, a prop, or a more specific docs question.';
export function citedSources(text, sources) {
  const ids = new Set([...String(text).matchAll(/\[source:([^[\]]+)\]/g)].map((m) => m[1]));
  return sources.filter((s) => ids.has(s.id));
}
