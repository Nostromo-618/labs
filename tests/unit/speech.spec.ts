import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/chat-vue-harness.html');
});

test('narration omits code, citations, URLs and markup; bounded splitters always preserve content', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { speechText, splitSpeechText, splitSpeechTokens, localEnglishVoices } =
      await import('/src/lib/speech/text.js');
    const text =
      '## Answer\nRead [the guide](https://example.com). [1] [source:a]\n```js\nsecretCode()\n```\nVisit https://example.com/raw and `inlineCode`.\n';
    const problematic = ('Hello @handle\n https://example.com/path\n ' + 'a'.repeat(1000)).repeat(
      30,
    );
    const chunks = splitSpeechText(problematic);
    const tokens = Array.from({ length: 5000 }, (_, i) => BigInt(i));
    const parts = splitSpeechTokens(tokens, 16n);
    return {
      text: speechText(text),
      lengths: chunks.map((c) => c.length),
      normalized: chunks.join('').replace(/\s/g, '') === problematic.replace(/\s/g, ''),
      tokenLengths: parts.map((p) => p.length),
      preserved:
        parts.flat().every((token, i) => token === tokens[i]) &&
        parts.flat().length === tokens.length,
      voices: localEnglishVoices({
        getVoices: () => [
          { name: 'remote', lang: 'en', localService: false },
          { name: 'local', lang: 'en-US', localService: true },
          { name: 'French', lang: 'fr', localService: true },
        ],
      }).map((v) => v.name),
      unclosed: speechText('Hello\n```js\nnot spoken'),
    };
  });
  expect(result.text).toBe('Answer Read the guide. Visit and .');
  expect(result.normalized).toBe(true);
  expect(Math.max(...result.lengths)).toBeLessThanOrEqual(300);
  expect(Math.max(...result.tokenLengths)).toBeLessThanOrEqual(508);
  expect(result.preserved).toBe(true);
  expect(result.voices).toEqual(['local']);
  expect(result.unclosed).toBe('Hello');
});

test('missing local English voices explains optional neural download without loading it', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [
          { localService: false, lang: 'en-US' },
          { localService: true, lang: 'fr-FR' },
        ],
        addEventListener() {},
        removeEventListener() {},
      },
    }),
  );
  await page.reload();
  await page.getByText('Voice settings', { exact: true }).click();
  await expect(page.getByText(/No local English voice is installed/)).toBeVisible();
  const error = await page.evaluate(async () => {
    const { speakSystem } = await import('/src/lib/speech/audio.js');
    return speakSystem('Hello', '', new AbortController().signal).catch(
      (failure) => failure.message,
    );
  });
  expect(error).toContain('Choose and load Neural voice');
  await page.getByLabel('Read-aloud voice').selectOption('neural');
  await expect(page.getByRole('button', { name: 'Load Neural voice', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.speechQA.loads)).toEqual([]);
});

