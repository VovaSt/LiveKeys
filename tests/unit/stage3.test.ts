import { describe, expect, it, vi } from 'vitest';
import { instruments, createLayer, pianoPreset, defaultPerformanceEffects, type VoiceIdentity } from '../../src/domain/models';
import { factoryPresets } from '../../src/domain/factory';
import { parsePreset, makeBackup, parseBackup } from '../../src/domain/serialization';
import { NoteRouter } from '../../src/domain/router';
import type { AudioEngine } from '../../src/domain/contracts';
import { LimiterDSP } from '../../public/audio/limiter.js';
import { delaySeconds } from '../../src/audio-web/effects';
import { normalizeMidi } from '../../src/domain/midi';
import bundledManifest from '../../public/samples/salamander-3v/manifest.json';
describe('stage 3 catalogue and compatibility', () => {
  it('maps every MIDI key/velocity to exactly one recorded zone', () => {
    const manifest = bundledManifest;
    expect(manifest.zones).toHaveLength(48);
    for (let note = 0; note <= 127; note++) for (let velocity = 1; velocity <= 127; velocity++)
      expect(manifest.zones.filter(z => note >= z.keyRange[0]! && note <= z.keyRange[1]! && velocity >= z.velocityRange[0]! && velocity <= z.velocityRange[1]!)).toHaveLength(1);
  });
  it('decodes the full 14-bit bend including exact center and endpoints', () => {
    for (const [lo, hi, value] of [[0, 0, -1], [0, 64, 0], [127, 127, 1]]) expect(normalizeMidi([0xef, lo!, hi!], 'a', 1)).toMatchObject({ type: 'bend', channel: 16, value });
  });
  it('provides 29 playable definitions and ten valid worship combinations', () => {
    expect(instruments).toHaveLength(29); expect(new Set(instruments.map(i => i.id)).size).toBe(29);
    expect(factoryPresets).toHaveLength(10);
    for (const instrument of instruments) expect(parsePreset({ ...pianoPreset, layers: [createLayer('test', instrument)] }).layers[0]!.instrument).toEqual(instrument);
    for (const preset of factoryPresets) expect(parseBackup(JSON.stringify(makeBackup([preset]))).presets[0]).toEqual(preset);
  });
  it('rejects obsolete preset schemas', () => {
    for (const schemaVersion of [1, 2]) expect(() => parsePreset({ ...pianoPreset, schemaVersion })).toThrow('version');
  });
  it('rejects unsafe feedback, missing controls and nonfinite values', () => {
    for (const value of [-1, 0.86, NaN, Infinity]) expect(() => parsePreset({ ...pianoPreset, effects: { ...pianoPreset.effects, feedback: value } })).toThrow();
    expect(() => parsePreset({ ...pianoPreset, effects: undefined })).toThrow();
  });
  it('computes tempo divisions and honors unsynced time', () => {
    expect(delaySeconds({ ...defaultPerformanceEffects, bpm: 120, division: '3/16' })).toBe(0.375);
    expect(delaySeconds({ ...defaultPerformanceEffects, delaySync: false, delayTime: 0.17 })).toBe(0.17);
  });
});
function monoRig() {
  const engine = { noteOn: vi.fn((_v: VoiceIdentity, _velocity: number, _time: number) => true), noteOff: vi.fn(), controlChange: vi.fn(), resetInput: vi.fn(), panic: vi.fn(), onVoiceEnded: undefined as ((id: string) => void) | undefined };
  const layer = createLayer('lead', instruments.find(i => i.id === 'warm-mono-lead') ?? instruments.find(i => i.id === 'warm-mono')!);
  layer.mono = true; layer.sustainEnabled = true;
  const preset = { ...structuredClone(pianoPreset), layers: [layer] };
  const router = new NoteRouter(engine as unknown as AudioEngine, preset, 'instance');
  const on = (note: number) => router.handle({ input: 'a', channel: 1, type: 'on', note, velocity: 100, time: 0 });
  const off = (note: number) => router.handle({ input: 'a', channel: 1, type: 'off', note, velocity: 0, time: 1 });
  const pedal = (value: number) => router.handle({ input: 'a', channel: 1, type: 'cc', controller: 64, value, time: 2 });
  return { engine, router, preset, on, off, pedal };
}
describe('last-note mono priority', () => {
  it('does not retain unsounded mono keys before audio is ready', () => {
    const { engine, router, on } = monoRig(); engine.noteOn.mockReturnValue(false); on(60); expect(router.heldNotes).toEqual([]);
  });
  it('returns to held pitch, glides from the last pitch and ignores stale physical voice completion', () => {
    const { engine, router, on, off } = monoRig();
    on(60); const first = engine.noteOn.mock.calls[0]![0]; on(64);
    engine.onVoiceEnded?.(first.id); expect(router.heldNotes).toEqual([60, 64]);
    off(64); expect(engine.noteOn.mock.lastCall![0]).toMatchObject({ pitch: 60, glideFrom: 64 });
    off(60); expect(router.heldNotes).toEqual([]);
    expect(engine.noteOff.mock.lastCall).toEqual([engine.noteOn.mock.lastCall![0].id, 1, false]);
  });
  it('pairs repeated notes FIFO and sustain release does not resurrect keys', () => {
    const { engine, router, on, off, pedal } = monoRig();
    pedal(127); on(60); on(60); off(60); expect(engine.noteOn).toHaveBeenCalledTimes(2);
    off(60); expect(router.heldNotes).toEqual([]); pedal(0);
    const count = engine.noteOn.mock.calls.length;
    pedal(0); expect(engine.noteOn).toHaveBeenCalledTimes(count);
    expect(engine.noteOff.mock.lastCall![2]).toBe(false);
  });
  it('mute discards held history, Panic resets it and bend is forwarded', () => {
    const { engine, router, preset, on, off } = monoRig(); on(60); on(64);
    router.updatePreset({ ...preset, layers: [{ ...preset.layers[0]!, mute: true }] }, 0.5);
    off(64); expect(engine.noteOn).toHaveBeenCalledTimes(2);
    router.panic(1); expect(router.heldNotes).toEqual([]);
    router.handle({ type: 'bend', input: 'a', channel: 1, time: 2, value: 0.5 });
    expect(engine.controlChange).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'bend', value: 0.5 }));
  });
});
describe('sample-peak limiter DSP', () => {
  it('links channels, caps hot input and contains nonfinite samples', () => {
    const dsp = new LimiterDSP(48000);
    const input = [new Float32Array([2, 0.5, NaN, Infinity, -8]), new Float32Array([1, -0.5, 0, -Infinity, 4])];
    const output = [new Float32Array(5), new Float32Array(5)];
    expect(dsp.process(input, output, 0.5)).toBeGreaterThan(0);
    expect(output[0]![0]).toBe(0.5); expect(output[1]![0]).toBe(0.25);
    for (const channel of output) for (const sample of channel) { expect(Number.isFinite(sample)).toBe(true); expect(Math.abs(sample)).toBeLessThanOrEqual(0.5); }
  });
  it('recovers gain smoothly after overload without exceeding ceiling', () => {
    const dsp = new LimiterDSP(48000), output = [new Float32Array(48000)];
    dsp.process([new Float32Array(48000).fill(10)], output, 0.8);
    dsp.process([new Float32Array(48000).fill(0.2)], output, 0.8);
    expect(output[0]![0]).toBeLessThan(0.02); expect(output[0]!.at(-1)).toBeCloseTo(0.2, 4);
    for (let i = 1; i < output[0]!.length; i++) expect(Math.abs(output[0]![i]! - output[0]![i - 1]!)).toBeLessThan(0.001);
  });
});
