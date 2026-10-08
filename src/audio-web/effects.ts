import type { LayerEffects, PerformanceEffects } from '../domain/models';
import { LayerToneGraph } from './layer-tone';
import { dbToGain } from './samples';
import { effectiveEffects, effectRack } from '../domain/effects';
export function delaySeconds(e: PerformanceEffects): number {
  const beats = e.division === '1/4' ? 1 : e.division === '1/8' ? 0.5 : 0.75;
  return e.delaySync ? 60 / e.bpm * beats : e.delayTime;
}
const smooth = (p: AudioParam, value: number, time: number) => p.setTargetAtTime(value, time, 0.02);
/** Resource cleanup uses a silent source's onended callback, never a timer as audio clock. */
function afterFade(context: BaseAudioContext, time: number, dispose: () => void): void {
  const timer = context.createBufferSource(); timer.buffer = context.createBuffer(1, 1, context.sampleRate);
  timer.onended = () => { timer.disconnect(); timer.onended = null; dispose(); }; timer.start(time);
}
interface FilterBranch { filter: BiquadFilterNode; wet: GainNode }
interface ChorusBranch { lfo: OscillatorNode; depths: GainNode[]; delays: DelayNode[]; nodes: AudioNode[]; wet: GainNode }
export class LayerEffectGraph {
  readonly input: GainNode;
  readonly gain: GainNode;
  readonly pan: StereoPannerNode;
  private tone: LayerToneGraph;
  private filtered: GainNode; private filterDry: GainNode; private dry: GainNode;
  private reverb: GainNode; private delay: GainNode; private nodes: AudioNode[];
  private filter?: FilterBranch; private chorus?: ChorusBranch;
  private filterEnabled = false; private chorusEnabled = false;
  private filterRevision = 0; private chorusRevision = 0; private disposed = false;
  constructor(private context: BaseAudioContext, master: AudioNode, reverb: AudioNode, delay: AudioNode, e: LayerEffects, gainDb: number, pan: number) {
    this.tone = new LayerToneGraph(context);
    this.input = context.createGain(); this.input.connect(this.tone.input); this.filtered = context.createGain(); this.filterDry = context.createGain();
    this.gain = context.createGain(); this.pan = context.createStereoPanner(); this.dry = context.createGain();
    this.reverb = context.createGain(); this.delay = context.createGain();
    this.tone.output.connect(this.filterDry).connect(this.filtered);
    this.filtered.connect(this.dry).connect(this.gain);
    this.gain.connect(this.pan).connect(master); this.pan.connect(this.reverb).connect(reverb); this.pan.connect(this.delay).connect(delay);
    this.nodes = [this.input, this.filtered, this.filterDry, this.gain, this.pan, this.dry, this.reverb, this.delay];
    this.gain.gain.value = dbToGain(gainDb); this.pan.pan.value = pan;
    this.reverb.gain.value = 0; this.delay.gain.value = 0;
    this.update(e, gainDb, pan);
  }
  private createFilter(e: LayerEffects): FilterBranch {
    const filter = this.context.createBiquadFilter(), wet = this.context.createGain();
    filter.type = 'lowpass'; wet.gain.value = 0;
    filter.frequency.value = Math.min(e.cutoff, this.context.sampleRate * 0.45); filter.Q.value = e.resonance;
    this.tone.output.connect(filter).connect(wet).connect(this.filtered);
    return { filter, wet };
  }
  private createChorus(e: LayerEffects): ChorusBranch {
    const lfo = this.context.createOscillator(), wet = this.context.createGain();
    wet.gain.value = 0; wet.connect(this.gain); lfo.frequency.value = e.chorusRate;
    const nodes: AudioNode[] = [lfo, wet], depths: GainNode[] = [], delays: DelayNode[] = [];
    for (const direction of [-1, 1]) {
      const delayed = this.context.createDelay(0.1), depth = this.context.createGain(), position = this.context.createStereoPanner();
      delayed.delayTime.value = 0.018; position.pan.value = direction; depth.gain.value = direction * e.chorusDepth;
      this.filtered.connect(delayed).connect(position).connect(wet);
      lfo.connect(depth).connect(delayed.delayTime);
      nodes.push(delayed, depth, position); depths.push(depth); delays.push(delayed);
    }
    lfo.start(); return { lfo, wet, nodes, depths, delays };
  }
  private removeFilter(): void {
    if (!this.filter) return;
    this.tone.output.disconnect(this.filter.filter); this.filter.filter.disconnect(); this.filter.wet.disconnect(); this.filter = undefined;
  }
  private removeChorus(): void {
    if (!this.chorus) return;
    for (const delay of this.chorus.delays) this.filtered.disconnect(delay);
    this.chorus.lfo.stop(); for (const node of this.chorus.nodes) node.disconnect(); this.chorus = undefined;
  }
  update(e: LayerEffects, gainDb: number, pan: number): void {
    if (this.disposed) return;
    this.tone.update(e);
    const filterEnabled = effectRack(e).some(slot => slot.type === 'filter' && slot.enabled);
    e = effectiveEffects(e);
    const chorusEnabled = !e.chorusBypass && e.chorusMix > 0, time = this.context.currentTime;
    if (filterEnabled && !this.filter) this.filter = this.createFilter(e);
    if (chorusEnabled && !this.chorus) this.chorus = this.createChorus(e);
    if (filterEnabled !== this.filterEnabled) {
      this.filterEnabled = filterEnabled; const revision = ++this.filterRevision;
      if (!filterEnabled) afterFade(this.context, time + 0.12, () => {
        if (!this.disposed && revision === this.filterRevision) this.removeFilter();
      });
    }
    if (chorusEnabled !== this.chorusEnabled) {
      this.chorusEnabled = chorusEnabled; const revision = ++this.chorusRevision;
      if (!chorusEnabled) afterFade(this.context, time + 0.12, () => {
        if (!this.disposed && revision === this.chorusRevision) this.removeChorus();
      });
    }
    smooth(this.filterDry.gain, filterEnabled ? 0 : 1, time);
    if (this.filter) {
      smooth(this.filter.wet.gain, filterEnabled ? 1 : 0, time);
      if (filterEnabled) {
        smooth(this.filter.filter.frequency, Math.min(e.cutoff, this.context.sampleRate * 0.45), time);
        smooth(this.filter.filter.Q, e.resonance, time);
      }
    }
    if (this.chorus) {
      smooth(this.chorus.lfo.frequency, e.chorusRate, time);
      this.chorus.depths.forEach((depth, i) => smooth(depth.gain, (i === 0 ? -1 : 1) * e.chorusDepth, time));
      smooth(this.chorus.wet.gain, chorusEnabled ? e.chorusMix * 0.5 : 0, time);
    }
    smooth(this.dry.gain, chorusEnabled ? 1 - 0.5 * e.chorusMix : 1, time);
    smooth(this.gain.gain, dbToGain(gainDb), time); smooth(this.pan.pan, pan, time);
    smooth(this.reverb.gain, e.reverbSend, time); smooth(this.delay.gain, e.delaySend, time);
  }
  silenceSends(time: number): void {
    for (const node of [this.reverb, this.delay]) { node.gain.cancelAndHoldAtTime(time); node.gain.linearRampToValueAtTime(0, time + 0.008); }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.removeFilter(); this.removeChorus(); this.tone.dispose(); for (const node of this.nodes) node.disconnect();
  }
}
interface WetGraph { reverb: ConvolverNode; delay: DelayNode; feedback: GainNode; reverbOut: GainNode; delayOut: GainNode; nodes: AudioNode[]; decay: number }
/** One shared reverb/delay pair, regardless of polyphony. Generated IR has no external assets. */
export class SharedEffects {
  readonly dry: GainNode; readonly reverbInput: GainNode; readonly delayInput: GainNode;
  private output: AudioNode; private current: WetGraph; private retired: WetGraph[] = [];
  private settings: PerformanceEffects;
  private cachedImpulse?: { decay: number; buffer: AudioBuffer };
  constructor(private context: BaseAudioContext, output: AudioNode, settings: PerformanceEffects) {
    this.settings = settings; this.dry = context.createGain(); this.reverbInput = context.createGain(); this.delayInput = context.createGain();
    this.output = output; this.dry.connect(output);
    this.current = this.createWet(settings); this.update(settings);
  }
  private impulse(decay: number): AudioBuffer {
    if (this.cachedImpulse?.decay === decay) return this.cachedImpulse.buffer;
    const length = Math.ceil(this.context.sampleRate * decay), buffer = this.context.createBuffer(2, length, this.context.sampleRate);
    let seed = 1337;
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        samples[i] = (seed / 2147483648 - 1) * (1 - i / length) ** 3 * Math.min(1, i / 200);
      }
    }
    this.cachedImpulse = { decay, buffer }; return buffer;
  }
  private createWet(e: PerformanceEffects): WetGraph {
    const reverb = this.context.createConvolver(), delay = this.context.createDelay(2.1), feedback = this.context.createGain();
    const reverbOut = this.context.createGain(), delayOut = this.context.createGain(), damping = this.context.createBiquadFilter();
    damping.type = 'lowpass'; damping.frequency.value = 6000;
    reverb.buffer = this.impulse(e.reverbDecay); delay.delayTime.value = delaySeconds(e); feedback.gain.value = e.feedback;
    reverbOut.gain.value = 0; delayOut.gain.value = 0;
    this.reverbInput.connect(reverb).connect(reverbOut).connect(this.output);
    this.delayInput.connect(delay).connect(delayOut).connect(this.output); delay.connect(damping).connect(feedback).connect(delay);
    return { reverb, delay, feedback, reverbOut, delayOut, decay: e.reverbDecay, nodes: [reverb, delay, feedback, reverbOut, delayOut, damping] };
  }
  private replace(e: PerformanceEffects, duration: number): void {
    const old = this.current, time = this.context.currentTime;
    this.reverbInput.disconnect(old.reverb); this.delayInput.disconnect(old.delay);
    for (const node of [old.reverbOut, old.delayOut]) { node.gain.cancelAndHoldAtTime(time); node.gain.linearRampToValueAtTime(0, time + duration); }
    this.retired.push(old); this.current = this.createWet(e);
    afterFade(this.context, time + duration + 0.005, () => { for (const node of old.nodes) node.disconnect(); this.retired = this.retired.filter(item => item !== old); });
    // Bound repeated IR edits even before onended callbacks get a main-thread turn.
    if (this.retired.length > 2) for (const node of this.retired.shift()!.nodes) node.disconnect();
  }
  update(e: PerformanceEffects): void {
    if (this.current.decay !== e.reverbDecay) this.replace(e, 0.05);
    this.settings = { ...e }; const time = this.context.currentTime;
    smooth(this.current.reverbOut.gain, e.reverbBypass ? 0 : 0.65, time);
    smooth(this.current.delayOut.gain, e.delayBypass ? 0 : 0.65, time);
    smooth(this.current.delay.delayTime, delaySeconds(e), time); smooth(this.current.feedback.gain, e.feedback, time);
  }
  clear(): void {
    const time = this.context.currentTime;
    for (const input of [this.reverbInput, this.delayInput]) {
      input.gain.cancelScheduledValues(time); input.gain.setValueAtTime(0, time); input.gain.setValueAtTime(1, time + 0.012);
    }
    this.replace(this.settings, 0.008); this.update(this.settings);
  }
  get memoryBytes(): number {
    const buffers = new Set([this.cachedImpulse?.buffer, this.current.reverb.buffer, ...this.retired.map(g => g.reverb.buffer)]);
    let bytes = 0; for (const buffer of buffers) if (buffer) bytes += buffer.length * buffer.numberOfChannels * 4;
    return bytes;
  }
  dispose(): void {
    this.cachedImpulse = undefined;
    for (const node of [this.dry, this.reverbInput, this.delayInput, ...this.current.nodes, ...this.retired.flatMap(g => g.nodes)]) node.disconnect();
  }
}