test('neural voice test distinguishes audio preparation from playback', async ({ page }) => {
  await page.getByText('Voice settings', { exact: true }).click();
  await page.getByLabel('Read-aloud voice').selectOption('neural');
  await expect(page.getByRole('button', { name: 'Test Neural voice', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load Neural voice', exact: true }).click();
  await page.evaluate(() => {
    window.speechQA.holdNeural = true;
  });
  await page.getByRole('button', { name: 'Test Neural voice', exact: true }).click();
  await expect(
    page.getByText('Preparing neural audio on this device…', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.speechQA.spoken)).toEqual([
    'This is the local neural voice.',
  ]);
  await page.evaluate(() => window.speechQA.finish());
  await expect(page.getByRole('button', { name: 'Test Neural voice', exact: true })).toBeEnabled();
  await expect(page.getByText(/If playback finishes silently/)).toBeVisible();
});

test('PCM player resumes after inference, rejects silent audio, and releases blocked/interrupted playback', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createPCMPlayer } = await import('/src/lib/speech/audio.js');
    const original = window.AudioContext;
    const contexts = [];
    class FakeContext extends EventTarget {
      state = 'suspended';
      sampleRate = 48000;
      destination = {};
      resumes = 0;
      closes = 0;
      blocked = false;
      interrupt = false;
      sources = [];
      constructor() {
        super();
        contexts.push(this);
      }
      resume() {
        this.resumes++;
        if (this.blocked) return new Promise(() => {});
        this.state = 'running';
        return Promise.resolve();
      }
      close() {
        this.closes++;
        this.state = 'closed';
        return Promise.resolve();
      }
      createBuffer(_channels, length) {
        return { length, copyToChannel() {} };
      }
      createBufferSource() {
        const context = this;
        const node = {
          connect() {},
          disconnect() {},
          stop() {},
          start() {
            context.sources.push(node.buffer.length);
            if (node.buffer.length === 1) return;
            if (context.interrupt) {
              context.state = 'interrupted';
              context.dispatchEvent(new Event('statechange'));
            } else queueMicrotask(() => node.onended?.());
          },
        };
        return node;
      }
    }
    window.AudioContext = FakeContext;
    const pcm = new Float32Array([0.1, -0.1]);
    try {
      const controller = new AbortController();
      const player = createPCMPlayer(controller.signal);
      contexts[0].state = 'suspended'; // Browser suspension during model inference.
      let started = false;
      await player.play(pcm, 24000, {
        onStart: () => {
          started = true;
        },
      });
      const silent = await player.play(new Float32Array(10), 24000).catch((error) => error.message);
      const invalid = await player
        .play(new Float32Array([NaN]), 24000)
        .catch((error) => error.message);
      contexts[0].interrupt = true;
      const interrupted = await player.play(pcm, 24000).catch((error) => error.message);
      player.cancel();
      const blockedController = new AbortController();
      const blocked = createPCMPlayer(blockedController.signal);
      contexts[1].state = 'suspended';
      contexts[1].blocked = true;
      const pending = blocked.play(pcm, 24000).catch((error) => error.name);
      blockedController.abort();
      const canceled = await pending;
      const timed = createPCMPlayer(new AbortController().signal);
      contexts[2].state = 'suspended';
      contexts[2].blocked = true;
      const timeout = await timed.play(pcm, 24000).catch((error) => error.message);
      timed.cancel();
      return {
        started,
        silent,
        invalid,
        interrupted,
        canceled,
        timeout,
        resumes: contexts[0].resumes,
        sources: contexts[0].sources,
        closes: contexts.map((context) => context.closes),
      };
    } finally {
      window.AudioContext = original;
    }
  });
  expect(result.started).toBe(true);
  expect(result.resumes).toBe(2);
  expect(result.sources).toEqual([1, 2, 2]);
  expect(result.silent).toContain('silent audio');
  expect(result.invalid).toContain('invalid audio');
  expect(result.interrupted).toContain('interrupted');
  expect(result.canceled).toBe('AbortError');
  expect(result.timeout).toContain('site Sound setting');
  expect(result.closes).toEqual([1, 1, 1]);
});

test('denied and full storage are best effort; clearing targets only speech caches', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { openSpeechCache, clearSpeechCaches } = await import('/src/lib/speech/assets.js');
    const denied = await openSpeechCache('test', {
      open() {
        throw new Error('denied');
      },
    });
    const full = await openSpeechCache('test', {
      async open() {
        return {
          match() {
            throw new Error('denied');
          },
          put() {
            throw new Error('full');
          },
        };
      },
    });
    await full.put('file', new Response('x'));
    const deleted = [];
    await clearSpeechCaches({
      async delete(name) {
        deleted.push(name);
        return true;
      },
    });
    return {
      available: denied.available,
      match: (await full.match('file')) === undefined,
      deleted,
    };
  });
  expect(result).toEqual({
    available: false,
    match: true,
    deleted: ['vwl-speech-whisper-v1', 'vwl-speech-kokoro-v1', 'vwl-speech-vad-v1'],
  });
});

