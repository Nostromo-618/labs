/** Bounded utterance detection driven by ordered 32 ms Silero frames. */
export class SpeechEndpoint {
  constructor() {
    this.reset();
  }
  reset() {
    this.pre = [];
    this.frames = [];
    this.length = 0;
    this.speechSamples = 0;
    this.silenceSamples = 0;
    this.active = false;
  }
  push(probability, frame) {
    if (!Number.isFinite(probability) || !(frame instanceof Float32Array) || frame.length !== 512)
      throw new Error('Invalid speech activity result.');
    if (!this.active) {
      if (probability < 0.5) {
        this.pre.push(frame);
        if (this.pre.length > 10) this.pre.shift();
        return null;
      }
      this.active = true;
      // Exactly 300 ms of pre-roll, even though frames are 32 ms each.
      const pre = new Float32Array(this.pre.length * 512);
      this.pre.forEach((part, i) => pre.set(part, i * 512));
      this.frames = [pre.slice(-4800)];
      this.length = this.frames[0].length;
      this.pre = [];
    }
    const part = frame.slice(0, Math.min(512, 960000 - this.length));
    this.frames.push(part);
    this.length += part.length;
    if (probability >= 0.5) {
      this.speechSamples += part.length;
      this.silenceSamples = 0;
    } else if (probability < 0.35) this.silenceSamples += part.length;
    const limit = this.length >= 960000;
    if (!limit && this.silenceSamples < 19200) return null;
    const accepted = this.speechSamples >= 4000;
    const audio = new Float32Array(
      limit ? this.length : Math.max(0, this.length - this.silenceSamples + 4800),
    );
    let offset = 0;
    for (const part of this.frames) {
      const size = Math.min(part.length, audio.length - offset);
      if (size <= 0) break;
      audio.set(part.subarray(0, size), offset);
      offset += size;
    }
    const silenceMs = this.silenceSamples / 16;
    this.reset();
    return accepted ? { audio, limit, silenceMs } : { misfire: true };
  }
}
