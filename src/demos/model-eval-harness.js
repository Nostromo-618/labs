import { BASELINE_MODEL_IDS, NEW_MODEL_IDS } from '@wwl/wwl-ai-chat';
import { runEvaluation, runPairEvaluation, renderReportHtml } from '../lib/model-evaluation.js';
const params = new URLSearchParams(location.search);
const controller = new AbortController();
window.__WWL_MODEL_EVAL_STOP__ = () => controller.abort();
window.__WWL_MODEL_EVAL_RUN__ = async () => {
  const modelIds = (
    params.get('models') || [...BASELINE_MODEL_IDS, ...NEW_MODEL_IDS].join(',')
  ).split(',');
  const options = {
    modelIds,
    repetitions: Number(params.get('warm') ?? 3),
    cold: params.get('cold') === '1',
    releaseCachesAfterModel: params.get('releaseCaches') === '1',
    signal: controller.signal,
    onProgress: ({ message, report }) => {
      const el = document.getElementById('log');
      if (el) el.textContent = message;
      console.log(message);
      if (report) {
        window.__WWL_MODEL_EVAL_REPORT__ = report;
        if (
          /: finished$|^Both comparison|^Paired recall|^Independent cancellation|^Pair recovery|^Pair stress test stopped/.test(
            message,
          )
        )
          console.log(`[WWL_EVAL_CHECKPOINT]${JSON.stringify(report)}`);
      }
    },
  };
  try {
    const report =
      params.get('pair') === '1' ? await runPairEvaluation(options) : await runEvaluation(options);
    window.__WWL_MODEL_EVAL_REPORT__ = report;
    window.__WWL_MODEL_EVAL_HTML__ = renderReportHtml(report);
  } catch (error) {
    window.__WWL_MODEL_EVAL_ERROR__ = error.message;
  } finally {
    window.__WWL_MODEL_EVAL_DONE__ = true;
  }
};
if (params.get('autorun') === '1') void window.__WWL_MODEL_EVAL_RUN__();
