import { validateLlmInput } from '@vanduo-oss/vwl-ai-chat/guardrails/llm';
import {
  createConversationCapture,
  requestConversationMicrophone,
  awaitConversationMicrophone,
} from './conversation-capture.js';
const aborted = () => new DOMException('Conversation stopped.', 'AbortError');
const releaseStream = (stream) => stream?.getTracks().forEach((track) => track.stop());
function settleDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      if (error) reject(error);
      else resolve();
    };
    const stop = () => finish(aborted());
    const timer = setTimeout(() => finish(), ms);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
}

/** Native engines are shared with manual speech; this controller owns only the automatic loop. */
export class ConversationSession {
  constructor({
    speech,
    preflight = () => {},
    ensureChat,
    submitTurn,
    cancelChat = () => {},
    restoreInstructions = () => {},
    requestMicrophone = requestConversationMicrophone,
    captureFactory = createConversationCapture,
    playerFactory = speech.playerFactory,
    delay = settleDelay,
    onChange = () => {},
  }) {
    Object.assign(this, {
      speech,
      preflight,
      ensureChat,
      submitTurn,
      cancelChat,
      restoreInstructions,
      requestMicrophone,
      captureFactory,
      playerFactory,
      delay,
      onChange,
    });
    this.state = {
      status: 'stopped',
      error: '',
      progress: '',
      reviewText: '',
      reviewReason: '',
      turns: 0,
      cacheAvailable: null,
      measurements: [],
    };
    this.epoch = 0;
  }
  update(values) {
    Object.assign(this.state, values);
    this.onChange({ ...this.state });
  }
  current(epoch) {
    return epoch === this.epoch && !this.controller?.signal.aborted;
  }
  start({ reviewedText = null } = {}) {
    if (this.state.ending) return this.endTask;
    if (!['stopped', 'paused'].includes(this.state.status)) return this.task;
    const previous = this.task;
    const epoch = ++this.epoch;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.update({ status: 'loading', error: '', progress: 'Checking Conversation Mode…' });
    try {
      this.preflight();
      if (
        reviewedText != null &&
        !validateLlmInput({ text: reviewedText, maxLength: 2000 }).allowed
      )
        throw new Error('Edit the voice message before sending it.');
      this.speech.cancel();
      this.playerLifetime = new AbortController();
      // Called synchronously in Start/Resume's gesture, before any model await.
      this.player = this.playerFactory(this.playerLifetime.signal);
      const microphone = this.requestMicrophone({ signal });
      this.lastEndpoint = null;
      this.task = this.prepare(epoch, signal, microphone, reviewedText, previous);
    } catch (error) {
      this.fail(error, epoch);
      this.task = Promise.resolve();
    }
    return this.task;
  }
  async prepare(epoch, signal, microphone, reviewedText, previous) {
    try {
      const stream = await awaitConversationMicrophone(microphone, signal);
      if (!this.current(epoch)) {
        releaseStream(stream);
        return;
      }
      this.initialStream = stream;
      // Let a canceled generation/load release its engine before starting another.
      await previous;
      if (!this.current(epoch)) return;
      await this.ensureChat({
        signal,
        onProgress: (progress) => {
          if (this.current(epoch)) this.update({ progress });
        },
      });
      if (!this.current(epoch)) return;
      for (const kind of ['whisper', 'kokoro', 'vad']) {
        const result = await this.speech.runtime.load(kind, {
          signal,
          onProgress: (p) => {
            if (this.current(epoch))
              this.update({
                progress: `${kind === 'vad' ? 'Voice detector' : kind === 'kokoro' ? 'Kokoro Heart' : 'Whisper'}: ${p.text}${Number.isFinite(p.percent) ? ` (${Math.round(p.percent)}%)` : ''}`,
                ...(p.cacheAvailable != null
                  ? { cacheAvailable: p.cacheAvailable && this.state.cacheAvailable !== false }
                  : {}),
              });
          },
        });
        if (!this.current(epoch)) return;
        if (result?.cacheAvailable != null)
          this.update({
            cacheAvailable: result.cacheAvailable && this.state.cacheAvailable !== false,
          });
        this.speech.update({});
      }
      if (reviewedText != null) {
        releaseStream(this.initialStream);
        this.initialStream = null;
        this.update({ reviewText: '', reviewReason: '' });
        await this.processText(reviewedText.trim(), epoch);
      } else await this.listen(epoch);
    } catch (error) {
      this.fail(error, epoch);
    }
  }
  async listen(epoch) {
    if (!this.current(epoch)) return;
    const signal = this.controller.signal;
    await this.speech.runtime.resetVad({ signal });
    if (!this.current(epoch)) return;
    const stream = this.initialStream;
    this.initialStream = null;
    const capture = await this.captureFactory({
      context: this.player.context,
      signal,
      runtime: this.speech.runtime,
      stream,
      onUtterance: (utterance) => {
        if (!this.current(epoch) || this.state.status !== 'listening') return;
        this.capture?.cancel();
        this.capture = null;
        this.task = this.handleUtterance(utterance, epoch);
      },
      onError: (error) => this.fail(error, epoch),
    });
    if (!this.current(epoch)) {
      capture.cancel();
      return;
    }
    this.capture = capture;
    this.update({ status: 'listening', progress: '' });
  }
  async handleUtterance({ audio, limit, silenceMs = 1200 }, epoch) {
    const signal = this.controller.signal;
    this.lastEndpoint = performance.now() - silenceMs;
    this.update({ status: 'transcribing' });
    try {
      const transcript = (await this.speech.runtime.transcribe(audio, { signal })).trim();
      if (!this.current(epoch)) return;
      if (limit) {
        this.review(transcript, 'Recording reached 60 seconds. Review this turn before sending.');
        return;
      }
      if (!transcript) {
        await this.listen(epoch);
        return;
      }
      await this.processText(transcript, epoch);
    } catch (error) {
      this.fail(error, epoch);
    }
  }
  async processText(text, epoch) {
    const signal = this.controller.signal;
    const guard = validateLlmInput({ text, maxLength: 2000 });
    if (!guard.allowed) {
      this.review(text, guard.message || 'Review this voice message before sending.');
      return;
    }
    this.update({ status: 'thinking', progress: '' });
    const measurement = {
      silenceToSubmitMs: this.lastEndpoint == null ? null : performance.now() - this.lastEndpoint,
    };
    try {
      const answer = await this.submitTurn(text, { signal, maxOutputTokens: 192 });
      if (!this.current(epoch)) return;
      this.update({ status: 'preparing-audio' });
      await this.speech.speak(answer, {
        provider: 'neural',
        player: this.player,
        signal,
        throwOnError: true,
        onPhase: (status) => {
          if (!this.current(epoch)) return;
          if (status === 'speaking' && measurement.silenceToFirstAudioMs == null)
            measurement.silenceToFirstAudioMs =
              this.lastEndpoint == null ? null : performance.now() - this.lastEndpoint;
          this.update({ status });
        },
      });
      if (!this.current(epoch)) return;
      this.update({
        turns: this.state.turns + 1,
        measurements: [...this.state.measurements.slice(-19), measurement],
      });
      await this.delay(400, signal);
      if (this.current(epoch)) await this.listen(epoch);
    } catch (error) {
      this.fail(error, epoch);
    }
  }
  review(text, reason) {
    this.pause();
    this.update({ reviewText: text, reviewReason: reason });
  }
  fail(error, epoch) {
    if (!this.current(epoch)) return;
    this.pause();
    this.update({
      error: error?.name === 'AbortError' ? '' : error.message || 'Conversation Mode failed.',
    });
  }
  pause() {
    if (this.state.ending) return;
    this.epoch++;
    this.controller?.abort();
    releaseStream(this.initialStream);
    this.initialStream = null;
    this.capture?.cancel();
    this.capture = null;
    this.playerLifetime?.abort();
    this.player?.cancel();
    this.player = null;
    this.speech.cancel();
    this.cancelChat();
    if (this.state.status !== 'stopped') this.update({ status: 'paused', progress: '' });
  }
  end() {
    if (this.state.ending) return this.endTask;
    this.pause();
    const epoch = this.epoch;
    this.update({ ending: true, progress: 'Ending conversation…' });
    this.endTask = this.finishEnding(epoch);
    return this.endTask;
  }
  async finishEnding(epoch) {
    await this.task;
    if (epoch !== this.epoch) return;
    await this.restoreInstructions();
    this.update({
      status: 'stopped',
      ending: false,
      error: '',
      progress: '',
      reviewText: '',
      reviewReason: '',
    });
  }
}
