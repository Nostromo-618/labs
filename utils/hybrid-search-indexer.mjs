#!/usr/bin/env node
/** Generate both embeddings directly into Labs; the manifest changes only on success. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const labsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgRoot = path.dirname(require.resolve('@vanduo-oss/vdl-hybrid-search/package.json'));
const sourceRoot = process.env.VD3_DOCS_PATH || path.resolve(labsRoot, '../../vd3/vd3-docs');
const result = spawnSync(
  process.execPath,
  [
    path.join(pkgRoot, 'scripts/vdl-hybrid-index.mjs'),
    '--source-root',
    sourceRoot,
    '--out',
    path.join(labsRoot, 'data'),
    '--presets',
    'minilm,embeddinggemma',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: process.env, cwd: pkgRoot },
);
process.exit(result.status ?? 1);
