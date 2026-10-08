import { selectZone } from '../../src/audio-web/samples';
import type { SamplePackManifest } from '../../src/domain/models';
import { SampleVoice } from '../../src/audio-web/voice';
import { LayerToneGraph } from '../../src/audio-web/layer-tone';
import { WebAudioEngine } from '../../src/audio-web/engine';
import { pianoPreset, createLayer, instruments, defaultPerformanceEffects, defaultLayerEffects } from '../../src/domain/models';
import { SharedEffects, LayerEffectGraph } from '../../src/audio-web/effects';
import { OutputGraph } from '../../src/audio-web/output';
import { PadVoice } from '../../src/audio-web/pad';
import { NoteRouter } from '../../src/domain/router';
import type { SampleZone } from '../../src/domain/models';
async function render(velocity: number, release: boolean) {
  const context = new OfflineAudioContext(2, 48000 * 2, 48000);
  const response = await fetch('/samples/salamander-3v/A3v15.mp3');
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  const zone: SampleZone = { id: 'A3', rootNote: 57, keyRange: [0, 127], velocityRange: [1, 127], tuningCents: 0, gainDb: 0, url: '' };
  const master = context.createGain(); master.gain.value = 0.25; master.connect(context.destination);
  const voice = new SampleVoice(context, master, buffer, zone, 60, velocity, 0.02);
  if (release) voice.release(0.5);
  master.gain.setTargetAtTime(0.12, 0.2, 0.015);
  const result = await context.startRendering();
  let energy = 0; let peak = 0; let tail = 0; let maxStep = 0; let finite = true;
  const data = result.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const sample = data[i]!;
    energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); finite &&= Number.isFinite(sample);
    // Piano damper release is now 1.05 s at C4, starting at 0.5 s.
    if (i > 48000 * 1.7) tail = Math.max(tail, Math.abs(sample));
    if (i > 0) maxStep = Math.max(maxStep, Math.abs(sample - data[i - 1]!));
  }
  voice.dispose(); return { energy, peak, tail, finite, maxStep };
}
const engine = new WebAudioEngine();
const router = new NoteRouter(engine, pianoPreset, pianoPreset.id);
Object.assign(window, {
  renderFelt: async (velocity: number) => {
    const context = new OfflineAudioContext(1, 22050 * 4, 22050);
    const manifest = await (await fetch('/samples/felt-piano/manifest.json')).json() as SamplePackManifest;
    const zone = selectZone(manifest.zones, 60, velocity)!;
    const buffer = await context.decodeAudioData(await (await fetch('/' + zone.url)).arrayBuffer());
    const voice = new SampleVoice(context, context.destination, buffer, zone, 60, velocity, 0.02);
    voice.release(2);
    const data = (await context.startRendering()).getChannelData(0);
    let energy = 0, tail = 0;
    for (let i = 0; i < data.length; i++) { energy += data[i]! ** 2; if (i > 22050 * 2 && i < 22050 * 2.4) tail += data[i]! ** 2; }
    return { zone: zone.id, energy, tail, finite: data.every(Number.isFinite), ended: data.slice(-1000).every(v => v === 0) };
  },
  renderVoiceFade: async () => {
    const context = new OfflineAudioContext(1, 48000, 48000);
    const buffer = context.createBuffer(1, 48000, 48000); buffer.getChannelData(0).fill(1);
    const voice = new SampleVoice(context, context.destination, buffer,
      { id: 'test', url: '', rootNote: 60, keyRange: [0, 127], velocityRange: [1, 127], tuningCents: 0, gainDb: 0 }, 60, 127, 0);
    voice.release(0.2, true, 0.5);
    const data = (await context.startRendering()).getChannelData(0);
    return [data[9600], data[21600], data[33600], data[40000]];
  },
  renderSynthRelease: async () => {
    const results = [];
    for (const id of ['drawbar-organ', 'gospel-organ', 'brash-mono', 'funk-butter']) {
      const instrument = instruments.find(i => i.id === id)!, layer = createLayer('test', instrument);
      if (instrument.definition.kind !== 'synth') throw new Error('synth');
      const profile = instrument.definition.profile!;
      for (const at of [0.002, 0.05, 0.8]) {
        const context = new OfflineAudioContext(1, 48000 * 2, 48000);
        const voice = new PadVoice(context, context.destination, 60, 100, 0, layer.pad, 0, profile);
        // Feed DC through the real gain envelope to measure discontinuities directly.
        voice.filter.disconnect();
        const dc = context.createConstantSource(); dc.connect(voice.envelope); dc.start();
        voice.release(at);
        const data = (await context.startRendering()).getChannelData(0), sample = Math.round(at * 48000);
        const end = voice.level * profile.sustain;
        const expected = at < layer.pad.attack ? voice.level * at / layer.pad.attack
          : voice.level * (Math.max(0.000001, end) / voice.level) ** Math.min(1, (at - layer.pad.attack) / profile.decay);
        results.push({ id, at, error: Math.abs(data[sample]! - expected), jump: Math.abs(data[sample]! - data[sample - 1]!), tail: data[Math.ceil((at + layer.pad.release + 0.01) * 48000)] });
      }
    }
    return results;
  },
  renderTone: async (effect: 'eq' | 'drive', enabled: boolean) => {
    const context = new OfflineAudioContext(1, 48000, 48000), tone = new LayerToneGraph(context);
    tone.output.connect(context.destination);
    tone.update({ ...defaultLayerEffects, eqMid: 6, drive: 0.7, rack: [{ type: effect, enabled }] });
    const source = context.createOscillator(), gain = context.createGain();
    source.frequency.value = 1000; gain.gain.value = 0.4;
    source.connect(gain).connect(tone.input); source.start(); source.stop(0.9);
    const data = (await context.startRendering()).getChannelData(0);
    let energy = 0, harmonic = 0;
    for (let i = 24000; i < 36000; i++) { energy += data[i]! ** 2; harmonic += data[i]! * Math.sin(2 * Math.PI * 3000 * i / 48000); }
    tone.dispose(); return { energy, harmonic: Math.abs(harmonic), finite: data.every(Number.isFinite) };
  },
  renderSampled: async (id: string, pitch = 60) => {
    const instrument = instruments.find(i => i.id === id)!, layer = createLayer('render', instrument);
    if (instrument.definition.kind !== 'sampler') throw new Error('Expected sampler');
    const context = new OfflineAudioContext(2, 22050 * 15, 22050);
    const manifest = await (await fetch('/samples/' + instrument.definition.packId + '/manifest.json')).json() as SamplePackManifest;
    const zone = selectZone(manifest.zones, pitch, 100, instrument.definition.sampleSet)!;
    const sample = await context.decodeAudioData(await (await fetch('/' + zone.url)).arrayBuffer());
    const voice = new SampleVoice(context, context.destination, sample, zone, pitch, 100, 0, 0, layer.pad);
    let ended = 0; voice.setEnded(() => ended++); voice.release(13, true);
    const buffer = await context.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    let energy = 0, side = 0, heldEnergy = 0, finite = true, maxStep = 0;
    const windows: number[] = [];
    for (let i = 0; i < left.length; i++) {
      energy += left[i]! ** 2 + right[i]! ** 2; side += (left[i]! - right[i]!) ** 2;
      finite &&= Number.isFinite(left[i]!) && Number.isFinite(right[i]!);
      if (i > 22050 * 10 && i < 22050 * 12) heldEnergy += left[i]! ** 2;
      if (i > 0) maxStep = Math.max(maxStep, Math.abs(left[i]! - left[i - 1]!));
      const window = Math.floor(i / 11025); windows[window] = (windows[window] ?? 0) + left[i]! ** 2 + right[i]! ** 2;
    }
    const result = { energy, heldEnergy, finite, maxStep, side, windows, ended, nodes: voice.nodeCount, tail: left.slice(-1000).every(v => v === 0) && right.slice(-1000).every(v => v === 0) };
    voice.dispose(); return result;
  },
  prepareSampled: async (id: string) => {
    const preset = { ...structuredClone(pianoPreset), layers: [createLayer('sampled', instruments.find(i => i.id === id)!)] };
    await engine.init(); const prepared = await engine.preparePreset(preset); engine.activatePreparedPreset(prepared); router.activate(preset, prepared);
  },
  renderFilterBypass: async (enabled: boolean) => {
    const context = new OfflineAudioContext(1, 24000, 48000);
    const silent = context.createGain();
    const graph = new LayerEffectGraph(context, context.destination, silent, silent,
      { ...defaultLayerEffects, cutoff: 300, rack: [{ type: 'filter', enabled }] }, 0, 0);
    const oscillator = context.createOscillator(); oscillator.frequency.value = 6000;
    oscillator.connect(graph.input); oscillator.start(0.05); oscillator.stop(0.49);
    const rendered = await context.startRendering();
    const energy = rendered.getChannelData(0).slice(12000, 20000).reduce((sum, sample) => sum + sample * sample, 0);
    graph.dispose(); return energy;
  },
  renderMono: async (mono: boolean) => {
    const context = new OfflineAudioContext(2, 1024, 48000), input = context.createGain();
    const output = new OutputGraph(context, input, context.destination, mono);
    const source = context.createBufferSource(), buffer = context.createBuffer(2, 1024, 48000);
    buffer.getChannelData(0).fill(0.6); buffer.getChannelData(1).fill(0.2);
    source.buffer = buffer; source.connect(input); source.start();
    const rendered = await context.startRendering(); output.dispose();
    return [rendered.getChannelData(0)[512], rendered.getChannelData(1)[512]];
  },
  prepareWet: async () => {
    const preset = structuredClone(pianoPreset); preset.layers[0]!.effects.reverbSend = 1; preset.layers[0]!.effects.delaySend = 1;
    preset.layers[0]!.effects.rack = [{ type: 'reverb', enabled: true }, { type: 'delay', enabled: true }];
    await engine.init(); const id = await engine.preparePreset(preset); engine.activatePreparedPreset(id); router.activate(preset, id);
  },
  renderCatalogue: async () => {
    const results = [];
    for (const instrument of instruments) {
      if (instrument.definition.kind !== 'synth') continue;
      const layer = createLayer('render', instrument);
      const context = new OfflineAudioContext(1, 22050 * 5, 22050);
      const voice = new PadVoice(context, context.destination, 60, 100, 0.02, layer.pad, 0, instrument.definition.profile);
      voice.release(4.4, true);
      const buffer = await context.startRendering(), data = buffer.getChannelData(0);
      results.push({ id: instrument.id, energy: data.reduce((n, v) => n + v * v, 0), peak: data.reduce((n, v) => Math.max(n, Math.abs(v)), 0),
        finite: data.every(Number.isFinite), tail: data.slice(-2000).every(v => v === 0) });
      voice.dispose();
    }
    return results;
  },
  renderElectric: async (id: string, velocity: number) => {
    const instrument = instruments.find(i => i.id === id)!, layer = createLayer('render', instrument);
    const context = new OfflineAudioContext(1, 22050, 22050);
    const voice = new PadVoice(context, context.destination, 60, velocity, 0, layer.pad, 0,
      instrument.definition.kind === 'synth' ? instrument.definition.profile : undefined);
    const buffer = await context.startRendering(), data = buffer.getChannelData(0);
    let energy = 0, difference = 0;
    for (let i = 1; i < 4000; i++) { energy += data[i]! ** 2; difference += (data[i]! - data[i - 1]!) ** 2; }
    voice.stop(1); voice.dispose(); return { energy, brightness: difference / energy };
  },
  renderEffects: async (clear: boolean) => {
    const context = new OfflineAudioContext(2, 48000, 48000);
    await context.audioWorklet.addModule('/audio/limiter.js');
    const limiter = new AudioWorkletNode(context, 'live-keys-limiter', { outputChannelCount: [2], parameterData: { ceiling: 0.5 } });
    limiter.connect(context.destination);
    const effects = new SharedEffects(context, limiter, { ...defaultPerformanceEffects, delaySync: false, delayTime: 0.08, reverbDecay: 0.8, feedback: 0.7, eqLow: 12 });
    const layer = new LayerEffectGraph(context, effects.dry, effects.reverbInput, effects.delayInput,
      { ...defaultLayerEffects, reverbSend: 1, delaySend: 1, rack: [{ type: 'reverb', enabled: true }, { type: 'delay', enabled: true }] }, 0, 0);
    const oscillator = context.createOscillator(), gain = context.createGain(); gain.gain.value = 20;
    oscillator.connect(gain).connect(layer.input); oscillator.start(0.05); oscillator.stop(0.1);
    const suspend = clear ? context.suspend(0.2) : undefined;
    const rendering = context.startRendering();
    if (suspend) { await suspend; effects.clear(); await context.resume(); }
    const buffer = await rendering, data = buffer.getChannelData(0);
    const result = { energy: data.reduce((n, v) => n + v * v, 0), peak: data.reduce((n, v) => Math.max(n, Math.abs(v)), 0),
      finite: data.every(Number.isFinite), tail: data.slice(24000).reduce((n, v) => n + v * v, 0) };
    layer.dispose(); effects.dispose(); limiter.disconnect(); return result;
  },
  renderPad: async (early: boolean) => {
    const context = new OfflineAudioContext(1, 48000 * 3, 48000);
    const voice = new PadVoice(context, context.destination, 60, 100, 0, { attack: 0.4, release: 0.5, cutoff: 1600 });
    voice.release(early ? 0.05 : 1); const buffer = await context.startRendering();
    const data = buffer.getChannelData(0);
    const result = { energy: data.reduce((sum, v) => sum + v * v, 0), finite: data.every(Number.isFinite),
      tail: Math.max(...data.slice(-4800).map(Math.abs)), peak: data.reduce((max, v) => Math.max(max, Math.abs(v)), 0) };
    voice.dispose(); return result;
  },
  preparePad: async () => {
    const preset = { ...structuredClone(pianoPreset), layers: [createLayer('pad')] };
    await engine.init(); const id = await engine.preparePreset(preset); engine.activatePreparedPreset(id); router.activate(preset, id);
  },
  preparePiano: async () => engine.preparePreset(pianoPreset),
  note: (down: boolean) => router.handle({ input: 'test', channel: 1, type: down ? 'on' : 'off', note: 60, velocity: down ? 100 : 0, time: engine.now() }),
  renderPiano: render, engine, router,
  prepare: async () => { await engine.init(); const id = await engine.preparePreset(pianoPreset); engine.activatePreparedPreset(id); router.activate(pianoPreset, id); },
  flood: () => {
    router.handle({ type: 'cc', input: 'test', channel: 1, controller: 64, value: 127, time: engine.now() });
    for (let i = 0; i < 150; i++) {
      const note = 36 + i % 48;
      router.handle({ type: 'on', input: 'test', channel: 1, note, velocity: 127, time: engine.now() });
      router.handle({ type: 'off', input: 'test', channel: 1, note, velocity: 0, time: engine.now() });
    }
    return engine.diagnostics();
  }
});
