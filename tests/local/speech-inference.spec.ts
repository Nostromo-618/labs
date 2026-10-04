import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('neural session produces non-silent Web Audio after inference from a real click', async ({
  page,
}, info) => {
  test.skip(process.env.RUN_SPEECH_INFERENCE !== '1', 'Explicit local speech model QA only.');
  await page.addInitScript(() => {
    window.audioQA = { contexts: [], buffers: [], peak: 0 };
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args) {
        super(...args);
        window.audioQA.contexts.push(this);
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args) => {
          const pcm = source.buffer.getChannelData(0);
          let peak = 0;
          for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
          window.audioQA.buffers.push({ peak, length: pcm.length, state: this.state });
          const analyser = this.createAnalyser();
          source.connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          const timer = setInterval(() => {
            analyser.getFloatTimeDomainData(samples);
            for (const sample of samples)
              window.audioQA.peak = Math.max(window.audioQA.peak, Math.abs(sample));
          }, 20);
          source.addEventListener(
            'ended',
            () => {
              clearInterval(timer);
              analyser.disconnect();
            },
            { once: true },
          );
          return start(...args);
        };
        return source;
      }
    };
  });
  await page.goto('/demo/speech-eval-harness.html');
  await page.evaluate(async () => {
    const session = window.speechEvaluation.createSession({
      onChange: (state) => {
        window.neuralState = state;
      },
    });
    window.neuralSession = session;
    await session.load('kokoro');
    const button = document.createElement('button');
    button.textContent = 'Read neural reply through session';
    button.onclick = () => {
      window.neuralDone = session.speak('Hello world. This is a private speech test.', {
        provider: 'neural',
      });
    };
    document.body.append(button);
  });
  await page.getByRole('button', { name: 'Read neural reply through session' }).click();
  await page.evaluate(() => window.neuralDone);
  const audio = await page.evaluate(() => ({
    buffers: window.audioQA.buffers,
    peak: window.audioQA.peak,
    state: window.neuralState,
  }));
  console.log('Neural session output:', JSON.stringify(audio));
  expect(audio.state.error).toBe('');
  expect(audio.buffers.length).toBeGreaterThan(0);
  expect(
    audio.buffers
      .filter((buffer) => buffer.length > 1)
      .every((buffer) => buffer.peak > 0.01 && buffer.state === 'running'),
  ).toBe(true);
  expect(audio.peak).toBeGreaterThan(0.01);
  await writeFile(info.outputPath('neural-output.json'), JSON.stringify(audio, null, 2));
  await page.evaluate(() => window.neuralSession.dispose());
});

test('real speech models round-trip, cache offline, and avoid audio/text uploads', async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.RUN_SPEECH_INFERENCE !== '1',
    'Explicit local speech model QA only. Run pnpm speech:fetch first.',
  );
  const requests = [];
  const violations = [];
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (event) =>
      console.error('CSP violation: ' + event.violatedDirective + ' ' + event.blockedURI),
    ),
  );
  page.on('request', (request) =>
    requests.push({ url: request.url(), method: request.method(), data: request.postData() }),
  );
  page.on('console', (message) => {
    if (message.text().startsWith('CSP violation:')) violations.push(message.text());
    if (message.type() === 'error') console.log(message.text());
  });
  await page.goto('/demo/speech-eval-harness.html');
  if (process.env.SPEECH_QA_PRODUCTION === '1')
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  if (process.env.RUN_SPEECH_CHAT === '1') await page.locator('#with-chat').check();
  if (process.env.RUN_SPEECH_REMOTE === '1') await page.locator('#remote').check();
  const report = await page.evaluate(() => window.speechEvaluation.run());
  console.log('Cold speech result:', JSON.stringify(report));
  expect(report.transcript.toLowerCase()).toContain('private speech test');
  expect(report.audioSeconds).toBeGreaterThan(1);
  expect(report.silence).toBe('');
  await page.evaluate(() => {
    const output = window.speechEvaluation.output;
    output.chunks = [...output.chunks, ...output.chunks];
  });
  await page.getByRole('button', { name: 'Play synthesized test phrase' }).click();
  await expect(page.locator('#status')).toHaveText('Playback completed', { timeout: 15_000 });
  const playback = await page.evaluate(() => window.speechEvaluation.playback);
  expect(playback.chunks).toHaveLength(2);
  expect(playback.chunks[1].startedMs - playback.chunks[0].finishedMs).toBeLessThan(100);
  await context.setOffline(true);
  const warm = await page.evaluate(() => window.speechEvaluation.run());
  expect(warm.transcript).toBe(report.transcript);
  await context.setOffline(false);
  // Chat's independent cache lifecycle is covered by its own evaluation suite.
  // This fresh-worker check blocks only speech downloads.
  await page.locator('#with-chat').uncheck();
  await page.evaluate(() => window.speechEvaluation.stop());
  // Keep the page's JS/WASM available; disable all model asset networking.
  // Browsers still need executable chunks when new module workers are created.
  await context.route(/\/(?:models\/|resolve\/)/, (route) => route.abort('internetdisconnected'));
  const offline = await page.evaluate(() => window.speechEvaluation.run());
  console.log('Cached speech result:', JSON.stringify(offline));
  expect(offline.transcript).toBe(report.transcript);
  expect(
    requests.filter((request) => !['GET', 'HEAD'].includes(request.method) || request.data),
  ).toEqual([]);
  expect(violations).toEqual([]);
  expect(
    requests
      .filter((request) => /huggingface\.co\/onnx-community\/(?:whisper|Kokoro)/.test(request.url))
      .every((request) => !request.url.includes('/resolve/main/')),
  ).toBe(true);
  expect(
    requests
      .filter((request) => /\.(?:m?js|wasm)(?:$|[?#])/.test(request.url))
      .every((request) => request.url.startsWith(new URL(page.url()).origin + '/')),
  ).toBe(true);
  const measurements = info.outputPath('speech-measurements.json');
  await writeFile(
    measurements,
    JSON.stringify(
      { cold: report, warmOffline: warm, reloadedAssetsOffline: offline, playback },
      null,
      2,
    ),
  );
  await info.attach('speech-measurements.json', {
    path: measurements,
    contentType: 'application/json',
  });
  await context.setOffline(false);
  await page.evaluate(() => window.speechEvaluation.stop());
});

test('real microphone worklet resamples mono PCM and releases capture', async ({ page }) => {
  test.skip(process.env.RUN_SPEECH_INFERENCE !== '1', 'Explicit local speech QA only.');
  await page.goto('/demo/speech-eval-harness.html');
  await page.evaluate(() => {
    window.speechTracks = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await original(options);
      window.speechTracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.getByRole('button', { name: 'Record microphone (3 seconds)' }).click();
  await expect(page.locator('#status')).toHaveText('Microphone released', { timeout: 10_000 });
  const result = await page.evaluate(() => ({
    audio: JSON.parse(document.getElementById('results').textContent),
    stopped: window.speechTracks.every((track) => track.readyState === 'ended'),
  }));
  expect(result.audio.seconds).toBeGreaterThan(2.5);
  expect(result.audio.seconds).toBeLessThan(3.5);
  expect(result.audio.framesAt16kHz).toBeGreaterThan(40000);
  expect(result.stopped).toBe(true);
});