test('worker cancellation rejects pending calls, ignores late messages and recreates lazily', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createSpeechRuntime } = await import('/src/lib/speech/runtime.js');
    const workers = [];
    const runtime = createSpeechRuntime({
      createWorker: () => {
        const worker = {
          messages: [],
          terminated: false,
          postMessage(data) {
            this.messages.push(data);
          },
          terminate() {
            this.terminated = true;
          },
        };
        workers.push(worker);
        return worker;
      },
    });
    const controller = new AbortController();
    const pending = runtime
      .load('whisper', { signal: controller.signal })
      .catch((error) => error.name);
    controller.abort();
    const canceled = await pending;
    const again = runtime.load('whisper');
    const id = workers[1].messages[0].id;
    workers[0].onmessage({ data: { id: 1, type: 'result', value: true } });
    workers[0].onerror({ message: 'Late error from terminated worker' });
    workers[1].onmessage({ data: { id, type: 'result', value: {} } });
    await again;
    const loaded = runtime.isLoaded('whisper');
    runtime.dispose();
    return {
      canceled,
      loaded,
      terminated: workers.every((worker) => worker.terminated),
      count: workers.length,
    };
  });
  expect(result).toEqual({ canceled: 'AbortError', loaded: true, terminated: true, count: 2 });
});

test('recording interrupts playback and stale recording failure cannot release a new microphone', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { SpeechSession } = await import('/src/lib/speech/session.js');
    let failStop,
      canceled = 0,
      calls = 0,
      playbackStopped = false;
    const session = new SpeechSession({
      runtime: { isLoaded: () => true, cancel() {}, dispose() {} },
      systemSpeaker: (_text, _voice, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => {
            playbackStopped = true;
            reject(new DOMException('', 'AbortError'));
          }),
        ),
      recorderFactory: async () =>
        ++calls === 1
          ? {
              stop: () =>
                new Promise((_resolve, reject) => {
                  failStop = reject;
                }),
              cancel() {},
            }
          : {
              cancel() {
                canceled++;
              },
            },
    });
    const playback = session.speak('Hello');
    await session.record();
    await playback;
    const old = session.finishRecording();
    session.cancel();
    await session.record();
    failStop(new Error('Old recording failed'));
    await old;
    const status = session.state.status;
    session.dispose();
    return { playbackStopped, status, canceled };
  });
  expect(result).toEqual({ playbackStopped: true, status: 'recording', canceled: 1 });
});

test('General read-aloud uses the final answer and reset/navigation release speech', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('VdDock placement');
  await input.press('Enter');
  await expect(page.locator('.vwl-ai-messages')).toContainText('Answer: VdDock placement');
  await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
  expect(await page.evaluate(() => window.speechQA.spoken)).toEqual(['Answer: VdDock placement']);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('button', { name: 'Stop reading', exact: true })).toHaveCount(0);
  await input.fill('hold');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Read aloud', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.chatQA.unmount());
  expect(await page.evaluate(() => window.speechQA.cancels)).toBeGreaterThan(0);
});

test('speech download cancellation ignores late progress and completion after navigation', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { SpeechSession } = await import('/src/lib/speech/session.js');
    let complete, progress;
    const session = new SpeechSession({
      runtime: {
        isLoaded: () => false,
        load: (_kind, options) =>
          new Promise((resolve) => {
            complete = resolve;
            progress = options.onProgress;
          }),
        cancel() {},
        dispose() {},
      },
    });
    const load = session.load('kokoro');
    session.dispose();
    progress({ text: 'Stale progress', percent: 99 });
    complete({ cacheAvailable: true });
    await load;
    return {
      status: session.state.status,
      progress: session.state.progress,
      ready: session.state.kokoroReady,
    };
  });
  expect(result).toEqual({ status: 'idle', progress: '', ready: false });
});

test('recording worklet mixes stereo into mono and caps PCM at exactly sixty seconds', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    let Processor,
      frames = 0,
      limits = 0,
      mixed = true;
    window.sampleRate = 48000;
    window.AudioWorkletProcessor = class {
      port = {
        postMessage(data) {
          if (data.type === 'pcm') {
            frames += data.pcm.length;
            mixed &&= data.pcm.every((sample) => sample === 0.5);
          }
          if (data.type === 'limit') limits++;
        },
      };
    };
    window.registerProcessor = (_name, constructor) => {
      Processor = constructor;
    };
    await import('/src/workers/speech-recorder-worklet.js');
    const processor = new Processor();
    const inputs = [[new Float32Array(128).fill(0.25), new Float32Array(128).fill(0.75)]];
    for (let i = 0; i < (48000 * 65) / 128; i++) processor.process(inputs);
    return { frames, limits, mixed, stopped: processor.stopped };
  });
  expect(result).toEqual({ frames: 48000 * 60, limits: 1, mixed: true, stopped: true });
});

