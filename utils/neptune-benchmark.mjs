#!/usr/bin/env node
/** Exercise the shipped HybridSearch package against both actual embedding sets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fuse from 'fuse.js';
import { pipeline } from '@huggingface/transformers';
import { HybridSearch } from '@vanduo-oss/vdl-hybrid-search';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (p) => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));
const queries = await read('utils/benchmark-queries.json');
const added = await read('utils/benchmark-new-routes.json');
const manifest = await read('data/search-manifest.json');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) =>
  String(url).startsWith('https://local-index.test/')
    ? new globalThis.Response(
        await fs.readFile(path.join(root, 'data', new URL(url).pathname.slice(1))),
      )
    : realFetch(url, options);
const url = (p) => `https://local-index.test/${p}`;
const current = await read(`data/${manifest.index}`);
const currentIds = new Set(current.documents.map((d) => d.id));
const retained = queries.filter((q) => currentIds.has(q.expected));
const reports = [];
for (const name of ['baseline', 'minilm', 'embeddinggemma']) {
  const baseline = name === 'baseline';
  const preset = baseline ? 'minilm' : name;
  const engine = new HybridSearch({
    embeddingPreset: preset,
    ...(baseline ? { confidence: { minTopScore: 0.53 } } : {}),
    indexUrl: url(baseline ? 'search-index.json' : manifest.index),
    vectorsUrl: url(baseline ? 'vectors.json' : manifest.presets[preset].path),
    loadFuse: async () => ({ default: Fuse }),
    loadTransformers: async () => ({ pipeline }),
  });
  await engine.initSemantic();
  const rows = [];
  for (const query of [...retained, ...(baseline ? [] : added)]) {
    const result = await engine.search(query.query, { mode: 'hybrid' });
    const ids = result.merged.map((h) => h.doc.id);
    const rank = query.expected ? ids.indexOf(query.expected) + 1 : 0;
    rows.push({
      ...query,
      rank,
      pass: query.expected ? rank > 0 && rank <= 5 : ids.length === 0,
      top5: ids.slice(0, 5),
    });
  }
  const kept = rows.slice(0, retained.length);
  const metrics = {
    recall5: kept.filter((r) => r.rank > 0 && r.rank <= 5).length / kept.length,
    mrr: kept.reduce((n, r) => n + (r.rank > 0 ? 1 / r.rank : 0), 0) / kept.length,
  };
  const report = { preset: name, model: engine.modelName, metrics, rows };
  reports.push(report);
  console.log(
    name,
    metrics,
    'new failures',
    rows.slice(retained.length).filter((r) => !r.pass),
  );
  await engine.dispose();
}
const failures = reports.slice(1).flatMap((r) => [
  ...(r.metrics.recall5 < reports[0].metrics.recall5 || r.metrics.mrr < reports[0].metrics.mrr
    ? [`${r.preset} recall regressed`]
    : []),
  ...r.rows
    .slice(retained.length)
    .filter((q) => !q.pass)
    .map((q) => `${r.preset}: ${q.query}`),
]);
await fs.mkdir(path.join(root, 'qa/local-refresh'), { recursive: true });
await fs.writeFile(
  path.join(root, 'qa/local-refresh/search-benchmark.json'),
  JSON.stringify(
    {
      sourceRevision: manifest.sourceRevision,
      generation: manifest.generation,
      retained: retained.length,
      retired: queries.filter((q) => !currentIds.has(q.expected)),
      reports,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
