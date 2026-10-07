/** Own-profile cache corruption/offline acceptance and bounded gate latency. */
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
const base = process.env.CHECKED_QA_URL || 'http://127.0.0.1:3001';
const context = await chromium.launchPersistentContext('/tmp/vwl-checked-stream-profile', {
  channel: 'chrome',
  headless: false,
});
const page = context.pages()[0];
const report = {};
try {
  await page.goto(`${base}/tests/fixtures/checked-inference.html`);
  await page.waitForFunction(() => window.checkedQA);
  report.invalid = await page.evaluate(async () => {
    const rt = window.checkedQA.createSpeechRuntime();
    try {
      await rt.load('kokoro', { voiceId: 'af' });
      return 'unexpected load';
    } catch (e) {
      return e.message;
    } finally {
      rt.dispose();
    }
  });
  const url = `${base}/models/vwl-speech-kokoro/voices/af_alloy.bin`;
  await page.evaluate(async (url) => {
    const cache = await caches.open('vwl-speech-kokoro-v1');
    const response = await cache.match(url);
    window.savedVoiceBytes = await response.arrayBuffer();
    await cache.put(url, new globalThis.Response(new Uint8Array(522240)));
  }, url);
  report.corrupt = await page.evaluate(async () => {
    const rt = window.checkedQA.createSpeechRuntime();
    try {
      await rt.load('kokoro', { voiceId: 'af_alloy' });
      return 'unexpected load';
    } catch (e) {
      return e.message;
    } finally {
      rt.dispose();
    }
  });
  await page.evaluate(async (url) => {
    const cache = await caches.open('vwl-speech-kokoro-v1');
    await cache.delete(url);
  }, url);
  await context.route(/\/(?:models\/|resolve\/)/, (r) => r.abort('internetdisconnected'));
  report.uncachedOffline = await page.evaluate(async () => {
    const rt = window.checkedQA.createSpeechRuntime();
    try {
      await rt.load('kokoro', { voiceId: 'af_alloy' });
      return 'unexpected load';
    } catch (e) {
      return e.message;
    } finally {
      rt.dispose();
    }
  });
  await context.unroute(/\/(?:models\/|resolve\/)/);
  await page.evaluate(async (url) => {
    const cache = await caches.open('vwl-speech-kokoro-v1');
    await cache.put(url, new globalThis.Response(window.savedVoiceBytes));
    window.savedVoiceBytes = null;
  }, url);
  report.restored = await page.evaluate(async () => {
    const rt = window.checkedQA.createSpeechRuntime();
    try {
      await rt.load('kokoro', { voiceId: 'af_alloy' });
      const out = await rt.synthesize('Restored voice works.', { voiceId: 'af_alloy' });
      return { samples: out.chunks[0].length };
    } finally {
      rt.dispose();
    }
  });
  report.latency = await page.evaluate(async () => {
    const { CheckedDeliveryGate } =
      await import('/@fs/Users/misteruser/Documents/GitHub/0_vanduo/vdl/vwl-ai-chat/src/checked-delivery.ts');
    const results = {};
    for (const size of [1000, 4000, 16000, 32000]) {
      const text = 'Flowers grow in a friendly garden. '
          .repeat(Math.ceil(size / 35))
          .slice(0, size),
        times = [];
      for (let i = 0; i < 60; i++) {
        const gate = new CheckedDeliveryGate(
          'family-friendly',
          () => {},
          () => {},
        );
        const at = performance.now();
        gate.accept(text);
        if (i >= 10) times.push(performance.now() - at);
      }
      times.sort((a, b) => a - b);
      results[size] = { medianMs: times[25], p95Ms: times[47] };
    }
    return results;
  });
  await fs.writeFile('qa/checked-stream/cache-latency.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
}
if (!/checksum/.test(report.corrupt) || !/while online/.test(report.uncachedOffline))
  process.exitCode = 1;