test('recording limit stops once and stale microphone permission completion is released', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { SpeechSession } = await import('/src/lib/speech/session.js');
    let limit,
      grant,
      stopped = 0,
      released = 0;
    const transcripts = [];
    const runtime = {
      isLoaded: () => true,
      async transcribe() {
        return 'limit transcript';
      },
      cancel() {},
      dispose() {},
    };
    const session = new SpeechSession({
      runtime,
      onTranscript: (text) => transcripts.push(text),
      recorderFactory: async ({ onLimit }) => {
        limit = onLimit;
        return {
          async stop() {
            stopped++;
            return new Float32Array(100);
          },
          cancel() {},
        };
      },
    });
    await session.record();
    limit();
    limit();
    await new Promise((resolve) => setTimeout(resolve, 5));
    session.dispose();
    const late = new SpeechSession({
      runtime,
      recorderFactory: () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    });
    const pending = late.record();
    late.dispose();
    grant({
      cancel() {
        released++;
      },
    });
    await pending;
    return { stopped, released, transcripts, status: late.state.status };
  });
  expect(result).toEqual({
    stopped: 1,
    released: 1,
    transcripts: ['limit transcript'],
    status: 'idle',
  });
});

test('dictation appends editable text, preserves overflow, and never sends automatically', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('existing draft');
  await page.getByRole('button', { name: 'Enable dictation (44 MB)' }).click();
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await page.getByRole('button', { name: /Stop recording/ }).click();
  await expect(input).toHaveValue('existing draft dictated text');
  expect(await page.evaluate(() => window.chatQA.calls.length)).toBe(0);
  await page.evaluate(() => (window.speechQA.transcript = 'x'.repeat(2100)));
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await page.getByRole('button', { name: /Stop recording/ }).click();
  await expect(input).toHaveValue('existing draft dictated text ' + 'x'.repeat(2100));
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await input.press('Enter');
  expect(await page.evaluate(() => window.chatQA.calls.length)).toBe(0);
  await input.fill('edited');
  await input.press('Enter');
  await expect(page.locator('[data-role="assistant"]')).toContainText('Answer: edited');
});

test('permission denial and silence preserve drafts; reset invalidates late transcription', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('keep this');
  await page.getByRole('button', { name: 'Enable dictation (44 MB)' }).click();
  await page.evaluate(() => (window.speechQA.denied = true));
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('permission denied');
  await expect(input).toHaveValue('keep this');
  await page.evaluate(() => {
    window.speechQA.denied = false;
    window.speechQA.transcript = '';
  });
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await page.getByRole('button', { name: /Stop recording/ }).click();
  await expect(page.getByRole('alert')).toContainText('No speech detected');
  await page.evaluate(() => {
    window.speechQA.hold = true;
    window.speechQA.transcript = 'late';
  });
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await page.getByRole('button', { name: /Stop recording/ }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.evaluate(() => window.speechQA.finish());
  await expect(input).toHaveValue('keep this');
});

test('completed replies support manual playback, stop, sending interruption and explicit neural loading', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('hello');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop reading', exact: true })).toBeVisible();
  await input.fill('next');
  await input.press('Enter');
  await expect(page.locator('[data-role="assistant"]').last()).toContainText('Answer: next');
  await expect(page.getByRole('button', { name: 'Stop reading', exact: true })).toHaveCount(0);
  await page.getByText('Voice settings', { exact: true }).click();
  await page.getByLabel('Read-aloud voice').selectOption('neural');
  expect(await page.evaluate(() => window.speechQA.loads)).toEqual([]);
  await page.getByRole('button', { name: 'Load Neural voice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Neural voice ready' })).toBeDisabled();
  await page.getByRole('button', { name: 'Read aloud', exact: true }).last().click();
  await expect
    .poll(() => page.evaluate(() => window.speechQA.spoken))
    .toEqual(['Answer: hello', 'Answer: next']);
});
