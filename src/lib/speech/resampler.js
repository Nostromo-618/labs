/** Stateful windowed-sinc resampling; bounded history and fixed 512-sample output frames. */
export class SpeechResampler {
  constructor(rate) {
    if (!Number.isFinite(rate) || rate < 16000) throw new Error('Unsupported capture sample rate.');
    this.step = rate / 16000;
    this.cutoff = 0.45 / this.step;
    this.buffer = new Float32Array(16);
    this.position = 16;
    this.frame = new Float32Array(512);
    this.offset = 0;
  }
  push(samples) {
    const combined = new Float32Array(this.buffer.length + samples.length);
    combined.set(this.buffer);
    combined.set(samples, this.buffer.length);
    this.buffer = combined;
    const output = [];
    while (this.position + 16 < combined.length) {
      let sum = 0,
        weightSum = 0;
      for (let i = Math.ceil(this.position - 16); i <= Math.floor(this.position + 16); i++) {
        const distance = i - this.position;
        const x = 2 * this.cutoff * distance;
        const sinc = Math.abs(x) < 1e-8 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const window =
          0.42 +
          0.5 * Math.cos((Math.PI * distance) / 16) +
          0.08 * Math.cos((2 * Math.PI * distance) / 16);
        const weight = sinc * window;
        sum += combined[i] * weight;
        weightSum += weight;
      }
      this.frame[this.offset++] = sum / weightSum;
      if (this.offset === 512) {
        output.push(this.frame);
        this.frame = new Float32Array(512);
        this.offset = 0;
      }
      this.position += this.step;
    }
    const consumed = Math.floor(this.position) - 16;
    this.buffer = combined.slice(consumed);
    this.position -= consumed;
    return output;
  }
}
