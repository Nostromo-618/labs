#!/usr/bin/env node
/** Explicit, validated prefetch from the package catalog. Models never enter dist. */
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { MODEL_OPTIONS, NEW_MODEL_IDS } from '@vanduo-oss/vdl-ai-chat';
const args = process.argv.slice(2);
const flag = args.indexOf('--model');
const ids = args.includes('--new')
  ? NEW_MODEL_IDS
  : (flag < 0 ? 'gemma-4-E2B-it-web' : args[flag + 1]).split(',');
const root = new URL('../.models/', import.meta.url);
async function verify(file, artifact) {
  try {
    const stat = await fs.stat(file);
    if (stat.size !== artifact.bytes) return false;
    const hash = createHash(artifact.sha256 ? 'sha256' : 'sha1');
    if (!artifact.sha256) hash.update(`blob ${artifact.bytes}\0`);
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === (artifact.sha256 || artifact.gitSha1);
  } catch {
    return false;
  }
}
for (const id of ids) {
  const model = MODEL_OPTIONS.find((m) => m.id === id);
  if (!model?.artifacts?.length || !model.revision)
    throw new Error(`No pinned artifacts for ${id}. Refresh the manifest first.`);
  console.log(
    `${id}: ${model.artifacts.length} files, ${(model.approxBytes / 1e6).toFixed(1)} MB, revision ${model.revision}`,
  );
  if (args.includes('--dry-run')) continue;
  const dir = new URL(`${id}/`, root);
  await fs.mkdir(dir, { recursive: true });
  for (const artifact of model.artifacts) {
    if (artifact.path.includes('..') || artifact.path.startsWith('/'))
      throw new Error('Invalid artifact path');
    const file = new URL(artifact.path, dir);
    if (!args.includes('--force') && (await verify(file, artifact))) continue;
    await fs.mkdir(path.dirname(file.pathname), { recursive: true });
    const response = await fetch(
      `https://huggingface.co/${model.repo}/resolve/${model.revision}/${artifact.path}`,
    );
    if (!response.ok || !response.body)
      throw new Error(`${id}/${artifact.path}: HTTP ${response.status}`);
    const temporary = new URL(file.href + '.partial');
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    if (!(await verify(temporary, artifact))) {
      await fs.unlink(temporary);
      throw new Error(`Integrity failure: ${artifact.path}`);
    }
    await fs.rename(temporary, file);
    console.log(`  verified ${artifact.path}`);
  }
  await fs.writeFile(
    new URL('.labs-model.json', dir),
    JSON.stringify({
      modelId: id,
      revision: model.revision,
      bytes: model.approxBytes,
      fetchedAt: new Date().toISOString(),
    }) + '\n',
  );
}
