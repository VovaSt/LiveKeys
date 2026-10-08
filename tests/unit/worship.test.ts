import { expect, it } from 'vitest';
import { instruments, pianoPreset } from '../../src/domain/models';
import { factoryPresets } from '../../src/domain/factory';
import { makeBackup, parseBackup } from '../../src/domain/serialization';

it('curates five simple pads, five leads, four dynamic pads and a separate felt bank', () => {
  expect(instruments.filter(i => i.category === 'pad')).toHaveLength(5);
  expect(instruments.filter(i => i.category === 'lead')).toHaveLength(5);
  expect(instruments.filter(i => i.category === 'dynamic').map(i => i.id)).toEqual(['aurora-motion', 'ocean-bloom', 'shimmer-pad', 'choir-bloom']);
  expect(instruments.find(i => i.id === 'felt-piano')?.definition).toMatchObject({ kind: 'sampler', packId: 'felt-piano' });
});
it('rejects removed sounds instead of substituting a current instrument', () => {
  for (const id of ['prism-pulse', 'wide-pad', 'bright-saw', 'dark-pad', 'velvet-pad', 'pluck', 'bell-keys']) {
    const preset = structuredClone(pianoPreset); preset.layers[0]!.instrument.id = id;
    expect(() => makeBackup([preset])).toThrow('missing-instrument');
  }
});
it('ships ten distinct worship presets spanning 1–4 layers with bounded effects and protected pad bass', () => {
  expect(factoryPresets).toHaveLength(10);
  expect(new Set(factoryPresets.map(p => p.id)).size).toBe(10);
  expect(new Set(factoryPresets.map(p => p.layers.map(l => l.instrument.id).join('+'))).size).toBe(10);
  expect([...new Set(factoryPresets.map(p => p.layers.length))].sort()).toEqual([1, 2, 3, 4]);
  expect(new Set(factoryPresets.flatMap(p => p.layers.flatMap(l => l.effects.rack!.map(fx => fx.type))))).toEqual(new Set(['filter', 'eq', 'reverb', 'chorus', 'delay', 'drive']));
  for (const p of factoryPresets) {
    const base = p.layers[0]!;
    expect(['piano', 'electric']).toContain(base.instrument.category);
    expect(base.keyRange).toEqual([21, 108]);
    expect(base.keyFadeLow ?? 0).toBe(0); expect(base.keyFadeHigh ?? 0).toBe(0);
    expect(base.gainDb).toBe(-3);
    expect(p.layers.slice(1).every(l => l.gainDb < base.gainDb)).toBe(true);
    expect(p.layers.length).toBeLessThanOrEqual(4);
    expect(parseBackup(JSON.stringify(makeBackup([p]))).presets[0]).toEqual(p);
    for (const l of p.layers) {
      expect(l.effects.rack!.length).toBeLessThanOrEqual(2);
      if (['pad', 'dynamic'].includes(l.instrument.category!)) {
        expect(l.keyRange[0]).toBeGreaterThanOrEqual(36); expect(l.keyRange[0]).toBeLessThanOrEqual(48);
        expect(l.voiceLimit).toBe(p.layers.length >= 3 ? 6 : 10);
      }
    }
  }
});
