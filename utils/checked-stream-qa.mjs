/** Explicit local headed Chrome QA. No deployment or runtime upgrades. */
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
const base = process.env.CHECKED_QA_URL || 'http://127.0.0.1:3001';
const root = 'qa/checked-stream';
await fs.mkdir(root, { recursive: true });
const context = await chromium.launchPersistentContext('/tmp/vwl-checked-stream-profile', {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disk-cache-size=1'],
});
const page = context.pages()[0];
const report = {
  date: new Date().toISOString(),
  browser: context.browser()?.version(),
  models: [],
  voices: [],
};
const save = () => fs.writeFile(`${root}/inference.json`, JSON.stringify(report, null, 2));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('browser:', m.text().slice(0, 400));
});
try {
  await page.goto(`${base}/tests/fixtures/checked-inference.html`);
  await page.waitForFunction(() => window.checkedQA);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: base, quotaSize: 12 * 1024 ** 3 });
  report.device = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    return {
      userAgent: navigator.userAgent,
      adapter: adapter.info,
      localVoices: window.checkedQA
        .localEnglishVoices()
        .map((v) => ({ name: v.name, voiceURI: v.voiceURI, lang: v.lang })),
    };
  });
  const models = await page.evaluate(() =>
    window.checkedQA.MODEL_OPTIONS.map((m) => ({
      id: m.id,
      primary: m.catalogRole === 'primary',
      reasoning: m.reasoning,
    })),
  );
  for (const model of models) {
    console.log('Model', model.id);
    const result = await page.evaluate(async (model) => {
      const q = window.checkedQA;
      const chat = new q.AiChat({ ...q.chatRuntimeOptions, modelId: model.id });
      window.qaChat = chat;
      const result = { id: model.id };
      let at = performance.now();
      try {
        await chat.load();
        result.loadMs = performance.now() - at;
        const previews = [];
        let finals = 0;
        at = performance.now();
        result.answer = await chat.generate(
          'Write a detailed friendly story of at least twelve paragraphs about a gardener who teaches children to plant flowers. Start the story immediately. Use complete sentences. Do not use a list.',
          {
            delivery: 'checked-stream',
            maxOutputTokens: model.reasoning === 'required' ? 1536 : 768,
            onPreview: (text) => {
              if (text) previews.push({ ms: performance.now() - at, length: text.length });
            },
            onUpdate: () => finals++,
          },
        );
        result.totalMs = performance.now() - at;
        result.previews = previews;
        result.finalCallbacks = finals;
        result.previewBeforeFinal = previews.length > 0 && previews[0].ms < result.totalMs;
        await chat.reset();
        if (model.primary) {
          chat.setSystemPromptOptions({
            extraRules:
              'Answer in one or two short conversational sentences, suitable for reading aloud.',
          });
          at = performance.now();
          let previewCount = 0;
          result.spokenAnswer = await chat.generate('Why do flowers need sunlight?', {
            delivery: 'complete',
            maxOutputTokens: model.reasoning === 'required' ? 1024 : 192,
            onPreview: () => previewCount++,
          });
          result.spokenGenerationMs = performance.now() - at;
          result.spokenPreviews = previewCount;
          const runtime = q.createSpeechRuntime();
          try {
            await runtime.load('kokoro');
            const output = await runtime.synthesize(result.spokenAnswer.slice(0, 500));
            const samples = output.chunks.flatMap((x) => Array.from(x));
            result.spokenAudio = {
              seconds: samples.length / output.sampleRate,
              peak: Math.max(...samples.map(Math.abs).slice(0, 100000)),
              finite: samples.every(Number.isFinite),
            };
          } finally {
            runtime.dispose();
          }
        }
      } catch (e) {
        result.error = e.message;
      } finally {
        await chat.dispose();
        await q.clearChatCaches([model.id]);
      }
      return result;
    }, model);
    report.models.push(result);
    await save();
    console.log(
      JSON.stringify({
        id: result.id,
        error: result.error,
        preview: result.previewBeforeFinal,
        first: result.previews?.[0],
        totalMs: result.totalMs,
        audio: result.spokenAudio,
      }),
    );
  }
  await page.evaluate(() => {
    window.voiceRuntime = window.checkedQA.createSpeechRuntime();
  });
  const voices = await page.evaluate(() => window.checkedQA.KOKORO_VOICES.map((v) => v.id));
  for (const id of voices) {
    const result = await page.evaluate(async (id) => {
      const at = performance.now();
      try {
        await window.voiceRuntime.load('kokoro', { voiceId: id });
        const loaded = performance.now();
        const output = await window.voiceRuntime.synthesize(
          'Hello. This is a private voice test. Flowers grow in the garden.',
          { voiceId: id },
        );
        window.output = output;
        let energy = 0,
          peak = 0,
          n = 0,
          finite = true;
        for (const chunk of output.chunks)
          for (const x of chunk) {
            energy += x * x;
            peak = Math.max(peak, Math.abs(x));
            finite &&= Number.isFinite(x);
            n++;
          }
        return {
          id,
          loadMs: loaded - at,
          synthesisMs: performance.now() - loaded,
          seconds: n / output.sampleRate,
          rms: Math.sqrt(energy / n),
          peak,
          finite,
        };
      } catch (e) {
        return { id, error: e.message };
      }
    }, id);
    report.voices.push(result);
    await save();
    console.log('Voice', JSON.stringify(result));
    if (['af_heart', 'am_michael', 'bf_emma', 'bm_george'].includes(id)) {
      await page.locator('#play').click();
      await page.evaluate(() => window.playTask);
      result.playbackCompleted = true;
      const audio = await page.evaluate(() => {
        const n = window.output.chunks.reduce((s, c) => s + c.length, 0),
          buf = new ArrayBuffer(44 + n * 2),
          v = new DataView(buf);
        const str = (o, t) => {
          for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i));
        };
        str(0, 'RIFF');
        v.setUint32(4, 36 + n * 2, true);
        str(8, 'WAVEfmt ');
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true);
        v.setUint16(22, 1, true);
        v.setUint32(24, 24000, true);
        v.setUint32(28, 48000, true);
        v.setUint16(32, 2, true);
        v.setUint16(34, 16, true);
        str(36, 'data');
        v.setUint32(40, n * 2, true);
        let i = 44;
        for (const c of window.output.chunks)
          for (const x of c) {
            v.setInt16(i, Math.max(-1, Math.min(1, x)) * 32767, true);
            i += 2;
          }
        return Array.from(new Uint8Array(buf));
      });
      await fs.writeFile(`${root}/${id}.wav`, Buffer.from(audio));
      await save();
    }
  }
  await page.evaluate(() => window.voiceRuntime.dispose());
  // Fresh worker cache reuse with all model/voice networking blocked.
  await context.route(/\/(?:models\/|resolve\/)/, (route) => route.abort('internetdisconnected'));
  report.offline = await page.evaluate(async () => {
    const runtime = window.checkedQA.createSpeechRuntime();
    try {
      await runtime.load('kokoro', { voiceId: 'bf_emma' });
      const out = await runtime.synthesize('This voice works offline.', { voiceId: 'bf_emma' });
      return { voiceId: 'bf_emma', samples: out.chunks[0].length };
    } catch (e) {
      return { error: e.message };
    } finally {
      runtime.dispose();
    }
  });
  await context.unroute(/\/(?:models\/|resolve\/)/);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'system';
    button.textContent = 'Test local system voice';
    button.onclick = () => {
      const v = window.checkedQA.localEnglishVoices()[0];
      window.systemTask = v
        ? window.checkedQA
            .speakSystem(
              'This is a local system voice test.',
              v.voiceURI,
              new AbortController().signal,
            )
            .then(() => ({ name: v.name, completed: true }))
            .catch((e) => ({ error: e.message }))
        : Promise.resolve({ unavailable: true });
    };
    document.body.append(button);
  });
  await page.locator('#system').click();
  report.system = await page.evaluate(() => window.systemTask);
  await save();
} finally {
  await context.close();
}
if (
  report.models.some((r) => r.error || !r.previewBeforeFinal) ||
  report.voices.some((r) => r.error || !r.finite || r.rms < 0.001)
)
  process.exitCode = 1;
