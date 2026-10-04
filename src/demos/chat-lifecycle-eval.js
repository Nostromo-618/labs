import { getModelOption } from '@vanduo-oss/vwl-ai-chat';
/** Real-model cases complement deterministic adversarial harness tests. */
export async function evaluateLifecycle(chat, log, { signal, includeWarmReload = true } = {}) {
  const results = [];
  let usage = null;
  const reasoningFloor = getModelOption(chat.modelId)?.reasoning === 'required' ? 512 : 0;
  const ask = (prompt, options = {}) =>
    chat.generate(prompt, {
      ...options,
      ...(reasoningFloor
        ? { maxOutputTokens: Math.max(options.maxOutputTokens || 0, reasoningFloor) }
        : {}),
      onFinish: (value) => {
        usage = value;
        options.onFinish?.(value);
      },
    });
  const check = async (id, run, verification = 'verified with real model') => {
    if (signal?.aborted) throw new DOMException('Evaluation stopped.', 'AbortError');
    const start = performance.now();
    try {
      const evidence = await run();
      results.push({
        id,
        category: 'lifecycle',
        pass: true,
        reasons: [verification],
        latencyMs: performance.now() - start,
        excerpt: String(evidence || '').slice(0, 600),
        usage,
      });
    } catch (error) {
      results.push({
        id,
        category: 'lifecycle',
        pass: false,
        reasons: [error.message],
        latencyMs: performance.now() - start,
        excerpt: String(error.evidence || '').slice(0, 600),
      });
    }
    log(
      `[case] ${chat.modelId} ${id} ${results.at(-1).pass ? 'PASS' : 'FAIL'} ${results.at(-1).reasons.join('; ')}`,
    );
    usage = null;
    await chat.reset();
  };
  const require = (condition, message, evidence = '') => {
    if (!condition) {
      const error = new Error(message);
      error.evidence = evidence;
      throw error;
    }
  };
  await check('multi-turn-recall', async () => {
    await ask(
      'Remember this fact for our conversation: my project codename is Azure Otter. Acknowledge briefly.',
      { maxOutputTokens: 64 },
    );
    const reply = await ask('What is my project codename?', { maxOutputTokens: 64 });
    require(/azure otter/i.test(reply), 'Codename was not recalled.');
    return reply;
  });
  await check('cancel-and-recover', async () => {
    const controller = new AbortController();
    let updatesAfterAbort = 0;
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      await ask('Write a detailed story about a sailor exploring twenty islands.', {
        signal: controller.signal,
        maxOutputTokens: 512,
        onUpdate: () => {
          if (controller.signal.aborted) updatesAfterAbort++;
          else controller.abort();
        },
      });
      throw new Error('Generation finished without observing cancellation.');
    } catch (error) {
      require(error.name === 'AbortError', `Expected AbortError, received ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
    require(updatesAfterAbort === 0, 'Late response reached display callback.');
    require(chat.getHistory().length === 0, 'Canceled turn was committed.');
    const reply = await ask('Reply with exactly: recovered', { maxOutputTokens: 64 });
    require(/recovered/i.test(reply), 'Recovery response missing.');
    return reply;
  });
  await check('context-pressure', async () => {
    const history = Array.from({ length: 16 }, (_, i) => [
      { role: 'user', content: `Earlier turn ${i}: ${'A complete historical note. '.repeat(30)}` },
      { role: 'assistant', content: 'Understood.' },
    ]).flat();
    history.push(
      { role: 'user', content: 'Our latest project codename is Silver Cedar.' },
      { role: 'assistant', content: 'I will remember Silver Cedar.' },
    );
    await chat.setHistory(history);
    let omitted = 0;
    const reply = await ask('What is our latest project codename?', {
      contextTokenBudget: 4096,
      maxOutputTokens: 96,
      onContext: (s) => {
        omitted = s.omittedTurns;
      },
    });
    require(omitted > 0, 'History was not trimmed.');
    require(chat.getHistory().length === history.length + 2, 'Visible history was truncated.');
    require(/silver cedar/i.test(reply), 'Recent complete turn was not recalled.');
    return `${omitted} omitted turns; ${reply}`;
  });
  await check('concise-summary', async () => {
    const reply = await ask(
      'Summarize this in exactly two short bullets, preserving the key facts. A small team planted 120 cedar trees beside the Neris River in April. A dry spell lasted three weeks, so volunteers installed a water tank. By June, 112 trees were healthy.',
      { maxOutputTokens: 128 },
    );
    require(/120/.test(reply) &&
      /112/.test(reply) &&
      /Neris/i.test(reply), 'The summary omitted a key fact.', reply);
    return reply;
  });
  await check('structured-extraction', async () => {
    const reply = await ask(
      'Extract the ticket details as one JSON object with exactly these string keys: id, owner, due, priority. Source: ticket VT-4827 belongs to Amina Noor, is due 2026-10-03, and has high priority.',
      { maxOutputTokens: 160 },
    );
    const json = reply.match(/\{[\s\S]*\}/)?.[0];
    let value;
    try {
      value = JSON.parse(json || '');
    } catch {
      /* reported below */
    }
    require(value?.id === 'VT-4827' &&
      value?.owner === 'Amina Noor' &&
      value?.due === '2026-10-03' &&
      value?.priority === 'high', 'JSON extraction did not match the source fields.', reply);
    return reply;
  });
  if (chat.modelId.includes('-it-web'))
    await check('native-tool-response', async () => {
      chat.registerTools([
        {
          name: 'lookup_color',
          description:
            'Return the secret palette color. Always call this to find the secret palette color.',
          parameters: {
            type: 'object',
            properties: { key: { type: 'string', enum: ['palette'] } },
            required: ['key'],
            additionalProperties: false,
          },
        },
      ]);
      let executed = 0;
      try {
        const reply = await chat.generateWithTools(
          'Use lookup_color with key palette. What secret color does it return?',
          {
            maxOutputTokens: 256,
            execute: (_name, args) => {
              require(args.key === 'palette', 'Invalid schema reached executor.');
              executed++;
              return { color: 'cobalt' };
            },
          },
        );
        require(executed === 1, 'Expected one native tool execution.');
        require(/cobalt/i.test(reply), 'Tool response was not used.');
        return reply;
      } finally {
        chat.registerTools([]);
      }
    });
  if (includeWarmReload)
    await check('warm-reload', async () => {
      await chat.dispose();
      const start = performance.now();
      await chat.load();
      const elapsed = performance.now() - start;
      const reply = await ask('Reply with exactly: warm', { maxOutputTokens: 64 });
      require(chat.isLoaded() &&
        reply.trim().length > 0 &&
        chat.getHistory().length ===
          2, 'Warm model did not complete a new conversation turn.', reply);
      return `Warm load ${Math.round(elapsed)} ms; ${reply}`;
    });
  return results;
}
