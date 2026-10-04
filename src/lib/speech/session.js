import { createSpeechRuntime } from './runtime.js';
import { createRecorder, createPCMPlayer, speakSystem } from './audio.js';
import { speechText, splitSpeechText } from './text.js';

/** Host state only; native engines, AudioContexts and workers stay outside Vue proxies. */
export class SpeechSession {
  constructor({
    runtime = createSpeechRuntime(),
    recorderFactory = createRecorder,
    playerFactory = createPCMPlayer,
    systemSpeaker = speakSystem,
    onChange = () => {},
    onTranscript = () => {},
  } = {}) {
    Object.assign(this, {
      runtime,
      recorderFactory,
      playerFactory,
      systemSpeaker,
      onChange,
      onTranscript,
    });
    this.state = {
      status: 'idle',
      error: '',
      progress: '',
      playbackPhase: '',
      recordingSeconds: 0,
      whisperReady: false,
      kokoroReady: false,
      cacheAvailable: null,
    };
    this.epoch = 0;
  }
  update(values) {
    Object.assign(this.state, values, {
      whisperReady: this.runtime.isLoaded('whisper'),
      kokoroReady: this.runtime.isLoaded('kokoro'),
    });
    this.onChange({ ...this.state });
  }
  begin(status) {
    if (this.state.status !== 'idle') throw new Error('Stop the current speech operation first.');
    this.controller = new AbortController();
    const epoch = ++this.epoch;
    this.update({ status, error: '', progress: '' });
    return { epoch, signal: this.controller.signal };
  }
  fail(error, epoch) {
    if (epoch !== this.epoch) return;
    this.update({
      status: 'idle',
      progress: '',
      playbackPhase: '',
      error: error?.name === 'AbortError' ? '' : error.message || 'Speech failed.',
    });
  }
  async load(kind) {
    const { epoch, signal } = this.begin('loading');
    try {
      const result = await this.runtime.load(kind, {
        signal,
        onProgress: (p) => {
          if (epoch === this.epoch)
            this.update({
              progress: p.text + (Number.isFinite(p.percent) ? ` (${Math.round(p.percent)}%)` : ''),
              ...(p.cacheAvailable != null ? { cacheAvailable: p.cacheAvailable } : {}),
            });
        },
      });
      if (epoch === this.epoch)
        this.update({
          status: 'idle',
          progress: '',
          ...(result ? { cacheAvailable: result.cacheAvailable } : {}),
        });
    } catch (error) {
      this.fail(error, epoch);
    }
  }
  async record() {
    if (this.state.status === 'speaking') this.cancel();
    if (!this.runtime.isLoaded('whisper')) throw new Error('Load dictation before recording.');
    const { epoch, signal } = this.begin('preparing');
    try {
      const recorder = await this.recorderFactory({
        signal,
        onLimit: () => {
          if (epoch === this.epoch && this.state.status === 'recording')
            void this.finishRecording();
        },
      });
      if (epoch !== this.epoch) {
        recorder.cancel();
        return;
      }
      this.recorder = recorder;
      this.update({ status: 'recording', recordingSeconds: 0 });
      this.startedAt = performance.now();
      const tick = () => {
        if (epoch !== this.epoch || this.state.status !== 'recording') return;
        this.update({
          recordingSeconds: Math.min(60, Math.floor((performance.now() - this.startedAt) / 1000)),
        });
        this.timer = setTimeout(tick, 1000);
      };
      tick();
    } catch (error) {
      this.fail(error, epoch);
    }
  }
  async finishRecording() {
    if (this.state.status !== 'recording') return;
    const epoch = this.epoch,
      signal = this.controller.signal;
    const recorder = this.recorder;
    clearTimeout(this.timer);
    this.update({ status: 'transcribing' });
    try {
      const audio = await recorder.stop();
      if (epoch === this.epoch) this.recorder = null;
      if (epoch !== this.epoch || signal.aborted) return;
      const transcript = await this.runtime.transcribe(audio, { signal });
      if (epoch !== this.epoch) return;
      this.update({
        status: 'idle',
        error: transcript ? '' : 'No speech detected. Your draft is unchanged.',
      });
      if (transcript) this.onTranscript(transcript);
    } catch (error) {
      recorder.cancel();
      if (epoch === this.epoch) this.recorder = null;
      this.fail(error, epoch);
    }
  }
  async speak(
    answer,
    {
      provider = 'system',
      voiceURI = '',
      player = null,
      signal: outerSignal,
      onPhase = () => {},
      throwOnError = false,
    } = {},
  ) {
    const text = speechText(answer);
    if (!text) {
      this.update({ error: 'This reply has no prose to read aloud.' });
      return;
    }
    const { epoch, signal } = this.begin('speaking');
    const cancel = () => this.cancel();
    outerSignal?.addEventListener('abort', cancel, { once: true });
    try {
      if (outerSignal?.aborted) throw new DOMException('Speech stopped.', 'AbortError');
      if (provider === 'neural' && !this.runtime.isLoaded('kokoro'))
        throw new Error('Load Neural voice before reading aloud.');
      // Unlock Web Audio from the click, before model inference awaits.
      if (provider === 'neural' && !player) this.player = this.playerFactory(signal);
      const activePlayer = player || this.player;
      this.update({ playbackPhase: provider === 'neural' ? 'preparing' : 'playing' });
      // Start the first sentence sooner; prepare only one following sentence
      // during playback, keeping both latency and buffered audio bounded.
      const sentences = splitSpeechText(text, 300, { oneSentence: provider === 'neural' });
      const prepare = (sentence) =>
        this.runtime.synthesize(sentence, { signal }).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      let next = provider === 'neural' ? prepare(sentences[0]) : null;
      for (let index = 0; index < sentences.length; index++) {
        if (epoch !== this.epoch || signal.aborted) return;
        if (provider === 'system') await this.systemSpeaker(sentences[index], voiceURI, signal);
        else {
          this.update({ playbackPhase: 'preparing' });
          onPhase('preparing-audio');
          const prepared = await next;
          if (prepared.error) throw prepared.error;
          const result = prepared.value;
          if (epoch !== this.epoch || signal.aborted) return;
          if (!result?.chunks?.length)
            throw new Error(
              'Neural voice produced no audio. Reload the page and load Neural voice again.',
            );
          // Bound look-ahead to one chunk and synthesize it while current audio plays.
          if (index + 1 < sentences.length) next = prepare(sentences[index + 1]);
          for (const audio of result.chunks)
            await activePlayer.play(audio, result.sampleRate, {
              signal,
              onStart: () => {
                if (epoch === this.epoch) {
                  this.update({ playbackPhase: 'playing' });
                  onPhase('speaking');
                }
              },
            });
        }
      }
      if (epoch === this.epoch) this.update({ status: 'idle', playbackPhase: '' });
    } catch (error) {
      this.fail(error, epoch);
      if (throwOnError) throw error;
    } finally {
      outerSignal?.removeEventListener('abort', cancel);
      if (epoch === this.epoch) {
        this.controller.abort();
        this.player?.cancel();
        this.player = null;
        this.update({});
      }
    }
  }
  cancel() {
    this.epoch++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.recorder?.cancel();
    this.recorder = null;
    this.player?.cancel();
    this.player = null;
    this.runtime.cancel();
    this.update({
      status: 'idle',
      error: '',
      progress: '',
      playbackPhase: '',
      recordingSeconds: 0,
    });
  }
  dispose() {
    this.cancel();
    this.runtime.dispose();
    this.update({});
  }
}
