import type { AudioEngine, Diagnostics } from '../domain/contracts';
import type { LayerConfig, MidiMessage, PerformancePreset, SamplePackManifest, VoiceIdentity } from '../domain/models';
import { defaultPerformanceEffects } from '../domain/models';
import { LayerEffectGraph, SharedEffects } from './effects';
import { audibleLayers, keyRangeGain } from '../domain/layers';
import { parsePreset } from '../domain/serialization';
import { dbToGain, selectZone, WebSampleRepository } from './samples';
import { SampleVoice, type PlayingVoice } from './voice';
import { PadVoice } from './pad';
import { OutputGraph } from './output';
import { AudioLoadMonitor } from './load-monitor';
import { StartupGate } from './startup-gate';
interface LayerBus { graph: LayerEffectGraph; users: number }
interface VoiceRecord { voice: PlayingVoice; identity: VoiceIdentity; bus: LayerBus; expression: GainNode; layer: LayerConfig; finished: boolean }
interface ActivePreset { preset: PerformancePreset; instance: string; buses: Map<string, LayerBus>; audible: Map<string, LayerConfig> }
export class WebAudioEngine implements AudioEngine {
  private context?: AudioContext;
  private repository?: WebSampleRepository;
  private manifests = new Map<string, SamplePackManifest>();
  readonly banks = new Map<string, 'loading' | 'ready' | 'error'>();
  private buffers?: ReadonlyMap<string, AudioBuffer>;
  private preparation: Promise<unknown> = Promise.resolve();
  private prepared = new Map<string, PerformancePreset>();
  private serial = 0;
  private active?: ActivePreset;
  private buses = new Set<LayerBus>();
  private instances: string[] = [];
  private master?: GainNode;
  private limiter?: AudioWorkletNode;
  private effects?: SharedEffects;
  private reduction = 0;
  private controls = new Map<string, { bend: number; mod: number; expression: number }>();
  private before?: AnalyserNode;
  private after?: AnalyserNode;
  private meterData = new Float32Array(1024);
  private voices = new Map<string, VoiceRecord>();
  private retiring = new Map<string, VoiceRecord>();
  private masterDb = -6;
  private outputMono = false;
  private output?: OutputGraph;
  private startupGate?: StartupGate;
  private limit: 32 | 64 = 64;
  private stolenVoices = 0;
  private loadMonitor = new AudioLoadMonitor();
  onVoiceEnded?: (id: string) => void;
  onSuspended?: () => void;
  async init(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.repository = new WebSampleRepository(this.context, document.baseURI);
      this.master = this.context.createGain(); this.master.gain.value = dbToGain(this.masterDb);
      this.before = this.context.createAnalyser(); this.after = this.context.createAnalyser();
      this.before.fftSize = 1024; this.after.fftSize = 1024;
      try {
        await this.context.audioWorklet.addModule(new URL('audio/limiter.js', document.baseURI));
        this.limiter = new AudioWorkletNode(this.context, 'live-keys-limiter', { outputChannelCount: [2] });
      } catch (error) { await this.context.close(); this.context = undefined; throw error; }
      this.limiter.port.onmessage = (event: MessageEvent<number>) => { this.reduction = event.data; };
      this.output = new OutputGraph(this.context, this.master, this.before, this.outputMono);
      this.startupGate = new StartupGate(this.context);
      this.before.connect(this.limiter).connect(this.startupGate.node).connect(this.after).connect(this.context.destination);
      this.effects = new SharedEffects(this.context, this.master, defaultPerformanceEffects);
      this.context.addEventListener('statechange', () => {
        if (this.context?.state !== 'running') { this.startupGate?.suspend(); this.panic(this.now()); this.onSuspended?.(); }
        else if (this.active) this.startupGate?.open();
      });
    }
    await this.resume();
  }
  async resume(): Promise<void> {
    await this.context?.resume();
    if (this.context?.state === 'running' && this.active) this.startupGate?.open();
  }
  now(): number { return this.context?.currentTime ?? 0; }
  midiTime(timestamp: number): number {
    const now = this.now();
    return Math.max(now, now + Math.min(0.01, (timestamp - performance.now()) / 1000));
  }
  async preparePreset(preset: PerformancePreset): Promise<string> {
    const validated = parsePreset(preset);
    const task = this.preparation.catch(() => {}).then(() => this.prepare(validated));
    this.preparation = task; return task;
  }
  private async prepare(preset: PerformancePreset): Promise<string> {
    if (!this.repository) throw new Error('Audio is not initialized');
    for (const layer of preset.layers) if (layer.instrument.definition.kind === 'sampler')
      await this.loadSamples(layer.instrument.definition.packId);
    const id = preset.id + ':' + ++this.serial;
    this.prepared.set(id, preset);
    if (this.prepared.size > 4) this.prepared.delete(this.prepared.keys().next().value!);
    return id;
  }
  needsPreparation(preset: PerformancePreset): boolean {
    return preset.layers.some(l => l.instrument.definition.kind === 'sampler' && this.banks.get(l.instrument.definition.packId) !== 'ready');
  }
  async loadBank(id: string): Promise<void> {
    const task = this.preparation.catch(() => {}).then(() => this.loadSamples(id)); this.preparation = task; await task;
  }
  private async loadSamples(id: string): Promise<void> {
    if (!this.repository || !['salamander-3v', 'fluid-ensemble', 'felt-piano', 'worship-textures'].includes(id)) throw new Error('Unknown bank');
    if (this.banks.get(id) === 'ready') return;
    this.banks.set(id, 'loading');
    try {
      const response = await fetch(new URL('samples/' + id + '/manifest.json', document.baseURI), { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('Manifest: HTTP ' + response.status);
      const manifest = await response.json() as SamplePackManifest;
      if (manifest.schemaVersion !== 1 || manifest.id !== id || !manifest.zones?.length) throw new Error('Invalid bundled manifest');
      this.buffers = await this.repository.load(manifest);
      this.manifests.set(id, manifest); this.banks.set(id, 'ready');
    } catch (error) { this.banks.set(id, 'error'); throw error; }
  }
  private makeBus(layer: LayerConfig): LayerBus {
    const fx = this.effects!;
    const graph = new LayerEffectGraph(this.context!, fx.dry, fx.reverbInput, fx.delayInput, layer.effects, layer.gainDb, layer.pan);
    const bus = { graph, users: 0 }; this.buses.add(bus); return bus;
  }
  private updateEffects(preset: PerformancePreset): void {
    // Reverb/Delay serve only explicit layer sends. Legacy master effects no longer color the mix.
    this.effects!.update(defaultPerformanceEffects);
    this.limiter!.parameters.get('ceiling')!.setValueAtTime(dbToGain(preset.effects.ceiling), this.now());
  }
  activatePreparedPreset(id: string): void {
    const preset = this.prepared.get(id);
    if (!preset || !this.context) throw new Error('Preset is not prepared');
    const buses = new Map(preset.layers.map(layer => [layer.id, this.makeBus(layer)]));
    this.active = { preset, instance: id, buses, audible: new Map(audibleLayers(preset).map(layer => [layer.id, layer])) }; this.prepared.delete(id);
    this.instances.push(id); this.updateEffects(preset);
    if (this.context.state === 'running') this.startupGate?.open();
    // Current + two old instances; fast repeated switches cannot accumulate forever.
    if (this.instances.length > 3) {
      const oldest = this.instances.shift();
      for (const [voiceId, record] of this.voices) if (record.identity.presetInstance === oldest) this.retire(voiceId, record, this.now());
    }
    this.cleanBuses();
  }
  updatePreset(preset: PerformancePreset): void {
    if (!this.active) throw new Error('Preset is not active');
    const next = parsePreset(preset);
    if (this.needsPreparation(next)) throw new Error('Samples not prepared');
    const audible = audibleLayers(next);
    for (const [id, record] of this.voices) {
      if (record.identity.presetInstance !== this.active.instance) continue;
      const layer = audible.find(l => l.id === record.identity.layer);
      const previous = this.active.preset.layers.find(l => l.id === record.identity.layer);
      if (!layer || layer.instrument.id !== previous?.instrument.id || layer.instrument.version !== previous?.instrument.version || layer.mono !== previous?.mono) this.retire(id, record, this.now());
      else {
        record.layer = layer;
        if (record.voice instanceof PadVoice) { record.voice.updateCutoff(layer.pad.cutoff, this.now()); record.voice.updateMovement(layer.pad.movement ?? 0, 0, this.now()); }
        if (record.voice instanceof SampleVoice) record.voice.updateCutoff(layer.pad.cutoff, this.now());
        this.applyControls(record, this.now());
      }
    }
    const nextBuses = new Map<string, LayerBus>();
    for (const layer of next.layers) {
      const previous = this.active.preset.layers.find(l => l.id === layer.id);
      const bus = previous?.instrument.id === layer.instrument.id && previous.instrument.version === layer.instrument.version ? this.active.buses.get(layer.id) : undefined;
      if (bus) bus.graph.update(layer.effects, layer.gainDb, layer.pan);
      nextBuses.set(layer.id, bus ?? this.makeBus(layer));
    }
    this.active.preset = next; this.active.buses = nextBuses;
    this.active.audible = new Map(audible.map(layer => [layer.id, layer]));
    for (const layer of next.layers) this.enforceLayerLimit(layer, this.now());
    this.updateEffects(next); this.cleanBuses();
  }
  noteOn(identity: VoiceIdentity, velocity: number, time: number): boolean {
    if (!this.active || this.context?.state !== 'running' || identity.presetInstance !== this.active.instance || this.voices.has(identity.id)) return false;
    const layer = this.active.audible.get(identity.layer);
    const bus = this.active.buses.get(identity.layer);
    if (!layer || !bus) return false;
    const at = Math.max(this.now(), time);
    const expression = this.context.createGain();
    const initialExpression = this.controls.get(JSON.stringify([identity.input, identity.channel]))?.expression ?? 1;
    expression.gain.value = keyRangeGain(layer, identity.note) * (layer.expressionEnabled ? initialExpression : 1);
    expression.connect(bus.graph.input);
    let voice: PlayingVoice;
    if (layer.instrument.definition.kind === 'synth') {
      voice = new PadVoice(this.context, expression, identity.pitch, velocity, at, layer.pad, layer.fineTune, layer.instrument.definition.profile, layer.glide, identity.glideFrom);
    } else {
      const manifest = this.manifests.get(layer.instrument.definition.packId);
      if (!manifest || !this.buffers) { expression.disconnect(); return false; }
      const zone = selectZone(manifest.zones, identity.pitch, velocity, layer.instrument.definition.sampleSet);
      const buffer = zone && this.buffers.get(zone.url);
      if (!zone || !buffer) { expression.disconnect(); return false; }
      voice = new SampleVoice(this.context, expression, buffer, zone, identity.pitch, velocity, at, layer.fineTune,
        layer.instrument.definition.sustained ? layer.pad : undefined);
    }
    this.enforceLayerLimit(layer, at, 1);
    if (this.voices.size >= this.limit) this.steal(at);
    const record: VoiceRecord = { voice, identity, bus, expression, layer, finished: false }; bus.users++; this.applyControls(record, at);
    voice.setEnded(() => this.finish(record)); this.voices.set(identity.id, record); return true;
  }
  private finish(record: VoiceRecord): void {
    if (record.finished) return; record.finished = true;
    record.voice.dispose(); record.expression.disconnect(); record.bus.users--;
    this.voices.delete(record.identity.id); this.retiring.delete(record.identity.id);
    this.onVoiceEnded?.(record.identity.id); this.cleanBuses();
  }
  private cleanBuses(): void {
    const current = new Set(this.active?.buses.values());
    for (const bus of this.buses) if (bus.users === 0 && !current.has(bus)) {
      bus.graph.dispose(); this.buses.delete(bus);
    }
  }
  private enforceLayerLimit(layer: LayerConfig, time: number, incoming = 0): void {
    if (!['pad', 'dynamic'].includes(layer.instrument.category ?? '')) return;
    let count = incoming;
    for (const record of this.voices.values()) if (record.bus === this.active?.buses.get(layer.id)) count++;
    // Map insertion order is note age; include held, sustained and releasing voices.
    for (const [id, record] of this.voices) {
      if (count <= (layer.voiceLimit ?? 10)) break;
      if (record.bus !== this.active?.buses.get(layer.id)) continue;
      this.stolenVoices++; this.retire(id, record, time, 0.5); count--;
    }
  }
  private retire(id: string, record: VoiceRecord, time: number, fadeSeconds?: number): void {
    record.voice.release(time, true, fadeSeconds); this.voices.delete(id); this.retiring.set(id, record); this.onVoiceEnded?.(id);
    if (this.retiring.size > this.limit) {
      const oldest = this.retiring.values().next().value;
      if (oldest) { oldest.voice.stop(time); this.finish(oldest); }
    }
  }
  private steal(time: number): void {
    let victim: VoiceRecord | undefined, bestScore = Infinity;
    // Preserve release-first/oldest policy without allocating and sorting a voice array on every note.
    for (const record of this.voices.values()) {
      const voice = record.voice;
      const score = voice.released ? voice.level * Math.max(0, 1 - (time - voice.releaseTime) / voice.releaseDuration) : voice.started;
      if (!victim || (voice.released && !victim.voice.released) ||
        (voice.released === victim.voice.released && score < bestScore)) {
        victim = record; bestScore = score;
      }
    }
    if (victim) { this.stolenVoices++; this.retire(victim.identity.id, victim, time); }
  }
  noteOff(id: string, time: number, fast = false): void { this.voices.get(id)?.voice.release(Math.max(this.now(), time), fast); }
  private applyControls(record: VoiceRecord, time: number): void {
    const c = this.controls.get(JSON.stringify([record.identity.input, record.identity.channel])) ?? { bend: 0, mod: 0, expression: 1 };
    record.voice.setBend(c.bend * record.layer.bendRange * 100, time);
    record.expression.gain.setTargetAtTime(keyRangeGain(record.layer, record.identity.note) * (record.layer.expressionEnabled ? c.expression : 1), time, 0.01);
    if (record.voice instanceof PadVoice) record.voice.setModulation(c.mod, time);
  }
  controlChange(message: MidiMessage): void {
    const key = JSON.stringify([message.input, message.channel]);
    const c = this.controls.get(key) ?? { bend: 0, mod: 0, expression: 1 };
    if (message.type === 'bend') c.bend = message.value;
    else if (message.type === 'cc' && message.controller === 1) c.mod = message.value / 127;
    else if (message.type === 'cc' && message.controller === 11) c.expression = message.value / 127;
    else if (message.type === 'cc' && message.controller === 121) { c.bend = 0; c.mod = 0; c.expression = 1; }
    else return;
    this.controls.set(key, c);
    for (const r of this.voices.values()) if (r.identity.input === message.input && r.identity.channel === message.channel) this.applyControls(r, message.time);
  }
  resetInput(input: string, channel?: number): void {
    for (const key of this.controls.keys()) {
      const [i, c] = JSON.parse(key) as [string, number];
      if (i === input && (channel === undefined || channel === c)) this.controls.delete(key);
    }
  }
  updateParameters(p: { masterDb?: number; voiceLimit?: 32 | 64; outputMono?: boolean }): void {
    if (p.outputMono !== undefined) { this.outputMono = p.outputMono; this.output?.setMono(p.outputMono); }
    if (p.masterDb !== undefined && Number.isFinite(p.masterDb)) {
      this.masterDb = Math.max(-60, Math.min(0, p.masterDb));
      this.master?.gain.setTargetAtTime(dbToGain(this.masterDb), this.now(), 0.015);
    }
    if (p.voiceLimit) { this.limit = p.voiceLimit; while (this.voices.size > this.limit) this.steal(this.now()); }
  }
  panic(time: number): void {
    this.controls.clear(); this.effects?.clear();
    for (const [id, record] of this.voices) this.retire(id, record, time);
    for (const record of this.retiring.values()) record.voice.release(time, true);
  }
  diagnostics(): Diagnostics {
    const peak = (node?: AnalyserNode): number => {
      if (!node) return 0; node.getFloatTimeDomainData(this.meterData);
      let result = 0; for (const sample of this.meterData) result = Math.max(result, Math.abs(sample)); return result;
    };
    const playback = (this.context as (AudioContext & { playbackStats?: { underrunEvents: number } }) | undefined)?.playbackStats;
    const load = this.loadMonitor.sample(performance.now(), this.now(), this.context?.state === 'running', document.visibilityState === 'visible', playback?.underrunEvents);
    return { ...load, state: this.context?.state ?? 'not-started', ready: !!this.active,
      voices: this.voices.size, nodes: [...this.voices.values(), ...this.retiring.values()].reduce((n, r) => n + r.voice.nodeCount + 1, 0), voiceLimit: this.limit,
      stolenVoices: this.stolenVoices, retiringVoices: this.retiring.size,
      assets: this.buffers?.size ?? 0, pcmBytes: this.repository?.pcmBytes ?? 0,
      limiterReduction: this.reduction, effectsBytes: this.effects?.memoryBytes ?? 0,
      sampleRate: this.context?.sampleRate ?? 0, baseLatency: this.context?.baseLatency,
      outputLatency: this.context?.outputLatency, peakBefore: peak(this.before), peakAfter: peak(this.after) };
  }
  async dispose(): Promise<void> {
    await this.preparation.catch(() => {});
    this.onSuspended = undefined; this.panic(this.now()); await this.context?.close();
    for (const record of this.retiring.values()) this.finish(record);
    this.active = undefined; this.cleanBuses(); this.prepared.clear(); this.instances = [];
    this.repository?.clear(); this.buffers = undefined; this.manifests.clear(); this.banks.clear(); this.effects?.dispose(); this.effects = undefined;
    if (this.limiter) { this.limiter.port.onmessage = null; this.limiter.disconnect(); } this.output?.dispose(); this.startupGate?.dispose(); this.startupGate = undefined; this.context = undefined;
  }
}
