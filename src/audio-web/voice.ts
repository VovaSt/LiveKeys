import type { SampleZone, PadParameters } from '../domain/models';
import { dbToGain } from './samples';
/** Shared by real-time sampler and OfflineAudioContext integration tests. */
export interface PlayingVoice {
  readonly nodeCount: number; readonly started: number; readonly level: number;
  released: boolean; releaseTime: number; releaseDuration: number;
  release(time: number, fast?: boolean, fadeSeconds?: number): void; stop(time: number): void;
  setEnded(callback: () => void): void; dispose(): void;
  setBend(cents: number, time: number): void;
}
export class SampleVoice implements PlayingVoice {
  readonly nodeCount: number;
  private filter?: BiquadFilterNode;
  private readonly pianoRelease: boolean;
  private readonly attackDuration: number;
  private releaseLevel = 0;
  private curvedRelease = false;
  releaseDuration = 0.28;
  readonly source: AudioBufferSourceNode;
  readonly envelope: GainNode;
  released = false;
  releaseTime = Infinity;
  readonly level: number;
  constructor(context: BaseAudioContext, output: AudioNode, buffer: AudioBuffer,
    zone: SampleZone, pitch: number, velocity: number, readonly started: number, fineTune = 0, parameters?: PadParameters) {
    this.nodeCount = parameters ? 3 : 2;
    this.pianoRelease = !parameters;
    this.attackDuration = parameters?.attack ?? 0.003;
    // Damped piano strings retain a short, curved tail; bass decays more slowly.
    this.releaseDuration = parameters?.release ?? Math.max(0.65, Math.min(1.3, 1.05 - (pitch - 60) * 0.009));
    this.source = context.createBufferSource(); this.envelope = context.createGain();
    this.source.buffer = buffer;
    this.source.playbackRate.value = 2 ** ((pitch - zone.rootNote + (zone.tuningCents + fineTune) / 100) / 12);
    if (zone.loop) {
      this.source.loop = true; this.source.loopStart = zone.loop.start; this.source.loopEnd = zone.loop.end;
    }
    this.level = (velocity / 127) ** 1.5 * dbToGain(zone.gainDb);
    this.envelope.gain.setValueAtTime(0, started);
    this.envelope.gain.linearRampToValueAtTime(this.level, started + this.attackDuration);
    if (parameters) {
      this.filter = context.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = 0.5;
      this.filter.frequency.value = Math.min(parameters.cutoff, context.sampleRate * 0.45);
      this.source.connect(this.filter).connect(this.envelope);
    } else this.source.connect(this.envelope);
    this.envelope.connect(output);
    this.source.start(started);
  }
  release(time: number, fast = false, fadeSeconds?: number): void {
    if (this.released && !fast && fadeSeconds === undefined) return;
    const elapsed = Math.max(0, time - this.releaseTime);
    const heldLevel = this.released ? (elapsed >= this.releaseDuration ? 0 : this.releaseLevel *
      (this.curvedRelease ? Math.exp(-7 * elapsed / this.releaseDuration) : Math.max(0, 1 - elapsed / this.releaseDuration))) :
      this.level * Math.max(0, Math.min(1, (time - this.started) / this.attackDuration));
    if (fadeSeconds !== undefined && this.released) fadeSeconds = Math.min(fadeSeconds, Math.max(0.001, this.releaseTime + this.releaseDuration - time));
    this.released = true; this.releaseTime = time;
    const duration = fadeSeconds ?? (fast ? 0.008 : this.releaseDuration);
    this.releaseDuration = duration;
    this.envelope.gain.cancelAndHoldAtTime(time);
    // Explicit anchor: otherwise Chromium can ramp from the previous attack event,
    // starting the fade before note-off when the sustain segment has no events.
    this.envelope.gain.setValueAtTime(heldLevel, time);
    this.releaseLevel = heldLevel;
    this.curvedRelease = this.pianoRelease && !fast && fadeSeconds === undefined;
    if (this.curvedRelease) {
      this.envelope.gain.setTargetAtTime(0, time, duration / 7);
      // Finish only after the exponential tail is below -60 dB, avoiding a hard cut.
      this.envelope.gain.setValueAtTime(0, time + duration);
    } else this.envelope.gain.linearRampToValueAtTime(0, time + duration);
    this.source.stop(time + duration + 0.001);
  }
  stop(time: number): void { this.source.stop(time); }
  setEnded(callback: () => void): void { this.source.onended = callback; }
  setBend(cents: number, time: number): void { this.source.detune.setTargetAtTime(cents, time, 0.008); }
  updateCutoff(cutoff: number, time: number): void { this.filter?.frequency.setTargetAtTime(cutoff, time, 0.025); }
  dispose(): void { this.source.disconnect(); this.filter?.disconnect(); this.envelope.disconnect(); this.source.onended = null; }
}
