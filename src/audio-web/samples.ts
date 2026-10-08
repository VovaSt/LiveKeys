import type { SampleRepository } from '../domain/contracts';
import type { SamplePackManifest, SampleZone } from '../domain/models';
export const dbToGain = (db: number): number => db <= -60 ? 0 : 10 ** (db / 20);
export function selectZone(zones: SampleZone[], note: number, velocity: number, sampleSet?: string): SampleZone | undefined {
  let selected: SampleZone | undefined, distance = Infinity;
  for (const zone of zones) {
    if (zone.sampleSet !== sampleSet || note < zone.keyRange[0] || note > zone.keyRange[1] || velocity < zone.velocityRange[0] || velocity > zone.velocityRange[1]) continue;
    const next = Math.abs(zone.rootNote - note);
    if (next < distance) { selected = zone; distance = next; }
  }
  return selected;
}
export class WebSampleRepository implements SampleRepository<AudioBuffer> {
  private buffers = new Map<string, AudioBuffer>();
  private pending: Promise<unknown> = Promise.resolve();
  pcmBytes = 0;
  constructor(private context: BaseAudioContext, private baseUrl: string, private budget = 256 * 1024 * 1024) {}
  load(manifest: SamplePackManifest): Promise<ReadonlyMap<string, AudioBuffer>> {
    const task = this.pending.catch(() => {}).then(() => this.loadAll(manifest));
    this.pending = task; return task;
  }
  private async loadAll(manifest: SamplePackManifest): Promise<ReadonlyMap<string, AudioBuffer>> {
    const decoder = manifest.decodeSampleRate ? new OfflineAudioContext(1, 1, manifest.decodeSampleRate) : this.context;
    // Sequential decode bounds transient memory. Existing buffers survive retry.
    for (const zone of manifest.zones) {
      if (this.buffers.has(zone.url)) continue;
      const response = await fetch(new URL(zone.url, this.baseUrl), { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Sample ${zone.id}: HTTP ${response.status}`);
      let buffer = await decoder.decodeAudioData(await response.arrayBuffer());
      if (zone.loop && !(zone.loop.start >= 0 && zone.loop.end > zone.loop.start && zone.loop.end <= buffer.duration + 1 / buffer.sampleRate)) throw new Error('Invalid sample loop: ' + zone.id);
      if (manifest.mono) {
        const mono = this.context.createBuffer(1, buffer.length, buffer.sampleRate), output = mono.getChannelData(0);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const data = buffer.getChannelData(channel);
          for (let i = 0; i < data.length; i++) output[i] = output[i]! + data[i]! / buffer.numberOfChannels;
        }
        // Consistent peak reference; velocity gain then supplies dynamics across recorded timbres.
        let peak = 0; for (const value of output) peak = Math.max(peak, Math.abs(value));
        if (peak > 0) for (let i = 0; i < output.length; i++) output[i] = output[i]! * 0.7 / peak;
        buffer = mono;
      }
      const bytes = buffer.length * buffer.numberOfChannels * 4;
      if (this.pcmBytes + bytes > this.budget) throw new Error('PCM budget: 256 MiB');
      this.buffers.set(zone.url, buffer); this.pcmBytes += bytes;
    }
    return this.buffers;
  }
  clear(): void { this.buffers.clear(); this.pcmBytes = 0; }
}
