/** Explicit local synthetic-microphone acceptance; all inference and audio are real. */
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
const base = process.env.CHECKED_QA_URL || 'http://127.0.0.1:3001';
const context = await chromium.launchPersistentContext('/tmp/vwl-checked-conversation-profile', {
  channel: 'chrome',
  headless: false,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disk-cache-size=1'],
});
const page = context.pages()[0],
  report = {
    date: new Date().toISOString(),
    turns: [],
    microphone:
      'Synthetic speech enters a real MediaStream, worklet/resampler and VAD. Physical microphone acoustics are not certified.',
  };
await fs.mkdir('qa/checked-stream', { recursive: true });
try {
  await page.goto(`${base}/tests/fixtures/checked-inference.html`);
  await page.waitForFunction(() => window.checkedQA);
  const ids = await page.evaluate(() => window.checkedQA.PRIMARY_MODEL_OPTIONS.map((m) => m.id));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: base, quotaSize: 12 * 1024 ** 3 });
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  for (const id of ids) {
    console.log('Conversation', id);
    await page.goto(`${base}/demo/conversation-eval-harness.html?model=${encodeURIComponent(id)}`);
    await page.waitForFunction(() => window.conversationEvaluation);
    await page.locator('#start').click();
    await page.waitForFunction(
      () => ['listening', 'paused'].includes(window.conversationEvaluation.loop.state.status),
      null,
      { timeout: 240000 },
    );
    let state = await page.evaluate(() => window.conversationEvaluation.loop.state);
    const failures = [];
    if (state.status === 'paused' && /stream failed/.test(state.error)) {
      failures.push(state.error);
      await page.locator('#resume').click();
      await page.waitForFunction(
        () => ['listening', 'paused'].includes(window.conversationEvaluation.loop.state.status),
        null,
        { timeout: 240000 },
      );
      state = await page.evaluate(() => window.conversationEvaluation.loop.state);
    }
    if (state.status === 'listening') {
      await page.evaluate(() =>
        window.conversationEvaluation.feed('Why do flowers need sunlight?'),
      );
      await page.waitForFunction(
        () =>
          window.conversationEvaluation.loop.state.turns >= 1 ||
          window.conversationEvaluation.loop.state.status === 'paused',
        null,
        { timeout: 240000 },
      );
    }
    await page.locator('#end').click();
    await page.waitForFunction(() => window.conversationEvaluation.loop.state.status === 'stopped');
    const result = await page.evaluate(() => window.conversationEvaluation.report());
    report.turns.push({ id, loadFailures: failures, ...result });
    console.log(
      JSON.stringify({
        id,
        turns: result.turns,
        error: result.state.error,
        peaks: result.peaks,
        liveTracks: result.liveTracks,
      }),
    );
    await page.evaluate(async () => {
      await window.conversationEvaluation.dispose();
      const { clearChatCaches } = await import('/src/lib/chat-runtime.js');
      await clearChatCaches([window.conversationEvaluation.chat.modelId]);
    });
    await fs.writeFile('qa/checked-stream/conversations.json', JSON.stringify(report, null, 2));
  }
} finally {
  await context.close();
}
if (
  report.turns.some(
    (r) =>
      r.turns.length !== 1 ||
      r.turns[0].previews !== 0 ||
      !r.peaks.some((p) => p.peak > 0.01) ||
      r.liveTracks !== 0,
  )
)
  process.exitCode = 1;
