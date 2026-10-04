import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('actual Chrome models take consecutive turns with cached offline audio and no uploads', async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.RUN_CONVERSATION_INFERENCE !== '1',
    'Explicit actual-model conversation acceptance',
  );
  const requests = [],
    violations = [];
  page.on('request', (request) =>
    requests.push({ url: request.url(), method: request.method(), data: request.postData() }),
  );
  await page.addInitScript(() => {
    window.outputPeak = 0;
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error('CSP violation: ' + e.violatedDirective),
    );
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args) {
        super(...args);
        window.inputQAContext ||= this;
      }
      createBufferSource() {
        const source = super.createBufferSource(),
          start = source.start.bind(source);
        source.start = (...args) => {
          if (this === window.inputQAContext) return start(...args);
          const analyser = this.createAnalyser();
          source.connect(analyser);
          const pcm = new Float32Array(analyser.fftSize);
          const timer = setInterval(() => {
            analyser.getFloatTimeDomainData(pcm);
            for (const sample of pcm)
              window.outputPeak = Math.max(window.outputPeak, Math.abs(sample));
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
  page.on('console', (m) => {
    if (m.text().startsWith('CSP violation:')) violations.push(m.text());
    if (m.type() === 'error') console.log(m.text());
  });
  await page.goto('/demo/conversation-eval-harness.html');
  if (process.env.SPEECH_QA_PRODUCTION === '1')
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  const begin = Date.now();
  await page.getByRole('button', { name: 'Start real conversation evaluation' }).click();
  const ready = () =>
    page.waitForFunction(
      () => ['listening', 'paused'].includes(window.conversationEvaluation.loop.state.status),
      null,
      { timeout: 240000 },
    );
  await ready();
  const loadFailures = [];
  const firstState = await page.evaluate(() => window.conversationEvaluation.loop.state);
  if (
    firstState.status === 'paused' &&
    firstState.error.includes('LiteRT model download or stream failed')
  ) {
    loadFailures.push(firstState.error);
    console.log('Cold model stream failed; explicitly testing Resume recovery:', firstState.error);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await ready();
  }
  expect(await page.evaluate(() => window.conversationEvaluation.loop.state)).toMatchObject({
    status: 'listening',
    error: '',
  });
  const loadMs = Date.now() - begin;
  const reports = [];
  for (const [index, text] of [
    'Remember my favorite color is blue.',
    'What is my favorite color?',
    'Say goodbye in one short sentence.',
  ].entries()) {
    if (index === 1) await context.setOffline(true);
    await page.evaluate((text) => window.conversationEvaluation.feed(text), text);
    await expect
      .poll(() => page.evaluate(() => window.conversationEvaluation.loop.state.turns), {
        timeout: 150000,
      })
      .toBe(index + 1);
    await expect
      .poll(() => page.evaluate(() => window.conversationEvaluation.loop.state.status), {
        timeout: 10000,
      })
      .toBe('listening');
    reports.push(await page.evaluate(() => window.conversationEvaluation.report()));
    console.log(
      'Conversation turn:',
      JSON.stringify({
        turns: reports.at(-1).turns,
        measurements: reports.at(-1).state.measurements,
        captures: reports.at(-1).captures,
      }),
    );
  }
  expect(reports[1].turns[1].answer.toLowerCase()).toContain('blue');
  expect(reports[2].captures).toBe(4);
  expect(reports[2].liveTracks).toBe(1);
  expect(reports[2].peaks.every((p) => p.peak > 0.01 && p.microphoneOff)).toBe(true);
  expect(
    reports[2].phases
      .filter((p) => ['transcribing', 'thinking', 'preparing-audio', 'speaking'].includes(p.status))
      .every((p) => p.liveTracks === 0),
  ).toBe(true);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(await page.evaluate(() => window.conversationEvaluation.report().liveTracks)).toBe(0);
  // A new VAD worker must reload cached weights. Keep local executable assets
  // reachable while blocking every model weight URL, including the VAD mirror.
  await context.setOffline(false);
  await context.route(/\/(?:models\/|resolve\/)|raw\.githubusercontent\.com/, (route) =>
    route.abort('internetdisconnected'),
  );
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.conversationEvaluation.loop.state.status), {
      timeout: 20000,
    })
    .toBe('listening');
  expect(await page.evaluate(() => window.conversationEvaluation.loop.state.turns)).toBe(3);
  await page.getByRole('button', { name: 'End', exact: true }).click();
  const ended = await page.evaluate(() => window.conversationEvaluation.report());
  expect(ended.liveTracks).toBe(0);
  expect(violations).toEqual([]);
  expect(requests.filter((r) => !['GET', 'HEAD'].includes(r.method) || r.data)).toEqual([]);
  expect(
    requests
      .filter((r) => /\.(?:m?js|wasm)(?:$|[?#])/.test(r.url))
      .every((r) => r.url.startsWith(new URL(page.url()).origin + '/')),
  ).toBe(true);
  const report = {
    loadMs,
    loadFailures,
    reports,
    ended,
    outputPeak: await page.evaluate(() => window.outputPeak),
    violations,
    uploadRequests: 0,
    memoryScope:
      'Main-thread heap only, excludes WASM workers and GPU allocations; measurements are observations, not full memory certification.',
  };
  expect(report.outputPeak).toBeGreaterThan(0.01);
  await writeFile(
    info.outputPath('conversation-measurements.json'),
    JSON.stringify(report, null, 2),
  );
  await page.evaluate(() => window.conversationEvaluation.dispose());
});

test('actual Silero rejects silence/noise, detects speech and reloads cached weights offline', async ({
  page,
  context,
}, info) => {
  test.skip(process.env.RUN_CONVERSATION_INFERENCE !== '1', 'Explicit actual-model VAD acceptance');
  await page.goto('/demo/speech-eval-harness.html');
  const report = await page.evaluate(async () => {
    const runtime = window.speechEvaluation.runtime;
    await runtime.load('vad');
    await runtime.load('kokoro');
    const run = async (frames) => {
      await runtime.resetVad();
      const endpoint = window.speechEvaluation.createEndpoint();
      let peak = 0,
        accepted = 0;
      for (const frame of frames) {
        const p = await runtime.detectSpeech(frame.slice());
        peak = Math.max(peak, p);
        const result = endpoint.push(p, frame);
        if (result?.audio) accepted++;
      }
      return { peak, accepted };
    };
    const silence = Array.from({ length: 50 }, () => new Float32Array(512));
    const noise = Array.from({ length: 100 }, () =>
      Float32Array.from({ length: 512 }, () => (Math.random() - 0.5) * 0.02),
    );
    const output = await runtime.synthesize('Hello world. This is a private speech test.');
    const resampler = window.speechEvaluation.createResampler(output.sampleRate),
      speechFrames = [];
    for (const chunk of output.chunks) speechFrames.push(...resampler.push(chunk));
    speechFrames.push(...silence);
    return {
      silence: await run(silence),
      noise: await run([...noise, ...silence]),
      speech: await run(speechFrames),
    };
  });
  expect(report.silence.peak).toBeLessThan(0.35);
  expect(report.silence.accepted).toBe(0);
  expect(report.noise.accepted).toBe(0);
  expect(report.speech.peak).toBeGreaterThan(0.5);
  expect(report.speech.accepted).toBe(1);
  await page.evaluate(() => window.speechEvaluation.runtime.dispose());
  await context.route(/\/(?:models\/|resolve\/)|raw\.githubusercontent\.com/, (route) =>
    route.abort('internetdisconnected'),
  );
  await page.evaluate(async () => {
    const runtime = window.speechEvaluation.runtime;
    await runtime.load('vad');
    await runtime.resetVad();
  });
  await writeFile(info.outputPath('vad-measurements.json'), JSON.stringify(report, null, 2));
  await page.evaluate(() => window.speechEvaluation.runtime.dispose());
});
