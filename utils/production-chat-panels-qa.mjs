/** Verify production Compare and explicitly-local QA Evaluate delivery without loading models. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve('qa/local-refresh');
const productionBase = (process.env.CHAT_PANELS_PRODUCTION_URL || 'http://127.0.0.1:4174').replace(
  /\/$/,
  '',
);
const qaBase = (process.env.CHAT_PANELS_QA_URL || 'http://127.0.0.1:4175').replace(/\/$/, '');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];

async function openChat(page, base) {
  await page.goto(`${base}/#demos/aichat`);
  const gate = page.getByTestId('disclaimer-gate');
  if (await gate.isVisible().catch(() => false))
    await page.getByTestId('disclaimer-accept').click();
  await page.getByRole('button', { name: 'Chat', exact: true }).waitFor();
}

try {
  const production = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const productionRequests = [];
  production.on('request', (request) => {
    if (/huggingface|\.litertlm(?:\?|$)|params_shard_|onnx\/model_q4/.test(request.url()))
      productionRequests.push(request.url());
  });
  await production.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (event) =>
      window.__cspViolations.push(event.violatedDirective),
    ),
  );
  await production.addInitScript(() => (window.__cspViolations = []));
  await openChat(production, productionBase);
  const csp = await production
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  assert(csp && !csp.includes("'unsafe-eval'"), 'production CSP must remain restrictive');
  assert.equal(await production.getByRole('button', { name: 'Evaluate · local' }).count(), 0);
  const compareBeforeLoad = await production.evaluate(() =>
    performance.getEntriesByType('resource').some((entry) => /VwlCompareChat/.test(entry.name)),
  );
  await production.getByRole('button', { name: 'Compare', exact: true }).click();
  await production.getByLabel('Model A').waitFor();
  const compareAfterLoad = await production.evaluate(() =>
    performance.getEntriesByType('resource').some((entry) => /VwlCompareChat/.test(entry.name)),
  );
  assert.equal(compareBeforeLoad, false, 'Compare chunk must load lazily');
  assert.equal(compareAfterLoad, true, 'Compare chunk should load after its tab is selected');
  assert.equal(await production.getByRole('button', { name: 'Load pair' }).isDisabled(), true);
  assert.deepEqual(productionRequests, [], 'opening Compare must not download a model');
  results.push({
    build: 'production',
    csp,
    compareBeforeLoad,
    compareAfterLoad,
    evaluationHidden: true,
    modelRequests: productionRequests,
    cspViolations: await production.evaluate(() => window.__cspViolations),
  });
  await production.screenshot({
    path: path.join(root, 'screenshots', 'chromium-production-compare-setup.png'),
    fullPage: true,
  });
  await production.close();

  const qa = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const qaRequests = [];
  qa.on('request', (request) => {
    if (/huggingface|\.litertlm(?:\?|$)|params_shard_|onnx\/model_q4/.test(request.url()))
      qaRequests.push(request.url());
  });
  await openChat(qa, qaBase);
  await qa.getByRole('button', { name: 'Evaluate · local' }).click();
  const panel = qa.getByRole('region', { name: 'Local model evaluation' });
  await panel.getByRole('heading', { name: 'Evaluate on this device' }).waitFor();
  assert.equal(await panel.locator('fieldset input[type="checkbox"]:checked').count(), 8);
  assert.deepEqual(qaRequests, [], 'opening Evaluate must not download a model');
  results.push({
    build: 'qa',
    evaluationVisible: true,
    defaultSelectedModels: 8,
    modelRequests: qaRequests,
  });
  await qa.screenshot({
    path: path.join(root, 'screenshots', 'chromium-qa-evaluation-setup.png'),
    fullPage: true,
  });
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, 'production-panels.json'),
    JSON.stringify(results[0], null, 2),
  );
  await fs.writeFile(path.join(root, 'qa-build-panels.json'), JSON.stringify(results[1], null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
