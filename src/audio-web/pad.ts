import type { PadParameters, SynthProfile } from '../domain/models';
import { synthCatalog } from '../domain/catalog';
import type { PlayingVoice } from './voice';
/** Subtractive pads/leads and two-operator FM electric keys. */
export class PadVoice implements PlayingVoice {
  readonly nodeCount: number;
  readonly oscillators: OscillatorNode[];
  readonly filter: BiquadFilterNode;
  readonly envelope: GainNode;
  private lfo: OscillatorNode;
  private movement: GainNode;
  private vibrato: GainNode;
  private index?: GainNode;
  private partNodes: AudioNode[] = [];
  private partMotion: GainNode[] = [];
  private profile: SynthProfile;
  private fineTune: number;
  private macroMovement: number;
  private attackDuration: number;
  private releaseLevel = 0;
  released = false;
  releaseTime = Infinity;
  releaseDuration: number;
  readonly level: number;
  constructor(private context: BaseAudioContext, output: AudioNode, pitch: number, velocity: number,
    readonly started: number, parameters: PadParameters, fineTune = 0, profile?: SynthProfile, glide = 0, glideFrom?: number) {
    const fallback = synthCatalog.find(i => i.id === 'warm-pad')!.definition;
    this.profile = profile ?? (fallback.kind === 'synth' ? fallback.profile! : undefined!);
    this.fineTune = fineTune; this.macroMovement = parameters.movement ?? this.profile.movement;
    this.level = (velocity / 127) ** 1.3 * this.profile.level;
    this.releaseDuration = parameters.release;
    this.attackDuration = parameters.attack;
    this.envelope = context.createGain(); this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass'; this.filter.frequency.value = parameters.cutoff; this.filter.Q.value = this.profile.resonance ?? 0.5;
    if (this.profile.filterEnvelope) {
      this.filter.frequency.setValueAtTime(parameters.cutoff, started);
      this.filter.frequency.linearRampToValueAtTime(Math.min(context.sampleRate * 0.45, parameters.cutoff + this.profile.filterEnvelope * velocity / 127), started + parameters.attack);
      this.filter.frequency.exponentialRampToValueAtTime(parameters.cutoff, started + parameters.attack + this.profile.decay);
    }
    this.envelope.gain.setValueAtTime(0, started);
    this.envelope.gain.linearRampToValueAtTime(this.level, started + parameters.attack);
    this.envelope.gain.exponentialRampToValueAtTime(Math.max(0.000001, this.level * this.profile.sustain), started + parameters.attack + this.profile.decay);
    this.filter.connect(this.envelope).connect(output);
    const hz = 440 * 2 ** ((pitch - 69) / 12);
    const startHz = glideFrom === undefined ? hz : 440 * 2 ** ((glideFrom - 69) / 12);
    this.oscillators = (this.profile.parts ?? [undefined, undefined]).map((part, index) => {
      const oscillator = context.createOscillator();
      const ratio = part?.ratio ?? (index === 0 ? 1 : this.profile.ratio);
      oscillator.type = part?.wave ?? (index === 0 ? this.profile.wave : this.profile.model === 'fm' ? 'sine' : this.profile.secondWave);
      oscillator.frequency.setValueAtTime(startHz * ratio, started);
      oscillator.frequency.exponentialRampToValueAtTime(hz * ratio, started + Math.max(0.001, glide));
      oscillator.detune.value = fineTune + (part?.detune ?? (this.profile.model === 'fm' ? 0 : (index === 0 ? -1 : 1) * this.profile.detune));
      if (part) {
        const tone = context.createBiquadFilter(), gain = context.createGain(), pan = context.createStereoPanner();
        tone.type = part.formant ? 'bandpass' : 'lowpass'; tone.frequency.value = Math.min(context.sampleRate * 0.45, part.formant ?? part.cutoff); tone.Q.value = part.formant ? 3 : 0.5;
        gain.gain.setValueAtTime(0, started); gain.gain.linearRampToValueAtTime(part.gain, started + part.attack);
        pan.pan.value = part.pan;
        oscillator.connect(tone).connect(gain); pan.connect(this.filter);
        this.partNodes.push(tone, gain, pan);
        if (this.profile.swell) {
          const motion = context.createGain(), amplitude = context.createGain();
          motion.gain.value = this.profile.swell * (index % 2 ? -1 : 1);
          gain.connect(amplitude).connect(pan); motion.connect(amplitude.gain);
          this.partMotion.push(motion); this.partNodes.push(motion, amplitude);
        } else gain.connect(pan);
      }
      return oscillator;
    });
    if (!this.profile.parts) this.oscillators[0]!.connect(this.filter);
    if (this.profile.model === 'fm' && !this.profile.parts) {
      this.index = context.createGain();
      this.index.gain.setValueAtTime(hz * this.profile.fmIndex * (0.1 + (velocity / 127) ** 2), started);
      this.index.gain.exponentialRampToValueAtTime(Math.max(0.001, hz * 0.01), started + this.profile.decay);
      this.oscillators[1]!.connect(this.index).connect(this.oscillators[0]!.frequency);
    } else if (!this.profile.parts) this.oscillators[1]!.connect(this.filter);
    this.lfo = context.createOscillator(); this.movement = context.createGain(); this.vibrato = context.createGain(); this.vibrato.gain.value = 0;
    this.lfo.frequency.value = this.profile.lfoRate; this.movement.gain.value = this.macroMovement * 700;
    this.lfo.connect(this.movement).connect(this.filter.detune);
    for (const motion of this.partMotion) this.lfo.connect(motion);
    this.lfo.connect(this.vibrato); for (const oscillator of this.oscillators) this.vibrato.connect(oscillator.detune);
    for (const oscillator of [...this.oscillators, this.lfo]) oscillator.start(started);
    this.nodeCount = this.oscillators.length + 5 + this.partNodes.length + (this.index ? 1 : 0);
  }
  setEnded(callback: () => void): void {
    let count = 0;
    for (const oscillator of this.oscillators) oscillator.onended = () => { if (++count === this.oscillators.length) callback(); };
  }
  setBend(cents: number, time: number): void {
    this.oscillators.forEach((osc, i) => osc.detune.setTargetAtTime(this.fineTune + cents +
      (this.profile.parts?.[i]?.detune ?? (this.profile.model === 'fm' ? 0 : (i === 0 ? -1 : 1) * this.profile.detune)), time, 0.008));
  }
  setModulation(value: number, time: number): void {
    this.movement.gain.setTargetAtTime((this.macroMovement + value) * 700, time, 0.03);
    this.vibrato.gain.setTargetAtTime(value * 50, time, 0.03);
  }
  updateCutoff(cutoff: number, time: number): void { this.filter.frequency.setTargetAtTime(cutoff, time, 0.025); }
  updateMovement(value: number, modulation: number, time: number): void { this.macroMovement = value; this.setModulation(modulation, time); }
  release(time: number, fast = false, fadeSeconds?: number): void {
    if (this.released && !fast && fadeSeconds === undefined) return;
    const age = Math.max(0, time - this.started);
    const sustain = Math.max(0.000001, this.level * this.profile.sustain);
    const held = this.released
      ? this.releaseLevel * Math.max(0, 1 - (time - this.releaseTime) / this.releaseDuration)
      : age < this.attackDuration ? this.level * age / this.attackDuration
      : this.level * (sustain / this.level) ** Math.min(1, (age - this.attackDuration) / this.profile.decay);
    if (fadeSeconds !== undefined && this.released) fadeSeconds = Math.min(fadeSeconds, Math.max(0.001, this.releaseTime + this.releaseDuration - time));
    this.released = true; this.releaseTime = time;
    if (fadeSeconds !== undefined) this.releaseDuration = fadeSeconds;
    else if (fast) this.releaseDuration = 0.008;
    this.envelope.gain.cancelAndHoldAtTime(time);
    // Anchor the exact ADSR value: release must never replace the preceding ramp.
    this.envelope.gain.setValueAtTime(held, time);
    this.releaseLevel = held;
    this.envelope.gain.linearRampToValueAtTime(0, time + this.releaseDuration);
    this.stop(time + this.releaseDuration + 0.001);
  }
  stop(time: number): void { for (const oscillator of [...this.oscillators, this.lfo]) oscillator.stop(time); }
  dispose(): void {
    for (const oscillator of [...this.oscillators, this.lfo]) { oscillator.onended = null; oscillator.disconnect(); }
    this.index?.disconnect(); this.movement.disconnect(); this.vibrato.disconnect(); this.filter.disconnect(); this.envelope.disconnect();
    for (const node of this.partNodes) node.disconnect();
  }
}
