import type { LayerEffects } from '../domain/models';
import { effectRack } from '../domain/effects';
import { tubeGain, tubeTransfer } from './tube-drive';
interface Branch { nodes: AudioNode[]; first: AudioNode; wet: GainNode; eq?: BiquadFilterNode[]; boost?: GainNode; trim?: GainNode; warmth?: BiquadFilterNode }
/** Layer-wide EQ/drive, never per voice. Disabled processors are disconnected after a short crossfade. */
export class LayerToneGraph {
  readonly input: GainNode;
  readonly output: GainNode;
  private current?: Branch;
  private retired = new Set<Branch>();
  private shape = '';
  private disposed = false;
  constructor(private context: BaseAudioContext) {
    this.input = context.createGain(); this.output = context.createGain();
  }
  update(e: LayerEffects): void {
    if (this.disposed) return;
    const enabled = (type: 'eq' | 'drive') => effectRack(e).some(s => s.type === type && s.enabled);
    const eq = enabled('eq'), drive = enabled('drive') && (e.drive ?? 0) > 0;
    const shape = `${eq}/${drive}`, time = this.context.currentTime;
    if (shape !== this.shape) {
      const nodes: AudioNode[] = [], wet = this.context.createGain();
      const next: Branch = { nodes, first: wet, wet };
      if (drive) {
        const boost = this.context.createGain(), shaper = this.context.createWaveShaper(), trim = this.context.createGain();
        shaper.curve = Float32Array.from({ length: 2049 }, (_, i) => tubeTransfer(i / 2048 * 2 - 1));
        shaper.oversample = '2x'; next.boost = boost; next.trim = trim;
        boost.gain.value = tubeGain(e.drive ?? 0); trim.gain.value = 1 / boost.gain.value;
        // Asymmetry adds even harmonics; remove its DC and soften the upper spectrum.
        const dc = this.context.createBiquadFilter(), warmth = this.context.createBiquadFilter();
        dc.type = 'highpass'; dc.frequency.value = 18; dc.Q.value = 0.707;
        warmth.type = 'highshelf'; warmth.frequency.value = 3200;
        warmth.gain.value = -3 * (e.drive ?? 0); next.warmth = warmth;
        nodes.push(boost, shaper, dc, warmth, trim);
      }
      if (eq) {
        next.eq = (['lowshelf', 'peaking', 'highshelf'] as const).map((type, i) => {
          const filter = this.context.createBiquadFilter(); filter.type = type;
          filter.frequency.value = [180, 1000, 5000][i]!; filter.Q.value = 0.7;
          return filter;
        });
        nodes.push(...next.eq);
      }
      nodes.push(wet); next.first = nodes[0]!;
      for (let i = 1; i < nodes.length; i++) nodes[i - 1]!.connect(nodes[i]!);
      wet.gain.value = this.current ? 0 : 1; this.input.connect(next.first); wet.connect(this.output);
      if (this.current) {
        const old = this.current; old.wet.gain.cancelAndHoldAtTime(time); old.wet.gain.linearRampToValueAtTime(0, time + 0.02);
        wet.gain.linearRampToValueAtTime(1, time + 0.02); this.retired.add(old);
        const timer = this.context.createBufferSource(); timer.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
        timer.onended = () => { timer.disconnect(); timer.onended = null; if (this.retired.delete(old)) this.remove(old); };
        timer.start(time + 0.025);
        if (this.retired.size > 2) { const oldest = this.retired.values().next().value!; this.retired.delete(oldest); this.remove(oldest); }
      }
      this.current = next; this.shape = shape;
    }
    const branch = this.current!;
    branch.eq?.forEach((filter, i) => filter.gain.setTargetAtTime([e.eqLow ?? 0, e.eqMid ?? 0, e.eqHigh ?? 0][i]!, time, 0.02));
    const amount = e.drive ?? 0;
    branch.boost?.gain.setTargetAtTime(tubeGain(amount), time, 0.02);
    branch.trim?.gain.setTargetAtTime(1 / tubeGain(amount), time, 0.02);
    branch.warmth?.gain.setTargetAtTime(-3 * amount, time, 0.02);
  }
  private remove(branch: Branch): void { this.input.disconnect(branch.first); for (const node of branch.nodes) node.disconnect(); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    if (this.current) this.remove(this.current);
    for (const branch of this.retired) this.remove(branch);
    this.retired.clear(); this.input.disconnect(); this.output.disconnect();
  }
}
