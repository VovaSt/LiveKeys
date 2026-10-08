// Linked-channel sample-peak limiter. No lookahead; NOT an inter-sample/true-peak limiter.
export class LimiterDSP {
  constructor(rate = 48000) { this.gain = 1; this.release = 1 - Math.exp(-1 / (0.08 * rate)); }
  process(input, output, ceiling) {
    ceiling = Number.isFinite(ceiling) ? Math.max(0.1, Math.min(1, ceiling)) : 0.89125;
    let reduction = 0;
    const length = output[0]?.length ?? 0;
    for (let i = 0; i < length; i++) {
      let peak = 0;
      for (const channel of input) { const value = channel[i]; if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value)); }
      const target = peak > ceiling ? ceiling / peak : 1;
      this.gain = target < this.gain ? target : Math.min(target, this.gain + (1 - this.gain) * this.release);
      reduction = Math.max(reduction, 1 - this.gain);
      for (let channel = 0; channel < output.length; channel++) {
        const value = input[channel]?.[i] ?? 0;
        output[channel][i] = Number.isFinite(value) ? Math.max(-ceiling, Math.min(ceiling, value * this.gain)) : 0;
      }
    }
    return reduction;
  }
}
if (typeof registerProcessor !== 'undefined') registerProcessor('live-keys-limiter', class extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ceiling', defaultValue: 0.89125, minValue: 0.1, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor() { super(); this.dsp = new LimiterDSP(sampleRate); this.frames = 0; this.reduction = 0; }
  process(inputs, outputs, parameters) {
    this.reduction = Math.max(this.reduction, this.dsp.process(inputs[0] ?? [], outputs[0], parameters.ceiling[0]));
    this.frames += outputs[0][0]?.length ?? 0;
    if (this.frames >= sampleRate / 10) { this.port.postMessage(this.reduction); this.frames = 0; this.reduction = 0; }
    return true;
  }
});
