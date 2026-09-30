/** Local production-preview checks. Models download only through explicit test clicks. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';
const root = path.resolve('qa/local-refresh');
const base = (process.env.PRODUCTION_REFRESH_BASE_URL || 'http://127.0.0.1:4173').replace(
  /\/$/,
  '',
);
await fs.mkdir(root, { recursive: true });
const report = [];
for (const [name, type] of Object.entries({ chromium, webkit })) {
  const browser = await type.launch({
    headless: true,
    ...(name === 'chromium'
      ? { channel: 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] }
      : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const violations = [];
  const errors = [];
  await page.addInitScript(() => {
    window.cspQA = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.cspQA.push({ directive: e.violatedDirective, uri: e.blockedURI }),
    );
  });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${base}/demo/hybrid-search-demo.html`);
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    if (!csp || csp.includes("'unsafe-eval'")) throw Error('Strict production CSP missing.');
    const capability = await page.evaluate(async () => ({
      gpu: !!navigator.gpu,
      adapter: !!(await navigator.gpu?.requestAdapter()),
      userAgent: navigator.userAgent,
    }));
    await page.getByRole('combobox', { name: 'Search documentation' }).fill('Dock');
    await page.locator('.vwl-neptune-result').first().waitFor();
    const embeddings = [];
    for (const preset of name === 'chromium' ? ['minilm', 'embeddinggemma'] : ['minilm']) {
      if (preset === 'embeddinggemma')
        await page.getByRole('combobox').first().selectOption(preset);
      await page.getByRole('button', { name: 'Enable semantic search', exact: true }).click();
      await page.waitForFunction(
        () => !document.querySelector('.vwl-neptune-semantic-controls button')?.disabled,
        {},
        { timeout: 300000 },
      );
      const status = await page.locator('.vwl-neptune-semantic-controls').innerText();
      embeddings.push({ preset, status });
      await page
        .getByRole('combobox', { name: 'Search documentation' })
        .fill('navigation bar at the edge of the screen');
      await page.waitForTimeout(1000);
      embeddings.at(-1).results = await page.locator('.vwl-neptune-result-title').allTextContents();
    }
    violations.push(...(await page.evaluate(() => window.cspQA)));
    await page.screenshot({
      path: path.join(root, 'screenshots', `${name}-production-search.png`),
      fullPage: true,
    });
    report.push({
      browser: name,
      version: browser.version(),
      capability,
      csp,
      embeddings,
      violations,
      errors,
    });
  } catch (error) {
    report.push({ browser: name, error: error.message, violations, errors });
  }
  await browser.close();
}
await fs.writeFile(path.join(root, 'production-browser.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
