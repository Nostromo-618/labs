/* global AudioWorkletProcessor, registerProcessor, sampleRate */
import { SpeechResampler } from '../lib/speech/resampler.js';
class ConversationCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.resampler = new SpeechResampler(sampleRate);
    this.stopped = false;
    this.port.onmessage = () => {
      this.stopped = true;
    };
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels)
      for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
    for (const frame of this.resampler.push(mono)) this.port.postMessage(frame, [frame.buffer]);
    return true;
  }
}
registerProcessor('vwl-conversation-capture', ConversationCapture);
