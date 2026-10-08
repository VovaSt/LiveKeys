import { describe, expect, it, vi } from 'vitest';
import { audibleLayers, curveVelocity, keyRangeGain } from '../../src/domain/layers';
import { createLayer, defaultSettings, pianoPreset, type PerformancePreset } from '../../src/domain/models';
import { makeBackup, parseBackup, parsePreset } from '../../src/domain/serialization';
import { NoteRouter } from '../../src/domain/router';
import type { AudioEngine } from '../../src/domain/contracts';
function rig() {
  const engine = { noteOn: vi.fn(() => true), noteOff: vi.fn(), controlChange: vi.fn(), panic: vi.fn() };
  const preset = structuredClone(pianoPreset); preset.layers.push(createLayer('pad'));
  const router = new NoteRouter(engine as unknown as AudioEngine, preset, 'instance');
  const on = (note = 60, velocity = 100) => router.handle({ input: 'a', channel: 1, type: 'on', note, velocity, time: 0 });
  const off = (note = 60) => router.handle({ input: 'a', channel: 1, type: 'off', note, velocity: 0, time: 1 });
  const sustain = (value: number) => router.handle({ input: 'a', channel: 1, type: 'cc', controller: 64, value, time: 2 });
  return { engine, router, preset, on, off, sustain };
}
describe('layer edits while playing', () => {
  it('supports three octaves in either direction while retaining input notes', () => {
    const { preset, router, on, engine } = rig();
    preset.layers[0]!.octave = -3; preset.layers[1]!.octave = 3;
    router.activate(parsePreset(preset), 'octaves'); on(60);
    expect(engine.noteOn).toHaveBeenNthCalledWith(1, expect.objectContaining({ note: 60, pitch: 24 }), 100, 0);
    expect(engine.noteOn).toHaveBeenNthCalledWith(2, expect.objectContaining({ note: 60, pitch: 96 }), 100, 0);
  });
  it('fades inside either key boundary and keeps hard edges by default', () => {
    const layer = createLayer('fade'); layer.keyRange = [48, 84];
    expect(keyRangeGain(layer, 48)).toBe(1); expect(keyRangeGain(layer, 84)).toBe(1);
    layer.keyFadeLow = 12; layer.keyFadeHigh = 12;
    for (const note of [47, 48, 84, 85]) expect(keyRangeGain(layer, note)).toBe(0);
    for (const note of [54, 78]) expect(keyRangeGain(layer, note)).toBe(0.5);
    for (const note of [60, 66, 72]) expect(keyRangeGain(layer, note)).toBe(1);
    layer.keyRange = [60, 60]; expect(keyRangeGain(layer, 60)).toBe(0);
  });
  it('preserves independent fades in backups and rejects invalid widths', () => {
    const preset = structuredClone(pianoPreset);
    preset.layers[0]!.keyFadeLow = 6; preset.layers[0]!.keyFadeHigh = 24;
    expect(parseBackup(JSON.stringify(makeBackup([preset]))).presets[0]).toEqual(preset);
    for (const field of ['keyFadeLow', 'keyFadeHigh'] as const) for (const value of [-1, 25, 0.5, NaN]) {
      const invalid = structuredClone(preset); invalid.layers[0]![field] = value;
      expect(() => parsePreset(invalid)).toThrow();
    }
  });
  it('layer octaves combine with global transpose without moving splits or losing sustained note-offs', () => {
    const { router, preset, on, off, sustain, engine } = rig();
    preset.layers[0]!.octave = -1; preset.layers[1]!.octave = 1;
    preset.layers[1]!.keyRange = [60, 72]; router.setGlobalTranspose(2);
    sustain(127); on();
    expect(engine.noteOn).toHaveBeenNthCalledWith(1, expect.objectContaining({ note: 60, pitch: 50 }), 100, 0);
    expect(engine.noteOn).toHaveBeenNthCalledWith(2, expect.objectContaining({ note: 60, pitch: 74 }), 100, 0);
    const next = structuredClone(preset); next.layers[0]!.octave = 2;
    router.updatePreset(next, 0.1); off(); expect(engine.noteOff).not.toHaveBeenCalled(); sustain(0);
    expect(engine.noteOff).toHaveBeenCalledWith('1', 2); expect(engine.noteOff).toHaveBeenCalledWith('2', 2);
    on(127); expect(engine.noteOn).toHaveBeenCalledTimes(2);
  });
  it('persists octave and rejects fractional or excessive shifts', () => {
    const preset = structuredClone(pianoPreset); preset.layers[0]!.octave = -2;
    expect(parseBackup(JSON.stringify(makeBackup([preset]))).presets[0]!.layers[0]!.octave).toBe(-2);
    for (const octave of [-4, 4, 0.5, NaN]) {
      preset.layers[0]!.octave = octave; expect(() => parsePreset(preset)).toThrow();
    }
  });
  it('split boundary is inclusive; overlap fans one press to two identities', () => {
    const { router, preset, on, off, engine } = rig();
    preset.layers[0]!.keyRange = [0, 60]; preset.layers[1]!.keyRange = [60, 127];
    router.activate(preset, 'split'); on(59); on(60); on(61);
    expect(engine.noteOn).toHaveBeenCalledTimes(4); off(60);
    expect(engine.noteOff).toHaveBeenCalledWith('2', 1); expect(engine.noteOff).toHaveBeenCalledWith('3', 1);
  });
  it('mute releases only its old voices and re-enable never retriggers keys', () => {
    const { router, preset, on, off, engine } = rig(); on();
    const next = structuredClone(preset); next.layers[1]!.mute = true; router.updatePreset(next, 0.1);
    expect(engine.noteOff).toHaveBeenCalledExactlyOnceWith('2', 0.1, true);
    next.layers[1]!.mute = false; router.updatePreset(structuredClone(next), 0.2);
    expect(engine.noteOn).toHaveBeenCalledTimes(2); off(); expect(engine.noteOff).toHaveBeenLastCalledWith('1', 1);
  });
  it('multiple solo layers work, and mute wins over solo', () => {
    const { preset } = rig(); preset.layers.push(createLayer('pad2')); preset.layers[0]!.solo = true; preset.layers[1]!.solo = true;
    expect(audibleLayers(preset).map(l => l.id)).toEqual(['piano', 'pad']);
    preset.layers[1]!.mute = true; expect(audibleLayers(preset).map(l => l.id)).toEqual(['piano']);
  });
  it('split and global transpose preserve old note-off identity; legacy layer transpose is ignored', () => {
    const { router, preset, on, off, sustain, engine } = rig(); sustain(127); on();
    const next = structuredClone(preset); next.layers[0]!.transpose = 12; next.layers[1]!.keyRange = [80, 127];
    router.updatePreset(next, 0.1); router.setGlobalTranspose(-12); off();
    expect(engine.noteOff).not.toHaveBeenCalled(); sustain(0);
    expect(engine.noteOff).toHaveBeenCalledWith('1', 2); expect(engine.noteOff).toHaveBeenCalledWith('2', 2);
    on(); expect(engine.noteOn).toHaveBeenLastCalledWith(expect.objectContaining({ pitch: 48 }), 100, 0);
  });
  it('disabling sustain releases latched pad but does not release a held key', () => {
    const { router, preset, on, off, sustain, engine } = rig(); sustain(127); on(); off(); on(64);
    const next = structuredClone(preset); next.layers[1]!.sustainEnabled = false; router.updatePreset(next, 0.3);
    expect(engine.noteOff).toHaveBeenCalledExactlyOnceWith('2', 0.3); off(64);
    expect(engine.noteOff).toHaveBeenLastCalledWith('4', 1);
  });
  it('filters original velocity before applying the selected curve', () => {
    const { router, preset, on, engine } = rig(); preset.layers[0]!.velocityRange = [40, 60]; preset.layers[0]!.velocityCurve = 'fixed';
    preset.layers[1]!.enabled = false; router.activate(preset, 'curve'); on(60, 39); on(60, 40);
    expect(engine.noteOn).toHaveBeenCalledExactlyOnceWith(expect.any(Object), 100, 0);
    expect(curveVelocity(40, 'soft')).toBeGreaterThan(40); expect(curveVelocity(40, 'hard')).toBeLessThan(40);
    for (const curve of ['linear', 'soft', 'hard', 'fixed'] as const) for (let velocity = 1; velocity <= 127; velocity++) {
      expect(curveVelocity(velocity, curve)).toBeGreaterThanOrEqual(1); expect(curveVelocity(velocity, curve)).toBeLessThanOrEqual(127);
    }
  });
  it('removing a sustained layer leaves surviving layers and FIFO repeat slots intact', () => {
    const { router, preset, on, off, sustain, engine } = rig(); sustain(127); on(); on();
    router.updatePreset({ ...preset, layers: [preset.layers[0]!] }, 0.1);
    expect(engine.noteOff).toHaveBeenCalledWith('2', 0.1, true); expect(engine.noteOff).toHaveBeenCalledWith('4', 0.1, true);
    off(); sustain(0); expect(engine.noteOff).toHaveBeenLastCalledWith('1', 2);
    off(); expect(engine.noteOff).toHaveBeenLastCalledWith('3', 1);
  });
});
describe('versioned preset data', () => {
  it('round-trips four layers and portable settings without buffers', () => {
    const p = structuredClone(pianoPreset); for (let i = 0; i < 3; i++) p.layers.push(createLayer('pad' + i));
    const backup = makeBackup([p], { ...defaultSettings, masterDb: -18, globalTranspose: -2 });
    expect(parseBackup(JSON.stringify(backup))).toEqual(backup); expect(backup.dependencies).toEqual([{ id: 'salamander-3v', version: '1' }, { id: 'fluid-ensemble', version: '1' }]);
  });
  it.each([
    (p: PerformancePreset) => { p.layers[0]!.pan = NaN; },
    (p: PerformancePreset) => { p.layers[0]!.keyRange = [100, 20]; },
    (p: PerformancePreset) => { p.layers[0]!.transpose = 25; },
    (p: PerformancePreset) => { p.layers[0]!.velocityRange = [0, 127]; },
    (p: PerformancePreset) => { p.layers[0]!.pad.release = Infinity; },
    (p: PerformancePreset) => { p.layers.push(p.layers[0]!); },
    (p: PerformancePreset) => { p.layers = []; },
    (p: PerformancePreset) => { p.layers = Array.from({ length: 5 }, (_, i) => createLayer('x' + i)); },
  ])('rejects invalid data atomically', mutate => {
    const p = structuredClone(pianoPreset); mutate(p); expect(() => parsePreset(p)).toThrow();
  });
  it('rejects unknown versions, missing instruments, missing dependencies, malformed and oversized JSON', () => {
    const p = structuredClone(pianoPreset); p.layers[0]!.instrument.id = 'missing'; expect(() => parsePreset(p)).toThrow('missing-instrument');
    expect(() => parsePreset({ ...pianoPreset, schemaVersion: 900 })).toThrow('version');
    const backup = makeBackup([pianoPreset]); backup.dependencies = [];
    expect(() => parseBackup(JSON.stringify(backup))).toThrow('missing-instrument');
    expect(() => parseBackup('{')).toThrow('invalid'); expect(() => parseBackup(' '.repeat(1024 * 1024 + 1))).toThrow('size');
    const invalid = makeBackup([pianoPreset]); invalid.presets.push(invalid.presets[0]!);
    expect(() => parseBackup(JSON.stringify(invalid))).toThrow('invalid');
  });
});
