import { AiChat, getModelOption } from '@vanduo-oss/vdl-ai-chat';
import {
  scoreCase,
  summarizeModelResults,
  buildReportDocument,
  renderReportHtml,
} from '../../model-eval.js';
import { chatRuntimeOptions, clearChatCaches, getChatDeviceCapabilities } from './chat-runtime.js';
import { evaluateLifecycle } from '../demos/chat-lifecycle-eval.js';
import { CompareSession } from './compare-session.js';
import suite from '../../utils/model-eval-suite.json';
export { renderReportHtml };
const aborted = (signal) => {
  if (signal?.aborted) throw new DOMException('Evaluation stopped.', 'AbortError');
};
export async function runEvaluation({
  modelIds,
  scope = 'all',
  repetitions = 3,
  cold = false,
  signal,
  onProgress = () => {},
}) {
  const report = buildReportDocument({
    suiteName: suite.name,
    suiteVersion: suite.version,
    modelResults: [],
    startedAt: new Date().toISOString(),
  });
  const device = await getChatDeviceCapabilities();
  report.environment = {
    userAgent: navigator.userAgent,
    deviceMemoryGb: device.deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    physicalDevice: 'host browser; device model unavailable',
    webgpuSupported: device.webgpuSupported,
    shaderF16: device.shaderF16,
    layoutEmulation: false,
    deviceMemoryIsApproximate: true,
    measuredGpuMemory: null,
  };
  report.execution = 'isolated-serial';
  report.coldCacheRequested = cold;
  try {
    report.corpus = await (await fetch('/data/search-manifest.json')).json();
  } catch {
    report.corpus = null;
  }
  const publish = (message) => onProgress({ message, report: structuredClone(report) });
  try {
    if (cold) await clearChatCaches(modelIds);
    for (const modelId of modelIds) {
      aborted(signal);
      const option = getModelOption(modelId);
      if (!option) throw new Error(`Unknown model: ${modelId}`);
      const modelResult = {
        modelId,
        label: option.label,
        family: option.family,
        backend: option.backend,
        runtimeVersion: option.runtimeVersion,
        revision: option.revision,
        precision: option.precision,
        license: option.license,
        capabilities: option.capabilities,
        externalDataFiles: option.externalDataFiles || 1,
        contextWindowTokens: option.maxNumTokens ?? null,
        reasoningPolicy: option.reasoning || 'none',
        generalOutputTokenLimit: option.reasoning === 'required' ? 2048 : 512,
        lifecycleOutputTokenFloor: option.reasoning === 'required' ? 512 : null,
        downloadBytes: option.approxBytes,
        estimatedWorkingBytes: option.estimatedWorkingBytes ?? null,
        measuredPeakMemory: null,
        executionMode: 'isolated-serial',
        loadSource: null,
        cases: [],
        loads: [],
      };
      report.models.push(modelResult);
      const unavailable = !device.webgpuSupported
        ? 'WebGPU is unavailable in this browser.'
        : option.requires.includes('shader-f16') && !device.shaderF16
          ? 'This model precision requires the WebGPU shader-f16 feature.'
          : null;
      if (unavailable) {
        modelResult.status = 'skipped';
        modelResult.skipReason = unavailable;
        modelResult.cases.push({
          id: 'runtime-availability',
          status: 'skipped',
          reasons: [unavailable],
        });
        publish(`${option.label}: skipped — ${unavailable}`);
        continue;
      }
      for (let round = 0; round <= repetitions; round++) {
        aborted(signal);
        const chat = new AiChat({ modelId, ...chatRuntimeOptions });
        const cancel = () => chat.cancel();
        signal?.addEventListener('abort', cancel);
        let source = 'unknown',
          bytesLoadedObserved = null,
          bytesProgressEstimate = null;
        const off = chat.onProgress((p) => {
          source = p.source || source;
          if (Number.isFinite(p.loadedBytes))
            bytesLoadedObserved = Math.max(bytesLoadedObserved || 0, p.loadedBytes);
          else if (
            p.stage === 'downloading' &&
            Number.isFinite(p.loaded) &&
            p.loaded >= 0 &&
            p.loaded <= 1
          )
            bytesProgressEstimate = Math.max(
              bytesProgressEstimate || 0,
              Math.round(option.approxBytes * p.loaded),
            );
          publish(`${option.label}: ${p.message || p.text || 'Loading'}`);
        });
        try {
          const started = performance.now();
          await chat.load();
          aborted(signal);
          modelResult.loads.push({
            round,
            label: round === 0 ? (cold ? 'cold-requested' : 'initial') : 'warm',
            source,
            loadMs: performance.now() - started,
            bytesRequested: option.approxBytes,
            bytesLoadedObserved,
            bytesProgressEstimate,
          });
          modelResult.loadSource ??= source;
          if (round === 0) {
            if (scope !== 'docs')
              for (const test of suite.cases) {
                aborted(signal);
                await chat.reset();
                const start = performance.now();
                let firstAnswerMs = null,
                  reply = '',
                  usage,
                  error;
                try {
                  reply = await chat.generate(test.prompt, {
                    signal,
                    maxOutputTokens: option.reasoning === 'required' ? 2048 : 512,
                    onUpdate: () => {
                      firstAnswerMs ??= performance.now() - start;
                    },
                    onFinish: (value) => {
                      usage = value;
                    },
                  });
                } catch (e) {
                  if (signal?.aborted) throw e;
                  error = e.message;
                }
                const scored = error ? { pass: false, reasons: [error] } : scoreCase(test, reply);
                modelResult.cases.push({
                  id: test.id,
                  round,
                  category: test.category,
                  ...scored,
                  status: scored.pass ? 'passed' : 'failed',
                  firstAnswerMs,
                  latencyMs: performance.now() - start,
                  usage,
                  excerpt: reply || error,
                });
                publish(`${option.label}: ${test.id} ${scored.pass ? 'PASS' : 'FAIL'}`);
              }
            const lifecycle = await evaluateLifecycle(chat, publish, {
              signal,
              scope,
              includeWarmReload: false,
            });
            modelResult.cases.push(...lifecycle.map((c) => ({ ...c, round })));
            if (!option.capabilities?.tools)
              modelResult.cases.push({
                id: 'native-tool-response',
                round,
                status: 'skipped',
                reasons: [
                  'This integration supports General and Docs chat; tools are not enabled.',
                ],
              });
          } else {
            const start = performance.now();
            let firstAnswerMs = null,
              reply = '',
              usage,
              error;
            try {
              reply = await chat.generate('Reply with exactly: warm', {
                signal,
                maxOutputTokens: option.reasoning === 'required' ? 512 : 64,
                onUpdate: () => {
                  firstAnswerMs ??= performance.now() - start;
                },
                onFinish: (value) => {
                  usage = value;
                },
              });
            } catch (e) {
              if (signal?.aborted) throw e;
              error = e.message;
            }
            const pass = !error && /\bwarm\b/i.test(reply);
            modelResult.cases.push({
              id: 'warm-reload',
              round,
              category: 'lifecycle',
              pass,
              status: pass ? 'passed' : 'failed',
              reasons: error
                ? [error]
                : pass
                  ? ['Real model completed after warm reload.']
                  : ['Warm response missing.'],
              firstAnswerMs,
              latencyMs: performance.now() - start,
              usage,
              excerpt: reply || error,
            });
            publish(`${option.label}: warm-reload ${pass ? 'PASS' : 'FAIL'}`);
          }
        } catch (e) {
          modelResult.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          if (signal?.aborted) throw e;
          // A model which cannot load cannot have useful warm repetitions.
          if (!chat.isLoaded()) {
            modelResult.status = 'failed';
            modelResult.cases.push({
              id: 'model-load',
              round,
              category: 'availability',
              status: 'failed',
              pass: false,
              reasons: [modelResult.error],
              excerpt: modelResult.error,
            });
            break;
          }
        } finally {
          off();
          signal?.removeEventListener('abort', cancel);
          await chat.dispose();
        }
      }
      const scoredCases = modelResult.cases.filter((c) => c.status !== 'skipped');
      Object.assign(modelResult, summarizeModelResults({ ...modelResult }, scoredCases), {
        cases: modelResult.cases,
      });
      publish(`${option.label}: finished`);
    }
  } catch (e) {
    report.stopped = signal?.aborted || false;
    report.error = e.message;
  }
  report.finishedAt = new Date().toISOString();
  report.summary = {
    modelCount: report.models.length,
    passRates: Object.fromEntries(report.models.map((m) => [m.modelId, m.passRate ?? null])),
  };
  publish(report.stopped ? 'Stopped; partial results retained.' : 'Evaluation finished.');
  return report;
}
export async function runPairEvaluation({
  modelIds,
  signal,
  onProgress = () => {},
  createCompare = (options) => new CompareSession(options),
}) {
  if (modelIds.length !== 2) throw new Error('Select exactly two models for a pair stress test.');
  const device = await getChatDeviceCapabilities();
  const pairMetadata = {
    execution: 'concurrent',
    modelMetadata: modelIds.map((modelId) => {
      const option = getModelOption(modelId);
      return {
        modelId,
        revision: option?.revision || null,
        precision: option?.precision || null,
        runtimeVersion: option?.runtimeVersion || null,
        downloadBytes: option?.approxBytes || null,
        estimatedWorkingBytes: option?.estimatedWorkingBytes ?? null,
        contextWindowTokens: option?.maxNumTokens ?? null,
        reasoningPolicy: option?.reasoning || 'none',
      };
    }),
    environment: {
      userAgent: navigator.userAgent,
      deviceMemoryGb: device.deviceMemory ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency,
      webgpuSupported: device.webgpuSupported,
      shaderF16: device.shaderF16,
      layoutEmulation: false,
      measuredGpuMemory: null,
    },
  };
  let stopOnNextAOutput = false;
  let compare;
  let lastPaneStatus = '';
  compare = createCompare({
    modelA: modelIds[0],
    onChange: (state) => {
      const status = state.panes.map((p) => p.status).join(' / ');
      if (status !== lastPaneStatus) {
        lastPaneStatus = status;
        onProgress({ message: status });
      }
      const firstPaneTurn = state.panes[0].turns.at(-1);
      if (
        stopOnNextAOutput &&
        state.busy &&
        firstPaneTurn?.status === 'running' &&
        firstPaneTurn.response
      ) {
        stopOnNextAOutput = false;
        compare.stop(0);
      }
    },
  });
  compare.state.models[1] = modelIds[1];
  const stop = () => compare.stop();
  signal?.addEventListener('abort', stop);
  const checks = [];
  const checkpoint = (message) =>
    onProgress({
      message,
      report: { ...compare.export(), ...pairMetadata, checks: structuredClone(checks) },
    });
  try {
    aborted(signal);
    await compare.loadPair();
    aborted(signal);
    checks.push({ id: 'simultaneous-residency', pass: compare.chats.every((c) => c?.isLoaded()) });
    checkpoint('Both comparison models loaded.');
    await compare.send('Remember that our project codename is Amber Finch. Acknowledge briefly.');
    aborted(signal);
    await compare.send('What is our project codename?');
    aborted(signal);
    checks.push({
      id: 'paired-recall',
      pass: compare.state.panes.every((p) => /amber finch/i.test(p.turns.at(-1)?.response || '')),
    });
    checkpoint('Paired recall completed.');
    stopOnNextAOutput = true;
    await compare.send('Write a detailed story about twenty islands.');
    checks.push({
      id: 'independent-stop',
      pass:
        compare.state.panes[0].turns.at(-1)?.status === 'stopped' &&
        compare.state.panes[1].turns.at(-1)?.status === 'complete',
    });
    checkpoint('Independent cancellation completed.');
    aborted(signal);
    const successfulPaneTurn = compare.state.panes[1].turns.at(-1);
    await compare.retry(0);
    const retriedPaneTurn = compare.state.panes[0].turns.at(-1);
    const successfulPaneUnchanged =
      compare.state.panes[1].turns.at(-1) === successfulPaneTurn &&
      successfulPaneTurn?.status === 'complete';
    checks.push({
      id: 'pair-retry-stopped-side',
      pass:
        retriedPaneTurn?.status === 'complete' &&
        Boolean(retriedPaneTurn.response?.trim()) &&
        successfulPaneUnchanged,
    });
    checkpoint('Stopped side retried; completed side unchanged.');
    return { ...compare.export(), ...pairMetadata, checks };
  } catch (error) {
    if (!signal?.aborted) throw error;
    const partial = {
      ...compare.export(),
      ...pairMetadata,
      checks,
      stopped: true,
      error: error.message,
    };
    onProgress({ message: 'Pair stress test stopped; partial results retained.', report: partial });
    return partial;
  } finally {
    signal?.removeEventListener('abort', stop);
    await compare.dispose();
  }
}
