/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class VwlSpeechRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.remaining = Math.ceil(sampleRate * 60);
    this.stopped = false;
    this.port.onmessage = () => {
      this.stopped = true;
      this.port.postMessage({ type: 'stopped' });
    };
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    const frames = Math.min(channels[0].length, this.remaining);
    const pcm = new Float32Array(frames);
    for (const channel of channels)
      for (let i = 0; i < frames; i++) pcm[i] += channel[i] / channels.length;
    this.remaining -= frames;
    this.port.postMessage({ type: 'pcm', pcm }, [pcm.buffer]);
    if (this.remaining <= 0) {
      this.stopped = true;
      this.port.postMessage({ type: 'limit' });
      return false;
    }
    return true;
  }
}
registerProcessor('vwl-speech-recorder', VwlSpeechRecorder);
